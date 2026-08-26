<?php

namespace App\Services\Knowledge;

/**
 * 知识库向量存储抽象。
 *
 * 默认实现 QdrantVecService（专用向量库），后续可替换为其它后端（pgvector / Milvus）
 * 而不影响 KbRagService。point id 统一用 MySQL kb_chunks.id（跨库主键），
 * payload 携带 kb_id / document_id 以支持多库过滤与级联删除。
 */
interface VecStoreInterface
{
    /** 幂等确保底层集合存在（维度由全局 embedding 模型决定） */
    public function ensureCollection(int $dim): void;

    /** 写入/覆盖单条向量 */
    public function upsert(int $chunkId, array $embedding, int $kbId, int $documentId): void;

    /**
     * 批量写入。
     *
     * @param array<int, array{chunk_id:int, embedding:array<float>, kb_id:int, document_id:int}> $items
     * @return int 实际写入条数
     */
    public function upsertBatch(array $items): int;

    /**
     * KNN 检索（可按知识库集合过滤）。
     *
     * @param array<float> $queryEmbedding
     * @param array<int> $kbIds 限定的知识库 id 列表（空 = 全部）
     * @param float|null $minScore 余弦相似度下限（越大越相似）
     * @return array<int, array{chunk_id:int, score:float, kb_id:int, document_id:int}>
     */
    public function search(array $queryEmbedding, int $topK, array $kbIds = [], ?float $minScore = null): array;

    /** 删除某知识库的全部向量 */
    public function deleteByKb(int $kbId): void;

    /** 删除某文档的全部向量 */
    public function deleteByDocument(int $documentId): void;

    /** 按 chunk id 列表删除 */
    public function deleteByChunkIds(array $chunkIds): void;

    /** 统计向量条数（可按知识库过滤） */
    public function count(?int $kbId = null): int;
}
