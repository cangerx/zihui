<?php

namespace App\Services;

use App\Models\SystemSetting;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\GuzzleException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use OSS\Core\OssException;
use OSS\OssClient;

/**
 * 统一资源上传服务
 *
 * 支持三种存储方式（由系统设置 storage_type 切换）：
 *   - local: 服务器本地（public/{subdir}/{filename}），返回相对路径 URL
 *   - cos:   腾讯云对象存储（手写 V5 签名 + Guzzle），返回完整 HTTPS URL
 *   - oss:   阿里云对象存储（官方 aliyuncs/oss-sdk-php），返回完整 HTTPS URL
 *
 * 桌面端 / 前端只关心 cover_image / icon_url 字段里的字符串，
 * 不需要感知存储方式。切换存储方式后历史数据 URL 保持有效。
 */
class StorageService
{
    /**
     * 上传文件到当前配置的存储后端
     *
     * @param UploadedFile $file       上传的文件
     * @param string       $subdir     子目录（如 inspirations / home/images / cloud-build/icons）
     * @param string       $filename   保存文件名（含扩展名）
     * @return string|null             成功返回可直接访问的 URL（local 为相对路径，cos 为完整 URL），失败返回 null
     */
    public static function upload(UploadedFile $file, string $subdir, string $filename): ?string
    {
        $type = self::effectiveStorageType();
        if ($type === 'cos') {
            return self::uploadToCos($file, $subdir, $filename);
        }
        if ($type === 'oss') {
            return self::uploadToOss($file, $subdir, $filename);
        }
        return self::uploadToLocal($file, $subdir, $filename);
    }

    /**
     * 上传并返回完整绝对 URL（适用于云打包图标场景，URL 会传给外部 GitHub Actions runner）
     */
    public static function uploadAbsolute(UploadedFile $file, string $subdir, string $filename): ?string
    {
        $url = self::upload($file, $subdir, $filename);
        if ($url === null) return null;
        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            return $url;
        }
        // local 模式：相对路径补全为绝对 URL
        return self::absoluteBase() . $url;
    }

    /**
     * 参考素材是否可从 public 目录直链访问（判断是否需改走服务路由兜底）。
     * public 不可写时 uploadToLocal 会把文件落到 storage 兜底目录（见 writableLocalDir），
     * 此时 public 直链外部访问会 404。
     */
    public static function isPublicServable(string $key): bool
    {
        $key = ltrim($key, '/');
        return $key !== '' && is_file(public_path($key));
    }

    /**
     * 参考素材服务路由的绝对 URL（public 不可写、文件落 storage 兜底目录时下发的可达链接）。
     * 由公开端点 /public/videos/reference-blob/{key} 经 readBytes 回流，
     * 见 VideoController::publicServeReferenceBlob；extractObjectKey 会剥掉该前缀取回真实 key。
     */
    public static function referenceBlobUrl(string $key): string
    {
        return self::absoluteBase() . '/public/videos/reference-blob/' . ltrim($key, '/');
    }

    /**
     * local 存储 key 对应的物理绝对路径（public 或 storage 兜底目录，见 resolveLocalPath）；
     * 不存在返回 null。供公开直出端点流式发送 local 文件，避免大视频整读入内存。
     */
    public static function localAbsolutePath(string $key): ?string
    {
        return self::resolveLocalPath(ltrim($key, '/'));
    }

    /**
     * 计算补全相对路径用的绝对地址前缀（不带末尾斜杠）。
     *
     * 优先读 config('app.url')（即 APP_URL）。未配置或仍是 Laravel 默认 http://localhost 时，
     * 降级用当前请求 Host —— 独立部署客户常忘改 APP_URL，导致图标等绝对 URL 指向
     * localhost/官方域名而外部（GitHub Actions runner）不可达，打包时报「无法读取图标」。
     * uploadAbsolute 总在「管理员通过自己的域名上传」的 HTTP 请求里被调用，
     * 故此时的请求 Host 正是客户真实可访问的域名。
     * 与 PaymentController::buildNotifyUrl 思路一致；但图标不强制改写 https
     * （客户站点可能只有 http），保留原 scheme。
     */
    private static function absoluteBase(): string
    {
        $base = (string) config('app.url', '');
        $host = strtolower((string) (parse_url($base, PHP_URL_HOST) ?: ''));
        // APP_URL 未配置、指向本机，或仍是已停用的旧站域名时，降级用当前请求 Host。
        if ($base === '' || $host === 'localhost' || $host === '127.0.0.1' || \App\Support\RetiredPublicHosts::contains($base)) {
            try {
                $req = request();
                $reqHost = $req ? $req->getSchemeAndHttpHost() : '';
                if ($reqHost !== '') {
                    $base = $reqHost;
                }
            } catch (\Throwable $e) {
                // 无请求上下文（队列 / 命令行）时保持 config 值
            }
        }
        return rtrim($base, '/');
    }

    /**
     * 把字节流当作文件落到当前存储后端，与 upload() 同语义但不依赖 UploadedFile。
     *
     * 用于「已经在内存里拿到字节流」的场景：远程图镜像、base64 解码、跨域代理等。
     * 走与 upload() 相同的 storage_type 分流（local / cos），返回值同样可直接写入
     * cover_image / icon_url 之类字段，下游和 upload() 完全一致。
     *
     * @param string $bytes        文件字节流
     * @param string $contentType  MIME 类型（如 image/png），影响 COS PUT 时的 Content-Type 头
     * @param string $subdir       子目录（与 upload() 一致）
     * @param string $filename     保存文件名（含扩展名）
     * @return string|null         成功返回 URL（local 相对路径 / cos 完整 URL）；失败返回 null
     */
    public static function putBytes(string $bytes, string $contentType, string $subdir, string $filename): ?string
    {
        $type = self::effectiveStorageType();
        if ($type === 'cos') {
            return self::putBytesToCos($bytes, $contentType, $subdir, $filename);
        }
        if ($type === 'oss') {
            return self::putBytesToOss($bytes, $contentType, $subdir, $filename);
        }
        return self::putBytesToLocal($bytes, $subdir, $filename);
    }

    /**
     * Private App v1 asset write. Unlike putBytes(), local assets never touch public_path;
     * object keys are generated by the caller and the returned URL is only an internal key.
     */
    public static function putPrivateBytes(string $bytes, string $contentType, string $subdir, string $filename): ?array
    {
        $configured = self::getStorageType();
        $driver = self::effectiveDriver($configured);
        if (in_array($configured, ['cos', 'oss'], true) && $driver !== $configured) {
            return null;
        }
        if ($driver === 'local') {
            $dir = storage_path('app/private-assets/' . trim($subdir, '/'));
            if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) return null;
            $path = rtrim($dir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $filename;
            $tmp = $path . '.part-' . bin2hex(random_bytes(6));
            if (@file_put_contents($tmp, $bytes, LOCK_EX) === false) return null;
            @chmod($tmp, 0600);
            if (!@rename($tmp, $path)) { @unlink($tmp); return null; }
            return ['driver' => 'local', 'key' => trim($subdir, '/') . '/' . $filename, 'url' => '/' . trim($subdir, '/') . '/' . $filename];
        }
        $url = $driver === 'cos'
            ? self::putPrivateBytesToCos($bytes, $contentType, $subdir, $filename)
            : self::putPrivateBytesToOss($bytes, $contentType, $subdir, $filename);
        if ($url === null) return null;
        // Keep only the opaque object key in AppAsset. The API creates short-lived
        // signed display URLs and never returns a raw provider URL.
        $key = trim($subdir, '/') . '/' . $filename;
        return ['driver' => $driver, 'key' => $key, 'url' => $key];
    }

    public static function getStorageType(): string
    {
        return (string) SystemSetting::getValue('storage_type', 'local');
    }

    /**
     * 实际生效的存储类型：storage_type 选了 cos/oss，但对象存储配置不完整（独立部署常见的
     * 「半配置」——只填了部分字段、或从没填过）时，自动降级为 local，避免整条上传因
     * loadCosConfig/loadOssConfig 返回 null 而硬失败（表现为参考图上传 reference_storage_error）。
     *
     * 只对「配置不完整」降级；凭据齐全但错误（如 PUT 403 签名不对）不在此列，仍由各 upload
     * 方法照常返回 null，以免静默掩盖真实的对象存储配错。
     */
    public static function effectiveStorageType(): string
    {
        return self::effectiveDriver(null);
    }

    /**
     * 解析某个存储 driver 的实际生效值：cos/oss 配置不完整时归为 local，保证「写到哪、
     * 读/删也去哪」一致（配合 uploadToLocal 的 storage 兜底目录）。external / local 原样返回。
     */
    private static function effectiveDriver(?string $driver): string
    {
        $type = ($driver !== null && $driver !== '') ? $driver : self::getStorageType();
        if ($type === 'cos' && self::loadCosConfig() === null) {
            Log::warning('[Storage] storage_type=cos 但 COS 配置不完整，本次操作降级为 local');
            return 'local';
        }
        if ($type === 'oss' && self::loadOssConfig() === null) {
            Log::warning('[Storage] storage_type=oss 但 OSS 配置不完整，本次操作降级为 local');
            return 'local';
        }
        return $type;
    }

    /**
     * 解析 local 模式实际可写的目录，返回绝对路径；都不可写返回 null。
     *
     * 优先 public_path($subdir)（可对外直链，与历史行为一致）；若 public 因权限
     * （宝塔/nginx 常见站点 root 属主、PHP-FPM 以 www 运行）建不出/不可写，则回退到
     * storage_path('app/local-assets/...')。应用只要能正常运行，storage 目录必定可写
     * （否则 session/cache/日志/编译视图早已全线 500），所以回退目录是可靠兜底。
     *
     * 回退目录下的文件不走 doc-root 直链，但参考图链路由后端 readBytes 自读回传
     * （ProcessImageTaskJob::materializeReferenceUrls），只要「写得进 + readBytes 读得回」
     * 即成立，不依赖 doc-root 可写或对象存储公共读。resolveLocalPath 读/删时同样兼容两处。
     */
    private static function writableLocalDir(string $subdir): ?string
    {
        $candidates = [
            public_path($subdir),
            storage_path('app/local-assets/' . trim($subdir, '/')),
        ];
        foreach ($candidates as $dir) {
            if (is_dir($dir)) {
                if (is_writable($dir)) return $dir;
                continue;
            }
            // mkdir 递归创建；并发下可能返回 false 但目录已存在，再判一次
            if (@mkdir($dir, 0755, true) || is_dir($dir)) {
                if (is_writable($dir)) return $dir;
            }
        }
        return null;
    }

    /**
     * 解析 local key 的物理路径：先看 public_path，再看 storage 兜底目录。都没有返回 null。
     * 与 writableLocalDir 的两处落点严格对应，保证 readBytes / delete 能找回 uploadToLocal 落的文件。
     */
    private static function resolveLocalPath(string $key): ?string
    {
        $key = ltrim($key, '/');
        $pub = public_path($key);
        if (is_file($pub)) return $pub;
        $sto = storage_path('app/local-assets/' . $key);
        if (is_file($sto)) return $sto;
        $private = storage_path('app/private-assets/' . $key);
        if (is_file($private)) return $private;
        return null;
    }

    // ============== Local ==============

    private static function uploadToLocal(UploadedFile $file, string $subdir, string $filename): ?string
    {
        $absoluteDir = self::writableLocalDir($subdir);
        if ($absoluteDir === null) {
            return null;
        }
        try {
            $file->move($absoluteDir, $filename);
        } catch (\Throwable $e) {
            // move 失败（权限/磁盘）统一归为 null，交由上层按「存储写入失败」处理，
            // 避免 FileException 以未捕获异常形态冒泡到未加 try/catch 的其它上传调用方。
            Log::warning('[Storage] local move failed', ['dir' => $absoluteDir, 'err' => $e->getMessage()]);
            return null;
        }
        return '/' . trim($subdir, '/') . '/' . $filename;
    }

    private static function putBytesToLocal(string $bytes, string $subdir, string $filename): ?string
    {
        $absoluteDir = self::writableLocalDir($subdir);
        if ($absoluteDir === null) {
            return null;
        }
        $absolutePath = rtrim($absoluteDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $filename;
        if (@file_put_contents($absolutePath, $bytes) === false) {
            return null;
        }
        return '/' . trim($subdir, '/') . '/' . $filename;
    }

    // ============== Tencent COS ==============

    private static function uploadToCos(UploadedFile $file, string $subdir, string $filename): ?string
    {
        $body = file_get_contents($file->getRealPath());
        if ($body === false) return null;
        $contentType = $file->getMimeType() ?: 'application/octet-stream';
        return self::putBytesToCos($body, $contentType, $subdir, $filename);
    }

    private static function putBytesToCos(string $bytes, string $contentType, string $subdir, string $filename, bool $private = false): ?string
    {
        $cfg = self::loadCosConfig();
        if ($cfg === null) return null;

        $bucketFqn = self::resolveCosBucketFqn($cfg);
        if ($bucketFqn === null) return null;

        $key = trim($subdir, '/') . '/' . $filename;  // COS object key
        $contentType = $contentType !== '' ? $contentType : 'application/octet-stream';
        $host = $bucketFqn . '.cos.' . $cfg['region'] . '.myqcloud.com';
        $endpoint = 'https://' . $host . '/' . self::encodeKey($key);

        $headers = [
            'Host' => $host,
            'Content-Type' => $contentType,
            'Content-Length' => (string) strlen($bytes),
        ];
        if ($private) $headers['x-cos-acl'] = 'private';
        $auth = self::buildCosAuthorization('put', '/' . self::encodeKey($key), [], $headers, $cfg);
        $headers['Authorization'] = $auth;

        try {
            // 较大参考图（桌面端已压缩，此处兜底）转存 COS 可能 >30s，调高到 120s 避免被中断成失败
            $client = new Client(['timeout' => 120]);
            $resp = $client->put($endpoint, [
                'headers' => $headers,
                'body' => $bytes,
                'http_errors' => false,
            ]);
        } catch (GuzzleException $e) {
            return null;
        }

        if ($resp->getStatusCode() < 200 || $resp->getStatusCode() >= 300) {
            return null;
        }

        // 优先用自定义域名（CDN），否则走 cos 默认域名
        if (!empty($cfg['domain'])) {
            return rtrim($cfg['domain'], '/') . '/' . self::encodeKey($key);
        }
        return 'https://' . $host . '/' . self::encodeKey($key);
    }

    /** Dedicated private AppAsset COS boundary (kept separate from public uploads). */
    private static function putPrivateBytesToCos(string $bytes, string $contentType, string $subdir, string $filename): ?string
    {
        return self::putBytesToCos($bytes, $contentType, $subdir, $filename, true);
    }

    /**
     * 从存储后端删除文件（best-effort，幂等）
     *
     * 接受 cover_image / icon_url 等字段保存的 URL：
     *   - local：相对路径如 "/inspirations/abc.png"
     *   - cos：完整 URL 如 "https://bucket-12345.cos.ap-shanghai.myqcloud.com/inspirations/abc.png"
     *          或 CDN 自定义域名 "https://cdn.example.com/inspirations/abc.png"
     *
     * 删除策略：按当前 storage_type 的后端尝试删除（**不**根据 URL host 反推存储类型，
     * 因为切换存储后历史 URL 仍然可访问，但删除时只能针对当前后端的实际文件）。
     *
     * 失败时仅记 warning 不抛异常 —— 业务上「数据库记录已删但文件未清掉」比「文件已没了
     * 但记录还在」要更可恢复（运维可以手动清孤儿文件）。
     *
     * @param string $url cover_image 字段值，空字符串视为成功（无文件）
     * @return bool 删除成功 / 文件本不存在 -> true；删除失败 -> false
     */
    public static function delete(string $url): bool
    {
        return self::deleteWithDriver($url, null);
    }

    /**
     * 按指定存储后端删除文件（best-effort，幂等）。
     *
     * 与 delete() 的区别：可显式指定 $driver（local/cos/oss/external），用于「切换存储类型后仍要
     * 清理历史文件」的场景 —— 历史记录里存了它当初落在哪个后端，照此删除才删得掉（delete() 只按
     * 当前全局 storage_type，切换后会删错后端）。$driver 为空时回退当前全局 storage_type。
     * external 表示外链（非本站存储），不删除任何文件。
     */
    public static function deleteWithDriver(string $url, ?string $driver): bool
    {
        if ($url === '') return true;
        if ($driver === 'external') return true;

        $key = self::extractObjectKey($url);
        if ($key === null || $key === '') {
            Log::warning('[Storage] delete: cannot extract key', ['url' => $url]);
            return false;
        }

        $type = self::effectiveDriver($driver);
        if ($type === 'cos') {
            return self::deleteFromCos($key);
        }
        if ($type === 'oss') {
            return self::deleteFromOss($key);
        }
        return self::deleteFromLocal($key);
    }

    /**
     * 生成对象存储的预签名 GET URL（用于私有 blob 直连下载，零服务器中转、流式）。
     * local 返回 null（本地存储走鉴权代理流式）。COS 把签名放 query；OSS 用 SDK signUrl。
     */
    public static function signedUrl(string $url, ?string $driver = null, int $expireSeconds = 1800): ?string
    {
        if ($url === '') return null;
        $type = ($driver !== null && $driver !== '') ? $driver : self::getStorageType();

        if ($type === 'cos') {
            $cfg = self::loadCosConfig();
            if ($cfg === null) return null;
            $bucketFqn = self::resolveCosBucketFqn($cfg);
            if ($bucketFqn === null) return null;
            $key = self::extractObjectKey($url);
            if (!$key) return null;
            $host = $bucketFqn . '.cos.' . $cfg['region'] . '.myqcloud.com';
            // 预签名：空 header-list（客户端直连仅带默认头），签名作为 query 串
            $auth = self::buildCosAuthorization('get', '/' . self::encodeKey($key), [], [], $cfg, $expireSeconds);
            return 'https://' . $host . '/' . self::encodeKey($key) . '?' . $auth;
        }

        if ($type === 'oss') {
            $cfg = self::loadOssConfig();
            if ($cfg === null) return null;
            $key = self::extractObjectKey($url);
            if (!$key) return null;
            try {
                $client = self::makeOssClient($cfg);
                return $client->signUrl($cfg['bucket'], $key, max(60, $expireSeconds), 'GET');
            } catch (\Throwable $e) {
                Log::warning('[Storage] sign oss url failed', ['key' => $key, 'err' => $e->getMessage()]);
                return null;
            }
        }

        return null;
    }

    /**
     * 把本站参考素材 URL 换成「上游 / 第三方可直接 HTTP 拉取」的 URL。
     *
     * 适用于「URL 原样交上游、由上游主动回拉」的链路：视频提交（providers）、云端视觉转发
     * （chat messages 的 image_url）等。这些链路无 materialize，私有 cos/oss 桶下未签名直链
     * 会被上游 GET 到 403 → 参考图静默失效。这里对本站 **cos/oss 默认域名**对象换成预签名
     * GET URL（私有桶也能拉），消除对「桶必须公共读」的隐式部署依赖。
     *
     * 其余一律原样返回：非 http(s)（相对路径 / dataURI）、local 绝对 URL、外链、自定义 CDN
     * 域名（detectDriverFromUrl 归 local，CDN 本就公开）。签名失败回退原 URL，绝不比现状更差。
     */
    public static function upstreamFetchableUrl(string $url, int $expireSeconds = 21600): string
    {
        if ($url === '' || !preg_match('#^https?://#i', $url)) {
            return $url;
        }
        $driver = self::detectDriverFromUrl($url);
        // 自定义 CDN 域名（cos_domain/oss_domain）下 detectDriverFromUrl 只能按 host 判定、会把本站
        // cos/oss 对象误归 local → 不预签名原样交上游 → 私有桶被上游回拉时 403。这里按已配置的自定义
        // 域名把它识别回 cos/oss 再预签名（预签名指向 cos/oss 原生端点，公有/私有桶均可拉，不依赖桶 ACL）。
        if ($driver !== 'cos' && $driver !== 'oss') {
            $driver = self::driverForConfiguredDomain($url) ?? $driver;
        }
        if ($driver !== 'cos' && $driver !== 'oss') {
            return $url;
        }
        $signed = self::signedUrl($url, $driver, $expireSeconds);
        return $signed ?: $url;
    }

    /**
     * URL 命中已配置的自定义存储访问域名时返回其对应存储后端（cos/oss），否则 null。
     * 自定义 CDN 域名下无法从 host 区分 cos/oss（detectDriverFromUrl 归 local），靠配置反查补齐。
     */
    private static function driverForConfiguredDomain(string $url): ?string
    {
        $cosDomain = self::normalizeStorageDomain((string) SystemSetting::getRawValue('cos_domain', ''));
        if ($cosDomain !== '' && str_starts_with($url, $cosDomain . '/')) {
            return 'cos';
        }
        $ossDomain = self::normalizeStorageDomain((string) SystemSetting::getRawValue('oss_domain', ''));
        if ($ossDomain !== '' && str_starts_with($url, $ossDomain . '/')) {
            return 'oss';
        }
        return null;
    }

    /**
     * 流式上传本地文件到当前存储后端（不整体读入内存，适合大视频）。
     * @return string|null 成功返回可访问 URL（local 相对路径 / cos-oss 完整 URL），失败 null
     */
    public static function putFile(string $localPath, string $contentType, string $subdir, string $filename): ?string
    {
        $type = self::effectiveStorageType();
        if ($type === 'cos') return self::putFileToCos($localPath, $contentType, $subdir, $filename);
        if ($type === 'oss') return self::putFileToOss($localPath, $contentType, $subdir, $filename);
        return self::putFileToLocal($localPath, $subdir, $filename);
    }

    private static function putFileToLocal(string $localPath, string $subdir, string $filename): ?string
    {
        $absoluteDir = self::writableLocalDir($subdir);
        if ($absoluteDir === null) {
            return null;
        }
        $absolutePath = rtrim($absoluteDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $filename;
        if (!@copy($localPath, $absolutePath)) {
            return null;
        }
        return '/' . trim($subdir, '/') . '/' . $filename;
    }

    private static function putFileToCos(string $localPath, string $contentType, string $subdir, string $filename): ?string
    {
        $cfg = self::loadCosConfig();
        if ($cfg === null) return null;
        $bucketFqn = self::resolveCosBucketFqn($cfg);
        if ($bucketFqn === null) return null;

        $key = trim($subdir, '/') . '/' . $filename;
        $contentType = $contentType !== '' ? $contentType : 'application/octet-stream';
        $size = @filesize($localPath);
        if ($size === false) return null;
        $host = $bucketFqn . '.cos.' . $cfg['region'] . '.myqcloud.com';
        $endpoint = 'https://' . $host . '/' . self::encodeKey($key);
        $headers = [
            'Host' => $host,
            'Content-Type' => $contentType,
            'Content-Length' => (string) $size,
        ];
        $headers['Authorization'] = self::buildCosAuthorization('put', '/' . self::encodeKey($key), [], $headers, $cfg);

        $stream = @fopen($localPath, 'rb');
        if ($stream === false) return null;
        try {
            $client = new Client(['timeout' => 600]);
            $resp = $client->put($endpoint, ['headers' => $headers, 'body' => $stream, 'http_errors' => false]);
        } catch (GuzzleException $e) {
            if (is_resource($stream)) fclose($stream);
            Log::warning('[Storage] put file cos failed', ['key' => $key, 'err' => $e->getMessage()]);
            return null;
        }
        if (is_resource($stream)) fclose($stream);
        if ($resp->getStatusCode() < 200 || $resp->getStatusCode() >= 300) {
            return null;
        }
        if (!empty($cfg['domain'])) {
            return rtrim($cfg['domain'], '/') . '/' . self::encodeKey($key);
        }
        return 'https://' . $host . '/' . self::encodeKey($key);
    }

    private static function putFileToOss(string $localPath, string $contentType, string $subdir, string $filename): ?string
    {
        $cfg = self::loadOssConfig();
        if ($cfg === null) return null;
        $key = trim($subdir, '/') . '/' . $filename;
        $contentType = $contentType !== '' ? $contentType : 'application/octet-stream';
        try {
            $client = self::makeOssClient($cfg);
            // SDK uploadFile 内部按需 multipart 流式上传，不整体入内存
            $client->uploadFile($cfg['bucket'], $key, $localPath, [OssClient::OSS_CONTENT_TYPE => $contentType]);
        } catch (\Throwable $e) {
            Log::warning('[Storage] put file oss failed', ['key' => $key, 'err' => $e->getMessage()]);
            return null;
        }
        if (!empty($cfg['domain'])) {
            return rtrim($cfg['domain'], '/') . '/' . self::encodeKey($key);
        }
        return 'https://' . $cfg['bucket'] . '.' . $cfg['endpoint'] . '/' . self::encodeKey($key);
    }

    /**
     * 服务端读取对象字节（用于私有 blob 鉴权代理下载，不暴露公网直链）。
     * 支持 local（public 路径）/ cos（V5 签名 GET）/ oss（SDK getObject）。
     * @return string|null 成功返回字节，失败返回 null
     */
    public static function readBytes(string $url, ?string $driver = null): ?string
    {
        if ($url === '') return null;
        $type = self::effectiveDriver($driver);

        if ($type === 'cos') {
            $cfg = self::loadCosConfig();
            if ($cfg === null) return null;
            $bucketFqn = self::resolveCosBucketFqn($cfg);
            if ($bucketFqn === null) return null;
            $key = self::extractObjectKey($url);
            if (!$key) return null;
            $host = $bucketFqn . '.cos.' . $cfg['region'] . '.myqcloud.com';
            $endpoint = 'https://' . $host . '/' . self::encodeKey($key);
            $headers = ['Host' => $host];
            $headers['Authorization'] = self::buildCosAuthorization('get', '/' . self::encodeKey($key), [], $headers, $cfg);
            try {
                $client = new Client(['timeout' => 120]);
                $resp = $client->get($endpoint, ['headers' => $headers, 'http_errors' => false]);
            } catch (GuzzleException $e) {
                Log::warning('[Storage] read cos failed', ['key' => $key, 'err' => $e->getMessage()]);
                return null;
            }
            if ($resp->getStatusCode() < 200 || $resp->getStatusCode() >= 300) return null;
            return (string) $resp->getBody();
        }

        if ($type === 'oss') {
            $cfg = self::loadOssConfig();
            if ($cfg === null) return null;
            $key = self::extractObjectKey($url);
            if (!$key) return null;
            try {
                $client = self::makeOssClient($cfg);
                return (string) $client->getObject($cfg['bucket'], $key);
            } catch (\Throwable $e) {
                Log::warning('[Storage] read oss failed', ['key' => $key, 'err' => $e->getMessage()]);
                return null;
            }
        }

        // local：从 public 路径读取（含 storage 兜底目录）
        $key = self::extractObjectKey($url);
        if (!$key) return null;
        $abs = self::resolveLocalPath($key);
        if ($abs === null) return null;
        $bytes = @file_get_contents($abs);
        return $bytes === false ? null : $bytes;
    }

    /**
     * 从 storage_url 反推存储后端（仅用于历史数据 storage_driver 为空时的兜底显示）。
     * 按 host 特征猜测：*.myqcloud.com → cos，*.aliyuncs.com → oss，其余（相对路径 / app.url /
     * 自定义 CDN 域名）→ local。注意：自定义域名下 cos/oss 无法区分，会落到 local。
     */
    public static function detectDriverFromUrl(string $url): string
    {
        if ($url === '') return 'local';
        if (!str_starts_with($url, 'http://') && !str_starts_with($url, 'https://')) {
            return 'local';
        }
        $host = strtolower((string) (parse_url($url, PHP_URL_HOST) ?: ''));
        if ($host === '') return 'local';
        if (str_contains($host, 'myqcloud.com')) return 'cos';
        if (str_contains($host, 'aliyuncs.com')) return 'oss';
        return 'local';
    }

    /**
     * 从 URL / 相对路径里提取存储 key（去掉 scheme/host/前导斜杠）
     */
    private static function extractObjectKey(string $url): ?string
    {
        if ($url === '') return null;

        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            // 参考素材服务路由 URL（/public/videos/reference-blob/{key}，见 referenceBlobUrl）→
            // 剥掉路由前缀取回真实存储 key，保证 readBytes / delete / signedUrl 仍按真实 key 定位文件。
            $marker = '/public/videos/reference-blob/';
            $pos = strpos($url, $marker);
            if ($pos !== false) {
                return ltrim(rawurldecode(substr($url, $pos + strlen($marker))), '/');
            }
            // 自定义 CDN 域名可能带 path 前缀（如 https://cdn.x.com/assets）；上传 URL 由
            // 「domain + '/' + encodeKey(key)」拼成，若只按裸 host 截 path 会把 domain 的 path
            // 前缀错当成 key 的一部分（→ blob 读 / 删 / 签名 / 生图 materialize 取错 key 拿不到字节）。
            // 故优先用已配置的自定义域名（含其 path 前缀）整体剥离，剥后剩余才是真实 object key。
            foreach (self::configuredDomainPrefixes() as $prefix) {
                if (str_starts_with($url, $prefix . '/')) {
                    return ltrim(rawurldecode(substr($url, strlen($prefix))), '/');
                }
            }
            $parsed = parse_url($url);
            if ($parsed === false || empty($parsed['path'])) return null;
            return ltrim(rawurldecode($parsed['path']), '/');
        }
        return ltrim($url, '/');
    }

    private static function deleteFromLocal(string $key): bool
    {
        $abs = self::resolveLocalPath($key);
        if ($abs === null) {
            // 文件本不存在视为成功（幂等）
            return true;
        }
        if (@unlink($abs)) {
            return true;
        }
        Log::warning('[Storage] delete local unlink failed', ['key' => $key]);
        return false;
    }

    private static function deleteFromCos(string $key): bool
    {
        $cfg = self::loadCosConfig();
        if ($cfg === null) {
            Log::warning('[Storage] delete cos: config incomplete', ['key' => $key]);
            return false;
        }

        $bucketFqn = self::resolveCosBucketFqn($cfg);
        if ($bucketFqn === null) {
            Log::warning('[Storage] delete cos: bucket fqn unresolved', ['key' => $key]);
            return false;
        }

        $host = $bucketFqn . '.cos.' . $cfg['region'] . '.myqcloud.com';
        $endpoint = 'https://' . $host . '/' . self::encodeKey($key);

        $headers = ['Host' => $host];
        $auth = self::buildCosAuthorization('delete', '/' . self::encodeKey($key), [], $headers, $cfg);
        $headers['Authorization'] = $auth;

        try {
            $client = new Client(['timeout' => 15]);
            $resp = $client->delete($endpoint, [
                'headers' => $headers,
                'http_errors' => false,
            ]);
        } catch (GuzzleException $e) {
            Log::warning('[Storage] delete cos network error', ['key' => $key, 'err' => $e->getMessage()]);
            return false;
        }

        $code = $resp->getStatusCode();
        // 204 = 删除成功；200 = 删除成功（不规范但部分代理会用）；404 = 文件不存在（视为成功，幂等）
        if ($code === 204 || $code === 200 || $code === 404) {
            return true;
        }
        Log::warning('[Storage] delete cos failed', ['key' => $key, 'status' => $code]);
        return false;
    }

    /**
     * 测试 COS 连接（HEAD bucket）
     * @return array{ok: bool, error?: string}
     */
    public static function testCos(): array
    {
        $cfg = self::loadCosConfig();
        if ($cfg === null) {
            return ['ok' => false, 'error' => 'COS 配置不完整，请检查 SecretId / SecretKey / Region / Bucket'];
        }

        $bucketFqn = self::resolveCosBucketFqn($cfg);
        if ($bucketFqn === null) {
            return ['ok' => false, 'error' => 'Bucket 名格式不合法：需填写「桶名」+「APPID」两个字段，或在 Bucket 字段中直接填入完整的「bucket-APPID」格式'];
        }

        $host = $bucketFqn . '.cos.' . $cfg['region'] . '.myqcloud.com';
        $endpoint = 'https://' . $host . '/';

        $headers = [
            'Host' => $host,
        ];
        $auth = self::buildCosAuthorization('head', '/', [], $headers, $cfg);
        $headers['Authorization'] = $auth;

        try {
            $client = new Client(['timeout' => 10]);
            $resp = $client->head($endpoint, [
                'headers' => $headers,
                'http_errors' => false,
            ]);
        } catch (GuzzleException $e) {
            return ['ok' => false, 'error' => '网络错误：' . $e->getMessage()];
        }

        $code = $resp->getStatusCode();
        if ($code === 200) {
            return ['ok' => true];
        }
        if ($code === 403) {
            return ['ok' => false, 'error' => '签名错误或权限不足，请检查 SecretId / SecretKey 是否正确'];
        }
        if ($code === 404) {
            return ['ok' => false, 'error' => 'Bucket 不存在或 Region 错误，请检查 Bucket / Region 配置'];
        }
        return ['ok' => false, 'error' => "HEAD bucket 失败，HTTP {$code}"];
    }

    /**
     * 加载并校验 COS 配置；返回 null 表示配置不完整
     * @return array{secret_id:string, secret_key:string, region:string, bucket:string, app_id:string, domain:string}|null
     */
    private static function loadCosConfig(): ?array
    {
        $secretId  = (string) SystemSetting::getRawValue('cos_secret_id', '');
        $secretKey = (string) SystemSetting::getRawValue('cos_secret_key', '');
        $region    = (string) SystemSetting::getRawValue('cos_region', '');
        $bucket    = (string) SystemSetting::getRawValue('cos_bucket', '');
        $appId     = (string) SystemSetting::getRawValue('cos_app_id', '');
        $domain    = (string) SystemSetting::getRawValue('cos_domain', '');

        if ($secretId === '' || $secretKey === '' || $region === '' || $bucket === '') {
            return null;
        }
        return [
            'secretId'   => $secretId,
            'secretKey'  => $secretKey,
            'secret_id'  => $secretId,
            'secret_key' => $secretKey,
            'region'     => $region,
            'bucket'     => $bucket,
            'app_id'     => $appId,
            'domain'     => self::normalizeStorageDomain($domain),
        ];
    }

    /**
     * 计算 COS host 前缀（bucket-APPID）。
     * 兼容两种填法：
     *   1. 新（推荐）：bucket = 桶名前缀，cos_app_id = APPID，运行时拼接
     *   2. 旧：bucket 字段直接填整段「name-1234567890」（已含 APPID 后缀）
     * 返回 null 表示无法构造合法 host（既没独立 APPID 也不是合并格式）
     */
    private static function resolveCosBucketFqn(array $cfg): ?string
    {
        $bucket = trim((string) ($cfg['bucket'] ?? ''));
        $appId  = trim((string) ($cfg['app_id'] ?? ''));
        if ($bucket === '') return null;
        // 已是 name-appid 格式（向后兼容旧配置）：直接使用
        if (preg_match('/-\d+$/', $bucket)) {
            return $bucket;
        }
        if ($appId !== '') {
            return $bucket . '-' . $appId;
        }
        return null;
    }

    /**
     * 生成腾讯云 COS V5 签名 Authorization 头
     *
     * 算法参考：https://cloud.tencent.com/document/product/436/7778
     *
     * @param string $method      HTTP 方法（小写）
     * @param string $uriPath     URI 路径（以 / 开头，已 URL 编码）
     * @param array  $params      URL 查询参数（key => value）
     * @param array  $headers     HTTP 头部（key => value，至少包含 Host）
     * @param array  $cfg         COS 配置
     */
    private static function buildCosAuthorization(string $method, string $uriPath, array $params, array $headers, array $cfg, int $expireSeconds = 1800): string
    {
        $now = time();
        $expire = $now + max(60, $expireSeconds);
        $keyTime = $now . ';' . $expire;

        // SignKey
        $signKey = hash_hmac('sha1', $keyTime, $cfg['secret_key']);

        // 整理参数：lowercase key + url encode value，按 key 排序
        $paramPairs = [];
        $paramKeys = [];
        if (!empty($params)) {
            $lower = [];
            foreach ($params as $k => $v) {
                $lk = strtolower(rawurlencode((string) $k));
                $lower[$lk] = rawurlencode((string) $v);
            }
            ksort($lower);
            foreach ($lower as $k => $v) {
                $paramPairs[] = $k . '=' . $v;
                $paramKeys[] = $k;
            }
        }
        $httpParameters = implode('&', $paramPairs);
        $urlParamList = implode(';', $paramKeys);

        // 整理头部：lowercase key + url encode value，按 key 排序
        $headerLower = [];
        foreach ($headers as $k => $v) {
            $lk = strtolower(rawurlencode((string) $k));
            $headerLower[$lk] = rawurlencode((string) $v);
        }
        ksort($headerLower);
        $headerPairs = [];
        $headerKeys = [];
        foreach ($headerLower as $k => $v) {
            $headerPairs[] = $k . '=' . $v;
            $headerKeys[] = $k;
        }
        $httpHeaders = implode('&', $headerPairs);
        $headerList = implode(';', $headerKeys);

        // HttpString
        $httpString = strtolower($method) . "\n" . $uriPath . "\n" . $httpParameters . "\n" . $httpHeaders . "\n";

        // StringToSign
        $stringToSign = "sha1\n" . $keyTime . "\n" . sha1($httpString) . "\n";

        // Signature
        $signature = hash_hmac('sha1', $stringToSign, $signKey);

        return 'q-sign-algorithm=sha1'
            . '&q-ak=' . $cfg['secret_id']
            . '&q-sign-time=' . $keyTime
            . '&q-key-time=' . $keyTime
            . '&q-header-list=' . $headerList
            . '&q-url-param-list=' . $urlParamList
            . '&q-signature=' . $signature;
    }

    /**
     * URL 编码 object key，保留 / 分隔符（COS 要求路径分隔符 / 不被编码）
     */
    private static function encodeKey(string $key): string
    {
        $parts = explode('/', $key);
        $encoded = array_map('rawurlencode', $parts);
        return implode('/', $encoded);
    }

    // ============== Aliyun OSS ==============

    private static function uploadToOss(UploadedFile $file, string $subdir, string $filename): ?string
    {
        $body = file_get_contents($file->getRealPath());
        if ($body === false) return null;
        $contentType = $file->getMimeType() ?: 'application/octet-stream';
        return self::putBytesToOss($body, $contentType, $subdir, $filename);
    }

    private static function putBytesToOss(string $bytes, string $contentType, string $subdir, string $filename, bool $private = false): ?string
    {
        $cfg = self::loadOssConfig();
        if ($cfg === null) return null;

        $key = trim($subdir, '/') . '/' . $filename;  // OSS object key
        $contentType = $contentType !== '' ? $contentType : 'application/octet-stream';

        try {
            $client = self::makeOssClient($cfg);
            $options = [OssClient::OSS_CONTENT_TYPE => $contentType];
            if ($private) $options[OssClient::OSS_HEADERS] = [OssClient::OSS_OBJECT_ACL => OssClient::OSS_ACL_TYPE_PRIVATE];
            $client->putObject($cfg['bucket'], $key, $bytes, $options);
        } catch (\Throwable $e) {
            Log::warning('[Storage] oss put failed', ['key' => $key, 'err' => $e->getMessage()]);
            return null;
        }

        // 优先用自定义域名（CDN），否则走 oss 默认域名 bucket.endpoint
        if (!empty($cfg['domain'])) {
            return rtrim($cfg['domain'], '/') . '/' . self::encodeKey($key);
        }
        return 'https://' . $cfg['bucket'] . '.' . $cfg['endpoint'] . '/' . self::encodeKey($key);
    }

    /** Dedicated private AppAsset OSS boundary (kept separate from public uploads). */
    private static function putPrivateBytesToOss(string $bytes, string $contentType, string $subdir, string $filename): ?string
    {
        return self::putBytesToOss($bytes, $contentType, $subdir, $filename, true);
    }

    private static function deleteFromOss(string $key): bool
    {
        $cfg = self::loadOssConfig();
        if ($cfg === null) {
            Log::warning('[Storage] delete oss: config incomplete', ['key' => $key]);
            return false;
        }

        try {
            $client = self::makeOssClient($cfg);
            // OSS deleteObject 对不存在的 key 也返回成功（幂等）
            $client->deleteObject($cfg['bucket'], $key);
            return true;
        } catch (OssException $e) {
            // NoSuchKey 视为已删除（幂等）
            if ($e->getErrorCode() === 'NoSuchKey') {
                return true;
            }
            Log::warning('[Storage] delete oss failed', ['key' => $key, 'code' => $e->getErrorCode()]);
            return false;
        } catch (\Throwable $e) {
            Log::warning('[Storage] delete oss network error', ['key' => $key, 'err' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * 测试阿里云 OSS 配置：GetBucketInfo 验证 AccessKey / Endpoint / Bucket 是否正确
     * @return array{ok: bool, error?: string}
     */
    public static function testOss(): array
    {
        $cfg = self::loadOssConfig();
        if ($cfg === null) {
            return ['ok' => false, 'error' => 'OSS 配置不完整，请检查 AccessKeyId / AccessKeySecret / Endpoint / Bucket'];
        }

        try {
            $client = self::makeOssClient($cfg);
            $client->getBucketInfo($cfg['bucket']);
            return ['ok' => true];
        } catch (OssException $e) {
            $errCode = $e->getErrorCode();
            if ($errCode === 'InvalidAccessKeyId' || $errCode === 'SignatureDoesNotMatch') {
                return ['ok' => false, 'error' => 'AccessKeyId / AccessKeySecret 不正确（' . $errCode . '）'];
            }
            if ($errCode === 'NoSuchBucket') {
                return ['ok' => false, 'error' => 'Bucket 不存在，或 Endpoint 与 Bucket 所在地域不匹配'];
            }
            if ($errCode === 'AccessDenied') {
                // 凭证有效但缺少 GetBucketInfo 权限，连接本身是通的，视为通过
                return ['ok' => true];
            }
            return ['ok' => false, 'error' => 'OSS 返回错误：' . ($errCode ?: $e->getMessage())];
        } catch (\Throwable $e) {
            return ['ok' => false, 'error' => '网络错误：' . $e->getMessage()];
        }
    }

    /**
     * 加载并校验 OSS 配置；返回 null 表示配置不完整
     * @return array{access_key_id:string, access_key_secret:string, endpoint:string, bucket:string, domain:string}|null
     */
    private static function loadOssConfig(): ?array
    {
        $keyId    = (string) SystemSetting::getRawValue('oss_access_key_id', '');
        $keySec   = (string) SystemSetting::getRawValue('oss_access_key_secret', '');
        $endpoint = self::normalizeOssEndpoint((string) SystemSetting::getRawValue('oss_endpoint', ''));
        $bucket   = trim((string) SystemSetting::getRawValue('oss_bucket', ''));
        $domain   = (string) SystemSetting::getRawValue('oss_domain', '');

        if ($keyId === '' || $keySec === '' || $endpoint === '' || $bucket === '') {
            return null;
        }
        return [
            'access_key_id'     => $keyId,
            'access_key_secret' => $keySec,
            'endpoint'          => $endpoint,
            'bucket'            => $bucket,
            'domain'            => self::normalizeStorageDomain($domain),
        ];
    }

    /**
     * 规整 OSS Endpoint：去掉 scheme 与尾斜杠，统一为 host 形态（如 oss-cn-hangzhou.aliyuncs.com）。
     */
    private static function normalizeOssEndpoint(string $endpoint): string
    {
        $endpoint = trim($endpoint);
        if ($endpoint === '') return '';
        $endpoint = preg_replace('#^https?://#i', '', $endpoint);
        return rtrim((string) $endpoint, '/');
    }

    /**
     * 规整自定义访问域名（cos_domain / oss_domain）：
     *   - 空 → 空
     *   - 缺 scheme → 补 https://（裸 host 如 cdn.x.com 不是合法 URL，直链 / 交上游都不可达）
     *   - 去尾斜杠
     * 保留可能的 path 前缀（部分 CDN 映射到子路径）：不在此处强行去掉，以免破坏「域名映射到
     * 子路径」的合法 CDN 公开直链；该 path 前缀由 extractObjectKey 配套剥离以取回正确 key。
     */
    private static function normalizeStorageDomain(string $domain): string
    {
        $domain = trim($domain);
        if ($domain === '') return '';
        if (!preg_match('#^https?://#i', $domain)) {
            $domain = 'https://' . $domain;
        }
        return rtrim($domain, '/');
    }

    /**
     * 已配置的自定义访问域名前缀列表（含其 path 前缀，已规整带 scheme、去尾斜杠）。
     * 供 extractObjectKey 在「域名带 path 前缀」场景下整体剥离前缀、取回正确 object key。
     */
    private static function configuredDomainPrefixes(): array
    {
        $out = [];
        foreach (['cos_domain', 'oss_domain'] as $k) {
            $d = self::normalizeStorageDomain((string) SystemSetting::getRawValue($k, ''));
            if ($d !== '') {
                $out[] = $d;
            }
        }
        return $out;
    }

    /**
     * 构造阿里云 OSS 官方 SDK 客户端。
     * endpoint 已由 loadOssConfig 规整为 host（无 scheme），这里补 https 传给 SDK；
     * isCName=false：endpoint 为官方地域节点，SDK 自动按 bucket.endpoint 访问。
     * 自定义访问域名（CDN）只用于拼访问 URL，不作为上传 endpoint。
     */
    private static function makeOssClient(array $cfg): OssClient
    {
        return new OssClient(
            $cfg['access_key_id'],
            $cfg['access_key_secret'],
            'https://' . $cfg['endpoint'],
            false
        );
    }
}
