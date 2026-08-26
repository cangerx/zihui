<?php

namespace Tests\Unit;

use App\Services\CloudBuild\CloudBuildGitHubDispatchService;
use Illuminate\Http\Client\Factory;

class CloudBuildGitHubDispatchServiceTest extends CloudBuildExecutionTestCase
{
    public function test_mocked_github_dispatch_posts_workflow_url(): void
    {
        $http = new Factory();
        $http->fake([
            'https://api.github.com/repos/acme/repo/actions/workflows/build-win.yml/dispatches' => Factory::response('', 204),
        ]);

        $service = new CloudBuildGitHubDispatchService($http, [
            'token' => 'test-token',
            'repo' => 'acme/repo',
            'ref' => 'main',
            'workflow_win' => 'build-win.yml',
            'workflow_mac' => 'build-mac.yml',
            'verify_ssl' => false,
            'api_timeout' => 5,
        ]);

        $this->assertTrue($service->isConfigured());
        $this->assertTrue($service->dispatch('win', [
            'build_id' => '00000000-0000-4000-8000-000000000601',
            'callback_token' => 'callback-test-token',
        ]));

        $http->assertSent(function ($request) {
            return $request->url() === 'https://api.github.com/repos/acme/repo/actions/workflows/build-win.yml/dispatches'
                && $request['ref'] === 'main'
                && $request['inputs']['build_id'] === '00000000-0000-4000-8000-000000000601'
                && $request->hasHeader('Authorization', 'Bearer test-token');
        });
    }

    public function test_blank_token_is_not_configured(): void
    {
        $service = new CloudBuildGitHubDispatchService(new Factory(), [
            'token' => '',
            'repo' => 'acme/repo',
            'ref' => 'main',
            'workflow_win' => 'build-win.yml',
            'workflow_mac' => 'build-mac.yml',
            'verify_ssl' => false,
            'api_timeout' => 5,
        ]);
        $this->assertFalse($service->isConfigured());
    }

    public function test_http_404_is_workflow_not_found(): void
    {
        $http = new Factory();
        $http->fake([
            '*' => Factory::response(['message' => 'Not Found'], 404),
        ]);
        $service = $this->dispatchService($http);
        $this->assertFalse($service->dispatch('win', ['build_id' => '00000000-0000-4000-8000-000000000602']));
        $this->assertSame(CloudBuildGitHubDispatchService::ERR_WORKFLOW_NOT_FOUND, $service->lastDispatchError());
    }

    public function test_http_403_is_dispatch_forbidden(): void
    {
        $http = new Factory();
        $http->fake([
            '*' => Factory::response(['message' => 'Resource not accessible by personal access token'], 403),
        ]);
        $service = $this->dispatchService($http);
        $this->assertFalse($service->dispatch('win', ['build_id' => '00000000-0000-4000-8000-000000000603']));
        $this->assertSame(CloudBuildGitHubDispatchService::ERR_FORBIDDEN, $service->lastDispatchError());
    }

    public function test_find_recent_workflow_run_skips_older_and_excluded(): void
    {
        $http = new Factory();
        $http->fake([
            'https://api.github.com/repos/acme/repo/actions/workflows/build-win.yml/runs*' => Factory::response([
                'workflow_runs' => [
                    [
                        'id' => 10,
                        'status' => 'completed',
                        'conclusion' => 'failure',
                        'html_url' => 'https://github.com/acme/repo/actions/runs/10',
                        'created_at' => '2026-08-23T02:50:00Z',
                    ],
                    [
                        'id' => 11,
                        'status' => 'completed',
                        'conclusion' => 'failure',
                        'html_url' => 'https://github.com/acme/repo/actions/runs/11',
                        'created_at' => '2026-08-23T02:56:13Z',
                    ],
                    [
                        'id' => 12,
                        'status' => 'in_progress',
                        'conclusion' => null,
                        'html_url' => 'https://github.com/acme/repo/actions/runs/12',
                        'created_at' => '2026-08-23T02:56:20Z',
                    ],
                ],
            ], 200),
        ]);
        $service = $this->dispatchService($http);
        $found = $service->findRecentWorkflowRun('win', '2026-08-23T02:56:00Z', [12]);
        $this->assertSame(11, $found['id'] ?? null);
        $this->assertSame('failure', $found['conclusion'] ?? null);
    }

    public function test_get_workflow_run_returns_normalized_row(): void
    {
        $http = new Factory();
        $http->fake([
            'https://api.github.com/repos/acme/repo/actions/runs/99' => Factory::response([
                'id' => 99,
                'status' => 'completed',
                'conclusion' => 'failure',
                'html_url' => 'https://github.com/acme/repo/actions/runs/99',
            ], 200),
        ]);
        $service = $this->dispatchService($http);
        $run = $service->getWorkflowRun(99);
        $this->assertSame(99, $run['id'] ?? null);
        $this->assertSame('completed', $run['status'] ?? null);
        $this->assertSame('failure', $run['conclusion'] ?? null);
    }

    public function test_download_headers_use_octet_stream_only(): void
    {
        $service = $this->dispatchService(new Factory());
        $headers = $service->downloadRequestHeaders();
        $accepts = array_values(array_filter($headers, fn ($h) => str_starts_with($h, 'Accept:')));
        $this->assertSame(['Accept: application/octet-stream'], $accepts);
        $this->assertFalse(in_array('Accept: application/vnd.github+json', $headers, true));
    }

    /**
     * @param array<string, mixed>|null $settings
     */
    private function dispatchService(Factory $http, ?array $settings = null): CloudBuildGitHubDispatchService
    {
        return new CloudBuildGitHubDispatchService($http, $settings ?? [
            'token' => 'test-token',
            'repo' => 'acme/repo',
            'ref' => 'main',
            'workflow_win' => 'build-win.yml',
            'workflow_mac' => 'build-mac.yml',
            'verify_ssl' => false,
            'api_timeout' => 5,
        ]);
    }
}
