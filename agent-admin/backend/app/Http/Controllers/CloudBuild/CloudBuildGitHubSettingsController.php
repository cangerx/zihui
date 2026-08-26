<?php

namespace App\Http\Controllers\CloudBuild;

use App\Http\Controllers\Controller;
use App\Models\SystemSetting;
use App\Services\CloudBuild\PackagingLicense;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class CloudBuildGitHubSettingsController extends Controller
{
    public function show(): JsonResponse
    {
        $repo = '';
        $hasToken = false;
        try {
            $repo = trim((string) SystemSetting::getValue('github_build_repo', ''));
            $hasToken = trim((string) SystemSetting::getValue('github_build_token', '')) !== '';
        } catch (\Throwable $e) {
        }

        return response()->json([
            'repo' => $repo,
            'has_token' => $hasToken,
            'can_use_github_packaging' => PackagingLicense::canUseGithub(),
            'can_use_mac_packaging' => PackagingLicense::canUseMac(),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        if (!PackagingLicense::canUseGithub()) {
            return response()->json(['error' => PackagingLicense::ERR_NOT_LICENSED], 403);
        }

        $validator = Validator::make($request->all(), [
            'repo' => ['required', 'string', 'max:200', 'regex:/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/'],
            'token' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        SystemSetting::setValue('github_build_repo', trim((string) $request->input('repo')));
        $token = trim((string) $request->input('token', ''));
        if ($token !== '') {
            SystemSetting::setValue('github_build_token', $token);
        }

        return $this->show();
    }
}
