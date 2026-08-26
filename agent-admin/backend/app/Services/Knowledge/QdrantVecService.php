<?php

namespace App\Services\Knowledge;

use App\Models\SystemSetting;
use App\Services\Qdrant\QdrantClient;

/**
 * 基于 Qdrant 的知识库向量存储实现。
 *
 * - 单 collection（config qdrant.collection），所有知识库共用，按 payload kb_id 过滤隔离
 * - distance=Cosine，search 返回 score 越大越相似（OpenAI embedding 已归一化）
 * - 删除支持按 kb_id / document_id payload filter，避免残留
 */
class QdrantVecService implements VecStoreInterface
{
    public function __construct(private QdrantClient $client) {}

    private function collection(): string
    {
        // collection 名来自「知识库设置」；为空回退 config 默认
        $name = trim((string) SystemSetting::getValue('kb_qdrant_collection'));
        return $name !== '' ? $name : (string) config('qdrant.default_collection', 'kb_chunks');
    }

    private function distance(): string
    {
        return (string) config('qdrant.distance', 'Cosine');
    }

    public function ensureCollection(int $dim): void
    {
        $this->client->ensureCollection($this->collection(), $dim, $this->distance());
    }

    public function upsert(int $chunkId, array $embedding, int $kbId, int $documentId): void
    {
        if (empty($embedding)) {
            return;
        }
        $this->client->upsertPoints($this->collection(), [[
            'id' => $chunkId,
            'vector' => array_map('floatval', $embedding),
            'payload' => ['kb_id' => $kbId, 'document_id' => $documentId],
        ]]);
    }

    public function upsertBatch(array $items): int
    {
        $points = [];
        foreach ($items as $it) {
            $embedding = $it['embedding'] ?? [];
            if (empty($embedding)) {
                continue;
            }
            $points[] = [
                'id' => (int) $it['chunk_id'],
                'vector' => array_map('floatval', $embedding),
                'payload' => [
                    'kb_id' => (int) ($it['kb_id'] ?? 0),
                    'document_id' => (int) ($it['document_id'] ?? 0),
                ],
            ];
        }
        if (empty($points)) {
            return 0;
        }
        $this->client->upsertPoints($this->collection(), $points);
        return count($points);
    }

    public function search(array $queryEmbedding, int $topK, array $kbIds = [], ?float $minScore = null): array
    {
        if (empty($queryEmbedding)) {
            return [];
        }
        $filter = null;
        if (!empty($kbIds)) {
            $filter = [
                'must' => [[
                    'key' => 'kb_id',
                    'match' => ['any' => array_values(array_map('intval', $kbIds))],
                ]],
            ];
        }
        $rows = $this->client->search($this->collection(), $queryEmbedding, $topK, $filter, $minScore);
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                'chunk_id' => (int) ($r['id'] ?? 0),
                'score' => (float) ($r['score'] ?? 0),
                'kb_id' => (int) ($r['payload']['kb_id'] ?? 0),
                'document_id' => (int) ($r['payload']['document_id'] ?? 0),
            ];
        }
        return $out;
    }

    public function deleteByKb(int $kbId): void
    {
        $this->client->deleteByFilter($this->collection(), [
            'must' => [['key' => 'kb_id', 'match' => ['value' => $kbId]]],
        ]);
    }

    public function deleteByDocument(int $documentId): void
    {
        $this->client->deleteByFilter($this->collection(), [
            'must' => [['key' => 'document_id', 'match' => ['value' => $documentId]]],
        ]);
    }

    public function deleteByChunkIds(array $chunkIds): void
    {
        $this->client->deleteByIds($this->collection(), $chunkIds);
    }

    public function count(?int $kbId = null): int
    {
        $filter = $kbId ? ['must' => [['key' => 'kb_id', 'match' => ['value' => $kbId]]]] : null;
        return $this->client->countPoints($this->collection(), $filter);
    }
}
