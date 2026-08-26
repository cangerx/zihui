<?php

namespace App\Services\Knowledge;

use App\Models\CloudModel;
use App\Models\KbChunk;
use App\Models\KbDocument;
use App\Models\KnowledgeBase;
use App\Models\SystemSetting;
use App\Services\DocChunkerService;
use App\Services\EmbeddingService;
use Illuminate\Support\Facades\Log;

/**
 * 知识库 RAG 服务：切片 + 嵌入（Qdrant 写入）+ hybrid 检索（向量 + 关键词 RRF）。
 *
 * 设计取舍：
 * - 复用 DocChunkerService 切片与 EmbeddingService 上游嵌入（与文档中心同引擎）
 * - 向量存 Qdrant（VecStoreInterface），point id = kb_chunks.id，payload kb_id/document_id
 * - 检索 = 向量召回（按 kb_id 过滤）+ MySQL FULLTEXT 关键词召回，RRF 融合后取 topK
 * - 不计费、不写 usage（与文档 RAG 行为一致；如需计费在 Controller 层另行处理）
 */
class KbRagService
{
    /** RRF 融合常数 */
    private const RRF_K = 60;

    public function __construct(
        private EmbeddingService $embedder,
        private DocChunkerService $chunker,
        private VecStoreInterface $vec
    ) {}

    // =========================================================================
    // 索引
    // =========================================================================

    /**
     * 单文档重建索引：切片 → 写 kb_chunks → 嵌入 → 写 Qdrant。
     *
     * @return array{chunks:int, indexed:int, model:string}
     */
    public function reindexDocument(int $docId): array
    {
        $doc = KbDocument::find($docId);
        if (!$doc) {
            throw new \RuntimeException("文档不存在：id={$docId}");
        }
        $kb = KnowledgeBase::find($doc->kb_id);
        if (!$kb) {
            throw new \RuntimeException("知识库不存在：id={$doc->kb_id}");
        }

        $doc->update(['index_status' => KbDocument::STATUS_PROCESSING, 'index_error' => '']);

        try {
            $cloudModel = $this->resolveEmbeddingModel($kb);

            $chunkSize = (int) SystemSetting::getValue('kb_chunk_size') ?: 800;
            $overlap = (int) SystemSetting::getValue('kb_chunk_overlap') ?: 100;
            $chunks = $this->chunker->chunkHtml((string) $doc->content_html, $chunkSize, $overlap);

            // 清旧索引（Qdrant 向量 + MySQL chunk 行）
            $this->vec->deleteByDocument($docId);
            KbChunk::where('document_id', $docId)->delete();

            if (empty($chunks)) {
                $doc->update(['index_status' => KbDocument::STATUS_READY, 'chunk_count' => 0]);
                $this->recountKb($kb->id);
                return ['chunks' => 0, 'indexed' => 0, 'model' => $cloudModel->model_id];
            }

            // 先建 chunk 行拿到 id（向量随后写）
            $chunkIds = [];
            foreach ($chunks as $c) {
                $row = KbChunk::create([
                    'kb_id' => $kb->id,
                    'document_id' => $docId,
                    'chunk_idx' => (int) $c['idx'],
                    'chunk_text' => (string) $c['text'],
                    'embedding_model' => $cloudModel->model_id,
                    'token_count' => (int) $c['token_count'],
                    'vec_indexed' => false,
                ]);
                $chunkIds[$c['idx']] = $row->id;
            }

            // 分批嵌入 + 写 Qdrant
            $indexed = 0;
            $ensured = false;
            $batches = array_chunk($chunks, EmbeddingService::EMBED_BATCH_SIZE);
            foreach ($batches as $batch) {
                $batch = array_values($batch);
                $inputs = array_map(fn ($c) => (string) $c['text'], $batch);
                $vectors = $this->embedder->embed($cloudModel, $inputs);

                $items = [];
                foreach ($batch as $i => $c) {
                    $vec = $vectors[$i] ?? null;
                    if (!is_array($vec) || empty($vec)) {
                        continue;
                    }
                    if (!$ensured) {
                        $this->vec->ensureCollection(count($vec));
                        $ensured = true;
                    }
                    $cid = $chunkIds[$c['idx']] ?? null;
                    if (!$cid) {
                        continue;
                    }
                    $items[] = [
                        'chunk_id' => $cid,
                        'embedding' => $vec,
                        'kb_id' => $kb->id,
                        'document_id' => $docId,
                    ];
                }
                if (!empty($items)) {
                    $n = $this->vec->upsertBatch($items);
                    KbChunk::whereIn('id', array_column($items, 'chunk_id'))->update(['vec_indexed' => true]);
                    $indexed += $n;
                }
            }

            $doc->update(['index_status' => KbDocument::STATUS_READY, 'chunk_count' => count($chunks)]);
            $this->recountKb($kb->id);

            return ['chunks' => count($chunks), 'indexed' => $indexed, 'model' => $cloudModel->model_id];
        } catch (\Throwable $e) {
            $doc->update([
                'index_status' => KbDocument::STATUS_FAILED,
                'index_error' => mb_substr($e->getMessage(), 0, 500, 'UTF-8'),
            ]);
            throw $e;
        }
    }

    /**
     * 重建某知识库全部文档。
     *
     * @return array{docs:int, chunks:int, indexed:int, failed:array}
     */
    public function reindexKnowledgeBase(int $kbId): array
    {
        $stats = ['docs' => 0, 'chunks' => 0, 'indexed' => 0, 'failed' => []];
        KbDocument::where('kb_id', $kbId)->orderBy('id')->chunkById(50, function ($docs) use (&$stats) {
            foreach ($docs as $doc) {
                try {
                    $r = $this->reindexDocument($doc->id);
                    $stats['docs']++;
                    $stats['chunks'] += $r['chunks'];
                    $stats['indexed'] += $r['indexed'];
                } catch (\Throwable $e) {
                    $stats['failed'][] = ['id' => $doc->id, 'title' => $doc->title, 'err' => $e->getMessage()];
                    Log::warning('[KbRag] reindex doc failed', ['doc_id' => $doc->id, 'err' => $e->getMessage()]);
                }
            }
        });
        return $stats;
    }

    /**
     * 删除文档的向量（Controller 删除文档时调，保证 Qdrant 一致性）。
     */
    public function purgeDocumentVectors(int $docId): void
    {
        $this->vec->deleteByDocument($docId);
    }

    /**
     * 删除知识库的全部向量（Controller 删除知识库时调）。
     */
    public function purgeKnowledgeBaseVectors(int $kbId): void
    {
        $this->vec->deleteByKb($kbId);
    }

    /**
     * 重算知识库的 doc/chunk 计数缓存。
     */
    public function recountKb(int $kbId): void
    {
        $docCount = KbDocument::where('kb_id', $kbId)->count();
        $chunkCount = KbChunk::where('kb_id', $kbId)->count();
        KnowledgeBase::where('id', $kbId)->update([
            'doc_count' => $docCount,
            'chunk_count' => $chunkCount,
        ]);
    }

    // =========================================================================
    // 检索
    // =========================================================================

    /**
     * hybrid 检索：向量 + 关键词 RRF 融合，返回片段列表。
     *
     * @param array<int> $kbIds 限定知识库
     * @return array<int, array{chunk_id:int, kb_id:int, kb_name:string, document_id:int, doc_title:string, score:float, chunk_text:string}>
     */
    public function retrieve(string $query, array $kbIds, int $topK = 0, ?float $minSim = null): array
    {
        $query = trim($query);
        $kbIds = array_values(array_unique(array_map('intval', $kbIds)));
        if ($query === '' || empty($kbIds)) {
            return [];
        }

        $kb = KnowledgeBase::whereIn('id', $kbIds)->first();
        if (!$kb) {
            return [];
        }

        if ($topK <= 0) {
            $topK = (int) SystemSetting::getValue('kb_retrieve_top_k') ?: 6;
        }
        if ($topK <= 0) {
            $topK = 6;
        }
        if ($minSim === null) {
            $minSim = (float) SystemSetting::getValue('kb_min_similarity');
        }

        // 向量召回
        $vectorHits = [];
        try {
            $cloudModel = $this->resolveEmbeddingModel($kb);
            $queryVec = $this->embedder->embedOne($cloudModel, $query);
            if (!empty($queryVec)) {
                $vectorHits = $this->vec->search($queryVec, $topK * 2, $kbIds, $minSim > 0 ? $minSim : null);
            }
        } catch (\Throwable $e) {
            Log::warning('[KbRag] vector search failed', ['err' => $e->getMessage()]);
        }

        // 关键词召回（hybrid）
        $keywordHits = [];
        if ((bool) SystemSetting::getValue('kb_hybrid_enabled')) {
            $keywordHits = $this->keywordSearch($query, $kbIds, $topK * 2);
        }

        $ranked = $this->rrfMerge($vectorHits, $keywordHits, $topK);
        if (empty($ranked)) {
            return [];
        }

        $chunkIds = array_keys($ranked);
        $rows = KbChunk::query()
            ->whereIn('kb_chunks.id', $chunkIds)
            ->join('kb_documents', 'kb_documents.id', '=', 'kb_chunks.document_id')
            ->join('knowledge_bases', 'knowledge_bases.id', '=', 'kb_chunks.kb_id')
            ->get([
                'kb_chunks.id as chunk_id',
                'kb_chunks.kb_id',
                'kb_chunks.document_id',
                'kb_chunks.chunk_text',
                'kb_documents.title as doc_title',
                'knowledge_bases.name as kb_name',
            ])
            ->keyBy('chunk_id');

        $result = [];
        foreach ($ranked as $cid => $info) {
            $row = $rows->get($cid);
            if (!$row) {
                continue;
            }
            $result[] = [
                'chunk_id' => (int) $row->chunk_id,
                'kb_id' => (int) $row->kb_id,
                'kb_name' => (string) $row->kb_name,
                'document_id' => (int) $row->document_id,
                'doc_title' => (string) $row->doc_title,
                'score' => round((float) $info['score'], 4),
                'chunk_text' => (string) $row->chunk_text,
            ];
        }
        return $result;
    }

    // =========================================================================
    // helpers
    // =========================================================================

    private function resolveEmbeddingModel(KnowledgeBase $kb): CloudModel
    {
        $modelId = (int) ($kb->embedding_model_id ?: 0);
        if ($modelId <= 0) {
            $modelId = (int) (SystemSetting::getValue('kb_embedding_model_id') ?: 0);
        }
        return $this->embedder->resolveActiveModel($modelId);
    }

    /**
     * MySQL FULLTEXT 关键词检索，返回有序 chunk_id 列表。
     *
     * @return array<int, int>
     */
    private function keywordSearch(string $query, array $kbIds, int $limit): array
    {
        try {
            $rows = KbChunk::query()
                ->whereIn('kb_id', $kbIds)
                ->whereRaw('MATCH(chunk_text) AGAINST(? IN NATURAL LANGUAGE MODE)', [$query])
                ->orderByRaw('MATCH(chunk_text) AGAINST(? IN NATURAL LANGUAGE MODE) DESC', [$query])
                ->limit($limit)
                ->pluck('id')
                ->all();
            return array_map('intval', $rows);
        } catch (\Throwable $e) {
            // FULLTEXT 不可用时降级为纯向量
            return [];
        }
    }

    /**
     * RRF 融合：综合向量与关键词两路排名。
     *
     * @param array<int, array{chunk_id:int, score:float}> $vectorHits
     * @param array<int, int> $keywordHits
     * @return array<int, array{rrf:float, score:float}> 按 rrf 降序，最多 topK
     */
    private function rrfMerge(array $vectorHits, array $keywordHits, int $topK): array
    {
        $rrf = [];
        $sim = [];

        foreach (array_values($vectorHits) as $rank => $h) {
            $cid = (int) $h['chunk_id'];
            if ($cid <= 0) {
                continue;
            }
            $rrf[$cid] = ($rrf[$cid] ?? 0) + 1.0 / (self::RRF_K + $rank + 1);
            $sim[$cid] = (float) ($h['score'] ?? 0);
        }
        foreach (array_values($keywordHits) as $rank => $cid) {
            $cid = (int) $cid;
            if ($cid <= 0) {
                continue;
            }
            $rrf[$cid] = ($rrf[$cid] ?? 0) + 1.0 / (self::RRF_K + $rank + 1);
        }

        arsort($rrf);
        $out = [];
        foreach ($rrf as $cid => $score) {
            $out[$cid] = ['rrf' => $score, 'score' => $sim[$cid] ?? $score];
            if (count($out) >= $topK) {
                break;
            }
        }
        return $out;
    }
}
