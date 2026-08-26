<?php

namespace App\Services\Gateway;

use App\Models\CloudModel;
use App\Models\CloudProvider;
use App\Models\ProviderCredential;
use App\Services\Gateway\Adapters\DuoMiAdapter;
use App\Services\Gateway\Adapters\OpenAICompatibleAdapter;
use App\Services\Gateway\Adapters\ProviderAdapter;
use Illuminate\Support\Collection;

/**
 * 网关路由：把一次调用映射到（适配器 + 凭证）的二元组。
 *
 * 路由职责：
 *   1. 按 provider.type 选适配器：
 *      - openai / openai_compatible → OpenAICompatibleAdapter（OpenAI 协议族）
 *      - duomi                       → DuoMiAdapter（多米 API：仅图片生成 gpt-image-2 异步）
 *      新增原生协议时扩 selectAdapter 内的 match
 *   2. 凭证选择策略：
 *      - 'round_robin'（默认）：池子里 status=active 的行中，按 last_used_at ASC 选最久没用的
 *      - 'random_weighted'  ：按 weight 加权随机
 *      - 池子全空 → 回落使用 provider.api_key（保证老 provider 零行为变化）
 *   3. 调用结束后由上层（NewGatewayService）回调 markCredentialSuccess/Failure 维护池状态：
 *      - 成功：fail_count 归零
 *      - 失败：fail_count++；达 config('gateway.credential_fail_invalid_threshold') 阈值置 invalid
 *
 * 选 key 后立刻写 last_used_at 是无锁的乐观策略：
 *   - 高并发下偶发两个请求选到同一把 key 不影响正确性
 *   - 写入用 saveQuietly 避免触发 updated_at 抖动
 */
class GatewayRouter
{
    /**
     * 综合路由：CloudModel → (adapter, provider, credential, apiKey)。
     */
    public function route(CloudModel $cloudModel): RouteResult
    {
        /** @var CloudProvider $provider */
        $provider = $cloudModel->provider;
        $adapter = $this->selectAdapter($provider);
        [$credential, $apiKey] = $this->selectCredential($provider);

        return new RouteResult($adapter, $provider, $credential, $apiKey);
    }

    /**
     * 仅选适配器（用于 ProbeService 不需要凭证池逻辑的探测场景）。
     *
     * host 自动识别兜底：管理员把 cloud_providers.type 配成 openai / openai_compatible 时，
     * OpenAICompatibleAdapter 走 OpenAI 同步协议 POST /images/generations，会被多米拒绝
     * 「Synchronous requests are not supported. Please add async=true to the query parameters」。
     * 这里把"多米判断"统一委托给 isLikelyDuoMiProvider，配合 OpenAICompatibleAdapter
     * 在 `async=true` 模式下的兼容处理（type=duomi 或 api_base host 含 duomi / domi 字样）。
     */
    public function selectAdapter(CloudProvider $provider): ProviderAdapter
    {
        if (self::isLikelyDuoMiProvider($provider)) {
            return app(DuoMiAdapter::class);
        }

        $type = (string) ($provider->type ?? 'openai_compatible');
        return match ($type) {
            'openai', 'openai_compatible' => app(OpenAICompatibleAdapter::class),
            // 未识别 type（含历史遗留枚举）一律回落 OpenAI 兼容协议，确保流量不中断
            default => app(OpenAICompatibleAdapter::class),
        };
    }

    /**
     * 判断 provider 是否为「多米类」服务商。
     *
     * 两条命中规则（或）：
     *   1. provider.type === 'duomi'                              （管理员显式配置）
     *   2. api_base host 含 duomi / domi 字样（duomiapi.com / domiapi.com / api.duomi.* / ...）
     *      —— 容忍管理员把 type 误配成 openai / openai_compatible 的常见错误
     *
     * static 设计原因：除 GatewayRouter 自己外，外部代码（如探测器、迁移脚本）也可能复用此判断逻辑，
     * 统一从一个入口判断，避免规则发散。
     */
    public static function isLikelyDuoMiProvider(CloudProvider $provider): bool
    {
        $type = (string) ($provider->type ?? '');
        if ($type === 'duomi') return true;

        $apiBase = (string) ($provider->api_base ?? '');
        if ($apiBase === '') return false;
        $host = parse_url($apiBase, PHP_URL_HOST);
        if (!is_string($host) || $host === '') return false;
        $host = strtolower($host);
        return str_contains($host, 'duomi') || str_contains($host, 'domi');
    }

    /**
     * 选凭证：返回 [ProviderCredential|null, apiKey]。
     */
    public function selectCredential(CloudProvider $provider): array
    {
        $strategy = (string) config('gateway.credential_pool_strategy', 'round_robin');

        /** @var Collection<int, ProviderCredential> $candidates */
        $candidates = ProviderCredential::query()
            ->where('provider_id', $provider->id)
            ->where('status', 'active')
            ->get();

        if ($candidates->isEmpty()) {
            // 池子空 → 回落 provider.api_key（保证老 provider 零行为变化）
            return [null, (string) ($provider->api_key ?? '')];
        }

        $cred = $strategy === 'random_weighted'
            ? $this->pickWeighted($candidates)
            : $this->pickLeastRecentlyUsed($candidates);

        if ($cred === null) {
            return [null, (string) ($provider->api_key ?? '')];
        }

        // 乐观写 last_used_at（不锁、不触发 updated_at）
        $cred->forceFill(['last_used_at' => now()])->saveQuietly();

        return [$cred, (string) $cred->api_key];
    }

    /**
     * 调用成功后回写：fail_count 归零（如有非零）。
     */
    public function markCredentialSuccess(?ProviderCredential $credential): void
    {
        if ($credential === null) return;
        if ((int) $credential->fail_count > 0) {
            $credential->forceFill(['fail_count' => 0])->saveQuietly();
        }
    }

    /**
     * 调用失败后回写：fail_count++、记录最近错误；达阈值置 invalid。
     *
     * 并发安全：
     *   - fail_count 用 increment 走 SQL `SET fail_count = fail_count + 1` 原子自增，
     *     避免两次失败「先读再写」时互相覆盖导致漏计。
     *   - 第二个参数把 last_failed_at / last_error 一起带上，单条 UPDATE 完成。
     *   - 达阈值后再下发一次 status=invalid 的 UPDATE。多请求并发达阈值时多写几次
     *     status=invalid 是幂等的，不影响正确性。
     */
    public function markCredentialFailure(?ProviderCredential $credential, string $errorMessage): void
    {
        if ($credential === null) return;

        $threshold = (int) config('gateway.credential_fail_invalid_threshold', 5);

        // 原子自增；第二参数附加同条 UPDATE 的字段，避免再发一条 SQL
        $credential->increment('fail_count', 1, [
            'last_failed_at' => now(),
            'last_error'     => mb_substr($errorMessage, 0, 500),
        ]);

        // increment 后 model 内存里的 fail_count 已经是新值（Eloquent 自动同步）
        if ((int) $credential->fail_count >= $threshold && $credential->status !== 'invalid') {
            $credential->forceFill(['status' => 'invalid'])->saveQuietly();
        }
    }

    /**
     * 同 weight 内按 last_used_at ASC（最久没用的优先）；跨 weight 也按 last_used_at 排序，
     * 不严格遵守 weight，避免低权重 key 永久饿死。
     * 适合"想让多把 key 都被均匀使用"的场景。
     */
    private function pickLeastRecentlyUsed(Collection $candidates): ?ProviderCredential
    {
        return $candidates
            ->sortBy(fn(ProviderCredential $c) => optional($c->last_used_at)->getTimestamp() ?? 0)
            ->first();
    }

    /**
     * 加权随机：weight 越大被抽中概率越高，调用比例近似 weight 比例。
     * 适合"主号优先用，备号偶尔分流"的场景。
     */
    private function pickWeighted(Collection $candidates): ?ProviderCredential
    {
        $total = 0;
        foreach ($candidates as $c) {
            $total += max(1, (int) $c->weight);
        }
        if ($total <= 0) {
            return $candidates->first();
        }

        $r = mt_rand(1, $total);
        $accum = 0;
        foreach ($candidates as $c) {
            $accum += max(1, (int) $c->weight);
            if ($r <= $accum) {
                return $c;
            }
        }
        return $candidates->last();
    }
}
