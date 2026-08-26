<?php

namespace App\Http\Controllers\CloudBuild;

use App\Http\Controllers\Controller;
use App\Services\CloudBuild\CloudBuildPullService;
use App\Services\CloudBuild\OemBuildPullService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 1.2.0 起的「混合推拉」唤醒入口（公开端点）：
 *
 *   - agent-build 在 artifact 拉好后给本端 POST /api/build/wake 发轻量信号 {"build_id": "..."}
 *   - 本端收到后立即返回 200，使用 fastcgi_finish_request / ignore_user_abort 把响应
 *     先 flush 给 agent-build，然后在后台继续 pullOne（resolve → download → place → ack）
 *
 * 安全设计：
 *   - 端点本身公开（无 JWT），但只接受 {"build_id"} —— 不接受 URL/sha256/filename 等敏感字段
 *   - 收到 wake 后由本端**主动回 agent-build 拉**数据，使用现有 Origin 域名鉴权（VerifyDomainBinding）
 *   - 因此伪造 wake 最多让本端发起一次自取无果的回拉（agent-build 对未授权 origin 返 404）
 *   - 内置 throttle:60,1（routes/api.php 注册时挂上）
 */
class CloudBuildWakeController extends Controller
{
    public function wake(Request $request, CloudBuildPullService $service, OemBuildPullService $oemService): JsonResponse
    {
        $buildId = (string) $request->input('build_id', '');
        if ($buildId === '') {
            return response()->json(['error' => 'missing_build_id'], 400);
        }

        // 快速 sanity check：本地至少要有这条记录，否则当成噪声
        $exists = DB::table('cloud_builds')->where('build_id', $buildId)->exists();
        $isOem = false;
        if (!$exists) {
            $isOem = DB::table('oem_builds')->where('build_id', $buildId)->exists();
            $exists = $isOem;
        }
        if (!$exists) {
            // 不暴露 404，避免被外部探测构造的 build_id（统一返 200 让攻击者无法分辨）
            return response()->json(['status' => 'wake_received'], 200);
        }

        // 准备好响应；先发回 agent-build，再后台拉
        $payload = ['status' => 'wake_received', 'build_id' => $buildId];
        $body = json_encode($payload, JSON_UNESCAPED_SLASHES);

        // 让脚本即使客户端断了也继续执行
        @ignore_user_abort(true);
        @set_time_limit(600);

        // 把响应先 flush 出去，agent-build 那边立刻拿到 200
        if (function_exists('fastcgi_finish_request')) {
            // PHP-FPM 路径（生产典型部署）：先手动构造 HTTP 响应再 finish
            // Laravel 的 Response 对象正常返回也行，但 fastcgi_finish_request 必须在 send 之后调
            header('Content-Type: application/json');
            header('Content-Length: ' . strlen($body));
            header('Connection: close');
            echo $body;
            fastcgi_finish_request();
        }
        // 非 PHP-FPM 环境（CLI 测试 / built-in server）：靠 ignore_user_abort 兜底，
        // 函数末尾 return Response 会让 Laravel 正常 flush（虽然慢一点）

        // 后台拉；任何异常都吃掉，仅记日志（前端轮询/再次 wake 都能恢复）
        try {
            $result = $isOem ? $oemService->pullOne($buildId) : $service->pullOne($buildId);
            Log::info('[Wake] pull triggered', [
                'build_id' => $buildId,
                'build_mode' => $isOem ? 'oem' : 'normal',
                'outcome' => $result['outcome'] ?? 'unknown',
                'message' => $result['message'] ?? '',
            ]);
        } catch (\Throwable $e) {
            Log::warning('[Wake] pull threw', [
                'build_id' => $buildId,
                'error' => $e->getMessage(),
            ]);
        }

        // 仅当走非 PHP-FPM 路径时才会用到这个返回；PHP-FPM 路径已经 finish_request
        return response()->json($payload, 200);
    }
}
