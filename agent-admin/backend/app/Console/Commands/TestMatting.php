<?php

namespace App\Console\Commands;

use App\Http\Controllers\MattingController;
use App\Services\Aliyun\AliyunMattingService;
use Illuminate\Console\Command;
use Throwable;

/**
 * 验证阿里抠图 SDK 装包 + 当前 SystemSetting 抠图凭证是否可用。
 *
 * 用法：
 *   php artisan test:matting /absolute/path/to/image.jpg
 *   php artisan test:matting https://example.com/image.jpg --url
 *     注：--url 模式下首参传公网 URL，不传本地路径
 *
 * 凭证来源（v1.5.0+）：SystemSetting (matting_access_key_id / matting_access_key_secret / matting_endpoint /
 * matting_region_id)，由管理后台「AI 抠图 → 自定义设置」配置；不再走 .env。
 *
 * 成功输出：
 *   - 阿里 RequestId
 *   - 处理耗时（毫秒）
 *   - 结果图临时 URL（24h 有效，PNG 透明背景）
 *
 * 失败时 exit code 非 0，stderr 打印错误堆栈。
 */
class TestMatting extends Command
{
    protected $signature = 'test:matting {path : 本地图片绝对路径，或 --url 模式下的公网 URL} {--url : 走 URL 模式（默认走本地文件 Advance 模式）}';
    protected $description = 'Verify Aliyun matting SDK install + current SystemSetting credentials by running a hello-world segmentation.';

    public function handle(AliyunMattingService $svc): int
    {
        $path = (string) $this->argument('path');
        $useUrl = (bool) $this->option('url');

        $creds = MattingController::resolveCreds();

        $this->info('==== 阿里抠图 hello world ====');
        $this->line('endpoint      : ' . $creds['endpoint']);
        $this->line('region        : ' . $creds['region_id']);
        $this->line('ak_configured : ' . (!empty($creds['access_key_id']) && !empty($creds['access_key_secret']) ? 'YES' : 'NO'));
        $this->line('mode          : ' . ($useUrl ? 'URL' : 'LocalFile (Advance API)'));
        $this->line('input         : ' . $path);
        $this->line('');

        try {
            $svc->configure($creds);
            $result = $useUrl
                ? $svc->segmentImageUrl($path)
                : $svc->segmentLocalFile($path);
        } catch (Throwable $e) {
            $this->error('FAILED: ' . $e->getMessage());
            if ($this->getOutput()->isVerbose()) {
                $this->error($e->getTraceAsString());
            }
            return 1;
        }

        $this->info('==== SUCCESS ====');
        $this->line('request_id    : ' . $result['request_id']);
        $this->line('elapsed_ms    : ' . $result['elapsed_ms']);
        $this->line('result_url    : ' . $result['image_url']);
        $this->line('');
        $this->line('结果 URL 24 小时有效，PNG 透明背景，浏览器打开查看。');
        return 0;
    }
}
