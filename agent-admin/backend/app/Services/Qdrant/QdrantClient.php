<?php

namespace App\Services\Qdrant;

use App\Models\SystemSetting;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Qdrant 向量数据库 HTTP 客户端（REST API）。
 *
 * 仅封装底层 collection / points 操作，业务语义（kb 过滤、归一化阈值）在 QdrantVecService。
 * 连接信息读 config/qdrant.php；开启鉴权时带 header api-key。
 */
class QdrantClient
{
    public function baseUrl(): string
    {
        // 连接地址来自云控端「知识库设置」（SystemSetting），不走 .env
        return rtrim((string) SystemSetting::getRawValue('kb_qdrant_url', ''), '/');
    }

    private function apiKey(): string
    {
        // 加密存储，解密后用于请求头 api-key
        return (string) SystemSetting::getRawValue('kb_qdrant_api_key', '');
    }

    public function isReady(): bool
    {
        return $this->baseUrl() !== '';
    }

    private function client(): PendingRequest
    {
        if (!$this->isReady()) {
            throw new RuntimeException('qdrant_not_configured');
        }
        $req = Http::acceptJson()
            ->timeout((int) config('qdrant.timeout', 20))
            ->connectTimeout((int) config('qdrant.connect_timeout', 5));
        $key = $this->apiKey();
        if ($key !== '') {
            $req = $req->withHeaders(['api-key' => $key]);
        }
        return $req;
    }

    public function collectionExists(string $collection): bool
    {
        try {
            $resp = $this->client()->get($this->baseUrl() . "/collections/{$collection}");
            return $resp->successful();
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * 幂等创建 collection（已存在则跳过），并为 kb_id / document_id 建 payload 索引以加速过滤删除。
     */
    public function ensureCollection(string $collection, int $dim, string $distance = 'Cosine'): void
    {
        if ($dim <= 0) {
            throw new RuntimeException('qdrant: invalid vector dim');
        }
        if ($this->collectionExists($collection)) {
            return;
        }
        $resp = $this->client()->put($this->baseUrl() . "/collections/{$collection}", [
            'vectors' => ['size' => $dim, 'distance' => $distance],
        ]);
        $this->assertOk($resp, 'create_collection');

        foreach (['kb_id', 'document_id'] as $field) {
            try {
                $this->client()->put($this->baseUrl() . "/collections/{$collection}/index?wait=true", [
                    'field_name' => $field,
                    'field_schema' => 'integer',
                ]);
            } catch (\Throwable $e) {
                // 索引建立失败不致命（仍可全表过滤），忽略
            }
        }
    }

    public function dropCollection(string $collection): void
    {
        try {
            $this->client()->delete($this->baseUrl() . "/collections/{$collection}");
        } catch (\Throwable $e) {
            // 删除不存在的 collection 忽略
        }
    }

    /**
     * @param array<int, array{id:int, vector:array<float>, payload:array}> $points
     */
    public function upsertPoints(string $collection, array $points): void
    {
        if (empty($points)) {
            return;
        }
        $resp = $this->client()->put($this->baseUrl() . "/collections/{$collection}/points?wait=true", [
            'points' => array_values($points),
        ]);
        $this->assertOk($resp, 'upsert_points');
    }

    /**
     * KNN 检索，返回 Qdrant 原始 result 数组（含 id / score / payload）。
     *
     * @return array<int, array{id:mixed, score:float, payload:array}>
     */
    public function search(string $collection, array $vector, int $limit, ?array $filter = null, ?float $scoreThreshold = null): array
    {
        $body = [
            'vector' => array_values($vector),
            'limit' => max(1, $limit),
            'with_payload' => true,
        ];
        if (!empty($filter)) {
            $body['filter'] = $filter;
        }
        if ($scoreThreshold !== null) {
            $body['score_threshold'] = $scoreThreshold;
        }
        $resp = $this->client()->post($this->baseUrl() . "/collections/{$collection}/points/search", $body);
        $this->assertOk($resp, 'search');
        return $resp->json('result') ?? [];
    }

    public function deleteByFilter(string $collection, array $filter): void
    {
        if (empty($filter)) {
            return;
        }
        $resp = $this->client()->post($this->baseUrl() . "/collections/{$collection}/points/delete?wait=true", [
            'filter' => $filter,
        ]);
        $this->assertOk($resp, 'delete_by_filter');
    }

    public function deleteByIds(string $collection, array $ids): void
    {
        if (empty($ids)) {
            return;
        }
        $resp = $this->client()->post($this->baseUrl() . "/collections/{$collection}/points/delete?wait=true", [
            'points' => array_values(array_map('intval', $ids)),
        ]);
        $this->assertOk($resp, 'delete_by_ids');
    }

    public function countPoints(string $collection, ?array $filter = null): int
    {
        if (!$this->collectionExists($collection)) {
            return 0;
        }
        $body = ['exact' => true];
        if (!empty($filter)) {
            $body['filter'] = $filter;
        }
        try {
            $resp = $this->client()->post($this->baseUrl() . "/collections/{$collection}/points/count", $body);
            if (!$resp->successful()) {
                return 0;
            }
            return (int) ($resp->json('result.count') ?? 0);
        } catch (\Throwable $e) {
            return 0;
        }
    }

    public function healthCheck(): array
    {
        if (!$this->isReady()) {
            return ['ok' => false, 'reason' => 'not_configured'];
        }
        try {
            $resp = $this->client()->get($this->baseUrl() . '/healthz');
            if ($resp->successful()) {
                return ['ok' => true];
            }
            // 老版本无 /healthz，回退根路径
            $root = $this->client()->get($this->baseUrl() . '/');
            return ['ok' => $root->successful(), 'status' => $root->status()];
        } catch (\Throwable $e) {
            return ['ok' => false, 'reason' => $e->getMessage()];
        }
    }

    private function assertOk(Response $resp, string $op): void
    {
        if (!$resp->successful()) {
            throw new RuntimeException("qdrant {$op} failed: HTTP " . $resp->status() . ' ' . substr((string) $resp->body(), 0, 300));
        }
    }
}
