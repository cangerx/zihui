<?php

namespace App\Http\Controllers;

use App\Models\CloudModel;
use App\Models\Doc;
use App\Models\DocCategory;
use App\Models\DocChunk;
use App\Models\SystemSetting;
use App\Services\DocExportService;
use App\Services\DocImportService;
use App\Services\DocRagService;
use App\Services\DocVecService;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * 文档管理控制器：admin CRUD + public/client 浏览。
 *
 * 路由分三组：
 *   - /api/admin/docs/*         auth.jwt + admin，全量管理
 *   - /api/public/docs/*        无鉴权，受 docs_enabled + docs_guest_access 门控
 *   - /api/client/docs/*        auth.jwt，已登录用户可访问（不受游客开关限制）
 *
 * 设计取舍：
 *   - 隐藏文档（is_visible=false）对 public/client 绝对不可见、不可搜，由 publicList/publicShow 硬过滤
 *   - content_html 是文档主体（富文本），content_plain 由 HTML 剥标签同步生成，专供 LIKE 模糊搜索
 *   - admin 列表不返回 content_html/content_plain（太大），详情才返回
 *   - 富文本编辑器内嵌图片通过 uploadImage 接口落到 StorageService，替换 HTML 中 <img src>
 *   - 删除文档不清理嵌入图片（可能被多处引用；清理成本 / 正确性不划算，留给定期孤儿清理任务）
 *   - Phase 2 的 RAG 相关接口（chat / retrieve-preview / reindex）单独实现，配置字段已在本 Controller 的 getConfig 中预留
 */
class DocController extends Controller
{
    /** 富文本嵌入图片存储子目录 */
    private const SUBDIR = 'docs/embeds';
    /** 单张嵌入图片上传上限（字节） */
    private const MAX_IMG_BYTES = 5 * 1024 * 1024;

    // =========================================================================
    // Admin: 配置
    // =========================================================================

    /**
     * GET /api/admin/docs/config
     * 返回所有文档相关系统设置 + 当前可用的 chat / embedding 模型下拉数据 + 统计信息。
     */
    public function getConfig(): JsonResponse
    {
        return response()->json([
            'docs_enabled'               => (bool) SystemSetting::getValue('docs_enabled'),
            'docs_guest_access'          => (bool) SystemSetting::getValue('docs_guest_access'),
            'docs_site_title'            => (string) SystemSetting::getValue('docs_site_title'),
            'docs_rag_enabled'           => (bool) SystemSetting::getValue('docs_rag_enabled'),
            'docs_chat_allow_guest'      => (bool) SystemSetting::getValue('docs_chat_allow_guest'),
            'docs_chat_model_id'         => SystemSetting::getValue('docs_chat_model_id'),
            'docs_embedding_model_id'    => SystemSetting::getValue('docs_embedding_model_id'),
            'docs_chunk_size'            => (int) SystemSetting::getValue('docs_chunk_size'),
            'docs_chunk_overlap'         => (int) SystemSetting::getValue('docs_chunk_overlap'),
            'docs_retrieve_top_k'        => (int) SystemSetting::getValue('docs_retrieve_top_k'),
            'docs_min_similarity'        => (float) SystemSetting::getValue('docs_min_similarity'),
            'docs_system_prompt'         => (string) SystemSetting::getValue('docs_system_prompt'),
            'available_chat_models'      => $this->availableModels('chat'),
            'available_embedding_models' => $this->availableModels('embedding'),
            'stats' => $this->buildStats(),
            'vec_mode' => $this->safeVecMode(),
        ]);
    }

    /**
     * 统计：文档总数 / 可见数 / 分类数 / chunk 数 / 已索引向量数
     * 拆出独立方法以便 reindex 后单独刷新（admin 前端按钮回调用）
     */
    private function buildStats(): array
    {
        return [
            'doc_count'      => Doc::count(),
            'visible_count'  => Doc::where('is_visible', true)->count(),
            'category_count' => DocCategory::count(),
            'chunk_count'    => DocChunk::count(),
            'indexed_count'  => $this->safeIndexedCount(),
        ];
    }

    private function safeIndexedCount(): int
    {
        try {
            /** @var DocVecService $vec */
            $vec = app(DocVecService::class);
            return $vec->indexedCount();
        } catch (\Throwable $e) {
            return 0;
        }
    }

    private function safeVecMode(): string
    {
        try {
            /** @var DocVecService $vec */
            $vec = app(DocVecService::class);
            return $vec->mode();
        } catch (\Throwable $e) {
            return 'unknown';
        }
    }

    /**
     * PUT /api/admin/docs/config
     * 增量更新：请求体里出现哪个字段才更新哪个（不会因为其他字段未传而被误重置）。
     */
    public function updateConfig(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'docs_enabled'            => ['nullable', 'boolean'],
            'docs_guest_access'       => ['nullable', 'boolean'],
            'docs_site_title'         => ['nullable', 'string', 'max:100'],
            'docs_rag_enabled'        => ['nullable', 'boolean'],
            'docs_chat_allow_guest'   => ['nullable', 'boolean'],
            'docs_chat_model_id'      => ['nullable', 'integer', 'exists:cloud_models,id'],
            'docs_embedding_model_id' => ['nullable', 'integer', 'exists:cloud_models,id'],
            'docs_chunk_size'         => ['nullable', 'integer', 'min:100', 'max:4000'],
            'docs_chunk_overlap'      => ['nullable', 'integer', 'min:0', 'max:1000'],
            'docs_retrieve_top_k'     => ['nullable', 'integer', 'min:1', 'max:20'],
            'docs_min_similarity'     => ['nullable', 'numeric', 'min:0', 'max:1'],
            'docs_system_prompt'      => ['nullable', 'string', 'max:10000'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $keys = [
            'docs_enabled', 'docs_guest_access', 'docs_site_title',
            'docs_rag_enabled', 'docs_chat_allow_guest',
            'docs_chat_model_id', 'docs_embedding_model_id',
            'docs_chunk_size', 'docs_chunk_overlap',
            'docs_retrieve_top_k', 'docs_min_similarity', 'docs_system_prompt',
        ];
        foreach ($keys as $key) {
            if ($request->has($key)) {
                SystemSetting::setValue($key, $request->input($key));
            }
        }
        return $this->getConfig();
    }

    // =========================================================================
    // Admin: 分类 CRUD
    // =========================================================================

    public function categoryIndex(): JsonResponse
    {
        $items = DocCategory::query()
            ->orderByDesc('sort_order')
            ->orderByDesc('id')
            ->withCount('docs')
            ->get();
        return response()->json(['data' => $items]);
    }

    public function categoryStore(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name'       => ['required', 'string', 'max:50'],
            'slug'       => ['nullable', 'string', 'max:80', 'regex:/^[A-Za-z0-9_-]+$/', 'unique:doc_categories,slug'],
            'sort_order' => ['nullable', 'integer', 'between:-9999,9999'],
            'is_visible' => ['nullable', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $cat = DocCategory::create([
            'name'       => $request->input('name'),
            'slug'       => $request->input('slug') ?: null,
            'sort_order' => (int) $request->input('sort_order', 0),
            'is_visible' => $request->boolean('is_visible', true),
        ]);
        return response()->json($cat, 201);
    }

    public function categoryUpdate(Request $request, int $id): JsonResponse
    {
        $cat = DocCategory::find($id);
        if (!$cat) return response()->json(['error' => 'not_found'], 404);

        $validator = Validator::make($request->all(), [
            'name'       => ['sometimes', 'required', 'string', 'max:50'],
            'slug'       => ['nullable', 'string', 'max:80', 'regex:/^[A-Za-z0-9_-]+$/', 'unique:doc_categories,slug,' . $id],
            'sort_order' => ['nullable', 'integer', 'between:-9999,9999'],
            'is_visible' => ['sometimes', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $data = [];
        if ($request->has('name'))       $data['name']       = $request->input('name');
        if ($request->has('slug'))       $data['slug']       = $request->input('slug') ?: null;
        if ($request->has('sort_order')) $data['sort_order'] = (int) $request->input('sort_order');
        if ($request->has('is_visible')) $data['is_visible'] = $request->boolean('is_visible');
        $cat->update($data);
        return response()->json($cat);
    }

    public function categoryDestroy(int $id): JsonResponse
    {
        $cat = DocCategory::find($id);
        if (!$cat) return response()->json(['error' => 'not_found'], 404);

        // 分类下还有文档时拒绝删除（ON DELETE RESTRICT 也会拦住，但前端提示更清晰）
        $count = Doc::where('category_id', $id)->count();
        if ($count > 0) {
            return response()->json([
                'error'   => 'category_not_empty',
                'message' => "分类下还有 {$count} 篇文档，请先移走或删除",
            ], 409);
        }
        $cat->delete();
        return response()->json(['ok' => true]);
    }

    // =========================================================================
    // Admin: 文档 CRUD + 批量
    // =========================================================================

    public function index(Request $request): JsonResponse
    {
        $query = Doc::query()
            ->with('category:id,name,slug')
            // chunk_count 和 indexed_chunk_count 分别表示「已切片数 / 已嵌入数」，
            // 前端在列表里能直接看出某文档是否被索引（chunk=0 → 还没 reindex；
            // chunk>0 && indexed==chunk → 完整索引；indexed<chunk → 部分失败需重建）
            ->withCount(['chunks', 'chunks as indexed_chunk_count' => function ($q) {
                $q->where('vec_indexed', true);
            }]);

        if ($request->filled('category_id')) {
            $query->where('category_id', (int) $request->input('category_id'));
        }
        if ($request->filled('is_visible') && $request->input('is_visible') !== '') {
            $query->where('is_visible', $request->boolean('is_visible'));
        }
        if ($request->filled('keyword')) {
            $kw = trim((string) $request->input('keyword'));
            if ($kw !== '') {
                $query->where(function ($q) use ($kw) {
                    $q->where('title', 'like', '%' . $kw . '%')
                      ->orWhere('subtitle', 'like', '%' . $kw . '%')
                      ->orWhere('content_plain', 'like', '%' . $kw . '%');
                });
            }
        }

        $query->orderByDesc('sort_order')->orderByDesc('id');
        $perPage = min(max((int) $request->input('per_page', 20), 1), 100);
        $paginated = $query->paginate($perPage);

        // 列表不返回 content_*（可能数 MB），详情接口才返回
        $items = collect($paginated->items())->map(function (Doc $d) {
            $arr = $d->toArray();
            unset($arr['content_html'], $arr['content_plain']);
            return $arr;
        })->all();

        return response()->json([
            'items'    => $items,
            'total'    => $paginated->total(),
            'page'     => $paginated->currentPage(),
            'per_page' => $paginated->perPage(),
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $doc = Doc::with('category:id,name,slug')->find($id);
        if (!$doc) return response()->json(['error' => 'not_found'], 404);
        return response()->json($doc);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateDoc($request, true);
        if ($data instanceof JsonResponse) return $data;

        $doc = Doc::create($data);
        $doc->load('category:id,name,slug');
        return response()->json($doc, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $doc = Doc::find($id);
        if (!$doc) return response()->json(['error' => 'not_found'], 404);

        $data = $this->validateDoc($request, false, $id);
        if ($data instanceof JsonResponse) return $data;

        $doc->update($data);
        $doc->load('category:id,name,slug');
        return response()->json($doc);
    }

    public function destroy(int $id): JsonResponse
    {
        $doc = Doc::find($id);
        if (!$doc) return response()->json(['error' => 'not_found'], 404);
        // 级联删除 doc_chunks 由 FK 自动；向量库清理由 Phase 2 DocVecService::destroyDoc() 接管
        $doc->delete();
        return response()->json(['ok' => true]);
    }

    public function batchDestroy(Request $request): JsonResponse
    {
        $ids = (array) $request->input('ids', []);
        $ids = array_values(array_filter(array_map('intval', $ids)));
        if (empty($ids)) {
            return response()->json(['error' => 'no_ids'], 422);
        }
        Doc::whereIn('id', $ids)->delete();
        return response()->json(['ok' => true, 'count' => count($ids)]);
    }

    public function batchSetVisibility(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'ids'        => ['required', 'array', 'min:1'],
            'ids.*'      => ['integer'],
            'is_visible' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $affected = Doc::whereIn('id', $request->input('ids'))
            ->update(['is_visible' => $request->boolean('is_visible')]);
        return response()->json(['ok' => true, 'affected' => $affected]);
    }

    public function setVisibility(Request $request, int $id): JsonResponse
    {
        $doc = Doc::find($id);
        if (!$doc) return response()->json(['error' => 'not_found'], 404);

        $validator = Validator::make($request->all(), [
            'is_visible' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $doc->update(['is_visible' => $request->boolean('is_visible')]);
        return response()->json($doc);
    }

    // =========================================================================
    // Admin: 导入 + 富文本图片上传
    // =========================================================================

    public function import(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'file'        => ['required', 'file', 'max:20480'],  // 20MB
            'category_id' => ['required', 'integer', 'exists:doc_categories,id'],
            'is_visible'  => ['nullable', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $result = $this->importOneFile(
            $request->file('file'),
            (int) $request->input('category_id'),
            (bool) $request->input('is_visible', true),
            app(DocImportService::class),
        );

        if ($result['status'] !== 'ok') {
            return response()->json([
                'error'   => 'import_failed',
                'message' => $result['error'] ?? '导入失败',
            ], 422);
        }
        return response()->json($result['doc'], 201);
    }

    /**
     * 批量导入：循环复用 importOneFile，每个文件独立 try/catch，失败的收集到 details。
     *
     * 上限：单次最多 50 个文件，总大小 100MB（防 PHP 内存 / 请求超时被反代切断）。
     *
     * POST /api/admin/docs/batch-import
     *   multipart/form-data:
     *     files[]      多文件，单个 ≤ 20MB
     *     category_id  分类 ID（必填）
     *     is_visible   true/false（默认 true，全部应用）
     *
     * Response: { success, failed, details:[{filename,status,doc_id?,title?,error?}] }
     */
    public function batchImport(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'files'       => ['required', 'array', 'min:1', 'max:50'],
            'files.*'     => ['file', 'max:20480'],  // 单文件 20MB
            'category_id' => ['required', 'integer', 'exists:doc_categories,id'],
            'is_visible'  => ['nullable', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        /** @var array<int,\Illuminate\Http\UploadedFile> $files */
        $files = $request->file('files') ?? [];

        // 总大小兜底（防止 50 个 20MB 一起冲爆 PHP 内存）
        $totalBytes = 0;
        foreach ($files as $f) {
            if ($f instanceof \Illuminate\Http\UploadedFile) {
                $totalBytes += $f->getSize() ?: 0;
            }
        }
        if ($totalBytes > 100 * 1024 * 1024) {
            return response()->json([
                'error'   => 'payload_too_large',
                'message' => '批量导入单次总大小不能超过 100MB，请分批上传',
            ], 413);
        }

        $categoryId = (int) $request->input('category_id');
        $isVisible  = (bool) $request->input('is_visible', true);
        $importer   = app(DocImportService::class);

        $success = 0;
        $failed  = 0;
        $details = [];

        foreach ($files as $file) {
            if (!($file instanceof \Illuminate\Http\UploadedFile)) {
                $failed++;
                $details[] = [
                    'filename' => '(unknown)',
                    'status'   => 'failed',
                    'error'    => '无效的文件',
                ];
                continue;
            }
            $res = $this->importOneFile($file, $categoryId, $isVisible, $importer);
            if ($res['status'] === 'ok') {
                $success++;
                $details[] = [
                    'filename' => $file->getClientOriginalName(),
                    'status'   => 'ok',
                    'doc_id'   => $res['doc']->id,
                    'title'    => $res['doc']->title,
                ];
            } else {
                $failed++;
                $details[] = [
                    'filename' => $file->getClientOriginalName(),
                    'status'   => 'failed',
                    'error'    => $res['error'] ?? '导入失败',
                ];
            }
        }

        return response()->json([
            'success' => $success,
            'failed'  => $failed,
            'details' => $details,
        ]);
    }

    // =========================================================================
    // Admin: 导出 md（单条 / 批量 zip）
    // =========================================================================

    /**
     * 单文档导出为 .md 文件下载。
     *
     * GET /api/admin/docs/{id}/export.md
     * Response: text/markdown, Content-Disposition: attachment; filename="{slug-or-title}.md"
     */
    public function exportOne(int $id, DocExportService $exporter)
    {
        $doc = Doc::find($id);
        if (!$doc) {
            return response()->json(['error' => 'doc_not_found'], 404);
        }
        $md = $exporter->exportDoc($doc);
        $filename = $exporter->buildBaseName($doc) . '.md';

        return response($md, 200, [
            'Content-Type'        => 'text/markdown; charset=utf-8',
            // RFC 5987 兼容中文 filename
            'Content-Disposition' => "attachment; filename=\"{$filename}\"; filename*=UTF-8''" . rawurlencode($filename),
        ]);
    }

    /**
     * 批量导出 N 个文档为 zip 下载。
     *
     * 实现细节：
     * - 不允许超过 200 个文档一次性导出（zip 体积 + 内存兜底）
     * - 每个文档作为 zip 内独立 .md 文件，按 category-slug/doc-slug.md 分目录
     * - 同名兜底：碰撞时追加 -2 / -3 后缀
     * - 临时 zip 路径：storage/app/temp/doc-exports/{uuid}.zip
     * - 用 Laravel Response::download(...)->deleteFileAfterSend(true) 让框架在
     *   fastcgi_finish_request 之后自动删除文件（对正常下载万无一失；下载中断的
     *   残留交给 cron 兜底）
     *
     * POST /api/admin/docs/export-batch  body: { ids: [1,2,3] }
     */
    public function exportBatch(Request $request, DocExportService $exporter)
    {
        $validator = Validator::make($request->all(), [
            'ids'   => ['required', 'array', 'min:1', 'max:200'],
            'ids.*' => ['integer'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $ids = array_values(array_unique(array_map('intval', $request->input('ids', []))));
        $docs = Doc::whereIn('id', $ids)->with('category:id,name,slug')->get();
        if ($docs->isEmpty()) {
            return response()->json(['error' => 'no_docs_found'], 404);
        }

        // 临时 zip 文件路径
        $tempDir = storage_path('app/temp/doc-exports');
        if (!is_dir($tempDir) && !@mkdir($tempDir, 0755, true) && !is_dir($tempDir)) {
            return response()->json([
                'error'   => 'storage_unwritable',
                'message' => "导出临时目录不可写：{$tempDir}",
            ], 500);
        }
        $zipPath = $tempDir . DIRECTORY_SEPARATOR . Str::uuid()->toString() . '.zip';

        $zip = new \ZipArchive();
        if ($zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            return response()->json(['error' => 'zip_open_failed'], 500);
        }

        // 用 used map 跟踪 zip 内部路径，碰撞时追加 -N 后缀
        $used = [];
        foreach ($docs as $doc) {
            $md = $exporter->exportDoc($doc);
            $base = $exporter->buildBaseName($doc);
            // 分类目录：用 category.slug，无则 'uncategorized'
            $catSlug = $doc->category && $doc->category->slug ? $doc->category->slug : 'uncategorized';
            $catSlug = preg_replace('#[/\\\\:*?"<>|]+#', '-', $catSlug) ?? $catSlug;

            $relative = $catSlug . '/' . $base . '.md';
            // 去重
            if (isset($used[$relative])) {
                $i = 2;
                do {
                    $candidate = $catSlug . '/' . $base . '-' . $i . '.md';
                    $i++;
                } while (isset($used[$candidate]));
                $relative = $candidate;
            }
            $used[$relative] = true;
            $zip->addFromString($relative, $md);
        }
        $zip->close();

        $filename = 'docs-export-' . now()->format('Ymd-His') . '.zip';
        // deleteFileAfterSend(true) 让 Symfony 在响应发送后自动 unlink；
        // 即便下载中断也有 cron 兜底（schedule: cleanup-doc-exports）。
        return response()->download($zipPath, $filename, [
            'Content-Type' => 'application/zip',
        ])->deleteFileAfterSend(true);
    }

    /**
     * 单文件导入工具：被 import() 和 batchImport() 共用。
     * 不抛异常，统一返回 {status:'ok',doc:Doc} 或 {status:'failed',error:string}，方便外层批量统计。
     *
     * @return array{status:string, doc?:\App\Models\Doc, error?:string}
     */
    private function importOneFile(
        \Illuminate\Http\UploadedFile $file,
        int $categoryId,
        bool $isVisible,
        DocImportService $importer,
    ): array {
        try {
            $parsed = $importer->parse($file);
        } catch (\Throwable $e) {
            return ['status' => 'failed', 'error' => $e->getMessage()];
        }

        try {
            $doc = Doc::create([
                'category_id'   => $categoryId,
                'title'         => $parsed['title'],
                'subtitle'      => $parsed['subtitle'] ?? null,
                'content_html'  => $parsed['content_html'],
                'content_plain' => Doc::htmlToPlain($parsed['content_html']),
                'is_visible'    => $isVisible,
                'import_source' => $parsed['import_source'],
                'sort_order'    => 0,
            ]);
            $doc->load('category:id,name,slug');
            return ['status' => 'ok', 'doc' => $doc];
        } catch (\Throwable $e) {
            return ['status' => 'failed', 'error' => '保存失败：' . $e->getMessage()];
        }
    }

    public function uploadImage(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'image' => [
                'required', 'file',
                'mimetypes:image/png,image/jpeg,image/webp,image/gif',
                'max:' . (int)(self::MAX_IMG_BYTES / 1024),
            ],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $file = $request->file('image');
        $ext  = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'png');
        if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp', 'gif'], true)) {
            $ext = 'png';
        }

        $filename = (string) Str::uuid() . '.' . $ext;
        $url = StorageService::upload($file, self::SUBDIR, $filename);
        if (!$url) {
            return response()->json(['error' => 'upload_failed'], 500);
        }
        return response()->json(['url' => $url]);
    }

    // =========================================================================
    // Public / Client: 文档前端浏览接口
    // =========================================================================

    /**
     * GET /api/public/docs/config（也挂 /api/client/docs/config）
     * publicConfig 不做 ensureAccessAllowed —— 前端要先拉到配置才能判断是否需要登录页。
     */
    public function publicConfig(): JsonResponse
    {
        return response()->json([
            'enabled'           => (bool) SystemSetting::getValue('docs_enabled'),
            'guest_access'      => (bool) SystemSetting::getValue('docs_guest_access'),
            'site_title'        => (string) SystemSetting::getValue('docs_site_title'),
            'rag_enabled'       => (bool) SystemSetting::getValue('docs_rag_enabled'),
            'chat_allow_guest'  => (bool) SystemSetting::getValue('docs_chat_allow_guest'),
        ]);
    }

    public function publicCategories(): JsonResponse
    {
        if ($r = $this->ensureAccessAllowed()) return $r;
        // 公共端点：只返回可见分类；docs_count 也只算 is_visible=true 的文档
        $items = DocCategory::query()
            ->where('is_visible', true)
            ->orderByDesc('sort_order')
            ->orderByDesc('id')
            ->withCount(['docs' => function ($q) {
                $q->where('is_visible', true);
            }])
            ->get(['id', 'name', 'slug', 'sort_order']);
        return response()->json(['data' => $items]);
    }

    public function publicList(Request $request): JsonResponse
    {
        if ($r = $this->ensureAccessAllowed()) return $r;

        // 隐藏文档 + 不可见分类下的文档全部硬过滤
        $query = Doc::query()
            ->where('docs.is_visible', true)
            ->whereExists(function ($q) {
                $q->select(DB::raw(1))
                  ->from('doc_categories')
                  ->whereColumn('doc_categories.id', 'docs.category_id')
                  ->where('doc_categories.is_visible', true);
            })
            ->with('category:id,name,slug');

        if ($request->filled('category_id')) {
            $query->where('category_id', (int) $request->input('category_id'));
        }
        if ($request->filled('category_slug')) {
            $slug = (string) $request->input('category_slug');
            // 只从 is_visible=true 的分类查 id（不可见分类的 slug 视作不存在）
            $catId = DocCategory::where('slug', $slug)->where('is_visible', true)->value('id');
            if (!$catId) {
                return response()->json(['items' => [], 'total' => 0, 'page' => 1, 'per_page' => 0]);
            }
            $query->where('category_id', $catId);
        }

        $keyword = trim((string) $request->input('keyword', ''));
        if ($keyword !== '') {
            $query->where(function ($q) use ($keyword) {
                $q->where('title', 'like', '%' . $keyword . '%')
                  ->orWhere('subtitle', 'like', '%' . $keyword . '%')
                  ->orWhere('content_plain', 'like', '%' . $keyword . '%');
            });
        }

        $query->orderByDesc('sort_order')->orderByDesc('id');
        $perPage = min(max((int) $request->input('per_page', 20), 1), 50);
        $paginated = $query->paginate($perPage);

        $items = collect($paginated->items())->map(function (Doc $d) use ($keyword) {
            $arr = $d->toArray();
            // 搜索结果附摘要；无关键词时返回开头片段
            $arr['excerpt'] = $this->buildExcerpt((string) ($d->content_plain ?? ''), $keyword);
            unset($arr['content_html'], $arr['content_plain']);
            return $arr;
        })->all();

        return response()->json([
            'items'    => $items,
            'total'    => $paginated->total(),
            'page'     => $paginated->currentPage(),
            'per_page' => $paginated->perPage(),
            'keyword'  => $keyword,
        ]);
    }

    public function publicShow(string $idOrSlug): JsonResponse
    {
        if ($r = $this->ensureAccessAllowed()) return $r;

        $doc = null;
        if (ctype_digit((string) $idOrSlug)) {
            $doc = Doc::with('category:id,name,slug,is_visible')->find((int) $idOrSlug);
        } else {
            $doc = Doc::with('category:id,name,slug,is_visible')->where('slug', $idOrSlug)->first();
        }
        // 文档隐藏 / 所属分类隐藏 → 视作不存在（避免直链绕过分类可见性）
        if (!$doc || !$doc->is_visible || !$doc->category || !$doc->category->is_visible) {
            return response()->json(['error' => 'not_found'], 404);
        }

        // 非事务累加浏览量：失败 / 丢精度可接受（统计用途，不是计费凭据）
        Doc::where('id', $doc->id)->increment('view_count');
        return response()->json($doc);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * 校验并组装文档写入 data。
     * $applyDefaults=true：store 场景，补 is_visible/sort_order/subtitle/slug 默认值 + import_source=manual
     * $applyDefaults=false：update 场景，只覆盖有传的字段；subtitle/slug 显式传空串视为清空
     *
     * @return array<string,mixed>|JsonResponse
     */
    private function validateDoc(Request $request, bool $applyDefaults, ?int $updatingId = null)
    {
        $rules = [
            'category_id'  => ['integer', 'exists:doc_categories,id'],
            'title'        => ['string', 'max:200'],
            'subtitle'     => ['nullable', 'string', 'max:300'],
            'content_html' => ['string'],
            'slug'         => ['nullable', 'string', 'max:120', 'regex:/^[A-Za-z0-9_-]+$/'],
            'is_visible'   => ['sometimes', 'boolean'],
            'sort_order'   => ['nullable', 'integer', 'between:-9999,9999'],
        ];
        if ($applyDefaults) {
            // store 场景下 category_id/title/content_html 必填
            $rules['category_id']  = array_merge(['required'], $rules['category_id']);
            $rules['title']        = array_merge(['required'], $rules['title']);
            $rules['content_html'] = array_merge(['required'], $rules['content_html']);
        } else {
            // update 场景所有字段 sometimes
            foreach (['category_id', 'title', 'content_html'] as $k) {
                $rules[$k] = array_merge(['sometimes'], $rules[$k]);
            }
        }

        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $data = [];
        foreach (['category_id', 'title', 'subtitle', 'content_html', 'slug', 'is_visible', 'sort_order'] as $field) {
            if ($request->has($field)) {
                $v = $request->input($field);
                // slug 空串视为清空（null）
                if ($field === 'slug' && $v === '') $v = null;
                if ($field === 'sort_order' && ($v === '' || $v === null)) $v = 0;
                // subtitle 空串保留为空串（前端清空时的显式意图）
                $data[$field] = $v;
            }
        }

        // content_plain 由 content_html 同步生成
        if (array_key_exists('content_html', $data)) {
            $data['content_plain'] = Doc::htmlToPlain((string) $data['content_html']);
        }

        if ($applyDefaults) {
            if (!array_key_exists('is_visible', $data)) $data['is_visible'] = true;
            if (!array_key_exists('sort_order', $data)) $data['sort_order'] = 0;
            if (!array_key_exists('subtitle', $data))   $data['subtitle']   = null;
            if (!array_key_exists('slug', $data))       $data['slug']       = null;
            $data['import_source'] = 'manual';
        }

        // slug 冲突保底校验（含本表 unique 但手动再查一次，便于 update 时排除自己）
        if (array_key_exists('slug', $data) && !empty($data['slug'])) {
            $q = Doc::where('slug', $data['slug']);
            if ($updatingId !== null) {
                $q->where('id', '<>', $updatingId);
            }
            if ($q->exists()) {
                return response()->json([
                    'error'   => 'validation_failed',
                    'details' => ['slug' => ['slug 已被其他文档占用']],
                ], 422);
            }
        }

        return $data;
    }

    /**
     * 公开接口访问门控：
     *   - docs_enabled=false：整站停用，返回 503
     *   - docs_guest_access=false + 未登录：要求登录，返回 401
     *   - 其他情形放行
     */
    private function ensureAccessAllowed(): ?JsonResponse
    {
        if (!(bool) SystemSetting::getValue('docs_enabled')) {
            return response()->json(['error' => 'docs_disabled'], 503);
        }
        // 已登录用户直接放行（client 端点中间件会设置 auth()->user()）
        if (auth()->check()) return null;

        if (!(bool) SystemSetting::getValue('docs_guest_access')) {
            return response()->json(['error' => 'login_required'], 401);
        }
        return null;
    }

    /**
     * 生成搜索结果摘要：定位关键词附近 120 字，前后省略号拼接。
     */
    private function buildExcerpt(string $plain, string $keyword, int $window = 120): string
    {
        $plain = trim($plain);
        if ($plain === '') return '';

        if ($keyword === '') {
            return mb_strlen($plain, 'UTF-8') > $window
                ? mb_substr($plain, 0, $window, 'UTF-8') . '…'
                : $plain;
        }

        $pos = mb_stripos($plain, $keyword, 0, 'UTF-8');
        if ($pos === false) {
            return mb_strlen($plain, 'UTF-8') > $window
                ? mb_substr($plain, 0, $window, 'UTF-8') . '…'
                : $plain;
        }

        $half    = intdiv($window, 2);
        $start   = max(0, $pos - $half);
        $snippet = mb_substr($plain, $start, $window, 'UTF-8');
        $total   = mb_strlen($plain, 'UTF-8');
        $prefix  = $start > 0 ? '…' : '';
        $suffix  = ($start + $window) < $total ? '…' : '';
        return $prefix . $snippet . $suffix;
    }

    /**
     * 列出某类型（chat / embedding）下所有 active 的模型，供 admin 设置页下拉。
     * 返回格式：[{id, name, model_id, provider_name}]
     */
    private function availableModels(string $type): array
    {
        return CloudModel::query()
            ->join('cloud_providers as p', 'p.id', '=', 'cloud_models.provider_id')
            ->where('cloud_models.type', $type)
            ->where('cloud_models.status', 'active')
            ->where('p.status', 'active')
            ->orderBy('p.id')
            ->orderBy('cloud_models.id')
            ->get([
                'cloud_models.id',
                'cloud_models.name',
                'cloud_models.model_id',
                'p.name as provider_name',
            ])
            ->toArray();
    }

    // =========================================================================
    // Admin: RAG 索引 / 检索预览 / 模型测试 / 审计日志
    // =========================================================================

    /**
     * POST /api/admin/docs/{id}/reindex
     * 单文档重新切片 + 嵌入。同步执行（文档量大时由 admin 前端给个 loading 提示）。
     */
    public function reindexOne(int $id, DocRagService $rag): JsonResponse
    {
        $doc = Doc::find($id);
        if (!$doc) return response()->json(['error' => 'not_found'], 404);

        try {
            $r = $rag->reindexDoc($id);
        } catch (\Throwable $e) {
            return response()->json([
                'error'   => 'reindex_failed',
                'message' => $e->getMessage(),
            ], 422);
        }
        return response()->json(['ok' => true] + $r);
    }

    /**
     * POST /api/admin/docs/reindex-all
     * 全量重建（切换 embedding 模型时调；同步执行，前端 loading）。
     */
    public function reindexAll(DocRagService $rag): JsonResponse
    {
        // 时间可能很长（每文档 1-3 秒）；增大 PHP 执行时长上限
        @set_time_limit(0);
        @ini_set('max_execution_time', '0');

        try {
            $stats = $rag->reindexAll();
        } catch (\Throwable $e) {
            return response()->json([
                'error'   => 'reindex_all_failed',
                'message' => $e->getMessage(),
            ], 500);
        }
        return response()->json(['ok' => true] + $stats + ['stats' => $this->buildStats()]);
    }

    /**
     * POST /api/admin/docs/retrieve-preview
     * admin 调试用：传入 query，返回命中的 chunk 列表 + 距离 / 相似度
     * Body: { query: string, top_k?: int }
     */
    public function retrievePreview(Request $request, DocRagService $rag): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'query' => ['required', 'string', 'max:1000'],
            'top_k' => ['nullable', 'integer', 'min:1', 'max:20'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        try {
            $hits = $rag->retrievePreview(
                (string) $request->input('query'),
                (int) $request->input('top_k', 0)
            );
        } catch (\Throwable $e) {
            return response()->json(['error' => 'retrieve_failed', 'message' => $e->getMessage()], 500);
        }
        return response()->json(['hits' => $hits]);
    }

    /**
     * POST /api/admin/docs/test-model
     * 测试 chat 或 embedding 模型连通性。
     * Body: { type: 'chat'|'embedding', cloud_model_id: int }
     *
     * 走 GatewayRouter 拿凭证池中的 apiKey（与 RAG 实际调用路径一致），
     * 避免「provider.api_key 为空但 provider_credentials 已配置」时虚假报错。
     */
    public function testModel(Request $request, \App\Services\Gateway\GatewayRouter $router): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'type'           => ['required', 'in:chat,embedding'],
            'cloud_model_id' => ['required', 'integer', 'exists:cloud_models,id'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $cloudModel = CloudModel::with('provider')->find((int) $request->input('cloud_model_id'));
        if (!$cloudModel) return response()->json(['error' => 'not_found'], 404);
        if ($cloudModel->type !== $request->input('type')) {
            return response()->json([
                'error' => 'model_type_mismatch',
                'message' => "模型类型不是 {$request->input('type')}",
            ], 422);
        }
        if (!$cloudModel->provider || $cloudModel->provider->status !== 'active') {
            return response()->json(['error' => 'provider_inactive', 'message' => '服务商已禁用'], 422);
        }

        try {
            $route = $router->route($cloudModel);
        } catch (\Throwable $e) {
            return response()->json(['ok' => false, 'error' => 'no_credential', 'detail' => $e->getMessage()]);
        }
        $apiKey = (string) $route->apiKey;
        if ($apiKey === '') {
            return response()->json(['ok' => false, 'error' => 'no_credential', 'detail' => '该服务商无可用凭证']);
        }

        $started = microtime(true);
        try {
            if ($cloudModel->type === 'embedding') {
                $url = rtrim((string) $cloudModel->provider->api_base, '/') . '/embeddings';
                $resp = Http::withToken($apiKey)
                    ->timeout(15)
                    ->post($url, [
                        'model' => $cloudModel->model_id,
                        'input' => '测试',
                    ]);
                if (!$resp->successful()) {
                    $router->markCredentialFailure($route->credential, 'test embed http ' . $resp->status());
                    return response()->json([
                        'ok' => false,
                        'error' => 'HTTP ' . $resp->status(),
                        'detail' => substr((string) $resp->body(), 0, 300),
                    ]);
                }
                $router->markCredentialSuccess($route->credential);
                $vec = $resp->json('data.0.embedding') ?? [];
                $latency = (int) round((microtime(true) - $started) * 1000);
                return response()->json([
                    'ok'       => true,
                    'latency'  => $latency,
                    'dimension' => count($vec),
                ]);
            }

            // chat: 测试一次极短调用
            $url = rtrim((string) $cloudModel->provider->api_base, '/') . '/chat/completions';
            $resp = Http::withToken($apiKey)
                ->timeout(15)
                ->post($url, [
                    'model'      => $cloudModel->model_id,
                    'messages'   => [['role' => 'user', 'content' => "回复一个字'好'"]],
                    'max_tokens' => 10,
                ]);
            if (!$resp->successful()) {
                $router->markCredentialFailure($route->credential, 'test chat http ' . $resp->status());
                return response()->json([
                    'ok' => false,
                    'error' => 'HTTP ' . $resp->status(),
                    'detail' => substr((string) $resp->body(), 0, 300),
                ]);
            }
            $router->markCredentialSuccess($route->credential);
            $reply = $resp->json('choices.0.message.content') ?? '';
            $latency = (int) round((microtime(true) - $started) * 1000);
            return response()->json([
                'ok'      => true,
                'latency' => $latency,
                'reply'   => $reply,
            ]);
        } catch (\Throwable $e) {
            $router->markCredentialFailure($route->credential, 'test network: ' . $e->getMessage());
            return response()->json([
                'ok'    => false,
                'error' => 'network',
                'detail' => $e->getMessage(),
            ]);
        }
    }

    /**
     * GET /api/admin/docs/chat-logs
     * 问答审计日志列表（分页 + 按 status / 关键词 / 用户 ID 过滤）
     */
    public function chatLogs(Request $request): JsonResponse
    {
        $query = \App\Models\DocChatLog::query()
            ->leftJoin('users', 'users.id', '=', 'doc_chat_logs.user_id')
            ->select([
                'doc_chat_logs.*',
                'users.username as user_username',
                'users.nickname as user_nickname',
            ]);

        if ($request->filled('status')) {
            $query->where('doc_chat_logs.status', $request->input('status'));
        }
        if ($request->filled('user_id')) {
            $query->where('doc_chat_logs.user_id', (int) $request->input('user_id'));
        }
        if ($request->filled('keyword')) {
            $kw = trim((string) $request->input('keyword'));
            if ($kw !== '') {
                $query->where(function ($q) use ($kw) {
                    $q->where('doc_chat_logs.query', 'like', '%' . $kw . '%')
                      ->orWhere('doc_chat_logs.session_id', 'like', '%' . $kw . '%');
                });
            }
        }

        $perPage = min(max((int) $request->input('per_page', 20), 1), 100);
        $paginated = $query->orderByDesc('doc_chat_logs.id')->paginate($perPage);
        return response()->json([
            'items'    => $paginated->items(),
            'total'    => $paginated->total(),
            'page'     => $paginated->currentPage(),
            'per_page' => $paginated->perPage(),
        ]);
    }

    // =========================================================================
    // Public / Client: 流式问答（SSE）
    // =========================================================================

    /**
     * POST /api/public/docs/chat（无鉴权）
     * Body: { query: string, session_id?: string }
     */
    public function publicChat(Request $request, DocRagService $rag): StreamedResponse
    {
        // 门控（流式响应不能用 ensureAccessAllowed 返回 JsonResponse，改成 SSE 错误事件）
        if (!(bool) SystemSetting::getValue('docs_enabled')) {
            return $this->ssError('docs_disabled', '文档站点已关闭');
        }
        if (!(bool) SystemSetting::getValue('docs_rag_enabled')) {
            return $this->ssError('rag_disabled', 'RAG 功能未启用');
        }
        if (!(bool) SystemSetting::getValue('docs_chat_allow_guest')) {
            return $this->ssError('login_required', '请登录后再使用文档助手');
        }
        return $rag->chat(
            (string) $request->input('query', ''),
            null,
            $this->normalizeSessionId((string) $request->input('session_id', ''))
        );
    }

    /**
     * POST /api/client/docs/chat（auth.jwt）
     * 已登录用户，不受 docs_chat_allow_guest 限制
     */
    public function clientChat(Request $request, DocRagService $rag): StreamedResponse
    {
        if (!(bool) SystemSetting::getValue('docs_enabled')) {
            return $this->ssError('docs_disabled', '文档站点已关闭');
        }
        if (!(bool) SystemSetting::getValue('docs_rag_enabled')) {
            return $this->ssError('rag_disabled', 'RAG 功能未启用');
        }
        $user = auth()->user();
        return $rag->chat(
            (string) $request->input('query', ''),
            $user ? (int) $user->id : null,
            $this->normalizeSessionId((string) $request->input('session_id', ''))
        );
    }

    /**
     * 简易 SSE 错误响应（用于流式接口的门控失败场景）
     * 协议与 DocRagService 完全一致：先 error 再 done，不携带 citations（前端按 error 走）
     */
    private function ssError(string $code, string $message): StreamedResponse
    {
        return new StreamedResponse(function () use ($code, $message) {
            $emit = function (array $payload) {
                echo 'data: ' . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
                if (ob_get_level() > 0) ob_flush();
                flush();
            };
            $emit(['error' => $code, 'message' => $message]);
            $emit(['done' => true]);
        }, 200, [
            'Content-Type'      => 'text/event-stream; charset=utf-8',
            'Cache-Control'     => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * 把前端传来的 session_id 规范化（截断 + 缺省时生成 uuid）
     */
    private function normalizeSessionId(string $raw): string
    {
        $raw = trim($raw);
        if ($raw === '') return (string) Str::uuid();
        // 仅允许 ascii 字母数字 - _，长度截断到 64
        $raw = preg_replace('/[^A-Za-z0-9_\-]/', '', $raw);
        return substr($raw, 0, 64) ?: (string) Str::uuid();
    }
}
