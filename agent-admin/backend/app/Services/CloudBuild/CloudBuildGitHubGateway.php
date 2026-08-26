<?php

namespace App\Services\CloudBuild;

interface CloudBuildGitHubGateway
{
    public function isConfigured(): bool;

    /**
     * 触发 workflow_dispatch。成功返回 true（GitHub 不立即返回 run_id）。
     *
     * @param array<string, scalar> $inputs
     */
    public function dispatch(string $platform, array $inputs): bool;

    /** 最近一次 dispatch 失败原因码；成功或未调用时为 null。 */
    public function lastDispatchError(): ?string;

    public function cancelRun(int $runId): bool;

    /**
     * 按 run_id 读一次 workflow run。
     *
     * @return array{id:int,status:string,conclusion:?string,html_url:string}|null
     */
    public function getWorkflowRun(int $runId): ?array;

    /**
     * 查找 dispatched_at 之后、尚未被其它任务占用的最近一次 workflow_dispatch。
     * GitHub 不在 list API 暴露 inputs，只能按时间窗 + 排除已占用 run_id。
     *
     * @param list<int> $excludeRunIds
     * @return array{id:int,status:string,conclusion:?string,html_url:string}|null
     */
    public function findRecentWorkflowRun(string $platform, string $createdAfterIso, array $excludeRunIds = []): ?array;

    /**
     * 把 URL 流式落到 sink。resumeFrom>0 时从该字节续传（HTTP Range）。
     *
     * @return array{ok:bool,bytes:int,error:?string}
     */
    public function downloadTo(string $url, string $sinkPath, int $resumeFrom = 0): array;
}
