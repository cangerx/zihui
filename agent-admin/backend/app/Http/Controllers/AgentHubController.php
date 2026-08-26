<?php

namespace App\Http\Controllers;

use App\Models\Agent;
use App\Models\AgentCategory;
use App\Models\SystemSetting;
use App\Services\AgentHub\AgentHubClient;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use RuntimeException;

class AgentHubController extends Controller
{
    private const IMAGE_SUBDIR = 'agents';
    private const IMAGE_MIRROR_MAX_BYTES = 8 * 1024 * 1024;
    private const IMAGE_MIRROR_TIMEOUT = 15;

    public function __construct(private AgentHubClient $hub)
    {
    }

    public function me(): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['enabled' => true, 'ready' => false, 'reason' => $this->notReadyReason()], 503);
        }
        try {
            $resp = $this->hub->get('/me');
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp, fn ($body) => ['enabled' => true, 'ready' => true, 'me' => $body]);
    }

    public function categories(): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }
        try {
            $resp = $this->hub->get('/categories');
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function list(Request $request): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }

        $hubQuery = $request->query();
        unset($hubQuery['exclude_pulled']);
        if (isset($hubQuery['page_size']) && !isset($hubQuery['per_page'])) {
            $hubQuery['per_page'] = $hubQuery['page_size'];
        }
        unset($hubQuery['page_size']);

        if ($request->boolean('exclude_pulled')) {
            return $this->listWithoutPulled($hubQuery, $request);
        }

        try {
            $resp = $this->hub->get('/list', $hubQuery);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function show(int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }
        try {
            $resp = $this->hub->get('/' . $hubId);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function statusBatch(Request $request): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }

        $validator = Validator::make($request->all(), [
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $localIds = array_values(array_unique($request->input('ids')));
        $rows = Agent::whereIn('id', $localIds)->whereNotNull('hub_shared_id')->get(['id', 'hub_shared_id']);
        if ($rows->isEmpty()) {
            return response()->json(['items' => []]);
        }

        $sharedIds = $rows->pluck('hub_shared_id')->all();
        $sharedToLocal = $rows->keyBy('hub_shared_id');
        try {
            $resp = $this->hub->post('/status-batch', ['shared_ids' => $sharedIds]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        if (!$resp->successful()) {
            return $this->forwardError($resp);
        }

        $items = $resp->json('items', []);
        $now = now();
        $output = [];
        DB::transaction(function () use ($items, $sharedToLocal, $now, &$output) {
            foreach ($items as $item) {
                $shared = $sharedToLocal->get($item['id'] ?? null);
                if (!$shared) continue;
                $localId = $shared->id;
                $hubStatus = $item['status'] ?? null;
                Agent::where('id', $localId)->update([
                    'hub_status' => $hubStatus,
                    'hub_status_synced_at' => $now,
                ]);
                $output[] = [
                    'local_id' => $localId,
                    'hub_shared_id' => $item['id'] ?? null,
                    'hub_status' => $hubStatus,
                    'is_visible' => (bool) ($item['is_visible'] ?? true),
                    'approve_count' => (int) ($item['approve_count'] ?? 0),
                    'reject_count' => (int) ($item['reject_count'] ?? 0),
                    'report_count' => (int) ($item['report_count'] ?? 0),
                    'auto_hidden_at' => $item['auto_hidden_at'] ?? null,
                    'latest_reject_reason' => $item['latest_reject_reason'] ?? null,
                ];
            }
        });

        return response()->json(['items' => $output]);
    }

    public function shareToHub(Request $request, int $localId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }

        $user = auth()->user();
        if (!$user) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $validator = Validator::make($request->all(), [
            'hub_category_id' => ['required', 'integer'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $agent = Agent::find($localId);
        if (!$agent) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($user->role !== 'admin' && (int) $agent->submitted_by_user_id !== (int) $user->id) {
            return response()->json(['error' => 'forbidden', 'message' => '只能分享自己投稿的智能体'], 403);
        }
        if ($agent->submission_status !== Agent::STATUS_APPROVED || !$agent->is_visible) {
            return response()->json(['error' => 'not_available', 'message' => '只有审核通过且已上架的智能体才能分享'], 422);
        }
        if ($agent->hub_shared_id) {
            return response()->json(['error' => 'already_shared', 'shared_id' => $agent->hub_shared_id, 'hub_status' => $agent->hub_status], 409);
        }
        if ($agent->from_hub_agent_id) {
            return response()->json(['error' => 'cannot_share_from_hub', 'message' => '从智能体共享库拉取的智能体不能再次分享回去'], 422);
        }

        $avatarUrl = '';
        if ((string) $agent->avatar !== '') {
            $avatarUrl = $this->resolveImageUrl((string) $agent->avatar) ?: '';
            if ($avatarUrl === '') {
                return response()->json(['error' => 'avatar_unreachable', 'message' => '形象图无公网 URL，请检查存储设置'], 422);
            }
        }

        $payload = [
            'hub_category_id' => (int) $request->input('hub_category_id'),
            'name' => (string) $agent->name,
            'description' => (string) $agent->description,
            'system_prompt' => (string) $agent->system_prompt,
            'tool_skill_ids' => json_encode(is_array($agent->tool_skill_ids) ? $agent->tool_skill_ids : [], JSON_UNESCAPED_UNICODE),
            'tool_approval' => (string) $agent->tool_approval,
            'enable_image_gen' => $agent->enable_image_gen ? 1 : 0,
            'tags' => json_encode(is_array($agent->tags) ? $agent->tags : [], JSON_UNESCAPED_UNICODE),
            'avatar_url' => $avatarUrl,
            'source_local_id' => (string) $agent->id,
            'source_site_name' => (string) SystemSetting::getValue('site_title', 'Agent Admin'),
        ];

        try {
            $resp = $this->hub->post('/submit', $payload);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        if (!$resp->successful()) {
            return $this->forwardError($resp);
        }

        $body = $resp->json();
        $sharedId = (int) ($body['shared_id'] ?? 0);
        if ($sharedId > 0) {
            $agent->update([
                'hub_shared_id' => $sharedId,
                'hub_status' => $body['status'] ?? 'pending',
                'hub_status_synced_at' => now(),
            ]);
        }

        Log::info('[AgentHub] shared to hub', ['local_id' => $agent->id, 'shared_id' => $sharedId, 'user_id' => $user->id]);

        return response()->json(['ok' => true, 'local_id' => $agent->id, 'hub_shared_id' => $sharedId, 'hub_status' => $body['status'] ?? 'pending']);
    }

    public function withdrawFromHub(int $localId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }
        $user = auth()->user();
        if (!$user) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }
        $agent = Agent::find($localId);
        if (!$agent) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($user->role !== 'admin' && (int) $agent->submitted_by_user_id !== (int) $user->id) {
            return response()->json(['error' => 'forbidden'], 403);
        }
        if (!$agent->hub_shared_id) {
            return response()->json(['error' => 'not_shared'], 422);
        }

        try {
            $resp = $this->hub->delete('/by-source/' . $agent->id);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        if (!$resp->successful() && $resp->status() !== 404) {
            return $this->forwardError($resp);
        }

        $agent->update(['hub_shared_id' => null, 'hub_status' => null, 'hub_status_synced_at' => now()]);
        Log::info('[AgentHub] withdrew from hub', ['local_id' => $agent->id, 'user_id' => $user->id]);
        return response()->json(['ok' => true, 'local_id' => $agent->id]);
    }

    public function report(Request $request, int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }
        $validator = Validator::make($request->all(), [
            'reason_code' => ['required', 'string', 'max:30'],
            'reason_note' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        try {
            $resp = $this->hub->post('/' . $hubId . '/report', [
                'reason_code' => $request->input('reason_code'),
                'reason_note' => $request->input('reason_note'),
            ]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function adminGetSettings(): JsonResponse
    {
        return response()->json(['enabled' => true, 'endpoint' => $this->hub->endpoint(), 'origin' => $this->hub->origin(), 'ready' => $this->hub->isReady()]);
    }

    public function adminHealthCheck(): JsonResponse
    {
        return response()->json($this->hub->healthCheck());
    }

    public function adminPendingList(Request $request): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }
        $hubQuery = $request->query();
        if (isset($hubQuery['page_size']) && !isset($hubQuery['per_page'])) {
            $hubQuery['per_page'] = $hubQuery['page_size'];
        }
        unset($hubQuery['page_size']);
        try {
            $resp = $this->hub->get('/pending-list', $hubQuery);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function adminReview(Request $request, int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }
        $validator = Validator::make($request->all(), [
            'action' => ['required', 'in:approve,reject'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        try {
            $resp = $this->hub->post('/' . $hubId . '/review', [
                'action' => $request->input('action'),
                'reason' => $request->input('reason'),
            ]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function adminPullToLocal(Request $request, int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'agent_hub_not_configured'], 503);
        }

        $validator = Validator::make($request->all(), [
            'local_category_id' => ['nullable', 'integer', 'exists:agent_categories,id'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $existing = Agent::where('from_hub_agent_id', $hubId)->first(['id']);
        if ($existing) {
            return response()->json(['error' => 'already_pulled', 'local_id' => $existing->id], 409);
        }

        try {
            $resp = $this->hub->get('/' . $hubId);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        if (!$resp->successful()) {
            return $this->forwardError($resp);
        }

        $hubItem = $resp->json();
        if (($hubItem['status'] ?? null) !== 'approved' || empty($hubItem['is_visible'])) {
            return response()->json(['error' => 'not_pullable', 'message' => '仅能拉取已通过审核且未下架的智能体'], 422);
        }

        $localCategory = $request->filled('local_category_id')
            ? AgentCategory::find((int) $request->input('local_category_id'))
            : null;

        $remoteAvatar = (string) ($hubItem['avatar'] ?? '');
        $localAvatar = $remoteAvatar !== '' ? $this->mirrorRemoteImage($remoteAvatar) : null;

        $created = Agent::create([
            'category_id' => $localCategory?->id,
            'name' => (string) ($hubItem['name'] ?? '未命名智能体'),
            'description' => (string) ($hubItem['description'] ?? ''),
            'avatar' => $localAvatar ?? $remoteAvatar,
            'system_prompt' => (string) ($hubItem['system_prompt'] ?? ''),
            'tool_skill_ids' => $this->sanitizeToolSkillIds($hubItem['tool_skill_ids'] ?? null),
            'tool_approval' => $this->normalizeToolApproval($hubItem['tool_approval'] ?? null),
            'enable_image_gen' => (bool) ($hubItem['enable_image_gen'] ?? false),
            'tags' => $this->sanitizeTags($hubItem['tags'] ?? null),
            'sort_order' => 0,
            'is_visible' => true,
            'submission_status' => Agent::STATUS_APPROVED,
            'source_type' => Agent::SOURCE_ADMIN,
            'reviewed_by_user_id' => optional(auth()->user())->id,
            'reviewed_at' => now(),
            'published_at' => now(),
            'from_hub_agent_id' => $hubId,
            'from_hub_source_site_name' => (string) ($hubItem['source_site_name'] ?? ''),
            'source_metadata' => $this->mergeSourceMetadata($hubItem),
            'created_by_user_id' => optional(auth()->user())->id,
        ]);

        Log::info('[AgentHub] pulled to local', [
            'hub_id' => $hubId,
            'local_id' => $created->id,
            'admin_id' => optional(auth()->user())->id,
            'avatar_localized' => $localAvatar !== null,
        ]);

        try {
            $bumpResp = $this->hub->post('/' . $hubId . '/download');
            if (!$bumpResp->successful()) {
                Log::warning('[AgentHub] bump download_count non-2xx', ['hub_id' => $hubId, 'status' => $bumpResp->status(), 'body' => $bumpResp->json()]);
            }
        } catch (\Throwable $e) {
            Log::warning('[AgentHub] bump download_count failed', ['hub_id' => $hubId, 'msg' => $e->getMessage()]);
        }

        return response()->json(['ok' => true, 'local_id' => $created->id, 'agent' => $created->load('category')], 201);
    }

    private function listWithoutPulled(array $hubQuery, Request $request): JsonResponse
    {
        $page = max(1, (int) $request->input('page', 1));
        $pageSize = min(100, max(1, (int) ($request->input('page_size') ?: $request->input('per_page', 24))));
        $hubPerPage = min(60, $pageSize);
        $targetStart = ($page - 1) * $pageSize;
        $targetEnd = $targetStart + $pageSize;
        $targetScanEnd = $targetEnd + 1;
        $scanPage = 1;
        $keptCount = 0;
        $resultItems = [];
        $lastBody = null;
        $rawTotal = 0;
        $seenHubIds = [];

        while ($scanPage <= 200) {
            $query = array_merge($hubQuery, ['page' => $scanPage, 'per_page' => $hubPerPage]);
            try {
                $resp = $this->hub->get('/list', $query);
            } catch (RuntimeException $e) {
                return response()->json(['error' => $e->getMessage()], 503);
            }
            if (!$resp->successful()) {
                return $this->forward($resp);
            }
            $body = $resp->json();
            $lastBody = $body;
            $items = is_array($body['items'] ?? null) ? $body['items'] : [];
            $rawTotal = max($rawTotal, (int) ($body['total'] ?? 0));
            if (empty($items)) break;

            foreach ($this->filterPulledHubItems($items) as $item) {
                $id = (int) ($item['id'] ?? 0);
                if ($id > 0 && isset($seenHubIds[$id])) continue;
                if ($id > 0) $seenHubIds[$id] = true;
                if ($keptCount >= $targetStart && $keptCount < $targetEnd) {
                    $resultItems[] = $item;
                }
                $keptCount++;
                if ($keptCount >= $targetScanEnd) break 2;
            }

            $remotePage = (int) ($body['page'] ?? $scanPage);
            $remotePerPage = (int) ($body['per_page'] ?? $hubPerPage);
            $remoteTotal = (int) ($body['total'] ?? 0);
            if ($remoteTotal > 0 && $remotePage * $remotePerPage >= $remoteTotal) break;
            if (count($items) < $hubPerPage) break;
            $scanPage++;
        }

        return response()->json(['items' => $resultItems, 'total' => $keptCount, 'page' => $page, 'per_page' => $pageSize, 'raw_total' => $lastBody['total'] ?? $rawTotal]);
    }

    private function filterPulledHubItems(array $items): array
    {
        $hubIds = array_values(array_filter(array_map(fn ($item) => (int) ($item['id'] ?? 0), $items)));
        if (empty($hubIds)) return $items;
        $pulledHubIds = Agent::whereIn('from_hub_agent_id', $hubIds)
            ->pluck('from_hub_agent_id')
            ->map(fn ($v) => (int) $v)
            ->all();
        $pulledSet = array_flip($pulledHubIds);
        return array_values(array_filter($items, fn ($item) => !isset($pulledSet[(int) ($item['id'] ?? 0)])));
    }

    private function resolveImageUrl(string $image): ?string
    {
        $image = trim($image);
        if ($image === '') return null;
        if (preg_match('#^https?://#i', $image)) return $image;
        $base = rtrim((string) config('app.url', ''), '/');
        if ($base === '') return null;
        return $base . '/' . ltrim($image, '/');
    }

    private function sanitizeToolSkillIds($value): array
    {
        $arr = $this->parseJsonArray($value);
        $filtered = array_values(array_intersect(
            array_map('strval', $arr),
            Agent::BUILTIN_TOOL_SKILL_IDS
        ));
        return $filtered ?: Agent::BUILTIN_TOOL_SKILL_IDS;
    }

    private function sanitizeTags($value): array
    {
        $arr = $this->parseJsonArray($value);
        $tags = [];
        foreach ($arr as $item) {
            $t = trim((string) $item);
            if ($t !== '') $tags[] = mb_substr($t, 0, 20);
        }
        return array_values(array_slice(array_unique($tags), 0, 10));
    }

    private function normalizeToolApproval($value): string
    {
        $v = (string) ($value ?? '');
        return in_array($v, [Agent::TOOL_APPROVAL_OFF, Agent::TOOL_APPROVAL_DESTRUCTIVE, Agent::TOOL_APPROVAL_ALL], true)
            ? $v
            : Agent::TOOL_APPROVAL_DESTRUCTIVE;
    }

    private function parseJsonArray($value): array
    {
        if (is_array($value)) return $value;
        if (!is_string($value) || trim($value) === '') return [];
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function mirrorRemoteImage(string $remoteUrl): ?string
    {
        $remoteUrl = trim($remoteUrl);
        if ($remoteUrl === '' || !preg_match('#^https?://#i', $remoteUrl)) return null;
        try {
            $resp = Http::timeout(self::IMAGE_MIRROR_TIMEOUT)->withOptions(['allow_redirects' => true])->get($remoteUrl);
        } catch (\Throwable $e) {
            Log::warning('[AgentHub] mirrorRemoteImage request failed', ['url' => $remoteUrl, 'err' => $e->getMessage()]);
            return null;
        }
        if (!$resp->successful()) {
            Log::warning('[AgentHub] mirrorRemoteImage non-2xx', ['url' => $remoteUrl, 'status' => $resp->status()]);
            return null;
        }
        $bytes = $resp->body();
        $size = strlen($bytes);
        if ($size === 0 || $size > self::IMAGE_MIRROR_MAX_BYTES) {
            Log::warning('[AgentHub] mirrorRemoteImage invalid size', ['url' => $remoteUrl, 'size' => $size]);
            return null;
        }
        $ct = strtolower((string) $resp->header('Content-Type'));
        $ext = match (true) {
            str_contains($ct, 'jpeg'), str_contains($ct, 'jpg') => 'jpg',
            str_contains($ct, 'png') => 'png',
            str_contains($ct, 'webp') => 'webp',
            str_contains($ct, 'gif') => 'gif',
            default => $this->guessImageExtFromUrl($remoteUrl),
        };
        $contentType = match ($ext) {
            'jpg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'gif' => 'image/gif',
            default => 'application/octet-stream',
        };
        $filename = (string) Str::uuid() . '.' . $ext;
        $localUrl = StorageService::putBytes($bytes, $contentType, self::IMAGE_SUBDIR, $filename);
        if ($localUrl === null) {
            Log::warning('[AgentHub] mirrorRemoteImage putBytes failed', ['url' => $remoteUrl, 'storage' => StorageService::getStorageType(), 'filename' => $filename]);
            return null;
        }
        return $localUrl;
    }

    private function guessImageExtFromUrl(string $url): string
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        $ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));
        return match ($ext) {
            'jpg', 'jpeg' => 'jpg',
            'png', 'webp', 'gif' => $ext,
            default => 'png',
        };
    }

    private function mergeSourceMetadata(array $hubItem): array
    {
        $metadata = is_array($hubItem['source_metadata'] ?? null) ? $hubItem['source_metadata'] : [];
        $metadata['hub_agent_id'] = (int) ($hubItem['id'] ?? 0);
        $metadata['hub_source_site_name'] = (string) ($hubItem['source_site_name'] ?? '');
        return $metadata;
    }

    private function forward(\Illuminate\Http\Client\Response $resp, ?callable $transform = null): JsonResponse
    {
        $body = $resp->json();
        if ($transform && $resp->successful()) {
            $body = $transform($body);
        }
        return response()->json($body, $resp->status());
    }

    private function forwardError(\Illuminate\Http\Client\Response $resp): JsonResponse
    {
        return response()->json($resp->json() ?: ['error' => 'hub_error'], $resp->status());
    }

    private function notReadyReason(): string
    {
        if ($this->hub->endpoint() === '') return 'endpoint_empty';
        if ($this->hub->origin() === '') return 'origin_empty';
        return 'unknown';
    }
}
