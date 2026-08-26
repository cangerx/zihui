<?php

namespace App\Http\Controllers;

use App\Models\CloudProvider;
use App\Services\Gateway\GatewayRouter;
use App\Support\ApiBase;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * provider.type 白名单：必须与前端 type 下拉选项保持同步。
 *
 * 已落地适配器：
 *   - openai / openai_compatible : OpenAI 协议族，走 OpenAICompatibleAdapter
 *                                  Azure OpenAI 依靠 config.auth_style=azure_api_key 在本适配器上承载，不占独立 type
 *   - duomi                       : 多米 API（duomiapi.com），仅图片生成（gpt-image-2 异步），走 DuoMiAdapter
 *
 * 其它原生协议（Anthropic / Gemini 等）等真正落地适配器时再加白名单。
 */

class CloudProviderController extends Controller
{
    /** provider.type 白名单常量：与上方注释保持同步。 */
    private const SUPPORTED_TYPES = ['openai', 'openai_compatible', 'duomi'];

    public function index(Request $request)
    {
        $query = CloudProvider::withCount('models');

        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }
        if ($request->filled('keyword')) {
            $query->where('name', 'like', "%{$request->keyword}%");
        }

        $providers = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        return response()->json($providers);
    }

    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name'         => 'required|string|max:100',
            'type'         => 'in:' . implode(',', self::SUPPORTED_TYPES),
            'api_base'     => 'required|string|max:500',
            'api_key'      => 'required|string',
            'status'       => 'in:active,disabled',
            'remark'       => 'nullable|string|max:500',
            // 高级配置（自定义 headers / query / auth_style / verify_ssl / proxy / api_version）
            'config'       => 'nullable|array',
            // 能力清单（stream / usage_in_stream / tools / vision / json_mode / reasoning_params）
            'capabilities' => 'nullable|array',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $payload = $request->only(['name', 'type', 'api_base', 'api_key', 'status', 'remark', 'config', 'capabilities']);
        // 保存前规范化：用户填不带 /v1 的 URL 自动补齐（已含 /v4 /v1beta 等版本号段则原样）
        $payload['api_base'] = ApiBase::normalize($payload['api_base'] ?? '');

        $provider = CloudProvider::create($payload);
        return response()->json($provider->makeVisible('api_key'), 201);
    }

    public function show($id)
    {
        $provider = CloudProvider::with('models')->withCount('models')->findOrFail($id);
        return response()->json($provider->makeVisible('api_key'));
    }

    public function update(Request $request, $id)
    {
        $provider = CloudProvider::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'name'         => 'string|max:100',
            'type'         => 'in:' . implode(',', self::SUPPORTED_TYPES),
            'api_base'     => 'string|max:500',
            'api_key'      => 'string',
            'status'       => 'in:active,disabled',
            'remark'       => 'nullable|string|max:500',
            'config'       => 'nullable|array',
            'capabilities' => 'nullable|array',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $payload = $request->only(['name', 'type', 'api_base', 'api_key', 'status', 'remark', 'config', 'capabilities']);
        // 仅在用户确实传入 api_base 时 normalize，未传入则保留原值
        if (array_key_exists('api_base', $payload)) {
            $payload['api_base'] = ApiBase::normalize($payload['api_base']);
        }

        $provider->fill($payload);
        $provider->save();

        return response()->json($provider->makeVisible('api_key'));
    }

    public function destroy($id)
    {
        CloudProvider::findOrFail($id)->delete();
        return response()->json(['message' => 'Deleted']);
    }

    /** 批量删除：循环调用 destroy，收集 errors */
    public function batchDestroy(Request $request)
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $request->input('ids', [])))));
        if (empty($ids)) return response()->json(['error' => 'ids 不能为空'], 400);
        if (count($ids) > 200) return response()->json(['error' => '单次批量操作不超过 200 条'], 400);

        $deleted = 0; $errors = [];
        foreach ($ids as $id) {
            try {
                $resp = $this->destroy($id);
                if ($resp->getStatusCode() >= 400) {
                    $data = $resp->getData(true);
                    $errors[] = ['id' => $id, 'error' => $data['error'] ?? ('HTTP ' . $resp->getStatusCode())];
                    continue;
                }
                $deleted++;
            } catch (\Throwable $e) {
                $errors[] = ['id' => $id, 'error' => $e->getMessage()];
            }
        }
        return response()->json(['deleted' => $deleted, 'errors' => $errors, 'total' => count($ids)]);
    }

    /**
     * 测试连接（基础体检）：GET /models 探测网络 + 鉴权 + 协议格式。
     *
     * 走 GatewayRouter + adapter 链路，与真实流量调用同一条路径：
     *   - selectAdapter()  按 provider.type 选 OpenAICompatibleAdapter
     *   - selectCredential() 凭证池有 active 行就用池子，否则回落 provider.api_key（兼容老 provider）
     *   - adapter.probeModels() 走 buildHttp，应用 auth_style / extra_headers / extra_query / verify_ssl / proxy
     *
     * 这样测试结果与真实流量行为一致，避免老 ProviderProbe 不应用 config 导致「测试通但实际不通」（或反之）。
     *
     * 返回 status 三档（HTTP 响应码）：
     *   - 'ok'      (200)：2xx 且响应符合 OpenAI 协议（含 data 数组）
     *   - 'warning' (200)：2xx 但协议不规范（HTML / 缺 data）；或 403 端点白名单
     *   - 'error'   (400)：401 / 404 / 5xx / 连接异常
     */
    public function testConnection(Request $request, $id, GatewayRouter $router): JsonResponse
    {
        /** @var CloudProvider $provider */
        $provider = CloudProvider::findOrFail($id);

        $adapter = $router->selectAdapter($provider);
        [, $apiKey] = $router->selectCredential($provider);

        if (empty($apiKey)) {
            $result = [
                'status'      => 'error',
                'message'     => '请先填写 API 密钥（或在凭证池里至少挂 1 把 active key）',
                'http_status' => null,
                'endpoint'    => '',
            ];
            $this->persistTestResult($provider, $result, 'basic');
            return response()->json($this->stripInternalFields($result), 400);
        }

        // probe 用稍长一点的超时（基础探测 15s 与历史值一致；与 cron 探测的 10s 区分）
        $probeResult = $adapter->probeModels($provider, $apiKey, 15);
        $result = $probeResult->toArray();

        $this->persistTestResult($provider, $result, 'basic');

        return response()->json(
            $this->stripInternalFields($result),
            $result['status'] === 'error' ? 400 : 200
        );
    }

    /**
     * 深度测试：发一条 max_tokens=1 的 chat completion，真正验证 /chat/completions 可用性。
     *
     * 用途：基础测试 GET /models 通过不代表 chat 通（中转 API 经常 /models 200 但 chat 502）。
     * 代价：消耗 1 个 token（成本忽略不计）。
     *
     * 同样走 GatewayRouter + adapter 链路，与 testConnection 行为一致。
     *
     * 入参：
     *   - model_id (可选)：未传则自动取 GET /models 的第一个 id
     */
    public function deepTest(Request $request, $id, GatewayRouter $router): JsonResponse
    {
        // 限 model_id 长度防恶意超长输入被原样拼进 chat completions 请求体
        $validator = Validator::make($request->all(), [
            'model_id' => 'nullable|string|max:200',
        ]);
        if ($validator->fails()) {
            return response()->json([
                'status'  => 'error',
                'message' => $validator->errors()->first(),
            ], 422);
        }

        /** @var CloudProvider $provider */
        $provider = CloudProvider::findOrFail($id);
        $modelId = $request->input('model_id');
        $modelId = is_string($modelId) && $modelId !== '' ? trim($modelId) : null;

        $adapter = $router->selectAdapter($provider);
        [, $apiKey] = $router->selectCredential($provider);

        if (empty($apiKey)) {
            $result = [
                'status'      => 'error',
                'message'     => '请先填写 API 密钥（或在凭证池里至少挂 1 把 active key）',
                'http_status' => null,
                'endpoint'    => '',
            ];
            $this->persistTestResult($provider, $result, 'deep');
            return response()->json($this->stripInternalFields($result), 400);
        }

        // timeout=null 让 adapter 内部回落 config('gateway.timeouts.deep_probe')
        $probeResult = $adapter->probeChat($provider, $apiKey, $modelId);
        $result = $probeResult->toArray();

        $this->persistTestResult($provider, $result, 'deep');

        return response()->json(
            $this->stripInternalFields($result),
            $result['status'] === 'error' ? 400 : 200
        );
    }

    /**
     * 拉取上游模型列表：复用 adapter 的 probeModels()，与测试连接走同一条链路。
     */
    public function fetchModels($id, GatewayRouter $router): JsonResponse
    {
        /** @var CloudProvider $provider */
        $provider = CloudProvider::findOrFail($id);

        $adapter = $router->selectAdapter($provider);
        [, $apiKey] = $router->selectCredential($provider);

        if (empty($apiKey)) {
            return response()->json([
                'error'    => '请先填写 API 密钥（或在凭证池里至少挂 1 把 active key）',
                'endpoint' => null,
            ], 400);
        }

        $probeResult = $adapter->probeModels($provider, $apiKey, 15);

        // error 或 warning（协议不规范 / 403 白名单）都不返回可用 models 清单
        $models = $probeResult->models;
        if ($probeResult->status === 'error' || empty($models)) {
            return response()->json([
                'error'    => $probeResult->message ?: '未获取到模型列表',
                'endpoint' => $probeResult->endpoint ?? null,
            ], 400);
        }

        return response()->json([
            'models' => collect($models)->map(fn($m) => [
                'id'       => $m['id'] ?? '',
                'owned_by' => $m['owned_by'] ?? '',
            ])->filter(fn($m) => !empty($m['id']))->values(),
        ]);
    }

    /**
     * 健康看板聚合接口：返回所有 provider 的 24h 探测数据 + 24h 整体可用率。
     *
     * 返回结构：
     *   {
     *     summary: { total, active, suspended, availability_24h },
     *     providers: [
     *       {
     *         id, name, type, status, suspended_at, suspended_reason,
     *         ok_24h, fail_24h, availability_24h, latency_p99_24h, latest_error,
     *         hourly: [ { bucket_hour, ok_count, fail_count, latency_ms_p99 } x 24 ]
     *       }
     *     ]
     *   }
     *
     * 性能：单 SQL 拉 24h 内所有 metrics 行（最多 provider_count * 24 条），按 provider 分组聚合。
     */
    public function health(): JsonResponse
    {
        $since = now()->subHours(24)->startOfHour();

        $providers = CloudProvider::orderBy('id')->get([
            'id', 'name', 'type', 'status', 'suspended_at', 'suspended_reason',
        ]);

        // 拉一次 24h 内所有 metrics 行，PHP 端按 provider 分组聚合，避免 N+1
        $metrics = DB::table('cloud_provider_metrics')
            ->where('bucket_hour', '>=', $since)
            ->orderBy('provider_id')
            ->orderBy('bucket_hour')
            ->get([
                'provider_id', 'bucket_hour', 'ok_count', 'fail_count',
                'latency_ms_p50', 'latency_ms_p99', 'last_error_message',
            ]);

        $byProvider = [];
        foreach ($metrics as $m) {
            $byProvider[$m->provider_id][] = $m;
        }

        $totalOk = 0;
        $totalFail = 0;
        $rows = [];

        foreach ($providers as $p) {
            $ms = $byProvider[$p->id] ?? [];
            $ok = 0; $fail = 0; $maxP99 = 0; $latestError = '';
            $hourly = [];
            foreach ($ms as $m) {
                $ok += (int) $m->ok_count;
                $fail += (int) $m->fail_count;
                if ((int) $m->latency_ms_p99 > $maxP99) $maxP99 = (int) $m->latency_ms_p99;
                if ($m->last_error_message) $latestError = (string) $m->last_error_message;
                $hourly[] = [
                    'bucket_hour'   => $m->bucket_hour,
                    'ok_count'      => (int) $m->ok_count,
                    'fail_count'    => (int) $m->fail_count,
                    'latency_ms_p99'=> (int) $m->latency_ms_p99,
                ];
            }
            $totalOk += $ok;
            $totalFail += $fail;
            $total = $ok + $fail;
            $availability = $total > 0 ? round(100 * $ok / $total, 2) : null;

            $rows[] = [
                'id'                => $p->id,
                'name'              => $p->name,
                'type'              => $p->type,
                'status'            => $p->status,
                'suspended_at'      => optional($p->suspended_at)->toDateTimeString(),
                'suspended_reason'  => $p->suspended_reason,
                'ok_24h'            => $ok,
                'fail_24h'          => $fail,
                'availability_24h'  => $availability,
                'latency_p99_24h'   => $maxP99,
                'latest_error'      => mb_substr($latestError, 0, 200),
                'hourly'            => $hourly,
            ];
        }

        $totalSamples = $totalOk + $totalFail;
        $globalAvailability = $totalSamples > 0 ? round(100 * $totalOk / $totalSamples, 2) : null;
        $activeCount = $providers->where('status', 'active')->whereNull('suspended_at')->count();
        $suspendedCount = $providers->whereNotNull('suspended_at')->count();

        return response()->json([
            'summary' => [
                'total'             => $providers->count(),
                'active'            => $activeCount,
                'suspended'         => $suspendedCount,
                'availability_24h'  => $globalAvailability,
                'samples_24h'       => $totalSamples,
                'window_started_at' => $since->toDateTimeString(),
            ],
            'providers' => $rows,
        ]);
    }

    /**
     * 解除熔断：清除 suspended_at / suspended_reason，让 GatewayRouter 重新可路由到该 provider。
     *
     * 配合 ProbeProviders Command 的自动熔断逻辑：连续探测失败时 suspended_at 写入；
     * 管理员排查恢复后调本接口重置。同时把所有 invalid 凭证的 fail_count 归零（可选，
     * 默认走 reactivate_credentials=false 不动凭证池）。
     */
    public function recover(Request $request, $id): JsonResponse
    {
        /** @var CloudProvider $provider */
        $provider = CloudProvider::findOrFail($id);

        $provider->forceFill([
            'suspended_at'     => null,
            'suspended_reason' => null,
        ])->saveQuietly();

        // 可选：同时把所有 invalid 凭证的 fail_count 归零、状态重置为 active
        if ($request->boolean('reactivate_credentials', false)) {
            \App\Models\ProviderCredential::where('provider_id', $provider->id)
                ->where('status', 'invalid')
                ->update([
                    'status'         => 'active',
                    'fail_count'     => 0,
                    'last_error'     => '',
                ]);
        }

        return response()->json([
            'message' => '已解除熔断',
            'id'      => $provider->id,
        ]);
    }

    /**
     * 把测试结果快照写到 provider 行：列表「上次体检」列直接读，不必每次现测。
     * 使用 forceFill + saveQuietly 避免触发 updated_at 抖动（保留 timestamps 精确反映业务变更）。
     */
    private function persistTestResult(CloudProvider $provider, array $result, string $kind): void
    {
        $provider->forceFill([
            'last_test_at'      => now(),
            'last_test_status'  => $result['status'] ?? 'error',
            'last_test_kind'    => $kind,
            'last_test_message' => mb_substr((string) ($result['message'] ?? ''), 0, 500),
        ])->saveQuietly();
    }

    /** 隐藏探测器内部字段（models 数组只供 fetchModels 使用，不暴露给测试连接接口） */
    private function stripInternalFields(array $result): array
    {
        unset($result['models']);
        return $result;
    }
}
