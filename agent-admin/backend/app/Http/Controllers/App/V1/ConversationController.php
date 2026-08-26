<?php

namespace App\Http\Controllers\App\V1;

use App\Http\Controllers\GatewayController;
use App\Models\AppConversation;
use App\Models\AppMessage;
use App\Models\CloudModel;
use App\Models\ModelAssignment;
use App\Support\AppV1Response;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class ConversationController
{
    public function index(Request $request)
    {
        if (!$this->enabled()) return $this->disabled();

        $user = $request->user();
        $items = AppConversation::query()
            ->where('user_id', $user->id)
            ->withCount('messages')
            ->orderByDesc('pinned')
            ->orderByDesc('updated_at')
            ->limit(min(100, max(1, (int) $request->input('limit', 50))))
            ->get()
            ->map(fn (AppConversation $conversation) => $this->conversation($conversation))
            ->values()->all();

        return AppV1Response::ok($items);
    }

    public function store(Request $request)
    {
        if (!$this->enabled()) return $this->disabled();

        $validator = Validator::make($request->all(), [
            'title' => ['nullable', 'string', 'max:160'],
            'model' => ['nullable', 'string', 'max:200'],
            'cloud_model_id' => ['nullable', 'integer'],
        ]);
        if ($validator->fails()) return AppV1Response::error('validation_error', $validator->errors()->first(), 422);

        $model = $this->resolveChatModel($request->user(), $request->input('model'), $request->input('cloud_model_id'));
        if ($model instanceof \Illuminate\Http\JsonResponse) return $model;

        $conversation = AppConversation::create([
            'user_id' => $request->user()->id,
            'title' => trim((string) ($request->input('title') ?: '新对话')),
            'model' => (string) $model->model_id,
            'cloud_model_id' => $model->id,
            'pinned' => false,
        ]);

        return AppV1Response::ok($this->conversation($conversation), 201);
    }

    public function show(Request $request, int $id)
    {
        if (!$this->enabled()) return $this->disabled();
        $conversation = $this->owned($request, $id);
        if (!$conversation) return AppV1Response::error('not_found', 'Conversation not found', 404);
        $conversation->load(['messages' => fn ($query) => $query->orderBy('id')]);

        return AppV1Response::ok(array_merge($this->conversation($conversation), [
            'messages' => $conversation->messages->map(fn (AppMessage $message) => $this->message($message))->values()->all(),
        ]));
    }

    public function update(Request $request, int $id)
    {
        if (!$this->enabled()) return $this->disabled();
        $conversation = $this->owned($request, $id);
        if (!$conversation) return AppV1Response::error('not_found', 'Conversation not found', 404);

        $validator = Validator::make($request->all(), [
            'title' => ['sometimes', 'string', 'max:160'],
            'pinned' => ['sometimes', 'boolean'],
        ]);
        if ($validator->fails()) return AppV1Response::error('validation_error', $validator->errors()->first(), 422);
        $conversation->fill($request->only(['title', 'pinned']))->save();

        return AppV1Response::ok($this->conversation($conversation));
    }

    public function destroy(Request $request, int $id)
    {
        if (!$this->enabled()) return $this->disabled();
        $conversation = $this->owned($request, $id);
        if (!$conversation) return AppV1Response::error('not_found', 'Conversation not found', 404);
        $conversation->delete();

        return AppV1Response::ok(null);
    }

    public function sendMessage(Request $request, int $id)
    {
        if (!$this->enabled()) return $this->disabled();
        $conversation = $this->owned($request, $id);
        if (!$conversation) return AppV1Response::error('not_found', 'Conversation not found', 404);

        $prepared = $this->prepareMessage($request, $conversation);
        if ($prepared instanceof \Illuminate\Http\JsonResponse) return $prepared;

        $model = $prepared['model'];
        $content = $prepared['content'];
        $requestId = $prepared['request_id'];
        $userMessage = $prepared['user_message'];
        $gatewayRequest = $this->gatewayRequest($prepared, false);
        try {
            $gatewayResponse = app(GatewayController::class)->chatCompletions($gatewayRequest);
        } catch (\Throwable $e) {
            $userMessage->delete();
            report($e);
            return AppV1Response::error('gateway_error', '模型调用失败，请稍后重试', 502);
        }
        if ($gatewayResponse->getStatusCode() >= 400) {
            $userMessage->delete();
            return AppV1Response::error(
                'gateway_error',
                $this->gatewayError($gatewayResponse->getData(true)),
                $gatewayResponse->getStatusCode()
            );
        }

        $payload = $gatewayResponse->getData(true);
        $assistantContent = $this->assistantContentFromPayload($payload);
        if ($assistantContent === '') {
            $userMessage->delete();
            return AppV1Response::error('empty_response', '模型未返回内容，请稍后重试', 502);
        }

        $assistantMessage = $this->persistAssistant($conversation, $model, $content, $assistantContent, $requestId);

        return AppV1Response::ok([
            'user_message' => $this->message($userMessage),
            'assistant_message' => $this->message($assistantMessage),
        ]);
    }

    public function streamMessage(Request $request, int $id)
    {
        if (!$this->enabled()) return $this->disabled();
        $conversation = $this->owned($request, $id);
        if (!$conversation) return AppV1Response::error('not_found', 'Conversation not found', 404);

        $prepared = $this->prepareMessage($request, $conversation);
        if ($prepared instanceof \Illuminate\Http\JsonResponse) return $prepared;

        $model = $prepared['model'];
        $content = $prepared['content'];
        $requestId = $prepared['request_id'];
        $userMessage = $prepared['user_message'];
        $streamBuffer = '';
        $assistantContent = '';

        $gatewayRequest = $this->gatewayRequest($prepared, true);
        $gatewayRequest->attributes->set('app_stream_listener', function (string $chunk) use (&$streamBuffer, &$assistantContent): void {
            $this->collectStreamChunk($chunk, $streamBuffer, $assistantContent);
        });
        $gatewayRequest->attributes->set('app_stream_complete_listener', function (array $result) use (
            &$streamBuffer,
            &$assistantContent,
            $conversation,
            $model,
            $content,
            $requestId,
            $userMessage
        ): void {
            if ($streamBuffer !== '') {
                $this->collectStreamChunk("\n", $streamBuffer, $assistantContent);
            }
            if (($result['ok'] ?? false) && trim($assistantContent) !== '') {
                $this->persistAssistant($conversation, $model, $content, $assistantContent, $requestId);
                return;
            }
            $userMessage->delete();
        });

        try {
            $gatewayResponse = app(GatewayController::class)->chatCompletions($gatewayRequest);
        } catch (\Throwable $e) {
            $userMessage->delete();
            report($e);
            return AppV1Response::error('gateway_error', '模型调用失败，请稍后重试', 502);
        }
        if ($gatewayResponse->getStatusCode() >= 400) {
            $userMessage->delete();
            return AppV1Response::error(
                'gateway_error',
                $this->gatewayError($gatewayResponse->getData(true)),
                $gatewayResponse->getStatusCode()
            );
        }

        return $gatewayResponse;
    }

    private function prepareMessage(Request $request, AppConversation $conversation)
    {
        $validator = Validator::make($request->all(), [
            'content' => ['required', 'string', 'max:20000'],
            'model' => ['nullable', 'string', 'max:200'],
            'cloud_model_id' => ['nullable', 'integer'],
        ]);
        if ($validator->fails()) return AppV1Response::error('validation_error', $validator->errors()->first(), 422);

        $model = $this->resolveChatModel(
            $request->user(),
            $request->input('model') ?: $conversation->model,
            $request->input('cloud_model_id') ?: $conversation->cloud_model_id
        );
        if ($model instanceof \Illuminate\Http\JsonResponse) return $model;

        $requestId = (string) Str::uuid();
        $content = trim((string) $request->input('content'));
        $userMessage = AppMessage::create([
            'conversation_id' => $conversation->id,
            'user_id' => $request->user()->id,
            'role' => 'user',
            'content' => $content,
            'model' => (string) $model->model_id,
            'request_id' => $requestId,
        ]);

        $messages = $conversation->messages()
            ->whereIn('role', ['user', 'assistant', 'system'])
            ->orderBy('id')
            ->limit((int) config('app_v1.max_context_messages', 50))
            ->get()
            ->map(fn (AppMessage $message) => [
                'role' => $message->role,
                'content' => $message->content,
            ])->values()->all();

        return [
            'model' => $model,
            'content' => $content,
            'request_id' => $requestId,
            'user_message' => $userMessage,
            'messages' => $messages,
        ];
    }

    private function gatewayRequest(array $prepared, bool $stream): Request
    {
        return Request::create('/api/gateway/chat/completions', 'POST', [
            'model' => $prepared['model']->model_id,
            'cloud_model_id' => $prepared['model']->id,
            'messages' => $prepared['messages'],
            'stream' => $stream,
        ]);
    }

    private function assistantContentFromPayload(array $payload): string
    {
        $content = $payload['choices'][0]['message']['content'] ?? $payload['data']['choices'][0]['message']['content'] ?? '';
        if (is_array($content)) {
            $content = collect($content)->map(fn ($part) => is_array($part) ? ($part['text'] ?? '') : (string) $part)->implode('');
        }
        return trim((string) $content);
    }

    private function persistAssistant(AppConversation $conversation, CloudModel $model, string $userContent, string $assistantContent, string $requestId): AppMessage
    {
        $assistantMessage = AppMessage::create([
            'conversation_id' => $conversation->id,
            'user_id' => $conversation->user_id,
            'role' => 'assistant',
            'content' => trim($assistantContent),
            'model' => (string) $model->model_id,
            'request_id' => $requestId,
        ]);
        if ($conversation->title === '新对话') {
            $conversation->title = Str::limit($userContent, 60, '');
        }
        $conversation->model = (string) $model->model_id;
        $conversation->cloud_model_id = $model->id;
        $conversation->save();
        return $assistantMessage;
    }

    private function collectStreamChunk(string $chunk, string &$buffer, string &$content): void
    {
        $buffer .= str_replace("\r\n", "\n", $chunk);
        while (($newline = strpos($buffer, "\n")) !== false) {
            $line = substr($buffer, 0, $newline);
            $buffer = substr($buffer, $newline + 1);
            $this->collectStreamLine($line, $content);
        }
    }

    private function collectStreamLine(string $line, string &$content): void
    {
        $line = trim($line);
        if (!str_starts_with($line, 'data:')) return;
        $data = trim(substr($line, 5));
        if ($data === '' || $data === '[DONE]') return;
        $payload = json_decode($data, true);
        if (!is_array($payload)) return;
        $delta = $payload['choices'][0]['delta']['content'] ?? $payload['choices'][0]['message']['content'] ?? '';
        if (is_array($delta)) {
            $delta = collect($delta)->map(fn ($part) => is_array($part) ? ($part['text'] ?? '') : (string) $part)->implode('');
        }
        $content .= (string) $delta;
    }

    private function owned(Request $request, int $id): ?AppConversation
    {
        return AppConversation::where('id', $id)->where('user_id', $request->user()->id)->first();
    }

    private function conversation(AppConversation $conversation): array
    {
        return [
            'id' => (int) $conversation->id,
            'title' => (string) $conversation->title,
            'model' => (string) $conversation->model,
            'message_count' => (int) ($conversation->messages_count ?? $conversation->messages()->count()),
            'pinned' => (bool) $conversation->pinned,
            'created_at' => optional($conversation->created_at)->toISOString(),
            'updated_at' => optional($conversation->updated_at)->toISOString(),
        ];
    }

    private function message(AppMessage $message): array
    {
        return [
            'id' => (int) $message->id,
            'role' => (string) $message->role,
            'content' => (string) $message->content,
            'model' => (string) $message->model,
            'created_at' => optional($message->created_at)->toISOString(),
        ];
    }

    private function resolveChatModel($user, ?string $modelId, $cloudModelId)
    {
        $query = CloudModel::query()->where('type', 'chat')->where('status', 'active')->whereHas('provider', fn ($q) => $q->where('status', 'active'))->with('provider');
        if ($cloudModelId !== null && $cloudModelId !== '') {
            $query->where('id', (int) $cloudModelId);
        } elseif ($modelId) {
            $query->where(fn ($q) => $q->where('model_id', $modelId)->orWhere('name', $modelId));
        }
        $models = $query->orderBy('id')->get()->filter(fn (CloudModel $model) => $this->authorized($user, $model));
        if ($models->count() > 1 && $cloudModelId === null) {
            return AppV1Response::error('ambiguous_model', '模型路由不唯一，请重新选择模型', 409);
        }
        $model = $models->first();
        if (!$model) return AppV1Response::error('model_unavailable', '当前没有可用的对话模型', 503);
        return $model;
    }

    private function authorized($user, CloudModel $model): bool
    {
        if (ModelAssignment::where('cloud_model_id', $model->id)->where('assignee_type', 'user')->where('assignee_id', $user->id)->exists()) return true;
        $groupIds = $user->groups()->pluck('user_groups.id')->all();
        return $groupIds !== [] && ModelAssignment::where('cloud_model_id', $model->id)->where('assignee_type', 'group')->whereIn('assignee_id', $groupIds)->exists();
    }

    private function enabled(): bool
    {
        return (bool) config('app_v1.features.chat', false);
    }

    private function disabled()
    {
        return AppV1Response::error('feature_disabled', '对话功能暂未开放', 503);
    }

    private function gatewayError(array $payload): string
    {
        $error = $payload['error'] ?? null;
        if (is_array($error)) {
            return (string) ($error['message'] ?? $error['error'] ?? '模型调用失败');
        }
        return (string) ($payload['message'] ?? $error ?? '模型调用失败');
    }
}
