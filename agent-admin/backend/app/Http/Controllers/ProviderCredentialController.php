<?php

namespace App\Http\Controllers;

use App\Models\CloudProvider;
use App\Models\ProviderCredential;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * 服务商凭证池管理：一个 provider 下挂多把 API Key。
 *
 * 与 cloud_providers.api_key 字段并存：
 *   - 池子有 status=active 行 → GatewayRouter 走凭证池调度
 *   - 池子全空（默认）→ 回落到 cloud_providers.api_key（保证老 provider 零行为变化）
 *
 * 字段语义见 ProviderCredential 模型 / migration 文件。
 */
class ProviderCredentialController extends Controller
{
    /**
     * 列出指定 provider 下的所有凭证。
     *
     * api_key 字段是敏感的，列表只返回 mask 形式（前 4 + ... + 后 4），
     * 完整值仅由 GatewayRouter 内部使用，不经接口出去。
     */
    public function index(Request $request, $providerId): JsonResponse
    {
        // 先验证 provider 存在（提前 404，避免返回空数组让前端误以为还没有凭证）
        CloudProvider::findOrFail($providerId);

        $credentials = ProviderCredential::where('provider_id', $providerId)
            ->orderBy('id')
            ->get()
            ->map(fn(ProviderCredential $c) => $this->present($c));

        return response()->json(['data' => $credentials]);
    }

    public function store(Request $request, $providerId): JsonResponse
    {
        // provider 存在性
        $provider = CloudProvider::findOrFail($providerId);

        $validator = Validator::make($request->all(), [
            'name'    => 'nullable|string|max:100',
            'api_key' => 'required|string|min:1',
            'weight'  => 'nullable|integer|min:1|max:65535',
            'remark'  => 'nullable|string|max:500',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $credential = ProviderCredential::create([
            'provider_id' => $provider->id,
            'name'        => (string) $request->input('name', ''),
            'api_key'     => (string) $request->input('api_key'),
            'weight'      => (int) ($request->input('weight') ?: 1),
            'remark'      => (string) $request->input('remark', ''),
            'status'      => 'active',
            'fail_count'  => 0,
        ]);

        return response()->json($this->present($credential), 201);
    }

    /**
     * 更新单条凭证：可改 name/weight/remark/api_key/status。
     * api_key 留空保持不变（与 CloudProviderController::update 风格一致）。
     */
    public function update(Request $request, $id): JsonResponse
    {
        /** @var ProviderCredential $credential */
        $credential = ProviderCredential::findOrFail($id);

        $validator = Validator::make($request->all(), [
            'name'    => 'nullable|string|max:100',
            'api_key' => 'nullable|string',
            'weight'  => 'nullable|integer|min:1|max:65535',
            'status'  => 'in:active,exhausted,invalid,disabled',
            'remark'  => 'nullable|string|max:500',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $payload = $request->only(['name', 'api_key', 'weight', 'status', 'remark']);
        // 空字符串 api_key 不覆盖（保持不变）
        if (array_key_exists('api_key', $payload) && trim((string) $payload['api_key']) === '') {
            unset($payload['api_key']);
        }
        if (array_key_exists('weight', $payload) && ($payload['weight'] === null || $payload['weight'] === '')) {
            unset($payload['weight']);
        }

        $credential->fill($payload);
        $credential->save();

        return response()->json($this->present($credential));
    }

    public function destroy($id): JsonResponse
    {
        $credential = ProviderCredential::findOrFail($id);
        $credential->delete(); // SoftDelete：保留审计痕迹
        return response()->json(['message' => 'Deleted']);
    }

    /**
     * 重置：fail_count 归零、status 置 active。
     * 用于管理员手工救回被自动失活的 key（确认 key 仍可用后调用）。
     */
    public function reactivate($id): JsonResponse
    {
        /** @var ProviderCredential $credential */
        $credential = ProviderCredential::findOrFail($id);

        $credential->forceFill([
            'status'     => 'active',
            'fail_count' => 0,
            'last_error' => '',
        ])->save();

        return response()->json($this->present($credential));
    }

    /**
     * 输出表示：mask 掉 api_key，保留运维所需元信息。
     */
    private function present(ProviderCredential $c): array
    {
        return [
            'id'             => $c->id,
            'provider_id'    => $c->provider_id,
            'name'           => $c->name,
            'api_key_masked' => $this->maskKey((string) $c->getAttribute('api_key')),
            'weight'         => (int) $c->weight,
            'status'         => $c->status,
            'fail_count'     => (int) $c->fail_count,
            'last_used_at'   => optional($c->last_used_at)->toDateTimeString(),
            'last_failed_at' => optional($c->last_failed_at)->toDateTimeString(),
            'last_error'     => $c->last_error,
            'remark'         => $c->remark,
            'created_at'     => optional($c->created_at)->toDateTimeString(),
            'updated_at'     => optional($c->updated_at)->toDateTimeString(),
        ];
    }

    /**
     * 凭证脱敏：长 ≤ 8 → 全打码；其余 → 前 4 + *** + 后 4。
     * 不改原值，仅出输出层。
     */
    private function maskKey(string $key): string
    {
        $len = strlen($key);
        if ($len === 0) return '';
        if ($len <= 8) return str_repeat('*', $len);
        return substr($key, 0, 4) . '***' . substr($key, -4);
    }
}
