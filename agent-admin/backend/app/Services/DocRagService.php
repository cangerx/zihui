<?php

namespace App\Services;

use App\Models\CloudModel;
use App\Models\Doc;
use App\Models\DocChatLog;
use App\Models\DocChunk;
use App\Models\SystemSetting;
use App\Services\Gateway\GatewayRouter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * 文档 RAG 服务：切片 + 嵌入 + 检索 + chat 流式回答
 *
 * 设计取舍：
 * - 直接用 GatewayRouter 拿 provider + credential（凭证池），调用 OpenAI 兼容上游
 *   （/embeddings 和 /chat/completions），不走 GatewayController（避免重写计费逻辑）
 * - 不计费：不调 deductBalance；不写 usage_records（避免污染主用量表）
 *   仅写 doc_chat_logs 用于审计 + admin 用量查询
 * - 流式 chat 用 curl + WRITEFUNCTION 转发 SSE，与 GatewayController::handleStreamChat 同模式
 * - 嵌入上游一次最多 50 条 input（防止单次请求过大），分批 dispatch
 * - 切换 embedding 模型后，admin 触发 reindexAll：先 DocVecService::dropAndRecreate()，
 *   再清 doc_chunks → 重新切片 → 重新嵌入
 */
class DocRagService
{
    /** 单批嵌入上限：分批调用上游 */
    private const EMBED_BATCH_SIZE = 50;
    /** 上游嵌入超时秒数 */
    private const EMBED_TIMEOUT = 60;
    /** 上游 chat 超时秒数（流式总时长） */
    private const CHAT_TIMEOUT = 180;

    public function __construct(
        private GatewayRouter $router,
        private DocChunkerService $chunker,
        private DocVecService $vec
    ) {}

    // =========================================================================
    // 切片 + 嵌入
    // =========================================================================

    /**
     * 单文档重新索引：删旧 chunk → 切片 → 嵌入 → 入库（MySQL doc_chunks + SQLite vec）
     *
     * @return array{chunks:int, indexed:int, model:string}
     * @throws \RuntimeException 当未配置 embedding 模型 / 上游错误
     */
    public function reindexDoc(int $docId): array
    {
        $doc = Doc::find($docId);
        if (!$doc) {
            throw new \RuntimeException("文档不存在：id={$docId}");
        }

        $modelId = (int) (SystemSetting::getValue('docs_embedding_model_id') ?: 0);
        if ($modelId <= 0) {
            throw new \RuntimeException('未配置向量模型，请先到「文档设置」选择 embedding 模型');
        }
        $cloudModel = CloudModel::with('provider')->find($modelId);
        if (!$cloudModel || $cloudModel->type !== 'embedding' || $cloudModel->status !== 'active') {
            throw new \RuntimeException('当前向量模型不可用，请检查 cloud_models 配置');
        }

        $chunkSize = (int) SystemSetting::getValue('docs_chunk_size');
        $overlap   = (int) SystemSetting::getValue('docs_chunk_overlap');
        $chunks    = $this->chunker->chunkHtml($doc->content_html ?? '', $chunkSize, $overlap);

        // 1. 清理旧索引（MySQL chunks 行 + SQLite 向量）
        $this->vec->deleteByDocId($docId);
        DocChunk::where('doc_id', $docId)->delete();

        if (empty($chunks)) {
            return ['chunks' => 0, 'indexed' => 0, 'model' => $cloudModel->model_id];
        }

        // 2. 入库 chunk_text（先建 chunk 行拿到 id，向量后写）
        $chunkIds = [];
        foreach ($chunks as $c) {
            $row = DocChunk::create([
                'doc_id'          => $docId,
                'chunk_idx'       => (int) $c['idx'],
                'chunk_text'      => (string) $c['text'],
                'embedding_model' => $cloudModel->model_id,
                'token_count'     => (int) $c['token_count'],
                'vec_indexed'     => false,
            ]);
            $chunkIds[$c['idx']] = $row->id;
        }

        // 3. 分批调用 embedding 上游
        $indexed = 0;
        $batches = array_chunk($chunks, self::EMBED_BATCH_SIZE);
        foreach ($batches as $batch) {
            $inputs = array_map(fn($c) => (string) $c['text'], $batch);
            $vectors = $this->embedUpstream($cloudModel, $inputs);
            foreach ($batch as $i => $c) {
                $vec = $vectors[$i] ?? null;
                if (!is_array($vec) || empty($vec)) continue;
                $cid = $chunkIds[$c['idx']] ?? null;
                if (!$cid) continue;
                $this->vec->upsert($cid, $vec, $cloudModel->model_id);
                DocChunk::where('id', $cid)->update(['vec_indexed' => true]);
                $indexed++;
            }
        }

        return [
            'chunks'  => count($chunks),
            'indexed' => $indexed,
            'model'   => $cloudModel->model_id,
        ];
    }

    /**
     * 全量重建：drop SQLite 表（避免维度残留）→ 清 doc_chunks → 逐文档重建
     * 同步执行，调用方自行决定是否包队列（admin 全量重建按钮 + 切模型时调）
     */
    public function reindexAll(): array
    {
        $this->vec->dropAndRecreate();
        DocChunk::truncate();

        $stats = ['docs' => 0, 'chunks' => 0, 'indexed' => 0, 'failed' => []];
        Doc::query()->orderBy('id')->chunkById(50, function ($docs) use (&$stats) {
            foreach ($docs as $doc) {
                try {
                    $r = $this->reindexDoc($doc->id);
                    $stats['docs']++;
                    $stats['chunks']  += $r['chunks'];
                    $stats['indexed'] += $r['indexed'];
                } catch (\Throwable $e) {
                    $stats['failed'][] = ['id' => $doc->id, 'title' => $doc->title, 'err' => $e->getMessage()];
                    Log::warning('[DocRag] reindex doc failed', [
                        'doc_id' => $doc->id,
                        'err'    => $e->getMessage(),
                    ]);
                }
            }
        });
        return $stats;
    }

    // =========================================================================
    // 检索
    // =========================================================================

    /**
     * 检索预览：admin 调试接口用，返回命中 chunk 列表
     *
     * @return array<int, array{chunk_id:int, doc_id:int, doc_title:string, distance:float, similarity:float, chunk_text:string}>
     */
    public function retrievePreview(string $query, int $topK = 0): array
    {
        $query = trim($query);
        if ($query === '') return [];

        $modelId = (int) (SystemSetting::getValue('docs_embedding_model_id') ?: 0);
        if ($modelId <= 0) return [];
        $cloudModel = CloudModel::with('provider')->find($modelId);
        if (!$cloudModel) return [];

        $vectors = $this->embedUpstream($cloudModel, [$query]);
        $queryVec = $vectors[0] ?? [];
        if (empty($queryVec)) return [];

        $topK = $topK > 0 ? $topK : (int) SystemSetting::getValue('docs_retrieve_top_k');
        if ($topK <= 0) $topK = 6;

        $minSim = (float) SystemSetting::getValue('docs_min_similarity');
        $maxDistance = $this->similarityToMaxDistance($minSim);

        $hits = $this->vec->search($queryVec, $topK, $cloudModel->model_id);
        if (empty($hits)) return [];

        $chunkIds = array_column($hits, 'chunk_id');
        $rows = DocChunk::query()
            ->whereIn('doc_chunks.id', $chunkIds)
            ->where('doc_chunks.embedding_model', $cloudModel->model_id)
            ->join('docs', 'docs.id', '=', 'doc_chunks.doc_id')
            ->where('docs.is_visible', true)
            ->get([
                'doc_chunks.id as chunk_id', 'doc_chunks.doc_id', 'doc_chunks.chunk_text',
                'docs.title as doc_title',
            ])
            ->keyBy('chunk_id');

        $result = [];
        foreach ($hits as $h) {
            if ($h['distance'] > $maxDistance) continue;
            $row = $rows->get($h['chunk_id']);
            if (!$row) continue;  // is_visible=false 时被过滤
            $result[] = [
                'chunk_id'   => (int) $row->chunk_id,
                'doc_id'     => (int) $row->doc_id,
                'doc_title'  => (string) $row->doc_title,
                'distance'   => (float) $h['distance'],
                'similarity' => $this->distanceToSimilarity((float) $h['distance']),
                'chunk_text' => (string) $row->chunk_text,
            ];
        }
        return $result;
    }

    // =========================================================================
    // 流式 Chat
    // =========================================================================

    /**
     * 流式问答：返回 Symfony StreamedResponse，由 Controller 直接 return
     *
     * 流协议（SSE，统一简化格式，不透传上游 OpenAI chunk）：
     *   data: {"citations":[{"index":1,"doc_id":12,"title":"...","slug":"..."},...]}  // 头部一次
     *   data: {"delta":"某段文本"}                                                  // 多次
     *   ...
     *   data: {"done":true}                                                       // 末尾一次
     *   data: {"error":"code","message":"..."}  + done                            // 错误路径
     *
     * 不透传上游原始 chunk，避免与后端追加事件两种格式混乱；WRITEFUNCTION 在
     * 解析到 delta.content 后立即 echo 简化事件，同时累计到 $accumulated 写日志。
     */
    public function chat(string $query, ?int $userId, string $sessionId): StreamedResponse
    {
        $startedAt = microtime(true);
        $query = trim($query);

        // 配置 + 模型校验
        $ragEnabled = (bool) SystemSetting::getValue('docs_rag_enabled');
        if (!$ragEnabled) {
            return $this->errorStream('rag_disabled', 'RAG 功能未启用');
        }

        $chatModelId = (int) (SystemSetting::getValue('docs_chat_model_id') ?: 0);
        $embedModelId = (int) (SystemSetting::getValue('docs_embedding_model_id') ?: 0);
        if ($chatModelId <= 0 || $embedModelId <= 0) {
            return $this->errorStream('model_not_configured', '尚未配置对话模型或向量模型，请联系管理员');
        }

        if ($query === '') {
            return $this->errorStream('empty_query', '问题不能为空');
        }
        if (mb_strlen($query, 'UTF-8') > 1000) {
            return $this->errorStream('query_too_long', '问题过长（最多 1000 字）');
        }

        // 嵌入 query
        try {
            $embedModel = CloudModel::with('provider')->find($embedModelId);
            if (!$embedModel) throw new \RuntimeException('embedding 模型不存在');
            $vectors = $this->embedUpstream($embedModel, [$query]);
            $queryVec = $vectors[0] ?? [];
            if (empty($queryVec)) throw new \RuntimeException('embedding 上游返回空向量');
        } catch (\Throwable $e) {
            $this->logChat($userId, $sessionId, $query, '', [], 0, 0, DocChatLog::STATUS_FAILED, 'embed: ' . $e->getMessage());
            return $this->errorStream('embed_failed', 'embedding 调用失败：' . $e->getMessage());
        }

        // KNN 检索
        $topK = (int) SystemSetting::getValue('docs_retrieve_top_k');
        $topK = $topK > 0 ? $topK : 6;
        $minSim = (float) SystemSetting::getValue('docs_min_similarity');
        $maxDistance = $this->similarityToMaxDistance($minSim);

        $hits = $this->vec->search($queryVec, $topK, $embedModel->model_id);
        $hits = array_values(array_filter($hits, fn($h) => $h['distance'] <= $maxDistance));

        // 反查 chunk + doc 元数据 + is_visible 过滤
        $chunkIds = array_column($hits, 'chunk_id');
        $matched = [];
        $citations = [];
        $citedDocIds = [];
        if (!empty($chunkIds)) {
            $rows = DocChunk::query()
                ->whereIn('doc_chunks.id', $chunkIds)
                ->join('docs', 'docs.id', '=', 'doc_chunks.doc_id')
                ->where('docs.is_visible', true)
                ->get([
                    'doc_chunks.id as chunk_id', 'doc_chunks.doc_id', 'doc_chunks.chunk_text',
                    'docs.title as doc_title', 'docs.slug as doc_slug',
                ])
                ->keyBy('chunk_id');

            $idx = 0;
            $seenDocIds = [];
            foreach ($hits as $h) {
                $row = $rows->get($h['chunk_id']);
                if (!$row) continue;
                $idx++;
                $matched[] = [
                    'idx'      => $idx,
                    'doc_id'   => (int) $row->doc_id,
                    'title'    => (string) $row->doc_title,
                    'text'     => (string) $row->chunk_text,
                    'distance' => (float) $h['distance'],
                ];
                if (!isset($seenDocIds[$row->doc_id])) {
                    $seenDocIds[$row->doc_id] = true;
                    $citations[] = [
                        'index'   => $idx,
                        'doc_id'  => (int) $row->doc_id,
                        'title'   => (string) $row->doc_title,
                        'slug'    => (string) ($row->doc_slug ?? ''),
                    ];
                    $citedDocIds[] = (int) $row->doc_id;
                }
            }
        }

        // 无命中：直接返回固定回答（不调 chat 模型，省钱）
        if (empty($matched)) {
            return $this->noMatchStream($userId, $sessionId, $query, $startedAt);
        }

        // 构造 prompt
        $context = '';
        foreach ($matched as $m) {
            $context .= "[{$m['idx']}] 来源文档：《{$m['title']}》\n{$m['text']}\n\n";
        }
        $systemPromptTpl = (string) SystemSetting::getValue('docs_system_prompt');
        $siteTitle = (string) SystemSetting::getValue('docs_site_title');
        $systemPrompt = strtr($systemPromptTpl, [
            '{site_title}' => $siteTitle,
            '{context}'    => $context,
            '{query}'      => $query,
        ]);

        $messages = [
            ['role' => 'system', 'content' => $systemPrompt],
            ['role' => 'user',   'content' => $query],
        ];

        // 调 chat 模型（流式）
        $chatModel = CloudModel::with('provider')->find($chatModelId);
        if (!$chatModel) {
            return $this->errorStream('chat_model_missing', '对话模型不存在');
        }

        return $this->streamChat($chatModel, $messages, [
            'user_id'      => $userId,
            'session_id'   => $sessionId,
            'query'        => $query,
            'citations'    => $citations,
            'cited_doc_ids' => $citedDocIds,
            'started_at'   => $startedAt,
        ]);
    }

    /**
     * 将 SSE 事件以统一格式输出。payload 是任意可 JSON 序列化的数组。
     * 集中一个出口可以统一控制输出编码 / 刷 buffer 逻辑。
     */
    private function emitSseEvent(array $payload): void
    {
        echo 'data: ' . json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
        if (ob_get_level() > 0) ob_flush();
        flush();
    }

    // =========================================================================
    // 上游调用 helpers
    // =========================================================================

    /**
     * 调用上游 /embeddings，返回向量数组列表
     *
     * @param CloudModel $cloudModel embedding 模型
     * @param array<string> $inputs 文本列表
     * @return array<int, array<float>>
     * @throws \RuntimeException 上游报错
     */
    private function embedUpstream(CloudModel $cloudModel, array $inputs): array
    {
        // 委托给共享 EmbeddingService（与知识库模块共用同一上游调用逻辑），行为不变
        return app(EmbeddingService::class)->embed($cloudModel, $inputs);
    }

    /**
     * 流式转发 chat 上游 SSE，结束后写 doc_chat_logs
     *
     * @param array{user_id:?int,session_id:string,query:string,citations:array,cited_doc_ids:array,started_at:float} $ctx
     */
    private function streamChat(CloudModel $cloudModel, array $messages, array $ctx): StreamedResponse
    {
        $route = $this->router->route($cloudModel);
        $url = rtrim((string) $route->provider->api_base, '/') . '/chat/completions';
        $body = [
            'model'    => $cloudModel->model_id,
            'messages' => $messages,
            'stream'   => true,
            'stream_options' => ['include_usage' => true],
        ];

        $self = $this;
        $logger = function (string $answer, int $totalTokens, string $status, ?string $err) use ($self, $ctx) {
            $latencyMs = (int) round((microtime(true) - $ctx['started_at']) * 1000);
            $self->logChat(
                $ctx['user_id'], $ctx['session_id'], $ctx['query'],
                $answer, $ctx['cited_doc_ids'], $latencyMs, $totalTokens, $status, $err
            );
        };

        return new StreamedResponse(function () use ($url, $route, $body, $ctx, $logger) {
            // 累计完整回答，用于审计日志
            $accumulated = '';
            $totalTokens = 0;

            // 头部先发 citations，让前端能在 delta 之前展示引用源
            $this->emitSseEvent(['citations' => $ctx['citations']]);

            $ch = curl_init($url);
            $self = $this;
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => json_encode($body),
                CURLOPT_HTTPHEADER     => [
                    'Content-Type: application/json',
                    'Authorization: Bearer ' . $route->apiKey,
                    'Accept: text/event-stream',
                ],
                CURLOPT_RETURNTRANSFER => false,
                CURLOPT_TIMEOUT        => self::CHAT_TIMEOUT,
                CURLOPT_WRITEFUNCTION  => function ($ch, $data) use (&$accumulated, &$totalTokens, $self) {
                    // 不透传上游 chunk；只解析 delta.content 后重新作为简化事件发出
                    $lines = explode("\n", $data);
                    foreach ($lines as $line) {
                        if (strpos($line, 'data: ') !== 0) continue;
                        $json = substr($line, 6);
                        if ($json === '[DONE]' || trim($json) === '') continue;
                        $parsed = json_decode($json, true);
                        if (!is_array($parsed)) continue;
                        $delta = $parsed['choices'][0]['delta']['content'] ?? null;
                        if (is_string($delta) && $delta !== '') {
                            $accumulated .= $delta;
                            $self->emitSseEvent(['delta' => $delta]);
                        }
                        if (isset($parsed['usage']['total_tokens'])) {
                            $totalTokens = (int) $parsed['usage']['total_tokens'];
                        }
                    }
                    return strlen($data);
                },
            ]);

            $ok = false;
            $errMsg = null;
            try {
                curl_exec($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                $curlErr  = curl_error($ch);
                $ok = ($httpCode >= 200 && $httpCode < 300 && $curlErr === '');
                if (!$ok) {
                    $errMsg = $curlErr ?: ('HTTP ' . $httpCode);
                }
            } catch (\Throwable $e) {
                $errMsg = $e->getMessage();
            } finally {
                curl_close($ch);
            }

            // 流末尾下发 done（错误时先发 error 再 done）
            if (!$ok) {
                $this->emitSseEvent(['error' => 'chat_upstream', 'message' => (string) $errMsg]);
            }
            $this->emitSseEvent(['done' => true]);

            // 记审计日志
            if ($ok) {
                $this->router->markCredentialSuccess($route->credential);
                $logger($accumulated, $totalTokens, DocChatLog::STATUS_SUCCESS, null);
            } else {
                $this->router->markCredentialFailure($route->credential, 'chat: ' . (string) $errMsg);
                $logger($accumulated, $totalTokens, DocChatLog::STATUS_FAILED, (string) $errMsg);
            }
        }, 200, [
            'Content-Type'      => 'text/event-stream; charset=utf-8',
            'Cache-Control'     => 'no-cache, no-store, must-revalidate',
            'Connection'        => 'keep-alive',
            'X-Accel-Buffering' => 'no',  // Nginx 禁用 buffer，确保流式即时下发
        ]);
    }

    /**
     * 没有命中文档时的固定流式回答（不调上游模型）
     */
    private function noMatchStream(?int $userId, string $sessionId, string $query, float $startedAt): StreamedResponse
    {
        return new StreamedResponse(function () use ($userId, $sessionId, $query, $startedAt) {
            $reply = '抱歉，文档中未找到相关信息。';
            // 与 streamChat 同格式：先 citations（空）→ delta → done
            $this->emitSseEvent(['citations' => []]);
            $this->emitSseEvent(['delta' => $reply]);
            $this->emitSseEvent(['done' => true]);

            $latencyMs = (int) round((microtime(true) - $startedAt) * 1000);
            $this->logChat($userId, $sessionId, $query, $reply, [], $latencyMs, 0, DocChatLog::STATUS_NO_MATCH, null);
        }, 200, [
            'Content-Type'      => 'text/event-stream; charset=utf-8',
            'Cache-Control'     => 'no-cache, no-store, must-revalidate',
            'Connection'        => 'keep-alive',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * 错误情形的流式响应（统一格式，前端识别 error 字段 + done）
     */
    private function errorStream(string $code, string $message): StreamedResponse
    {
        return new StreamedResponse(function () use ($code, $message) {
            $this->emitSseEvent(['error' => $code, 'message' => $message]);
            $this->emitSseEvent(['done' => true]);
        }, 200, [
            'Content-Type'      => 'text/event-stream; charset=utf-8',
            'Cache-Control'     => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * 写问答审计日志（doc_chat_logs）
     */
    public function logChat(?int $userId, string $sessionId, string $query, string $answer, array $citedDocIds, int $latencyMs, int $totalTokens, string $status, ?string $err): void
    {
        try {
            DocChatLog::create([
                'user_id'       => $userId,
                'session_id'    => substr($sessionId, 0, 64),
                'query'         => mb_substr($query, 0, 5000, 'UTF-8'),
                'answer'        => $answer,
                'cited_doc_ids' => array_values(array_unique($citedDocIds)),
                'latency_ms'    => $latencyMs,
                'total_tokens'  => $totalTokens,
                'status'        => $status,
                'error'         => $err ? mb_substr($err, 0, 500, 'UTF-8') : null,
            ]);
        } catch (\Throwable $e) {
            Log::warning('[DocRag] write chat log failed', ['err' => $e->getMessage()]);
        }
    }

    // =========================================================================
    // 距离 / 相似度转换
    // =========================================================================

    /**
     * 把 cosine 相似度阈值转成 distance 截断值（DocVecService 返回的 distance）
     *   - vec0 模式：归一化向量的 L2 距离 d，cosine_similarity = 1 - d²/2
     *     → max_d = sqrt(2 * (1 - min_sim))
     *   - fallback 模式：cosine_distance = 1 - cosine_similarity
     *     → max_d = 1 - min_sim
     */
    private function similarityToMaxDistance(float $minSimilarity): float
    {
        $minSim = max(0.0, min(1.0, $minSimilarity));
        if ($this->vec->mode() === 'vec0') {
            return sqrt(max(0.0, 2.0 * (1.0 - $minSim)));
        }
        return 1.0 - $minSim;
    }

    /**
     * distance → similarity（仅展示用）
     */
    private function distanceToSimilarity(float $distance): float
    {
        if ($this->vec->mode() === 'vec0') {
            $sim = 1.0 - ($distance * $distance) / 2.0;
        } else {
            $sim = 1.0 - $distance;
        }
        return round(max(0.0, min(1.0, $sim)), 4);
    }
}
