<?php

namespace Tests\Support;

use App\Services\CloudBuild\CloudBuildGitHubGateway;

final class FakeCloudBuildGitHubGateway implements CloudBuildGitHubGateway
{
    public bool $configured = true;
    public bool $dispatchResult = true;
    public ?string $dispatchError = null;
    public bool $cancelResult = true;
    public int $dispatchCalls = 0;
    public int $cancelCalls = 0;
    public array $lastInputs = [];
    public array $platforms = [];
    public ?int $lastCancelRunId = null;
    /** @var array{id:int,status:string,conclusion:?string,html_url?:string}|null */
    public ?array $recentRun = null;
    /** @var array<int, array{id:int,status:string,conclusion:?string,html_url?:string}> */
    public array $runsById = [];
    public array $downloadBodies = [];
    public int $maxBytesPerCall = 2147483647;
    public int $downloadCalls = 0;
    private ?string $lastDispatchError = null;

    public function isConfigured(): bool
    {
        return $this->configured;
    }

    public function dispatch(string $platform, array $inputs): bool
    {
        $this->dispatchCalls++;
        $this->platforms[] = $platform;
        $this->lastInputs = $inputs;
        if ($this->dispatchResult) {
            $this->lastDispatchError = null;
            return true;
        }
        $this->lastDispatchError = $this->dispatchError;
        return false;
    }

    public function lastDispatchError(): ?string
    {
        return $this->lastDispatchError;
    }

    public function cancelRun(int $runId): bool
    {
        $this->cancelCalls++;
        $this->lastCancelRunId = $runId;
        return $this->cancelResult;
    }

    public function getWorkflowRun(int $runId): ?array
    {
        return $this->runsById[$runId] ?? null;
    }

    public function findRecentWorkflowRun(string $platform, string $createdAfterIso, array $excludeRunIds = []): ?array
    {
        if ($this->recentRun === null) {
            return null;
        }
        $id = (int) ($this->recentRun['id'] ?? 0);
        if ($id > 0 && in_array($id, array_map('intval', $excludeRunIds), true)) {
            return null;
        }
        return $this->recentRun;
    }

    public function downloadTo(string $url, string $sinkPath, int $resumeFrom = 0): array
    {
        $this->downloadCalls++;
        $full = (string) ($this->downloadBodies[$url] ?? '');
        $remaining = substr($full, $resumeFrom);
        $chunk = substr($remaining, 0, $this->maxBytesPerCall);
        $dir = dirname($sinkPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        $mode = $resumeFrom > 0 ? 'ab' : 'wb';
        $fp = fopen($sinkPath, $mode);
        if ($fp === false) {
            return ['ok' => false, 'bytes' => 0, 'error' => 'open_failed'];
        }
        fwrite($fp, $chunk);
        fclose($fp);
        if ($full === '') {
            return ['ok' => false, 'bytes' => 0, 'error' => 'empty'];
        }
        $complete = ($resumeFrom + strlen($chunk)) >= strlen($full);
        if (!$complete) {
            return ['ok' => false, 'bytes' => strlen($chunk), 'error' => 'interrupted'];
        }
        return ['ok' => true, 'bytes' => strlen($chunk), 'error' => null];
    }
}
