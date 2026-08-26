<?php

namespace App\Http\Controllers;

use App\Jobs\ReindexKnowledgeDocumentJob;
use App\Models\Agent;
use App\Models\CloudModel;
use App\Models\KbChunk;
use App\Models\KbDocument;
use App\Models\KnowledgeBase;
use App\Models\SystemSetting;
use App\Services\AgentAccessService;
use App\Services\Knowledge\KbDocumentParseService;
use App\Services\Knowledge\KbRagService;
use App\Services\Knowledge\VecStoreInterface;
use App\Services\Qdrant\QdrantClient;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * 云端知识库管理控制器（admin）。
 *
 * 路由：/api/admin/knowledge-bases/*（auth.jwt + admin）
 *
 * 设计取舍：
 *   - 知识库是顶层单元；文档挂在知识库下（kb_id），支持富文本在线编辑 + 文件上传解析
 *   - 向量化异步执行（ReindexKnowledgeDocumentJob，sync/database 双模），不阻塞请求
 *   - 检索调试 retrievePreview 走 KbRagService::retrieve（hybrid 向量 + 关键词）
 *   - 删除文档/知识库时同步清理 Qdrant 向量（保证一致性）
 */
class KnowledgeBaseController extends Controller
{
    private const SUBDIR = 'kb/embeds';
    private const MAX_IMG_BYTES = 5 * 1024 * 1024;

    // =========================================================================
    // 配置
    // =========================================================================

    public function getConfig(): JsonResponse
    {
        return response()->json([
            'kb_embedding_model_id'      => SystemSetting::getValue('kb_embedding_model_id'),
            'kb_chunk_size'              => (int) SystemSetting::getValue('kb_chunk_size'),
            'kb_chunk_overlap'           => (int) SystemSetting::getValue('kb_chunk_overlap'),
            'kb_retrieve_top_k'          => (int) SystemSetting::getValue('kb_retrieve_top_k'),
            'kb_min_similarity'          => (float) SystemSetting::getValue('kb_min_similarity'),
            'kb_hybrid_enabled'          => (bool) SystemSetting::getValue('kb_hybrid_enabled'),
            // Qdrant 连接（api_key 仅返回是否已配置，绝不下发明文）
            'kb_qdrant_url'              => (string) SystemSetting::getValue('kb_qdrant_url'),
            'kb_qdrant_collection'      => (string) SystemSetting::getValue('kb_qdrant_collection'),
            'has_kb_qdrant_api_key'     => SystemSetting::getRawValue('kb_qdrant_api_key', '') !== '',
            'available_embedding_models' => $this->availableModels('embedding'),
            'stats'                      => $this->buildStats(),
            'qdrant'                     => $this->safeQdrantHealth(),
        ]);
    }

    public function updateConfig(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'kb_embedding_model_id' => ['nullable', 'integer', 'exists:cloud_models,id'],
            'kb_chunk_size'         => ['nullable', 'integer', 'min:100', 'max:4000'],
            'kb_chunk_overlap'      => ['nullable', 'integer', 'min:0', 'max:1000'],
            'kb_retrieve_top_k'     => ['nullable', 'integer', 'min:1', 'max:20'],
            'kb_min_similarity'     => ['nullable', 'numeric', 'min:0', 'max:1'],
            'kb_hybrid_enabled'     => ['nullable', 'boolean'],
            'kb_qdrant_url'         => ['nullable', 'string', 'max:300'],
            'kb_qdrant_api_key'     => ['nullable', 'string', 'max:500'],
            'kb_qdrant_collection'  => ['nullable', 'string', 'max:100', 'regex:/^[A-Za-z0-9_\-]*$/'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $keys = [
            'kb_embedding_model_id', 'kb_chunk_size', 'kb_chunk_overlap',
            'kb_retrieve_top_k', 'kb_min_similarity', 'kb_hybrid_enabled',
            'kb_qdrant_url', 'kb_qdrant_collection',
        ];
        foreach ($keys as $key) {
            if ($request->has($key)) {
                SystemSetting::setValue($key, $request->input($key));
            }
        }
        // api_key 加密字段：仅在显式传入非空时更新，留空表示保持原值（避免清空已配置的 key）
        if ($request->filled('kb_qdrant_api_key')) {
            SystemSetting::setValue('kb_qdrant_api_key', (string) $request->input('kb_qdrant_api_key'));
        }
        return $this->getConfig();
    }

    // =========================================================================
    // 知识库 CRUD
    // =========================================================================

    public function index(Request $request): JsonResponse
    {
        $query = KnowledgeBase::query()->withCount('agents');

        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }
        if ($request->filled('keyword')) {
            $kw = trim((string) $request->input('keyword'));
            if ($kw !== '') {
                $query->where(function ($q) use ($kw) {
                    $q->where('name', 'like', '%' . $kw . '%')
                      ->orWhere('description', 'like', '%' . $kw . '%');
                });
            }
        }

        $query->orderByDesc('sort_order')->orderByDesc('id');
        $perPage = min(max((int) $request->input('per_page', 20), 1), 100);
        $paginated = $query->paginate($perPage);

        return response()->json([
            'items'    => $paginated->items(),
            'total'    => $paginated->total(),
            'page'     => $paginated->currentPage(),
            'per_page' => $paginated->perPage(),
        ]);
    }

    /**
     * 轻量列表（供智能体绑定表单下拉）：仅 active 知识库的 id + name。
     */
    public function options(): JsonResponse
    {
        $items = KnowledgeBase::query()
            ->where('status', KnowledgeBase::STATUS_ACTIVE)
            ->orderByDesc('sort_order')
            ->orderByDesc('id')
            ->get(['id', 'name', 'doc_count', 'chunk_count']);
        return response()->json(['data' => $items]);
    }

    public function show(int $id): JsonResponse
    {
        $kb = KnowledgeBase::withCount(['agents', 'documents'])->find($id);
        if (!$kb) {
            return response()->json(['error' => 'not_found'], 404);
        }
        return response()->json($kb);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateKb($request, true);
        if ($data instanceof JsonResponse) {
            return $data;
        }
        $user = auth()->user();
        $data['created_by_user_id'] = $user ? (int) $user->id : null;

        $kb = KnowledgeBase::create($data);
        return response()->json($kb, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $kb = KnowledgeBase::find($id);
        if (!$kb) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $data = $this->validateKb($request, false);
        if ($data instanceof JsonResponse) {
            return $data;
        }
        $kb->update($data);
        return response()->json($kb);
    }

    public function destroy(int $id, KbRagService $rag): JsonResponse
    {
        $kb = KnowledgeBase::find($id);
        if (!$kb) {
            return response()->json(['error' => 'not_found'], 404);
        }
        // 先清 Qdrant 向量（避免残留），再删库（级联删 documents/chunks + agent 绑定）
        try {
            $rag->purgeKnowledgeBaseVectors($id);
        } catch (\Throwable $e) {
            Log::warning('[KB] purge vectors on destroy failed', ['kb' => $id, 'err' => $e->getMessage()]);
        }
        $kb->delete();
        return response()->json(['ok' => true]);
    }

    // =========================================================================
    // 文档 CRUD（挂在 kbId 下）
    // =========================================================================

    public function listDocuments(Request $request, int $kbId): JsonResponse
    {
        if (!KnowledgeBase::whereKey($kbId)->exists()) {
            return response()->json(['error' => 'kb_not_found'], 404);
        }

        $query = KbDocument::query()->where('kb_id', $kbId);
        if ($request->filled('index_status')) {
            $query->where('index_status', $request->input('index_status'));
        }
        if ($request->filled('keyword')) {
            $kw = trim((string) $request->input('keyword'));
            if ($kw !== '') {
                $query->where('title', 'like', '%' . $kw . '%');
            }
        }

        $query->orderByDesc('sort_order')->orderByDesc('id');
        $perPage = min(max((int) $request->input('per_page', 20), 1), 100);
        $paginated = $query->paginate($perPage);

        // 列表不返回正文（可能很大）
        $items = collect($paginated->items())->map(function (KbDocument $d) {
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

    public function showDocument(int $kbId, int $docId): JsonResponse
    {
        $doc = KbDocument::where('kb_id', $kbId)->where('id', $docId)->first();
        if (!$doc) {
            return response()->json(['error' => 'not_found'], 404);
        }
        return response()->json($doc);
    }

    /**
     * 富文本在线创建文档。
     */
    public function storeDocument(Request $request, int $kbId): JsonResponse
    {
        if (!KnowledgeBase::whereKey($kbId)->exists()) {
            return response()->json(['error' => 'kb_not_found'], 404);
        }
        $validator = Validator::make($request->all(), [
            'title'        => ['required', 'string', 'max:200'],
            'content_html' => ['required', 'string'],
            'sort_order'   => ['nullable', 'integer', 'between:-9999,9999'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $html = (string) $request->input('content_html');
        $doc = KbDocument::create([
            'kb_id'         => $kbId,
            'title'         => (string) $request->input('title'),
            'source_type'   => KbDocument::SOURCE_RICHTEXT,
            'content_html'  => $html,
            'content_plain' => KbDocument::htmlToPlain($html),
            'index_status'  => KbDocument::STATUS_PENDING,
            'sort_order'    => (int) $request->input('sort_order', 0),
        ]);

        app(KbRagService::class)->recountKb($kbId);
        $this->dispatchDocumentIndex($doc->id);

        return response()->json($doc, 201);
    }

    public function updateDocument(Request $request, int $kbId, int $docId): JsonResponse
    {
        $doc = KbDocument::where('kb_id', $kbId)->where('id', $docId)->first();
        if (!$doc) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $validator = Validator::make($request->all(), [
            'title'        => ['sometimes', 'required', 'string', 'max:200'],
            'content_html' => ['sometimes', 'required', 'string'],
            'sort_order'   => ['nullable', 'integer', 'between:-9999,9999'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $data = [];
        if ($request->has('title')) {
            $data['title'] = (string) $request->input('title');
        }
        if ($request->has('sort_order')) {
            $data['sort_order'] = (int) $request->input('sort_order');
        }
        $contentChanged = false;
        if ($request->has('content_html')) {
            $html = (string) $request->input('content_html');
            $data['content_html'] = $html;
            $data['content_plain'] = KbDocument::htmlToPlain($html);
            $data['index_status'] = KbDocument::STATUS_PENDING;
            $contentChanged = true;
        }
        $doc->update($data);

        if ($contentChanged) {
            $this->dispatchDocumentIndex($doc->id);
        }
        return response()->json($doc);
    }

    public function destroyDocument(int $kbId, int $docId, KbRagService $rag): JsonResponse
    {
        $doc = KbDocument::where('kb_id', $kbId)->where('id', $docId)->first();
        if (!$doc) {
            return response()->json(['error' => 'not_found'], 404);
        }
        try {
            $rag->purgeDocumentVectors($docId);
        } catch (\Throwable $e) {
            Log::warning('[KB] purge doc vectors failed', ['doc' => $docId, 'err' => $e->getMessage()]);
        }
        $doc->delete(); // 级联删 kb_chunks
        $rag->recountKb($kbId);
        return response()->json(['ok' => true]);
    }

    // =========================================================================
    // 文件上传导入（解析 PDF/Word/Markdown/TXT/Excel）
    // =========================================================================

    public function import(Request $request, int $kbId): JsonResponse
    {
        if (!KnowledgeBase::whereKey($kbId)->exists()) {
            return response()->json(['error' => 'kb_not_found'], 404);
        }
        $validator = Validator::make($request->all(), [
            'files'   => ['required', 'array', 'min:1', 'max:50'],
            'files.*' => ['file', 'max:20480'], // 单文件 20MB
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        /** @var array<int,\Illuminate\Http\UploadedFile> $files */
        $files = $request->file('files') ?? [];
        $parser = app(KbDocumentParseService::class);

        $success = 0;
        $failed = 0;
        $details = [];
        $newDocIds = [];

        foreach ($files as $file) {
            if (!($file instanceof \Illuminate\Http\UploadedFile)) {
                $failed++;
                $details[] = ['filename' => '(unknown)', 'status' => 'failed', 'error' => '无效的文件'];
                continue;
            }
            try {
                $parsed = $parser->parse($file);
                $doc = KbDocument::create([
                    'kb_id'             => $kbId,
                    'title'             => $parsed['title'],
                    'source_type'       => KbDocument::SOURCE_UPLOAD,
                    'original_filename' => $parsed['original_filename'],
                    'content_html'      => $parsed['content_html'],
                    'content_plain'     => KbDocument::htmlToPlain($parsed['content_html']),
                    'file_size'         => (int) ($file->getSize() ?: 0),
                    'index_status'      => KbDocument::STATUS_PENDING,
                    'sort_order'        => 0,
                ]);
                $newDocIds[] = $doc->id;
                $success++;
                $details[] = [
                    'filename' => $file->getClientOriginalName(),
                    'status'   => 'ok',
                    'doc_id'   => $doc->id,
                    'title'    => $doc->title,
                ];
            } catch (\Throwable $e) {
                $failed++;
                $details[] = [
                    'filename' => $file->getClientOriginalName(),
                    'status'   => 'failed',
                    'error'    => $e->getMessage(),
                ];
            }
        }

        app(KbRagService::class)->recountKb($kbId);
        foreach ($newDocIds as $docId) {
            $this->dispatchDocumentIndex($docId);
        }

        return response()->json(['success' => $success, 'failed' => $failed, 'details' => $details]);
    }

    public function uploadImage(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'image' => [
                'required', 'file',
                'mimetypes:image/png,image/jpeg,image/webp,image/gif',
                'max:' . (int) (self::MAX_IMG_BYTES / 1024),
            ],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $file = $request->file('image');
        $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'png');
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
    // 索引 / 检索调试 / 模型测试
    // =========================================================================

    public function reindexDocument(int $kbId, int $docId): JsonResponse
    {
        $doc = KbDocument::where('kb_id', $kbId)->where('id', $docId)->first();
        if (!$doc) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $this->dispatchDocumentIndex($docId);
        return response()->json(['ok' => true, 'index_status' => KbDocument::STATUS_PENDING]);
    }

    public function reindexKb(int $kbId): JsonResponse
    {
        if (!KnowledgeBase::whereKey($kbId)->exists()) {
            return response()->json(['error' => 'kb_not_found'], 404);
        }
        $docIds = KbDocument::where('kb_id', $kbId)->pluck('id')->all();
        foreach ($docIds as $docId) {
            $this->dispatchDocumentIndex((int) $docId);
        }
        return response()->json(['ok' => true, 'dispatched' => count($docIds)]);
    }

    public function retrievePreview(Request $request, KbRagService $rag): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'query'             => ['required', 'string', 'max:1000'],
            'top_k'             => ['nullable', 'integer', 'min:1', 'max:20'],
            'knowledge_base_id' => ['nullable', 'integer'],
            'kb_ids'            => ['nullable', 'array'],
            'kb_ids.*'          => ['integer'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $kbIds = [];
        if ($request->filled('kb_ids')) {
            $kbIds = array_map('intval', (array) $request->input('kb_ids'));
        } elseif ($request->filled('knowledge_base_id')) {
            $kbIds = [(int) $request->input('knowledge_base_id')];
        } else {
            $kbIds = KnowledgeBase::where('status', KnowledgeBase::STATUS_ACTIVE)->pluck('id')->map(fn ($i) => (int) $i)->all();
        }
        if (empty($kbIds)) {
            return response()->json(['hits' => []]);
        }

        try {
            $hits = $rag->retrieve(
                (string) $request->input('query'),
                $kbIds,
                (int) $request->input('top_k', 0)
            );
        } catch (\Throwable $e) {
            return response()->json(['error' => 'retrieve_failed', 'message' => $e->getMessage()], 500);
        }
        return response()->json(['hits' => $hits]);
    }

    /**
     * 测试 embedding 模型连通性（返回向量维度）。
     */
    public function testModel(Request $request, \App\Services\Gateway\GatewayRouter $router): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'cloud_model_id' => ['required', 'integer', 'exists:cloud_models,id'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $cloudModel = CloudModel::with('provider')->find((int) $request->input('cloud_model_id'));
        if (!$cloudModel) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($cloudModel->type !== 'embedding') {
            return response()->json(['error' => 'model_type_mismatch', 'message' => '模型类型不是 embedding'], 422);
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
            $url = rtrim((string) $cloudModel->provider->api_base, '/') . '/embeddings';
            $resp = \Illuminate\Support\Facades\Http::withToken($apiKey)
                ->timeout(15)
                ->post($url, ['model' => $cloudModel->model_id, 'input' => '测试']);
            if (!$resp->successful()) {
                $router->markCredentialFailure($route->credential, 'kb test embed http ' . $resp->status());
                return response()->json(['ok' => false, 'error' => 'HTTP ' . $resp->status(), 'detail' => substr((string) $resp->body(), 0, 300)]);
            }
            $router->markCredentialSuccess($route->credential);
            $vec = $resp->json('data.0.embedding') ?? [];
            return response()->json([
                'ok'        => true,
                'latency'   => (int) round((microtime(true) - $started) * 1000),
                'dimension' => count($vec),
            ]);
        } catch (\Throwable $e) {
            $router->markCredentialFailure($route->credential, 'kb test network: ' . $e->getMessage());
            return response()->json(['ok' => false, 'error' => 'network', 'detail' => $e->getMessage()]);
        }
    }

    // =========================================================================
    // Client: 桌面端语义检索（鉴权随智能体授权传递）
    // =========================================================================

    /**
     * POST /api/client/knowledge-bases/search（auth.jwt）
     *
     * 桌面端对话 RAG 调用：传 agent_id + query，返回该智能体绑定知识库的检索片段。
     * 鉴权流水线：登录 → agent 上架可见 → 用户已 acquire → 仅检索 agent 绑定的 kb。
     *
     * Body: { agent_id: int, query: string, top_k?: int, kb_ids?: int[] }
     */
    public function clientSearch(Request $request, KbRagService $rag, AgentAccessService $access): JsonResponse
    {
        $user = auth()->user();
        if (!$user) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $validator = Validator::make($request->all(), [
            'agent_id' => ['required', 'integer'],
            'query'    => ['required', 'string', 'max:1000'],
            'top_k'    => ['nullable', 'integer', 'min:1', 'max:20'],
            'kb_ids'   => ['nullable', 'array'],
            'kb_ids.*' => ['integer'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $agentId = (int) $request->input('agent_id');
        $agent = $access->findApprovedVisibleAgent($agentId, ['knowledgeBases:id']);
        if (!$agent) {
            return response()->json(['error' => 'agent_not_found'], 404);
        }
        if (!$access->isAgentVisibleTo($agent, $user)) {
            return response()->json(['error' => 'forbidden', 'message' => '无权使用该智能体'], 403);
        }
        if (!$access->userOwnsAgent($agentId, (int) $user->id)) {
            return response()->json(['error' => 'not_owned', 'message' => '请先在智能体市场获取该智能体'], 403);
        }

        // 该智能体绑定的知识库
        $boundKbIds = $agent->knowledgeBases->pluck('id')->map(fn ($i) => (int) $i)->all();
        if (empty($boundKbIds)) {
            return response()->json(['hits' => []]);
        }

        // 请求若指定 kb_ids，取与绑定集合的交集（防止越权检索未绑定的库）
        $kbIds = $boundKbIds;
        if ($request->filled('kb_ids')) {
            $requested = array_map('intval', (array) $request->input('kb_ids'));
            $kbIds = array_values(array_intersect($boundKbIds, $requested));
            if (empty($kbIds)) {
                return response()->json(['hits' => []]);
            }
        }

        $topK = (int) $request->input('top_k', 0);
        if ($topK <= 0) {
            $topK = (int) ($agent->kb_top_k ?: 0);
        }

        try {
            $hits = $rag->retrieve((string) $request->input('query'), $kbIds, $topK);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'retrieve_failed', 'message' => $e->getMessage()], 500);
        }

        // 转成桌面端消费的形态
        $results = array_map(fn ($h) => [
            'cloud_kb_id' => $h['kb_id'],
            'kb_name'     => $h['kb_name'],
            'chunk_id'    => $h['chunk_id'],
            'document_id' => $h['document_id'],
            'source_doc'  => $h['doc_title'],
            'content'     => $h['chunk_text'],
            'score'       => $h['score'],
        ], $hits);

        return response()->json(['hits' => $results]);
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * 校验并组装知识库写入 data。
     *
     * @return array<string,mixed>|JsonResponse
     */
    private function validateKb(Request $request, bool $creating)
    {
        $rules = [
            'name'               => ['string', 'max:100'],
            'description'        => ['nullable', 'string', 'max:500'],
            'embedding_model_id' => ['nullable', 'integer', 'exists:cloud_models,id'],
            'visibility_scope'   => ['nullable', 'in:public,restricted'],
            'status'             => ['nullable', 'in:active,disabled'],
            'is_visible'         => ['sometimes', 'boolean'],
            'sort_order'         => ['nullable', 'integer', 'between:-9999,9999'],
        ];
        if ($creating) {
            $rules['name'] = array_merge(['required'], $rules['name']);
        } else {
            $rules['name'] = array_merge(['sometimes', 'required'], $rules['name']);
        }

        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $data = [];
        foreach (['name', 'description', 'embedding_model_id', 'visibility_scope', 'status', 'is_visible', 'sort_order'] as $field) {
            if ($request->has($field)) {
                $v = $request->input($field);
                if ($field === 'embedding_model_id' && ($v === '' || $v === 0)) {
                    $v = null;
                }
                if ($field === 'sort_order' && ($v === '' || $v === null)) {
                    $v = 0;
                }
                $data[$field] = $v;
            }
        }
        if ($creating) {
            if (!array_key_exists('status', $data)) {
                $data['status'] = KnowledgeBase::STATUS_ACTIVE;
            }
            if (!array_key_exists('is_visible', $data)) {
                $data['is_visible'] = true;
            }
            if (!array_key_exists('sort_order', $data)) {
                $data['sort_order'] = 0;
            }
        }
        return $data;
    }

    /**
     * 异步派发文档向量化（sync/database 双模，仿 MattingController）。
     */
    private function dispatchDocumentIndex(int $docId): void
    {
        KbDocument::where('id', $docId)->update([
            'index_status' => KbDocument::STATUS_PENDING,
            'index_error'  => '',
        ]);

        if (config('queue.default', 'sync') === 'sync') {
            app()->terminating(function () use ($docId) {
                @set_time_limit(0);
                try {
                    app()->call([new ReindexKnowledgeDocumentJob($docId), 'handle']);
                } catch (\Throwable $e) {
                    Log::warning('[KB] sync reindex failed', ['doc' => $docId, 'err' => $e->getMessage()]);
                }
            });
        } else {
            ReindexKnowledgeDocumentJob::dispatch($docId);
        }
    }

    private function buildStats(): array
    {
        return [
            'kb_count'      => KnowledgeBase::count(),
            'doc_count'     => KbDocument::count(),
            'chunk_count'   => KbChunk::count(),
            'indexed_count' => $this->safeIndexedCount(),
        ];
    }

    private function safeIndexedCount(): int
    {
        try {
            return app(VecStoreInterface::class)->count(null);
        } catch (\Throwable $e) {
            return 0;
        }
    }

    private function safeQdrantHealth(): array
    {
        try {
            return app(QdrantClient::class)->healthCheck();
        } catch (\Throwable $e) {
            return ['ok' => false, 'reason' => $e->getMessage()];
        }
    }

    private function availableModels(string $type): array
    {
        return CloudModel::query()
            ->join('cloud_providers as p', 'p.id', '=', 'cloud_models.provider_id')
            ->where('cloud_models.type', $type)
            ->where('cloud_models.status', 'active')
            ->where('p.status', 'active')
            ->orderBy('p.id')
            ->orderBy('cloud_models.id')
            ->get(['cloud_models.id', 'cloud_models.name', 'cloud_models.model_id', 'p.name as provider_name'])
            ->toArray();
    }
}
