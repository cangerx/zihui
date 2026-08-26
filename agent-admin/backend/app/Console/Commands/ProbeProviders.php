<?php

namespace App\Console\Commands;

use App\Models\CloudProvider;
use App\Services\Gateway\GatewayRouter;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * 健康探测：周期性对 active 且未熔断的 provider 调 GET /models 验证可用性。
 *
 * 设计要点：
 *   - 只跑基础探测（不发 chat completion），不消耗 token，可高频运行
 *   - 单次延迟 + 成功/失败计数按"小时桶"聚合写入 cloud_provider_metrics
 *     （主键 provider_id + bucket_hour，UPSERT）
 *   - 连续失败次数缓存在 Cache（TTL 6h），达 config('gateway.probe_fail_suspend_threshold')
 *     时把 provider 标记 suspended_at（不删除，可由管理员一键 recover）
 *   - 同时清理超过 metrics_retain_days（默认 30 天）的旧 metrics，避免无限增长
 *
 * 调度：app/Console/Kernel.php 注册 everyFiveMinutes()->withoutOverlapping()。
 * 手工触发：php artisan providers:probe [--id=1 --id=2]
 */
class ProbeProviders extends Command
{
    protected $signature = 'providers:probe
        {--id=* : 指定 provider id 列表，不指定则探测所有 active 状态的 provider}
        {--no-suspend : 调试用：禁用自动熔断逻辑}';

    protected $description = '健康探测所有云服务商：GET /models（不消耗 token）+ 写 metrics + 自动熔断';

    public function handle(GatewayRouter $router): int
    {
        $providers = $this->resolveProviders();
        if ($providers->isEmpty()) {
            $this->info('No active providers to probe.');
            return self::SUCCESS;
        }

        $this->info("Probing {$providers->count()} provider(s)...");

        $threshold      = (int) config('gateway.probe_fail_suspend_threshold', 6);
        $timeoutSeconds = (int) config('gateway.timeouts.probe', 10);
        $allowSuspend   = !$this->option('no-suspend');

        foreach ($providers as $provider) {
            $this->probeOne($provider, $router, $threshold, $timeoutSeconds, $allowSuspend);
        }

        $this->cleanupOldMetrics();

        $this->info('Probe done.');
        return self::SUCCESS;
    }

    /**
     * 取要探测的 provider 集合：
     *   - --id 指定时只探测指定的（含已 suspended，便于人工触发的复测）
     *   - 否则取 active 且未 suspended 的
     */
    private function resolveProviders()
    {
        $ids = array_filter((array) $this->option('id'), fn($v) => $v !== '' && $v !== null);

        $query = CloudProvider::query();
        if (!empty($ids)) {
            return $query->whereIn('id', $ids)->get();
        }
        return $query
            ->where('status', 'active')
            ->whereNull('suspended_at')
            ->get();
    }

    private function probeOne(CloudProvider $provider, GatewayRouter $router, int $threshold, int $timeoutSeconds, bool $allowSuspend): void
    {
        $cacheKey = "provider:probe_consecutive_fail:{$provider->id}";

        try {
            $adapter = $router->selectAdapter($provider);
            [$credential, $apiKey] = $router->selectCredential($provider);

            $start = microtime(true);
            $result = $adapter->probeModels($provider, $apiKey, $timeoutSeconds);
            $latencyMs = (int) round((microtime(true) - $start) * 1000);

            // 'warning' 视作可用（中转 API 屏蔽 /models 的常见情况），不计入连续失败
            $isOk = in_array($result->status, ['ok', 'warning'], true);

            $this->upsertMetrics(
                $provider->id,
                $isOk,
                $latencyMs,
                $isOk ? '' : (string) $result->message
            );

            if ($isOk) {
                Cache::forget($cacheKey);
                // 探测成功也回写 credential：清零 fail_count，让之前因抖动累积的失败计数重置
                $router->markCredentialSuccess($credential);
                $this->line(" - [{$provider->id}] {$provider->name}: {$result->status} ({$latencyMs}ms)");
                return;
            }

            // ── 失败归因：凭证问题 vs Provider 问题 ──────────────
            // 401/403 强烈指向「这把 key 坏了」，应只把这把 credential 标 invalid，
            // 不让坏 key 反复探测连累整个 provider 被熔断。
            // 4xx 其他 / 5xx / 连接异常 / 协议不规范都视为 provider 整体问题。
            //
            // 注意：池子为空时 $credential 为 null（用 provider.api_key 兜底），
            // 此时 401/403 仍计入 provider 熔断（无凭证池可标）。
            $isCredentialError = $credential !== null
                && in_array($result->httpStatus, [401, 403], true);

            if ($isCredentialError) {
                $router->markCredentialFailure($credential, (string) $result->message);
                $this->warn(" - [{$provider->id}] {$provider->name}: credential error HTTP {$result->httpStatus}, marked fail (cred id={$credential->id})");
                return;
            }

            $consecutive = (int) Cache::get($cacheKey, 0) + 1;
            Cache::put($cacheKey, $consecutive, now()->addHours(6));

            $this->warn(" - [{$provider->id}] {$provider->name}: error ({$consecutive}/{$threshold}) {$result->message}");

            if ($allowSuspend && $consecutive >= $threshold) {
                $this->suspendProvider($provider, (string) $result->message);
                Cache::forget($cacheKey);
            }
        } catch (Throwable $e) {
            Log::warning("[probe] provider={$provider->id} err=" . $e->getMessage());
            $this->upsertMetrics($provider->id, false, 0, 'probe exception: ' . $e->getMessage());

            $consecutive = (int) Cache::get($cacheKey, 0) + 1;
            Cache::put($cacheKey, $consecutive, now()->addHours(6));
            $this->error(" - [{$provider->id}] {$provider->name}: exception ({$consecutive}/{$threshold}) " . $e->getMessage());

            if ($allowSuspend && $consecutive >= $threshold) {
                $this->suspendProvider($provider, $e->getMessage());
                Cache::forget($cacheKey);
            }
        }
    }

    /**
     * UPSERT 一行 cloud_provider_metrics 按当前小时桶累加。
     *
     * 延迟分位数采用近似策略：本次延迟样本直接覆盖 p50/p99（多次样本时后写覆盖前写）。
     * 监控用途够用；如需精确分位数，后续可改 t-digest 或外部时序库。
     */
    private function upsertMetrics(int $providerId, bool $ok, int $latencyMs, string $errorMsg): void
    {
        $bucketHour = now()->startOfHour();
        $errMsgTrimmed = mb_substr($errorMsg, 0, 500);

        DB::statement(
            "INSERT INTO cloud_provider_metrics
                (provider_id, bucket_hour, ok_count, fail_count, latency_ms_p50, latency_ms_p99, last_error_message, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
                ok_count = ok_count + VALUES(ok_count),
                fail_count = fail_count + VALUES(fail_count),
                latency_ms_p50 = VALUES(latency_ms_p50),
                latency_ms_p99 = VALUES(latency_ms_p99),
                last_error_message = VALUES(last_error_message),
                updated_at = NOW()",
            [
                $providerId,
                $bucketHour,
                $ok ? 1 : 0,
                $ok ? 0 : 1,
                $latencyMs,
                $latencyMs,
                $errMsgTrimmed,
            ]
        );
    }

    private function suspendProvider(CloudProvider $provider, string $reason): void
    {
        $provider->forceFill([
            'suspended_at'     => now(),
            'suspended_reason' => mb_substr('自动熔断：' . $reason, 0, 500),
        ])->saveQuietly();

        Log::warning("[probe] provider {$provider->id} ({$provider->name}) suspended: {$reason}");
        $this->error("   suspended provider {$provider->id}");
    }

    private function cleanupOldMetrics(): void
    {
        $retainDays = (int) config('gateway.metrics_retain_days', 30);
        if ($retainDays <= 0) return;

        $cutoff = now()->subDays($retainDays);
        $deleted = DB::table('cloud_provider_metrics')
            ->where('bucket_hour', '<', $cutoff)
            ->delete();

        if ($deleted > 0) {
            $this->line("Cleaned {$deleted} old metric rows (older than {$retainDays} days).");
        }
    }
}
