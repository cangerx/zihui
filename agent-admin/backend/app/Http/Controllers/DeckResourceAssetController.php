<?php

namespace App\Http\Controllers;

use App\Models\DeckResourceAsset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;

/**
 * AI Deck 资源资产(ffmpeg / 模板包)管理 + 桌面端下发 manifest。
 * 三层分发: 上游母 CDN 人工上传 → 本控制器「一键拉取」下载+首次自算 SHA256 固化+落 public →
 * 桌面端经 clientManifest 比对 version/sha256 后从【本云控端】拉取。
 */
class DeckResourceAssetController extends Controller
{
    // ---------------- 管理端(admin) ----------------

    public function index(Request $request): JsonResponse
    {
        $query = DeckResourceAsset::query();
        if ($request->filled('kind')) {
            $query->where('kind', $request->kind);
        }
        if ($request->filled('platform')) {
            $query->where('platform', $request->platform);
        }
        if ($request->filled('oem_project_key')) {
            $query->where('oem_project_key', $request->oem_project_key);
        }
        return response()->json($query->orderByDesc('id')->paginate($request->get('per_page', 50)));
    }

    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'kind'            => 'required|in:ffmpeg,template',
            'asset_key'       => 'required|string|max:120',
            'platform'        => 'nullable|string|max:20',
            'version'         => 'nullable|string|max:40',
            'source_url'      => 'required|string|max:1000',
            'oem_project_key' => 'nullable|string|max:80',
            'meta'            => 'nullable|array',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $asset = DeckResourceAsset::create(array_merge($validator->validated(), ['status' => 'pending']));
        return response()->json($asset, 201);
    }

    /**
     * 从打包 manifest 批量导入模板资产: 按 (kind=template, asset_key, oem) updateOrCreate 为 pending。
     * 不在本请求内拉取(217 套同步拉会超时); 拉取由前端循环调 pullPending 分批完成。
     */
    public function bulkImport(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'templates'         => 'required|array|min:1',
            'templates.*.id'    => 'required|string|max:120',
            'templates.*.url'   => 'required|string|max:1000',
            'oem_project_key'   => 'nullable|string|max:80',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $oem = (string) $request->get('oem_project_key', '');
        $created = 0;
        $updated = 0;
        foreach ($request->input('templates') as $t) {
            $asset = DeckResourceAsset::updateOrCreate(
                ['kind' => 'template', 'asset_key' => $t['id'], 'oem_project_key' => $oem],
                [
                    'platform'   => 'any',
                    'version'    => (string) ($t['version'] ?? '1'),
                    'source_url' => $t['url'],
                    'status'     => 'pending',
                    'meta'       => [
                        'name'        => $t['name'] ?? $t['id'],
                        'category'    => $t['category'] ?? '',
                        'description' => $t['description'] ?? '',
                        'schema'      => $t['schema'] ?? new \stdClass(),
                    ],
                ]
            );
            $asset->wasRecentlyCreated ? $created++ : $updated++;
        }
        $pending = DeckResourceAsset::where('status', 'pending')->count();
        return response()->json(compact('created', 'updated') + ['pending' => $pending]);
    }

    /**
     * 分批拉取待处理资产(默认只拉 pending, 单次上限 limit), 供前端循环调用直到 remaining=0。
     * 避免一次请求内同步拉数百个文件导致超时。
     */
    public function pullPending(Request $request): JsonResponse
    {
        $limit = max(1, min((int) $request->get('limit', 15), 50));
        $kind  = (string) $request->get('kind', '');
        $includeFailed = (bool) $request->get('include_failed', false);
        $statuses = $includeFailed ? ['pending', 'failed'] : ['pending'];

        $query = DeckResourceAsset::whereIn('status', $statuses);
        if ($kind !== '') {
            $query->where('kind', $kind);
        }
        $batch = (clone $query)->orderBy('id')->limit($limit)->get();

        $pulled = 0;
        $failed = [];
        foreach ($batch as $asset) {
            $this->pullAsset($asset) ? $pulled++ : ($failed[] = $asset->asset_key);
        }
        $remaining = (clone $query)->count();
        return response()->json(compact('pulled', 'failed', 'remaining'));
    }

    /** 一键拉取单个: 从 source_url 下载 → 首次自算 SHA256 固化 → 落 public/updates/deck → 标 ready。 */
    public function pull(int $id): JsonResponse
    {
        $asset = DeckResourceAsset::find($id);
        if (!$asset) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($this->pullAsset($asset)) {
            return response()->json(['ok' => true, 'asset' => $asset->fresh()]);
        }
        return response()->json(['error' => 'pull_failed', 'message' => $asset->error], 502);
    }

    /** 下载+固化单个资产的核心逻辑; 成功返回 true, 失败标 failed 返回 false。pull/pullPending 共用。 */
    private function pullAsset(DeckResourceAsset $asset): bool
    {
        try {
            $resp = Http::timeout(120)->get($asset->source_url);
            if (!$resp->successful()) {
                throw new \RuntimeException('下载失败 HTTP ' . $resp->status());
            }
            $body = $resp->body();
            $sha  = hash('sha256', $body);

            // 模板包: 从下载的 template.json 自动提取 meta(name/category/description/schema), 免管理员手填。
            if ($asset->kind === 'template') {
                $tpl = json_decode($body, true);
                if (is_array($tpl)) {
                    $asset->meta = [
                        'name'        => $tpl['name'] ?? $asset->asset_key,
                        'category'    => $tpl['category'] ?? '',
                        'description' => $tpl['description'] ?? '',
                        'schema'      => $tpl['schema'] ?? new \stdClass(),
                    ];
                }
            }

            $rel = 'updates/deck/' . $asset->kind . '/' . ($asset->platform ?: 'any');
            $dir = public_path($rel);
            if (!is_dir($dir)) {
                @mkdir($dir, 0755, true);
            }
            $filename = $this->safeFilename($asset);
            file_put_contents($dir . DIRECTORY_SEPARATOR . $filename, $body);

            $asset->update([
                'sha256'     => $sha,
                'size'       => strlen($body),
                'local_path' => $rel . '/' . $filename,
                'status'     => 'ready',
                'error'      => '',
            ]);
            return true;
        } catch (\Throwable $e) {
            $asset->update(['status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 500)]);
            return false;
        }
    }

    public function destroy(int $id): JsonResponse
    {
        $asset = DeckResourceAsset::find($id);
        if (!$asset) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($asset->local_path) {
            @unlink(public_path($asset->local_path));
        }
        $asset->delete();
        return response()->json(['ok' => true]);
    }

    // ---------------- 完备性自检 + 一键拉取（替代手动添加 / 粘贴 manifest） ----------------

    /** ffmpeg 期望清单(固定): 3 平台 × {ffmpeg,ffprobe}, source_url 按母 CDN 约定生成。 */
    private function expectedFfmpeg(): array
    {
        $base = (string) config('deck.mother_cdn');
        $out = [];
        foreach ((array) config('deck.ffmpeg_platforms', []) as $platform) {
            $ext = str_starts_with($platform, 'win') ? '.exe' : '';
            foreach ((array) config('deck.ffmpeg_binaries', []) as $bin) {
                $out[] = [
                    'asset_key'  => $bin,
                    'platform'   => $platform,
                    'source_url' => "{$base}/ffmpeg/{$platform}/{$bin}{$ext}",
                ];
            }
        }
        return $out;
    }

    /** 从母 CDN 固定地址拉模板期望清单(manifest.json); 拿不到(未上传/网络/格式错)返回 null。 */
    private function fetchTemplateManifest(): ?array
    {
        try {
            $resp = Http::timeout(20)->get((string) config('deck.template_manifest_url'));
            if (!$resp->successful()) {
                return null;
            }
            $data = $resp->json();
            if (!is_array($data)) {
                return null;
            }
            if (array_key_exists('templates', $data)) {
                return is_array($data['templates']) ? $data['templates'] : null;
            }
            // 兼容裸数组(列表)形式; 连续整数键判定(PHP 8.0 无 array_is_list)
            return array_keys($data) === array_keys(array_values($data)) ? $data : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /** 完备性自检: 对比期望清单 vs 已 ready 资产, 返回 ffmpeg/template 各自的就绪数与缺口。 */
    public function check(): JsonResponse
    {
        // ffmpeg: 内置 6 项期望
        $ffExpected = $this->expectedFfmpeg();
        $ffReady = DeckResourceAsset::where('kind', 'ffmpeg')->where('status', 'ready')
            ->where('oem_project_key', '')->get()->keyBy(fn ($a) => $a->platform . '/' . $a->asset_key);
        $ffMissing = [];
        foreach ($ffExpected as $e) {
            if (!$ffReady->has($e['platform'] . '/' . $e['asset_key'])) {
                $ffMissing[] = ['platform' => $e['platform'], 'asset_key' => $e['asset_key']];
            }
        }

        // template: 从母 CDN manifest 拉期望
        $manifest = $this->fetchTemplateManifest();
        $tpl = [
            'manifest_ok'  => $manifest !== null,
            'manifest_url' => (string) config('deck.template_manifest_url'),
            'expected'     => 0,
            'ready'        => 0,
            'missing'      => [],
        ];
        if ($manifest !== null) {
            $tplReady = DeckResourceAsset::where('kind', 'template')->where('status', 'ready')
                ->where('oem_project_key', '')->pluck('asset_key')->flip();
            $missing = [];
            foreach ($manifest as $t) {
                $id = (string) ($t['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                if (!$tplReady->has($id)) {
                    $missing[] = ['id' => $id, 'name' => (string) ($t['name'] ?? $id)];
                }
            }
            $tpl['expected'] = count($manifest);
            $tpl['ready']    = count($manifest) - count($missing);
            $tpl['missing']  = $missing;
        }

        return response()->json([
            'ffmpeg' => [
                'expected' => count($ffExpected),
                'ready'    => count($ffExpected) - count($ffMissing),
                'missing'  => $ffMissing,
            ],
            'template' => $tpl,
        ]);
    }

    /**
     * 一键拉取缺失: 按 kind 把期望清单同步入库(缺的 / 版本变化的置 pending), 再拉一批(limit),
     * 返回 remaining 供前端循环调用直到 0。已 ready 且未变化的不重复拉。
     */
    public function sync(Request $request): JsonResponse
    {
        @set_time_limit(300); // ffmpeg 二进制较大, 放宽单请求执行时间

        $kind  = (string) $request->get('kind', '');
        $limit = max(1, min((int) $request->get('limit', 8), 30));
        if (!in_array($kind, ['ffmpeg', 'template'], true)) {
            return response()->json(['error' => 'invalid_kind'], 422);
        }

        if ($kind === 'ffmpeg') {
            foreach ($this->expectedFfmpeg() as $e) {
                $asset = DeckResourceAsset::firstOrNew([
                    'kind' => 'ffmpeg', 'asset_key' => $e['asset_key'],
                    'platform' => $e['platform'], 'version' => '', 'oem_project_key' => '',
                ]);
                $changed = !$asset->exists || $asset->source_url !== $e['source_url'];
                $asset->source_url = $e['source_url'];
                if ($changed || $asset->status === 'failed') {
                    $asset->status = 'pending';
                }
                $asset->save();
            }
        } else {
            $manifest = $this->fetchTemplateManifest();
            if ($manifest === null) {
                return response()->json([
                    'error'        => 'manifest_unreachable',
                    'manifest_url' => (string) config('deck.template_manifest_url'),
                ], 502);
            }
            foreach ($manifest as $t) {
                $id  = (string) ($t['id'] ?? '');
                $url = (string) ($t['url'] ?? '');
                if ($id === '' || $url === '') {
                    continue;
                }
                $ver   = (string) ($t['version'] ?? '1');
                $asset = DeckResourceAsset::firstOrNew([
                    'kind' => 'template', 'asset_key' => $id, 'oem_project_key' => '',
                ]);
                $changed = !$asset->exists || $asset->version !== $ver || $asset->source_url !== $url;
                $asset->platform   = 'any';
                $asset->version    = $ver;
                $asset->source_url = $url;
                $asset->meta       = [
                    'name'        => $t['name'] ?? $id,
                    'category'    => $t['category'] ?? '',
                    'description' => $t['description'] ?? '',
                    'schema'      => $t['schema'] ?? new \stdClass(),
                ];
                if ($changed) {
                    $asset->status = 'pending';
                    $asset->sha256 = '';
                    $asset->size   = 0;
                }
                $asset->save();
            }
        }

        // 拉一批该 kind 的 pending（复用 pullAsset 的下载 + 首次自算 SHA256 固化逻辑）
        $batch = DeckResourceAsset::where('kind', $kind)->where('status', 'pending')
            ->orderBy('id')->limit($limit)->get();
        $pulled = 0;
        $failed = [];
        foreach ($batch as $asset) {
            $this->pullAsset($asset) ? $pulled++ : ($failed[] = $asset->asset_key);
        }
        $remaining = DeckResourceAsset::where('kind', $kind)->where('status', 'pending')->count();

        return response()->json(compact('pulled', 'failed', 'remaining'));
    }

    // ---------------- 客户端(桌面端) ----------------

    /** 桌面端按 kind 拉 manifest(仅 ready, 按 X-OEM-Project-Key 过滤可见集)。 */
    public function clientManifest(Request $request): JsonResponse
    {
        $kind = (string) $request->get('kind', '');
        $oem  = (string) $request->header('X-OEM-Project-Key', '');

        $query = DeckResourceAsset::where('status', 'ready');
        if ($kind !== '') {
            $query->where('kind', $kind);
        }
        // 通用(oem 为空) + 该 OEM 专属
        $query->where(function ($w) use ($oem) {
            $w->where('oem_project_key', '');
            if ($oem !== '') {
                $w->orWhere('oem_project_key', $oem);
            }
        });

        $items = $query->get()->map(function (DeckResourceAsset $a) {
            return [
                'kind'      => $a->kind,
                'asset_key' => $a->asset_key,
                'platform'  => $a->platform,
                'version'   => $a->version,
                'sha256'    => $a->sha256,
                'size'      => $a->size,
                'url'       => $a->local_path ? url($a->local_path) : '',
                'meta'      => $a->meta,
            ];
        });

        return response()->json([
            'schema_version' => 1,
            'kind'           => $kind,
            'items'          => $items,
        ]);
    }

    private function safeFilename(DeckResourceAsset $asset): string
    {
        if ($asset->kind === 'ffmpeg') {
            $ext = str_starts_with($asset->platform, 'win') ? '.exe' : '';
            return preg_replace('/[^a-zA-Z0-9_.-]/', '_', $asset->asset_key) . $ext;
        }
        // template: {asset_key}-{version}.json
        $base = $asset->asset_key . '-' . ($asset->version ?: '1');
        return preg_replace('/[^a-zA-Z0-9_.-]/', '_', $base) . '.json';
    }
}
