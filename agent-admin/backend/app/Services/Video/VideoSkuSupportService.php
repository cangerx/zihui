<?php

namespace App\Services\Video;

use App\Models\VideoModelSpec;
use App\Models\VideoSkuPrice;

/**
 * 视频 SKU / 生成参数 支持性校验（L2 计费维度模型）。
 *
 * SKU 只锁定「计费维度」（非空字段），未锁定（空）的维度由用户生成时自选；
 * 因此校验拆为两步：
 *   - assertSkuSupported：SKU 锁定的维度必须在模型能力内（后台保存 + 提交时复核）
 *   - assertGenerationParams：合并后的最终生成参数（含自选维度）必须在模型能力内
 * 空值代表「不约束/由后续步骤决定」，统一跳过。
 */
class VideoSkuSupportService
{
    public function assertSkuSupported(VideoSkuPrice $sku): void
    {
        $spec = $sku->modelSpec;
        if (!$spec) {
            throw new \InvalidArgumentException('视频模型不存在');
        }
        $this->assertValueSupported('生成模式', (string) $sku->mode, $spec->supported_modes);
        $this->assertDurationSupported((int) $sku->duration_seconds, $spec->supported_durations);
        $this->assertValueSupported('清晰度', (string) $sku->resolution, $spec->supported_resolutions);
        $this->assertValueSupported('画面比例', (string) $sku->aspect_ratio, $spec->supported_aspect_ratios);
    }

    public function assertGenerationParams(VideoModelSpec $spec, array $params): void
    {
        $this->assertValueSupported('生成模式', (string) ($params['mode'] ?? ''), $spec->supported_modes);
        $this->assertDurationSupported((int) ($params['duration'] ?? 0), $spec->supported_durations);
        $this->assertValueSupported('清晰度', (string) ($params['resolution'] ?? ''), $spec->supported_resolutions);
        $this->assertValueSupported('画面比例', (string) ($params['aspect_ratio'] ?? ''), $spec->supported_aspect_ratios);
    }

    public function assertAssetsSupported(VideoModelSpec $spec, array $assets): void
    {
        $images = $this->assetsByType($assets, 'image');
        $videos = $this->assetsByType($assets, 'video');
        $audios = $this->assetsByType($assets, 'audio');

        // 参考素材白名单按模型能力驱动（不再硬编码协议名）：
        //   - seedance / wan：图/视频/音频全放行
        //   - 其它协议：默认仅图片；provider_params.ref_media 显式声明才放行视频/音频
        //     （cang-api 走 openai_video，靠 ref_media=["image","video"] 开放视频参考）
        $allowed = $this->allowedRefMedia($spec);
        if (count($videos) > 0 && !in_array('video', $allowed, true)) {
            throw new \InvalidArgumentException('当前模型不支持视频参考素材');
        }
        if (count($audios) > 0 && !in_array('audio', $allowed, true)) {
            throw new \InvalidArgumentException('当前模型不支持音频参考素材');
        }
        $maxImages = (int) ($spec->max_reference_images ?? 0);
        if ($maxImages > 0 && count($images) > $maxImages) {
            throw new \InvalidArgumentException('参考图数量超过当前模型限制（最多 ' . $maxImages . ' 张）');
        }
    }

    /**
     * 模型允许的参考素材类型白名单。
     * seedance / wan 全放行图视频音频；其它协议默认仅图片，可由 provider_params.ref_media 扩展。
     * 公开给 catalog 下发（supported_ref_media），使桌面端可选素材与后端校验严格一致。
     *
     * @return array<int, string>
     */
    public function allowedRefMedia(VideoModelSpec $spec): array
    {
        $protocol = (string) $spec->provider_protocol;
        if ($protocol === 'seedance' || $protocol === 'volcengine_ark' || $protocol === 'minimax_h3' || VideoProtocols::isWan($protocol)) {
            return ['image', 'video', 'audio'];
        }
        $allowed = ['image'];
        $params = is_array($spec->provider_params) ? $spec->provider_params : [];
        if (isset($params['ref_media']) && is_array($params['ref_media'])) {
            $allowed = array_values(array_unique(array_merge(
                $allowed,
                array_intersect($params['ref_media'], ['image', 'video', 'audio'])
            )));
        }
        return $allowed;
    }

    private function assertValueSupported(string $label, string $value, $supported): void
    {
        if ($value === '') {
            return;
        }
        $list = (array) ($supported ?: []);
        if (!empty($list) && !in_array($value, $list, true)) {
            throw new \InvalidArgumentException("不支持的{$label}：{$value}");
        }
    }

    private function assertDurationSupported(int $value, $supported): void
    {
        if ($value <= 0) {
            return;
        }
        $list = array_map('intval', (array) ($supported ?: []));
        if (!empty($list) && !in_array($value, $list, true)) {
            throw new \InvalidArgumentException("不支持的时长：{$value} 秒");
        }
    }

    private function assetsByType(array $assets, string $type): array
    {
        return array_values(array_filter($assets, fn($asset) => is_array($asset) && ($asset['asset_type'] ?? '') === $type));
    }
}
