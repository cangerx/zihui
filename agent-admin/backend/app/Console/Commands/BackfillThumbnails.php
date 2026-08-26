<?php

namespace App\Console\Commands;

use App\Models\Agent;
use App\Models\CreativeTemplate;
use App\Models\Inspiration;
use App\Services\StorageService;
use App\Services\ThumbnailService;
use GuzzleHttp\Client;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * 为存量的「灵感广场 / 创意模板 / 智能体市场」记录补生成缩略图。
 *
 * 运行期的新上传由上传端生成缩略图（后端零图像扩展依赖）；本命令是给历史数据一次性补齐，
 * 是全链路里唯一用到 GD 的地方。GD 不可用时直接退出并提示，不影响线上功能（老记录继续回退原图）。
 *
 * 用法：
 *   php artisan thumbnails:backfill                # 三类全部
 *   php artisan thumbnails:backfill --type=agent   # 仅智能体
 *   php artisan thumbnails:backfill --dry-run      # 只统计不写入
 */
class BackfillThumbnails extends Command
{
    protected $signature = 'thumbnails:backfill
        {--type=all : inspiration|template|agent|all}
        {--limit=0 : 每类最多处理条数（0 = 不限）}
        {--size=720 : 缩略图长边像素}
        {--quality=82 : JPEG 质量 1-100}
        {--dry-run : 只统计待回填数量，不读图、不写库}';

    protected $description = '为灵感/创意模板/智能体的存量记录补生成缩略图（需 GD 扩展）';

    public function handle(): int
    {
        $type = (string) $this->option('type');
        $dryRun = (bool) $this->option('dry-run');
        $maxSide = max(64, (int) $this->option('size'));
        $quality = (int) $this->option('quality');
        $limit = max(0, (int) $this->option('limit'));

        if (!$dryRun && !ThumbnailService::available()) {
            $this->error('当前 PHP 未启用 GD 扩展，无法生成缩略图。请安装/开启 gd 后重试（或 --dry-run 仅统计）。');
            return self::FAILURE;
        }

        $targets = [
            'inspiration' => ['model' => Inspiration::class, 'source' => 'cover_image', 'thumb' => 'cover_thumb', 'subdir' => 'inspirations'],
            'template'    => ['model' => CreativeTemplate::class, 'source' => 'cover_image', 'thumb' => 'cover_thumb', 'subdir' => 'creative-templates'],
            'agent'       => ['model' => Agent::class, 'source' => 'avatar', 'thumb' => 'avatar_thumb', 'subdir' => 'agents'],
        ];

        if ($type !== 'all') {
            if (!isset($targets[$type])) {
                $this->error("未知 --type={$type}，可选 inspiration|template|agent|all");
                return self::FAILURE;
            }
            $targets = [$type => $targets[$type]];
        }

        $totalOk = 0;
        $totalFail = 0;
        foreach ($targets as $name => $cfg) {
            [$ok, $fail] = $this->processType($name, $cfg, $maxSide, $quality, $limit, $dryRun);
            $totalOk += $ok;
            $totalFail += $fail;
        }

        $this->info($dryRun
            ? "dry-run 完成：待回填 {$totalOk} 条"
            : "回填完成：成功 {$totalOk} 条，失败/跳过 {$totalFail} 条");
        return self::SUCCESS;
    }

    /** @return array{0:int,1:int} [成功数, 失败数] */
    private function processType(string $name, array $cfg, int $maxSide, int $quality, int $limit, bool $dryRun): array
    {
        $modelClass = $cfg['model'];
        $sourceCol = $cfg['source'];
        $thumbCol = $cfg['thumb'];
        $subdir = $cfg['subdir'];

        $query = $modelClass::query()
            ->where($sourceCol, '!=', '')
            ->where(function ($q) use ($thumbCol) {
                $q->whereNull($thumbCol)->orWhere($thumbCol, '');
            });
        $pending = (clone $query)->count();
        $this->line("[{$name}] 待回填 {$pending} 条");

        if ($dryRun) {
            return [$pending, 0];
        }

        if ($limit > 0) {
            $query->limit($limit);
        }

        $ok = 0;
        $fail = 0;
        $query->orderBy('id')->chunkById(100, function ($rows) use (&$ok, &$fail, $sourceCol, $thumbCol, $subdir, $maxSide, $quality) {
            foreach ($rows as $row) {
                if ($this->backfillOne($row, $sourceCol, $thumbCol, $subdir, $maxSide, $quality)) {
                    $ok++;
                } else {
                    $fail++;
                }
            }
        });

        $this->line("[{$name}] 成功 {$ok}，失败/跳过 {$fail}");
        return [$ok, $fail];
    }

    private function backfillOne(Model $row, string $sourceCol, string $thumbCol, string $subdir, int $maxSide, int $quality): bool
    {
        $sourceUrl = (string) $row->{$sourceCol};
        if ($sourceUrl === '') {
            return false;
        }

        $bytes = $this->readSourceBytes($sourceUrl);
        if ($bytes === null) {
            $this->warn("  #{$row->id} 读取原图失败：{$sourceUrl}");
            return false;
        }

        $jpeg = ThumbnailService::generateJpeg($bytes, $maxSide, $quality);
        if ($jpeg === null) {
            $this->warn("  #{$row->id} 生成缩略图失败（解码不支持？）");
            return false;
        }

        $thumbUrl = StorageService::putBytes($jpeg, 'image/jpeg', $subdir, (string) Str::uuid() . '_thumb.jpg');
        if ($thumbUrl === null) {
            $this->warn("  #{$row->id} 缩略图上传存储失败");
            return false;
        }

        $row->{$thumbCol} = $thumbUrl;
        $row->save();
        return true;
    }

    /** 读取原图字节：http(s) 下载，相对路径走 public_path。 */
    private function readSourceBytes(string $url): ?string
    {
        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            try {
                $client = new Client(['timeout' => 30]);
                $resp = $client->get($url, ['http_errors' => false]);
                if ($resp->getStatusCode() < 200 || $resp->getStatusCode() >= 300) {
                    return null;
                }
                $body = (string) $resp->getBody();
                return $body !== '' ? $body : null;
            } catch (\Throwable $e) {
                return null;
            }
        }

        $abs = public_path(ltrim($url, '/'));
        if (!is_file($abs)) {
            return null;
        }
        $body = @file_get_contents($abs);
        return $body === false ? null : $body;
    }
}
