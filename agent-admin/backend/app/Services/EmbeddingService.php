<?php

namespace App\Services;

use App\Models\CloudModel;
use App\Services\Gateway\GatewayRouter;
use Illuminate\Support\Facades\Http;

/**
 * 通用 Embedding 服务：把文本经凭证池路由到 OpenAI 兼容上游 /embeddings。
 *
 * 从 DocRagService::embedUpstream 抽取，供「文档 RAG」与「知识库」共用：
 * - 不计费、不写 usage_records（与文档 RAG 行为一致）
 * - 凭证成功/失败回调维护凭证池状态
 * - 单批最多 EMBED_BATCH_SIZE 条，超出由调用方分批
 */
class EmbeddingService
{
    /** 单批嵌入上限：调用方据此分批 */
    public const EMBED_BATCH_SIZE = 50;
    /** 上游嵌入超时秒数 */
    private const EMBED_TIMEOUT = 60;

    public function __construct(private GatewayRouter $router) {}

    /**
     * 校验并返回一个可用的 embedding CloudModel（含 provider）。
     *
     * @throws \RuntimeException 未配置 / 不可用
     */
    public function resolveActiveModel(int $modelId): CloudModel
    {
        if ($modelId <= 0) {
            throw new \RuntimeException('未配置向量模型，请先在「知识库设置」选择 embedding 模型');
        }
        $model = CloudModel::with('provider')->find($modelId);
        if (!$model || $model->type !== 'embedding' || $model->status !== 'active') {
            throw new \RuntimeException('当前向量模型不可用，请检查 cloud_models 配置');
        }
        return $model;
    }

    /**
     * 批量嵌入：返回与 inputs 顺序对应的向量列表。
     *
     * @param array<string> $inputs
     * @return array<int, array<float>>
     * @throws \RuntimeException 上游报错
     */
    public function embed(CloudModel $cloudModel, array $inputs): array
    {
        if (empty($inputs)) {
            return [];
        }

        $route = $this->router->route($cloudModel);
        $url = rtrim((string) $route->provider->api_base, '/') . '/embeddings';
        $body = [
            'model' => $cloudModel->model_id,
            'input' => count($inputs) === 1 ? $inputs[0] : array_values($inputs),
        ];

        try {
            $resp = Http::withToken((string) $route->apiKey)
                ->timeout(self::EMBED_TIMEOUT)
                ->retry(2, 200, throw: false)
                ->post($url, $body);
        } catch (\Throwable $e) {
            $this->router->markCredentialFailure($route->credential, 'embed: ' . $e->getMessage());
            throw new \RuntimeException('embedding 网络错误：' . $e->getMessage());
        }

        if (!$resp->successful()) {
            $this->router->markCredentialFailure($route->credential, 'embed http ' . $resp->status());
            throw new \RuntimeException('embedding 上游错误：HTTP ' . $resp->status() . ' ' . substr((string) $resp->body(), 0, 200));
        }

        $this->router->markCredentialSuccess($route->credential);

        $data = $resp->json('data') ?? [];
        $vectors = [];
        foreach ($data as $row) {
            $vec = $row['embedding'] ?? null;
            if (is_array($vec)) {
                $vectors[(int) ($row['index'] ?? count($vectors))] = array_map('floatval', $vec);
            }
        }
        ksort($vectors);
        return array_values($vectors);
    }

    /**
     * 单条文本嵌入，返回一维向量（失败抛异常，空结果返回 []）。
     *
     * @return array<float>
     */
    public function embedOne(CloudModel $cloudModel, string $text): array
    {
        $vectors = $this->embed($cloudModel, [$text]);
        return $vectors[0] ?? [];
    }
}
