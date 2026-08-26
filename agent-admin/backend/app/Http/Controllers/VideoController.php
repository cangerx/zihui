<?php

namespace App\Http\Controllers;

use App\Models\TemporaryReferenceAsset;
use App\Models\User;
use App\Models\VideoModelSpec;
use App\Models\VideoPricingRule;
use App\Models\VideoProviderAccount;
use App\Models\VideoSkuPrice;
use App\Models\VideoTask;
use App\Models\VideoUsageRecord;
use App\Services\StorageService;
use App\Services\Video\TemporaryReferenceAssetService;
use App\Services\Video\VideoCatalogDiagnosticsService;
use App\Services\Video\VideoModelImportService;
use App\Services\Video\VideoProviderManager;
use App\Services\Video\VideoSkuSupportService;
use App\Services\Video\VideoTaskService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class VideoController extends Controller
{
    public function clientCatalog()
    {
        return response()->json(app(VideoTaskService::class)->catalog(auth()->user()));
    }

    public function clientUploadReference(Request $request)
    {
        $request->validate([
            'file' => 'required|file|max:51200',
            'asset_type' => 'nullable|in:image,video,audio',
        ]);

        try {
            $asset = app(TemporaryReferenceAssetService::class)->upload(auth()->user(), $request->file('file'), (string)$request->input('asset_type', 'image'));
        } catch (\Throwable $e) {
            // 真实异常原本被统一抹成笼统「更换更小的文件」误导用户；改为按异常类型分类成
            // 可自助排查的提示（DB 未迁移 / 对象存储配错 / 目录权限），完整异常仍记日志供运维定位。
            return $this->referenceUploadErrorResponse($e, 'video:reference-upload');
        }
        return response()->json(['asset' => $this->serializeAsset($asset)]);
    }

    /**
     * 图片生成参考图上传（桌面端本地直连多米等「只收图片 URL」的服务商用）。
     *
     * 多米图片 API 不可靠接受 base64/dataUri，桌面端先把参考图传到这里换成公网 URL，
     * 再交给多米。素材落 temporary_reference_assets（image 类型，6h 过期），由
     * video:purge-reference-assets 定时清理，不会无限堆积成孤儿文件。
     */
    public function clientUploadImageReference(Request $request)
    {
        $request->validate([
            'file' => 'required|file|image|max:20480',
        ]);

        try {
            $asset = app(TemporaryReferenceAssetService::class)->upload(
                auth()->user(),
                $request->file('file'),
                'image',
                'image-reference-assets',
                6
            );
        } catch (\Throwable $e) {
            return $this->referenceUploadErrorResponse($e, 'video:image-reference-upload');
        }

        return response()->json([
            'url' => $asset->storage_url,
            'asset' => $this->serializeAsset($asset),
        ]);
    }

    /**
     * 参考素材直出（公开、无需登录）。
     *
     * storage_type=local 且 public 目录不可写时，参考素材落 storage 兜底目录、按 public 直链外部
     * 访问会 404 —— 上游服务商回拉参考图与桌面端预览均失效（视频链路无 base64 materialize 兜底）。
     * 本端点由 StorageService::readBytes 从 public 或 storage 兜底目录读出回流，保证可拉。
     *
     * 安全：只服务 video-reference-assets / image-reference-assets 两个子目录，文件名为不可猜的 uuid
     * （与 public 直链同等安全模型）；拒绝路径穿越；上游/桌面端无凭据可访问，故不加鉴权（同 public 直链）。
     */
    public function publicServeReferenceBlob(string $path)
    {
        if (str_contains($path, '..') || !preg_match('#^(video-reference-assets|image-reference-assets)/[A-Za-z0-9._-]+$#', $path)) {
            abort(404);
        }
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'gif' => 'image/gif',
            'bmp' => 'image/bmp',
            'mp4' => 'video/mp4',
            'mov' => 'video/quicktime',
            'webm' => 'video/webm',
            'mp3' => 'audio/mpeg',
            'wav' => 'audio/wav',
            'm4a' => 'audio/mp4',
            'ogg' => 'audio/ogg',
            default => 'application/octet-stream',
        };
        // local 文件流式发送（BinaryFileResponse，避免大视频整读入内存）；
        // cos/oss 后端（端点被直接命中）无本地文件时回退整读。
        $local = StorageService::localAbsolutePath($path);
        if ($local !== null) {
            return response()->file($local, [
                'Content-Type' => $mime,
                'Cache-Control' => 'public, max-age=3600',
            ]);
        }
        $bytes = StorageService::readBytes('/' . $path);
        if ($bytes === null) {
            abort(404);
        }
        return response($bytes, 200)
            ->header('Content-Type', $mime)
            ->header('Content-Length', (string) strlen($bytes))
            ->header('Cache-Control', 'public, max-age=3600');
    }

    /**
     * 参考素材上传失败的分类报错。
     *
     * 上传失败原本被统一抹成「请稍后重试或更换更小的文件」，对独立部署排查极不友好——
     * 真因几乎都是：后端数据库未迁移（如缺 storage_driver 字段）、对象存储配置错误、
     * 或本地 public 目录不可写。这里按异常类型给出可自助处理的中文提示，并把真实异常
     * 类名 + 消息记入日志供运维定位（前端 translateError 对未命中映射的文案原样透传）。
     */
    private function referenceUploadErrorResponse(\Throwable $e, string $logTag)
    {
        Log::warning("[{$logTag}] " . get_class($e) . ': ' . $e->getMessage());

        // QueryException 继承自 PDOException：缺字段 / 表不存在 / 连接失败都会命中，
        // 独立部署下绝大多数是后端没执行数据库迁移。
        if ($e instanceof \PDOException) {
            return response()->json([
                'error' => '上传失败：后端数据库未完成升级，请联系管理员升级后端并执行数据库迁移后重试。',
                'code' => 'reference_db_error',
            ], 500);
        }

        // 其余（uploadAbsolute 返回 null 抛的 RuntimeException、$file->move() 的 FileException）
        // 归为存储转存失败：对象存储密钥/桶/region 配错，或本地存储目录不可写。
        return response()->json([
            'error' => '上传失败：服务器存储转存失败，请检查对象存储（COS/OSS）配置或存储目录权限；若为偶发网络问题可稍后重试。',
            'code' => 'reference_storage_error',
        ], 500);
    }

    public function clientSubmit(Request $request)
    {
        $payload = $request->validate([
            'sku_key' => 'required|string|max:200',
            'prompt' => 'required|string|max:8000',
            'negative_prompt' => 'nullable|string|max:4000',
            'mode' => 'nullable|string|max:50',
            'duration_seconds' => 'nullable|integer|min:1|max:120',
            'resolution' => 'nullable|string|max:50',
            'aspect_ratio' => 'nullable|string|max:50',
            'quality' => 'nullable|string|max:50',
            'reference_assets' => 'nullable|array|max:20',
            'reference_assets.*.id' => 'nullable',
            'reference_assets.*.asset_type' => 'required_with:reference_assets|string|in:image,video,audio',
            'reference_assets.*.original_name' => 'nullable|string|max:255',
            'reference_assets.*.url' => 'required_with:reference_assets|string|max:1000',
            'reference_assets.*.role' => 'nullable|string|in:reference,subject,scene,style,first_frame,last_frame',
            'reference_assets.*.index' => 'nullable|integer|min:1|max:20',
            'reference_assets.*.label' => 'nullable|string|max:50',
            'reference_asset_notes' => 'nullable|string|max:1000',
            'reference_image_urls' => 'nullable|array|max:10',
            'reference_image_urls.*' => 'string|max:1000',
            'reference_video_urls' => 'nullable|array|max:3',
            'reference_video_urls.*' => 'string|max:1000',
            'reference_audio_urls' => 'nullable|array|max:3',
            'reference_audio_urls.*' => 'string|max:1000',
        ]);

        try {
            $task = app(VideoTaskService::class)->create(auth()->user(), $payload);
            return response()->json(['task' => app(VideoTaskService::class)->serializeTask($task)]);
        } catch (\Throwable $e) {
            $code = str_contains($e->getMessage(), 'Insufficient credit balance') ? 402 : 422;
            return response()->json(['error' => $e->getMessage()], $code);
        }
    }

    public function clientTasks(Request $request)
    {
        $query = VideoTask::where('user_id', auth()->id())->with(['modelSpec', 'sku', 'result']);
        if ($request->filled('status')) $query->where('status', $request->status);
        $service = app(VideoTaskService::class);
        $paginator = $query->orderByDesc('created_at')->paginate((int)$request->get('per_page', 20));
        $items = [];
        foreach ($paginator as $task) {
            $items[] = $service->serializeTask($task);
        }
        return response()->json($this->paginatedPayload($paginator, $items));
    }

    public function clientShow(string $taskId)
    {
        $task = VideoTask::where('id', $taskId)->where('user_id', auth()->id())->with(['modelSpec', 'sku', 'result'])->first();
        if (!$task) return response()->json(['error' => 'Task not found'], 404);
        return response()->json(['task' => app(VideoTaskService::class)->serializeTask($task)]);
    }

    public function clientRefresh(string $taskId)
    {
        $task = VideoTask::where('id', $taskId)->where('user_id', auth()->id())->first();
        if (!$task) return response()->json(['error' => 'Task not found'], 404);
        $task = app(VideoTaskService::class)->refresh($task);
        return response()->json(['task' => app(VideoTaskService::class)->serializeTask($task)]);
    }

    public function clientCancel(string $taskId)
    {
        $task = VideoTask::where('id', $taskId)->where('user_id', auth()->id())->with('account')->first();
        if (!$task) return response()->json(['error' => 'Task not found'], 404);
        $task = app(VideoTaskService::class)->cancel($task);
        return response()->json(['task' => app(VideoTaskService::class)->serializeTask($task)]);
    }

    public function clientUsage(Request $request)
    {
        $query = VideoUsageRecord::where('user_id', auth()->id());
        if ($request->filled('status')) $query->where('status', $request->status);
        $paginator = $query->orderByDesc('created_at')->paginate((int)$request->get('per_page', 20));
        $items = [];
        foreach ($paginator as $record) {
            $items[] = [
                'id' => (int)$record->id,
                'video_task_id' => $record->video_task_id,
                'video_model_spec_id' => $record->video_model_spec_id,
                'video_sku_price_id' => $record->video_sku_price_id,
                'provider_key' => $record->provider_key,
                'provider_protocol' => $record->provider_protocol,
                'model_id' => $record->model_id,
                'sku_key' => $record->sku_key,
                'credits_used' => (float)$record->credits_used,
                'balance_type' => $record->balance_type,
                'status' => $record->status,
                'request_id' => $record->request_id,
                'remark' => $record->remark,
                'created_at' => $record->created_at,
                'updated_at' => $record->updated_at,
            ];
        }
        return response()->json($this->paginatedPayload($paginator, $items));
    }

    public function adminStats()
    {
        return response()->json([
            'accounts' => VideoProviderAccount::count(),
            'active_accounts' => VideoProviderAccount::where('status', 'active')->count(),
            'models' => VideoModelSpec::count(),
            'skus' => VideoSkuPrice::count(),
            'unpriced_skus' => VideoSkuPrice::where('status', 'active')->whereNull('default_credit_cost')->count(),
            'tasks' => VideoTask::count(),
            'pending_tasks' => VideoTask::whereIn('status', ['pending', 'submitting', 'submitted', 'running'])->count(),
            'completed_tasks' => VideoTask::where('status', 'completed')->count(),
            'failed_tasks' => VideoTask::where('status', 'failed')->count(),
            'credits_used' => (float)VideoUsageRecord::where('status', 'success')->sum('credits_used'),
        ]);
    }

    public function adminAccounts(Request $request)
    {
        $query = VideoProviderAccount::query();
        if ($request->filled('provider_key')) $query->where('provider_key', $request->provider_key);
        if ($request->filled('status')) $query->where('status', $request->status);
        $paginator = $query->orderByDesc('id')->paginate((int)$request->get('per_page', 20));
        $items = [];
        foreach ($paginator as $account) {
            $items[] = $this->serializeAccount($account);
        }
        return response()->json($this->paginatedPayload($paginator, $items));
    }

    public function adminStoreAccount(Request $request)
    {
        $payload = $request->validate([
            'provider_key' => 'required|string|max:50',
            'driver' => 'nullable|in:duomi,openai_video,wan,minimax_h3,volcengine_ark',
            'name' => 'required|string|max:100',
            'base_url' => 'nullable|string|max:500',
            'api_key' => 'nullable|string|max:2000',
            'auth_style' => 'nullable|in:bearer,raw_authorization_header',
            'status' => 'nullable|in:active,disabled',
            'remark' => 'nullable|string|max:500',
            'verify_ssl' => 'nullable|boolean',
            'proxy' => 'nullable|string|max:300',
            'extra_headers' => 'nullable|array',
        ]);

        $providerKey = trim((string)$payload['provider_key']);
        $driver = $this->inferDriver($providerKey, $payload['driver'] ?? null);
        $baseUrl = trim((string)($payload['base_url'] ?? ''))
            ?: ($driver === 'duomi' ? 'https://duomiapi.com' : ($driver === 'minimax_h3' ? 'https://api.minimaxi.com' : ($driver === 'volcengine_ark' ? 'https://ark.cn-beijing.volces.com' : '')));
        if ($driver !== 'duomi' && $baseUrl === '') {
            $hint = $driver === 'wan' ? 'Wan / 算力超市必须填写 Base URL，例如 https://api.likeadmin.cn' : 'OpenAI 兼容视频服务商必须填写 Base URL';
            return response()->json(['error' => $hint], 422);
        }

        $data = [
            'provider_key' => $providerKey,
            'name' => $payload['name'],
            'base_url' => $baseUrl,
            'auth_style' => $payload['auth_style'] ?? ($driver === 'duomi' ? 'raw_authorization_header' : 'bearer'),
            'status' => $payload['status'] ?? 'active',
            'remark' => $payload['remark'] ?? '',
            'config' => $this->buildAccountConfig($payload, $driver, null),
        ];
        if (array_key_exists('api_key', $payload) && trim((string)$payload['api_key']) !== '') {
            $data['api_key'] = $payload['api_key'];
        }

        $account = DB::transaction(function () use ($data) {
            $account = VideoProviderAccount::create($data);
            $this->disableOtherActiveAccounts($account);
            return $account;
        });
        return response()->json(['account' => $this->serializeAccount($account)]);
    }

    public function adminUpdateAccount(Request $request, int $id)
    {
        $account = VideoProviderAccount::findOrFail($id);
        $payload = $request->validate([
            'name' => 'nullable|string|max:100',
            'driver' => 'nullable|in:duomi,openai_video,wan,minimax_h3,volcengine_ark',
            'base_url' => 'nullable|string|max:500',
            'api_key' => 'nullable|string|max:2000',
            'auth_style' => 'nullable|in:bearer,raw_authorization_header',
            'status' => 'nullable|in:active,disabled',
            'remark' => 'nullable|string|max:500',
            'verify_ssl' => 'nullable|boolean',
            'proxy' => 'nullable|string|max:300',
            'extra_headers' => 'nullable|array',
        ]);

        $existingConfig = is_array($account->config) ? $account->config : [];
        $driver = $this->inferDriver((string)$account->provider_key, $payload['driver'] ?? ($existingConfig['driver'] ?? null));

        $update = [];
        foreach (['name', 'base_url', 'auth_style', 'status', 'remark'] as $field) {
            if (array_key_exists($field, $payload) && $payload[$field] !== null) {
                $update[$field] = $payload[$field];
            }
        }
        if (array_key_exists('api_key', $payload) && trim((string)$payload['api_key']) !== '') {
            $update['api_key'] = $payload['api_key'];
        }
        $update['config'] = $this->buildAccountConfig($payload, $driver, $account);

        $account = DB::transaction(function () use ($account, $update) {
            $account->update($update);
            $account = $account->fresh();
            $this->disableOtherActiveAccounts($account);
            return $account;
        });
        return response()->json(['account' => $this->serializeAccount($account)]);
    }

    private function inferDriver(string $providerKey, ?string $driver): string
    {
        $driver = strtolower(trim((string)$driver));
        if (in_array($driver, ['duomi', 'openai_video', 'wan', 'minimax_h3', 'volcengine_ark'], true)) {
            return $driver;
        }
        $key = strtolower($providerKey);
        if ($key === 'duomi') {
            return 'duomi';
        }
        if (in_array($key, ['wan', 'likeadmin', 'dashscope'], true)) {
            return 'wan';
        }
        if (in_array($key, ['minimax', 'minimax_h3', 'hailuo'], true)) {
            return 'minimax_h3';
        }
        if (in_array($key, ['volcengine', 'volcengine_ark', 'ark', 'jimeng'], true)) {
            return 'volcengine_ark';
        }
        return 'openai_video';
    }

    private function buildAccountConfig(array $payload, string $driver, ?VideoProviderAccount $existing): array
    {
        $config = $existing && is_array($existing->config) ? $existing->config : [];
        $config['driver'] = $driver;

        if (array_key_exists('verify_ssl', $payload) && $payload['verify_ssl'] !== null) {
            $config['verify_ssl'] = (bool)$payload['verify_ssl'];
        }
        if (array_key_exists('proxy', $payload)) {
            $proxy = trim((string)($payload['proxy'] ?? ''));
            if ($proxy === '') {
                unset($config['proxy']);
            } else {
                $config['proxy'] = $proxy;
            }
        }
        if (array_key_exists('extra_headers', $payload)) {
            $headers = $this->normalizeHeaders($payload['extra_headers'] ?? []);
            if (empty($headers)) {
                unset($config['extra_headers']);
            } else {
                $config['extra_headers'] = $headers;
            }
        }
        return $config;
    }

    private function normalizeHeaders($raw): array
    {
        if (!is_array($raw) || empty($raw)) {
            return [];
        }
        $headers = [];
        $isList = array_keys($raw) === range(0, count($raw) - 1);
        if ($isList) {
            foreach ($raw as $item) {
                if (!is_array($item)) continue;
                $key = trim((string)($item['key'] ?? ''));
                if ($key !== '') $headers[$key] = (string)($item['value'] ?? '');
            }
        } else {
            foreach ($raw as $key => $value) {
                $key = trim((string)$key);
                if ($key !== '' && (is_string($value) || is_numeric($value))) {
                    $headers[$key] = (string)$value;
                }
            }
        }
        return $headers;
    }

    public function adminDeleteAccount(int $id)
    {
        $account = VideoProviderAccount::findOrFail($id);
        if ($account->tasks()->exists()) {
            $account->update(['status' => 'disabled']);
            return response()->json(['ok' => true, 'message' => '账号已有任务记录，已改为禁用']);
        }
        $account->delete();
        return response()->json(['ok' => true]);
    }

    private function disableOtherActiveAccounts(VideoProviderAccount $account): void
    {
        if ($account->status !== 'active') {
            return;
        }

        VideoProviderAccount::where('provider_key', $account->provider_key)
            ->where('id', '<>', $account->id)
            ->where('status', 'active')
            ->update(['status' => 'disabled']);
    }

    public function adminTestAccount(int $id)
    {
        $account = VideoProviderAccount::findOrFail($id);
        $result = app(VideoProviderManager::class)->driver($account)->test($account);
        $account->update([
            'last_test_at' => now(),
            'last_test_status' => !empty($result['ok']) ? 'success' : 'failed',
            'last_test_message' => (string)($result['message'] ?? ''),
        ]);
        return response()->json($result);
    }

    public function adminFetchProviderModels(int $id)
    {
        $account = VideoProviderAccount::findOrFail($id);
        $driver = app(VideoProviderManager::class)->driver($account);
        if (!method_exists($driver, 'fetchModels')) {
            return response()->json(['error' => '当前服务商驱动不支持拉取模型列表'], 422);
        }
        try {
            $models = $driver->fetchModels($account);
        } catch (\Throwable $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $existingSet = array_flip(VideoModelSpec::where('provider_key', $account->provider_key)->pluck('model_id')->all());
        $items = array_map(fn($m) => [
            'id' => $m['id'],
            'name' => $m['name'],
            'exists' => isset($existingSet[$m['id']]),
        ], $models);

        return response()->json([
            'provider_key' => $account->provider_key,
            'driver' => app(VideoProviderManager::class)->driverKey($account),
            'models' => $items,
        ]);
    }

    public function adminImportProviderModels(Request $request, int $id)
    {
        $account = VideoProviderAccount::findOrFail($id);
        $payload = $request->validate([
            'models' => 'required|array|min:1|max:100',
            'models.*.id' => 'required|string|max:150',
            'models.*.name' => 'nullable|string|max:150',
            'default_credit_cost' => 'required|numeric|min:0.0001|max:999999',
        ]);
        return response()->json(app(VideoModelImportService::class)->import(
            $account,
            $payload['models'],
            (float) $payload['default_credit_cost']
        ));
    }

    public function adminModelSpecs(Request $request)
    {
        $query = VideoModelSpec::with(['skus' => fn($q) => $q->orderBy('sort_order')->orderBy('id')]);
        if ($request->filled('provider_key')) $query->where('provider_key', $request->provider_key);
        if ($request->filled('provider_protocol')) $query->where('provider_protocol', $request->provider_protocol);
        if ($request->filled('status')) $query->where('status', $request->status);
        return response()->json(['models' => $query->orderBy('sort_order')->orderBy('id')->get()]);
    }

    public function adminCatalogDiagnostics(Request $request)
    {
        $payload = $request->validate(['user_id' => 'nullable|integer|min:1']);
        $user = isset($payload['user_id']) ? User::findOrFail((int) $payload['user_id']) : null;

        return response()->json(app(VideoCatalogDiagnosticsService::class)->diagnose($user));
    }

    public function adminStoreModelSpec(Request $request)
    {
        $payload = $request->validate([
            'provider_key' => 'required|string|max:50',
            'provider_protocol' => 'required|string|max:50',
            'model_id' => 'required|string|max:150',
            'display_name' => 'required|string|max:150',
            'generation_type' => 'nullable|string|max:50',
            'status' => 'nullable|in:active,disabled',
            'supported_modes' => 'nullable|array',
            'supported_modes.*' => 'string|max:50',
            'supported_durations' => 'nullable|array',
            'supported_durations.*' => 'integer|min:1|max:600',
            'supported_resolutions' => 'nullable|array',
            'supported_resolutions.*' => 'string|max:50',
            'supported_aspect_ratios' => 'nullable|array',
            'supported_aspect_ratios.*' => 'string|max:50',
            'max_reference_images' => 'nullable|integer|min:0|max:50',
            'provider_params' => 'nullable|array',
            'description' => 'nullable|string|max:500',
            'sort_order' => 'nullable|integer|min:0|max:999999',
        ]);

        if (VideoModelSpec::where('provider_key', $payload['provider_key'])->where('model_id', $payload['model_id'])->exists()) {
            return response()->json(['error' => '该服务商下已存在相同 model_id'], 422);
        }

        $spec = VideoModelSpec::create([
            'provider_key' => $payload['provider_key'],
            'provider_protocol' => $payload['provider_protocol'],
            'model_id' => $payload['model_id'],
            'display_name' => $payload['display_name'],
            'generation_type' => $payload['generation_type'] ?? 'text_to_video',
            'status' => $payload['status'] ?? 'active',
            'supported_modes' => $payload['supported_modes'] ?? [],
            'supported_durations' => $payload['supported_durations'] ?? [],
            'supported_resolutions' => $payload['supported_resolutions'] ?? [],
            'supported_aspect_ratios' => $payload['supported_aspect_ratios'] ?? [],
            'max_reference_images' => $payload['max_reference_images'] ?? 0,
            'provider_params' => $payload['provider_params'] ?? [],
            'description' => $payload['description'] ?? '',
            'sort_order' => $payload['sort_order'] ?? 0,
        ]);
        return response()->json(['model' => $spec->fresh('skus')]);
    }

    public function adminUpdateModelSpec(Request $request, int $id)
    {
        $spec = VideoModelSpec::findOrFail($id);
        $payload = $request->validate([
            'display_name' => 'nullable|string|max:150',
            'provider_protocol' => 'nullable|string|max:50',
            'generation_type' => 'nullable|string|max:50',
            'status' => 'nullable|in:active,disabled',
            'supported_modes' => 'nullable|array',
            'supported_modes.*' => 'string|max:50',
            'supported_durations' => 'nullable|array',
            'supported_durations.*' => 'integer|min:1|max:600',
            'supported_resolutions' => 'nullable|array',
            'supported_resolutions.*' => 'string|max:50',
            'supported_aspect_ratios' => 'nullable|array',
            'supported_aspect_ratios.*' => 'string|max:50',
            'max_reference_images' => 'nullable|integer|min:0|max:50',
            'provider_params' => 'nullable|array',
            'description' => 'nullable|string|max:500',
            'sort_order' => 'nullable|integer|min:0|max:999999',
        ]);
        $update = [];
        foreach ($payload as $key => $value) {
            if ($value !== null) $update[$key] = $value;
        }
        $spec->update($update);
        return response()->json(['model' => $spec->fresh('skus')]);
    }

    public function adminDeleteModelSpec(int $id)
    {
        $spec = VideoModelSpec::findOrFail($id);
        if (VideoTask::where('video_model_spec_id', $id)->exists()) {
            $spec->update(['status' => 'disabled']);
            return response()->json(['ok' => true, 'message' => '该模型已有任务记录，已改为禁用']);
        }
        $spec->delete();
        return response()->json(['ok' => true]);
    }

    public function adminSkus(Request $request)
    {
        $query = VideoSkuPrice::with('modelSpec');
        if ($request->filled('provider_protocol')) $query->where('provider_protocol', $request->provider_protocol);
        if ($request->filled('status')) $query->where('status', $request->status);
        if ($request->get('pricing_status') === 'priced') $query->whereNotNull('default_credit_cost');
        if ($request->get('pricing_status') === 'unpriced') $query->whereNull('default_credit_cost');
        return response()->json(['skus' => $query->orderBy('sort_order')->orderBy('id')->get()]);
    }

    public function adminStoreSku(Request $request)
    {
        $payload = $request->validate([
            'video_model_spec_id' => 'required|integer|exists:video_model_specs,id',
            'sku_key' => 'nullable|string|max:200',
            'title' => 'required|string|max:200',
            'mode' => 'nullable|string|max:50',
            'duration_seconds' => 'nullable|integer|min:0|max:600',
            'resolution' => 'nullable|string|max:50',
            'aspect_ratio' => 'nullable|string|max:50',
            'quality' => 'nullable|string|max:50',
            'default_credit_cost' => 'nullable|numeric|min:0|max:999999',
            'price_label' => 'nullable|string|max:100',
            'provider_cost_text' => 'nullable|string|max:300',
            'provider_cost_source' => 'nullable|string|max:500',
            'status' => 'nullable|in:active,disabled',
            'sort_order' => 'nullable|integer|min:0|max:999999',
        ]);

        $spec = VideoModelSpec::findOrFail((int)$payload['video_model_spec_id']);
        $skuKey = trim((string)($payload['sku_key'] ?? '')) ?: $this->generateSkuKey($spec, $payload);
        if (VideoSkuPrice::where('sku_key', $skuKey)->exists()) {
            return response()->json(['error' => 'SKU Key 已存在：' . $skuKey], 422);
        }

        $data = [
            'video_model_spec_id' => $spec->id,
            'sku_key' => $skuKey,
            'provider_key' => $spec->provider_key,
            'provider_protocol' => $spec->provider_protocol,
            'model_id' => $spec->model_id,
            'title' => $payload['title'],
            'mode' => $payload['mode'] ?? '',
            'duration_seconds' => (int)($payload['duration_seconds'] ?? 0),
            'resolution' => $payload['resolution'] ?? '',
            'aspect_ratio' => $payload['aspect_ratio'] ?? '',
            'quality' => $payload['quality'] ?? '',
            'default_credit_cost' => array_key_exists('default_credit_cost', $payload) ? $payload['default_credit_cost'] : null,
            'price_label' => $payload['price_label'] ?? '',
            'provider_cost_text' => $payload['provider_cost_text'] ?? '',
            'provider_cost_source' => $payload['provider_cost_source'] ?? '',
            'provider_params' => [],
            'status' => $payload['status'] ?? 'active',
            'sort_order' => $payload['sort_order'] ?? 0,
        ];

        $candidate = new VideoSkuPrice($data);
        $candidate->setRelation('modelSpec', $spec);
        if ($data['status'] === 'active') {
            try {
                app(VideoSkuSupportService::class)->assertSkuSupported($candidate);
            } catch (\InvalidArgumentException $e) {
                return response()->json(['error' => $e->getMessage()], 422);
            }
        }

        $sku = VideoSkuPrice::create($data);
        return response()->json(['sku' => $sku->fresh('modelSpec')]);
    }

    public function adminUpdateSku(Request $request, int $id)
    {
        $sku = VideoSkuPrice::findOrFail($id);
        $payload = $request->validate([
            'title' => 'nullable|string|max:200',
            'mode' => 'nullable|string|max:50',
            'duration_seconds' => 'nullable|integer|min:0|max:600',
            'resolution' => 'nullable|string|max:50',
            'aspect_ratio' => 'nullable|string|max:50',
            'quality' => 'nullable|string|max:50',
            'default_credit_cost' => 'nullable|numeric|min:0|max:999999',
            'price_label' => 'nullable|string|max:100',
            'provider_cost_text' => 'nullable|string|max:300',
            'provider_cost_source' => 'nullable|string|max:500',
            'status' => 'nullable|in:active,disabled',
            'sort_order' => 'nullable|integer|min:0|max:999999',
        ]);
        if (array_key_exists('default_credit_cost', $payload) && $payload['default_credit_cost'] === null) {
            $payload['price_label'] = '';
        }
        $candidate = clone $sku;
        $candidate->fill($payload);
        if (($payload['status'] ?? $sku->status) === 'active') {
            try {
                app(VideoSkuSupportService::class)->assertSkuSupported($candidate);
            } catch (\InvalidArgumentException $e) {
                return response()->json(['error' => $e->getMessage()], 422);
            }
        }
        $sku->update($payload);
        return response()->json(['sku' => $sku->fresh('modelSpec')]);
    }

    public function adminDeleteSku(int $id)
    {
        $sku = VideoSkuPrice::findOrFail($id);
        if (VideoTask::where('video_sku_price_id', $id)->exists()) {
            $sku->update(['status' => 'disabled']);
            return response()->json(['ok' => true, 'message' => '该 SKU 已有任务记录，已改为禁用']);
        }
        $sku->delete();
        return response()->json(['ok' => true]);
    }

    private function generateSkuKey(VideoModelSpec $spec, array $p): string
    {
        $parts = array_filter([
            $spec->provider_key,
            $spec->model_id,
            !empty($p['duration_seconds']) ? ((int)$p['duration_seconds'] . 's') : null,
            $p['resolution'] ?? null,
            $p['aspect_ratio'] ?? null,
            $p['mode'] ?? null,
        ], fn($v) => $v !== null && $v !== '');
        $base = implode(':', $parts);
        $suffix = substr(md5(uniqid('', true)), 0, 6);
        $key = $base . ':' . $suffix;
        if (mb_strlen($key) > 190) {
            $key = $spec->provider_key . ':' . substr(md5($base), 0, 12) . ':' . $suffix;
        }
        return $key;
    }

    public function adminBatchUpdateSkus(Request $request)
    {
        $payload = $request->validate([
            'ids' => 'required|array|min:1|max:500',
            'ids.*' => 'required|integer|min:1',
            'status' => 'required|in:active,disabled',
        ]);
        $ids = collect($payload['ids'])->map(fn($id) => (int)$id)->filter(fn($id) => $id > 0)->unique()->values();
        if ($ids->isEmpty()) {
            return response()->json(['error' => '请选择至少一个 SKU'], 422);
        }

        $skus = VideoSkuPrice::with('modelSpec')->whereIn('id', $ids)->get();
        if ($skus->isEmpty()) {
            return response()->json(['error' => '未找到可处理的 SKU'], 422);
        }

        if ($payload['status'] === 'active') {
            foreach ($skus as $sku) {
                app(VideoSkuSupportService::class)->assertSkuSupported($sku);
            }
        }

        $affected = VideoSkuPrice::whereIn('id', $skus->pluck('id'))->update([
            'status' => $payload['status'],
            'updated_at' => now(),
        ]);

        return response()->json([
            'affected' => $affected,
            'skus' => VideoSkuPrice::with('modelSpec')->whereIn('id', $skus->pluck('id'))->orderBy('sort_order')->orderBy('id')->get(),
        ]);
    }

    public function adminPricingRules(Request $request)
    {
        $query = VideoPricingRule::with('sku.modelSpec')->whereIn('target_type', ['user', 'group']);
        if ($request->filled('sku_id')) $query->where('video_sku_price_id', $request->sku_id);
        if (in_array((string)$request->target_type, ['user', 'group'], true)) $query->where('target_type', $request->target_type);
        return response()->json($query->orderByDesc('id')->paginate((int)$request->get('per_page', 50)));
    }

    public function adminStorePricingRule(Request $request)
    {
        $payload = $request->validate([
            'video_sku_price_id' => 'required|integer|exists:video_sku_prices,id',
            'target_type' => 'required|in:user,group',
            'target_id' => 'nullable|integer|min:1',
            'credit_cost' => 'required|numeric|min:0|max:999999',
            'status' => 'nullable|in:active,disabled',
            'remark' => 'nullable|string|max:500',
        ]);
        if (empty($payload['target_id'])) {
            return response()->json(['error' => '用户/分组价格规则必须填写目标 ID'], 422);
        }
        $sku = VideoSkuPrice::find((int)$payload['video_sku_price_id']);
        if (!$sku || $sku->default_credit_cost === null) {
            return response()->json(['error' => '请先在 SKU 与价格中配置默认扣费'], 422);
        }
        $payload['status'] = $payload['status'] ?? 'active';
        $payload['remark'] = trim((string)($payload['remark'] ?? ''));
        $rule = VideoPricingRule::updateOrCreate([
            'video_sku_price_id' => $payload['video_sku_price_id'],
            'target_type' => $payload['target_type'],
            'target_id' => (int)($payload['target_id'] ?? 0),
        ], $payload);
        return response()->json(['rule' => $rule->fresh('sku.modelSpec')]);
    }

    public function adminBatchStorePricingRules(Request $request)
    {
        $payload = $request->validate([
            'video_sku_price_id' => 'required|integer|exists:video_sku_prices,id',
            'target_type' => 'required|in:user,group',
            'target_ids' => 'required|array|min:1|max:200',
            'target_ids.*' => 'required|integer|min:1',
            'credit_cost' => 'required|numeric|min:0|max:999999',
            'status' => 'nullable|in:active,disabled',
            'remark' => 'nullable|string|max:500',
        ]);
        $sku = VideoSkuPrice::find((int)$payload['video_sku_price_id']);
        if (!$sku || $sku->default_credit_cost === null) {
            return response()->json(['error' => '请先在 SKU 与价格中配置默认扣费'], 422);
        }
        $targetIds = collect($payload['target_ids'])->map(fn($id) => (int)$id)->filter(fn($id) => $id > 0)->unique()->values();
        if ($targetIds->isEmpty()) {
            return response()->json(['error' => '请选择至少一个用户或分组'], 422);
        }
        $fields = [
            'credit_cost' => $payload['credit_cost'],
            'status' => $payload['status'] ?? 'active',
            'remark' => trim((string)($payload['remark'] ?? '')),
        ];
        $rules = [];
        DB::transaction(function () use ($targetIds, $payload, $fields, &$rules) {
            foreach ($targetIds as $targetId) {
                $rule = VideoPricingRule::updateOrCreate([
                    'video_sku_price_id' => (int)$payload['video_sku_price_id'],
                    'target_type' => (string)$payload['target_type'],
                    'target_id' => (int)$targetId,
                ], $fields);
                $rules[] = $rule->fresh('sku.modelSpec');
            }
        });
        return response()->json(['affected' => count($rules), 'rules' => $rules]);
    }

    public function adminBatchStorePricingRuleDiscounts(Request $request)
    {
        $payload = $request->validate([
            'video_model_spec_ids' => 'required|array|min:1|max:50',
            'video_model_spec_ids.*' => 'required|integer|exists:video_model_specs,id',
            'target_type' => 'required|in:user,group',
            'target_ids' => 'required|array|min:1|max:200',
            'target_ids.*' => 'required|integer|min:1',
            'discount_percent' => 'required|numeric|min:0|max:300',
            'conflict_strategy' => 'nullable|in:overwrite,skip',
            'status' => 'nullable|in:active,disabled',
            'remark' => 'nullable|string|max:500',
        ]);

        $modelIds = collect($payload['video_model_spec_ids'])->map(fn($id) => (int)$id)->filter(fn($id) => $id > 0)->unique()->values();
        $targetIds = collect($payload['target_ids'])->map(fn($id) => (int)$id)->filter(fn($id) => $id > 0)->unique()->values();
        if ($modelIds->isEmpty()) {
            return response()->json(['error' => '请选择至少一个视频模型'], 422);
        }
        if ($targetIds->isEmpty()) {
            return response()->json(['error' => '请选择至少一个用户或分组'], 422);
        }

        $targetTable = $payload['target_type'] === 'group' ? 'user_groups' : 'users';
        $existingTargetIds = DB::table($targetTable)->whereIn('id', $targetIds)->pluck('id')->map(fn($id) => (int)$id)->values();
        if ($existingTargetIds->count() !== $targetIds->count()) {
            return response()->json(['error' => '所选用户或分组中存在无效目标'], 422);
        }

        $models = VideoModelSpec::whereIn('id', $modelIds)->get();
        $activePricedSkus = VideoSkuPrice::whereIn('video_model_spec_id', $modelIds)
            ->where('status', 'active')
            ->whereNotNull('default_credit_cost')
            ->orderBy('video_model_spec_id')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();
        $skippedUnpriced = VideoSkuPrice::whereIn('video_model_spec_id', $modelIds)
            ->where('status', 'active')
            ->whereNull('default_credit_cost')
            ->count();
        $skippedDisabled = VideoSkuPrice::whereIn('video_model_spec_id', $modelIds)
            ->where('status', '<>', 'active')
            ->count();

        if ($activePricedSkus->isEmpty()) {
            return response()->json(['error' => '所选模型下没有已启用且已定价的 SKU'], 422);
        }
        $totalCandidates = $activePricedSkus->count() * $targetIds->count();
        if ($totalCandidates > 20000) {
            return response()->json(['error' => '本次批量规则数量过大，请减少模型或目标数量后重试'], 422);
        }

        $discountPercent = (float)$payload['discount_percent'];
        $discountRate = $discountPercent / 100;
        $conflictStrategy = $payload['conflict_strategy'] ?? 'overwrite';
        $status = $payload['status'] ?? 'active';
        $remark = trim((string)($payload['remark'] ?? ''));
        $skuIds = $activePricedSkus->pluck('id')->map(fn($id) => (int)$id)->values();
        $existingRules = VideoPricingRule::whereIn('video_sku_price_id', $skuIds)
            ->where('target_type', (string)$payload['target_type'])
            ->whereIn('target_id', $targetIds)
            ->get()
            ->keyBy(fn($rule) => (int)$rule->video_sku_price_id . ':' . (int)$rule->target_id);
        $created = 0;
        $updated = 0;
        $skippedExisting = 0;

        DB::transaction(function () use ($activePricedSkus, $targetIds, $payload, $discountRate, $conflictStrategy, $status, $remark, $existingRules, &$created, &$updated, &$skippedExisting) {
            foreach ($activePricedSkus as $sku) {
                // 价格百分比支持溢价（>100%）；扣费上限与单条计费规则一致（max 999999）兜底，防止溢价后超出列范围。
                $creditCost = min(round(((float)$sku->default_credit_cost) * $discountRate, 4), 999999);
                foreach ($targetIds as $targetId) {
                    $keys = [
                        'video_sku_price_id' => (int)$sku->id,
                        'target_type' => (string)$payload['target_type'],
                        'target_id' => (int)$targetId,
                    ];
                    $existing = $existingRules->get((int)$sku->id . ':' . (int)$targetId);
                    if ($existing && $conflictStrategy === 'skip') {
                        $skippedExisting++;
                        continue;
                    }
                    $fields = [
                        'credit_cost' => $creditCost,
                        'status' => $status,
                        'remark' => $remark,
                    ];
                    if ($existing) {
                        $existing->update($fields);
                        $updated++;
                    } else {
                        VideoPricingRule::create(array_merge($keys, $fields));
                        $created++;
                    }
                }
            }
        });

        $affected = $created + $updated;
        return response()->json([
            'ok' => true,
            'model_count' => $models->count(),
            'sku_count' => $activePricedSkus->count(),
            'target_count' => $targetIds->count(),
            'affected' => $affected,
            'created' => $created,
            'updated' => $updated,
            'skipped_existing' => $skippedExisting,
            'skipped_unpriced' => $skippedUnpriced,
            'skipped_disabled' => $skippedDisabled,
            'discount_percent' => $discountPercent,
            'conflict_strategy' => $conflictStrategy,
            'total_candidates' => $totalCandidates,
            'max_rule_count' => 20000,
        ]);
    }

    public function adminUpdatePricingRule(Request $request, int $id)
    {
        $rule = VideoPricingRule::findOrFail($id);
        if ($rule->target_type === 'default') {
            return response()->json(['error' => '默认价格请在 SKU 与价格中维护'], 422);
        }
        $payload = $request->validate([
            'credit_cost' => 'sometimes|required|numeric|min:0|max:999999',
            'status' => 'nullable|in:active,disabled',
            'remark' => 'nullable|string|max:500',
        ]);
        $sku = $rule->sku;
        if (!$sku || $sku->default_credit_cost === null) {
            return response()->json(['error' => '请先在 SKU 与价格中配置默认扣费'], 422);
        }
        if (array_key_exists('remark', $payload)) {
            $payload['remark'] = trim((string)($payload['remark'] ?? ''));
        }
        $rule->update($payload);
        return response()->json(['rule' => $rule->fresh('sku.modelSpec')]);
    }

    public function adminDeletePricingRule(int $id)
    {
        VideoPricingRule::findOrFail($id)->delete();
        return response()->json(['ok' => true]);
    }

    public function adminTasks(Request $request)
    {
        $query = VideoTask::with(['modelSpec', 'sku', 'result']);
        if ($request->filled('status')) $query->where('status', $request->status);
        if ($request->filled('provider_protocol')) $query->where('provider_protocol', $request->provider_protocol);
        if ($request->filled('user_id')) $query->where('user_id', (int)$request->user_id);
        if ($request->filled('keyword')) {
            $keyword = '%' . $request->keyword . '%';
            $query->where(function ($q) use ($keyword) {
                $q->where('id', 'like', $keyword)->orWhere('prompt', 'like', $keyword)->orWhere('provider_task_id', 'like', $keyword);
            });
        }
        $service = app(VideoTaskService::class);
        $paginator = $query->orderByDesc('created_at')->paginate((int)$request->get('per_page', 20));
        $items = [];
        foreach ($paginator as $task) {
            $items[] = $service->serializeTask($task, true);
        }
        return response()->json($this->paginatedPayload($paginator, $items));
    }

    public function adminShowTask(string $taskId)
    {
        $task = VideoTask::with(['modelSpec', 'sku', 'result', 'usageRecord'])->findOrFail($taskId);
        return response()->json(['task' => app(VideoTaskService::class)->serializeTask($task, true)]);
    }

    public function adminRefreshTask(string $taskId)
    {
        $task = VideoTask::findOrFail($taskId);
        $task = app(VideoTaskService::class)->refresh($task);
        return response()->json(['task' => app(VideoTaskService::class)->serializeTask($task, true)]);
    }

    public function adminCancelTask(string $taskId)
    {
        $task = VideoTask::with('account')->findOrFail($taskId);
        $task = app(VideoTaskService::class)->cancel($task);
        return response()->json(['task' => app(VideoTaskService::class)->serializeTask($task, true)]);
    }

    public function adminDeleteTask(string $taskId)
    {
        VideoTask::findOrFail($taskId)->delete();
        return response()->json(['ok' => true]);
    }

    public function adminBatchDeleteTasks(Request $request)
    {
        $payload = $request->validate(['ids' => 'required|array', 'ids.*' => 'string']);
        $count = VideoTask::whereIn('id', $payload['ids'])->delete();
        return response()->json(['ok' => true, 'deleted' => $count]);
    }

    public function adminUsage(Request $request)
    {
        $query = VideoUsageRecord::query();
        if ($request->filled('status')) $query->where('status', $request->status);
        if ($request->filled('user_id')) $query->where('user_id', (int)$request->user_id);
        return response()->json($query->orderByDesc('created_at')->paginate((int)$request->get('per_page', 20)));
    }

    // ===== 临时参考素材（桌面端上传的视频参考图/视频/音频，24h 过期） =====

    public function adminReferenceAssets(Request $request)
    {
        $query = TemporaryReferenceAsset::with('user');
        if ($request->filled('user_id')) $query->where('user_id', (int)$request->user_id);
        if ($request->filled('asset_type')) $query->where('asset_type', $request->asset_type);
        if ($request->filled('source')) $query->where('source', $request->source);
        if ($request->filled('storage_driver')) $query->where('storage_driver', $request->storage_driver);
        if ($request->filled('status')) $query->where('status', $request->status);
        if ($request->filled('expired')) {
            if (in_array($request->expired, ['1', 'true', true], true)) {
                $query->whereNotNull('expires_at')->where('expires_at', '<', now());
            } else {
                $query->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>=', now()));
            }
        }
        if ($request->filled('bound')) {
            if (in_array($request->bound, ['1', 'true', true], true)) {
                $query->whereNotNull('video_task_id');
            } else {
                $query->whereNull('video_task_id');
            }
        }
        if ($request->filled('keyword')) {
            $keyword = '%' . $request->keyword . '%';
            $query->where(function ($q) use ($keyword) {
                $q->where('storage_url', 'like', $keyword)
                  ->orWhere('original_url', 'like', $keyword)
                  ->orWhere('video_task_id', 'like', $keyword);
            });
        }
        $paginator = $query->orderByDesc('id')->paginate((int)$request->get('per_page', 20));
        $items = [];
        foreach ($paginator as $asset) {
            $items[] = $this->serializeAssetAdmin($asset);
        }
        return response()->json($this->paginatedPayload($paginator, $items));
    }

    public function adminReferenceAssetStats()
    {
        $now = now();
        return response()->json([
            'total'      => TemporaryReferenceAsset::count(),
            'expired'    => TemporaryReferenceAsset::whereNotNull('expires_at')->where('expires_at', '<', $now)->count(),
            'bound'      => TemporaryReferenceAsset::whereNotNull('video_task_id')->count(),
            'unbound'    => TemporaryReferenceAsset::whereNull('video_task_id')->count(),
            'total_size' => (int) TemporaryReferenceAsset::sum('file_size'),
            'by_type'    => [
                'image' => TemporaryReferenceAsset::where('asset_type', 'image')->count(),
                'video' => TemporaryReferenceAsset::where('asset_type', 'video')->count(),
                'audio' => TemporaryReferenceAsset::where('asset_type', 'audio')->count(),
            ],
            'by_source'  => [
                'upload' => TemporaryReferenceAsset::where('source', 'upload')->count(),
                'url'    => TemporaryReferenceAsset::where('source', 'url')->count(),
            ],
            'by_storage' => [
                'local'    => TemporaryReferenceAsset::where('storage_driver', 'local')->count(),
                'cos'      => TemporaryReferenceAsset::where('storage_driver', 'cos')->count(),
                'oss'      => TemporaryReferenceAsset::where('storage_driver', 'oss')->count(),
                'external' => TemporaryReferenceAsset::where('storage_driver', 'external')->count(),
                'unknown'  => TemporaryReferenceAsset::where(function ($q) {
                    $q->whereNull('storage_driver')->orWhere('storage_driver', '');
                })->count(),
            ],
        ]);
    }

    public function adminDeleteReferenceAsset(int $id)
    {
        $result = app(TemporaryReferenceAssetService::class)->deleteAssets([$id]);
        if (($result['deleted'] ?? 0) === 0) {
            return response()->json(['error' => '素材不存在或删除失败'], 404);
        }
        return response()->json(['ok' => true]);
    }

    public function adminBatchDeleteReferenceAssets(Request $request)
    {
        $payload = $request->validate(['ids' => 'required|array|max:1000', 'ids.*' => 'integer']);
        $result = app(TemporaryReferenceAssetService::class)->deleteAssets($payload['ids']);
        return response()->json($result);
    }

    public function adminCleanupExpiredReferenceAssets(Request $request)
    {
        $limit = (int) $request->input('limit', 1000);
        $grace = (int) $request->input('grace_minutes', 0);
        $deleted = app(TemporaryReferenceAssetService::class)->purgeExpired($limit, $grace);
        return response()->json(['ok' => true, 'deleted' => $deleted]);
    }

    private function serializeAccount(VideoProviderAccount $account): array
    {
        $config = is_array($account->config) ? $account->config : [];
        $driver = app(VideoProviderManager::class)->driver($account);
        return [
            'id' => (int)$account->id,
            'provider_key' => $account->provider_key,
            'driver' => $config['driver'] ?? $this->inferDriver((string)$account->provider_key, null),
            'supports_model_fetch' => method_exists($driver, 'fetchModels'),
            'name' => $account->name,
            'base_url' => $account->base_url,
            'auth_style' => $account->auth_style,
            'verify_ssl' => $config['verify_ssl'] ?? true,
            'proxy' => (string)($config['proxy'] ?? ''),
            'extra_headers' => is_array($config['extra_headers'] ?? null) ? $config['extra_headers'] : [],
            'status' => $account->status,
            'has_api_key' => (string)$account->api_key !== '',
            'last_test_at' => $account->last_test_at,
            'last_test_status' => $account->last_test_status,
            'last_test_message' => $account->last_test_message,
            'remark' => $account->remark,
            'created_at' => $account->created_at,
            'updated_at' => $account->updated_at,
        ];
    }

    private function serializeAsset(TemporaryReferenceAsset $asset): array
    {
        return [
            'id' => (int)$asset->id,
            'asset_type' => $asset->asset_type,
            'source' => $asset->source,
            'url' => $asset->storage_url,
            'original_name' => (string)($asset->metadata['original_name'] ?? ''),
            'mime_type' => $asset->mime_type,
            'file_size' => (int)$asset->file_size,
            'expires_at' => $asset->expires_at,
        ];
    }

    private function serializeAssetAdmin(TemporaryReferenceAsset $asset): array
    {
        return [
            'id'            => (int)$asset->id,
            'user_id'       => (int)$asset->user_id,
            'user'          => $asset->user ? [
                'id'       => (int)$asset->user->id,
                'username' => $asset->user->username,
                'nickname' => $asset->user->nickname,
            ] : null,
            'video_task_id' => $asset->video_task_id,
            'asset_type'    => $asset->asset_type,
            'source'        => $asset->source,
            'url'           => $asset->storage_url,
            'storage_driver' => $asset->storage_driver ?: \App\Services\StorageService::detectDriverFromUrl((string) $asset->storage_url),
            'original_url'  => $asset->original_url,
            'original_name' => (string)($asset->metadata['original_name'] ?? ''),
            'mime_type'     => $asset->mime_type,
            'file_size'     => (int)$asset->file_size,
            'status'        => $asset->status,
            'is_expired'    => $asset->expires_at ? $asset->expires_at->isPast() : false,
            'expires_at'    => $asset->expires_at,
            'created_at'    => $asset->created_at,
        ];
    }

    private function paginatedPayload($paginator, array $items): array
    {
        $payload = $paginator->toArray();
        $payload['data'] = $items;
        return $payload;
    }
}
