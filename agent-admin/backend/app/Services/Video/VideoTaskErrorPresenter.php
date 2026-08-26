<?php

namespace App\Services\Video;

class VideoTaskErrorPresenter
{
    public function present(?string $message, ?string $errorCode = null): array
    {
        $detail = trim((string) $message);
        $haystack = mb_strtolower(trim((string) $errorCode) . ' ' . $detail);
        $rules = [
            ['no_channel', ['无渠道', 'no channel', 'channel not found'], '上游分组没有可用渠道', '检查中转站的分组、渠道和当前模型绑定。'],
            ['invalid_ratio', ['invalid ratio', 'aspect ratio', 'ratio is', '比例不支持', '非法 ratio'], '画面比例不被当前模型支持', '核对实际发出的 ratio / size，改为模型白名单中的比例。'],
            ['sku_unpriced', ['尚未配置扣费', 'sku 未定价', 'unpriced'], 'SKU 尚未定价', '到「SKU 与价格」填写默认积分并启用。'],
            ['content_moderation', ['moderation', 'content policy', 'safety', '审核不通过', '素材违规'], '提示词或素材未通过上游审核', '检查提示词、参考图和参考视频，移除可能触发审核的内容。'],
            ['insufficient_balance', ['insufficient credit', 'insufficient balance', '余额不足', '积分不足'], '账户余额或积分不足', '核对用户积分与上游账户余额，补足后重试。'],
        ];
        foreach ($rules as [$code, $needles, $title, $hint]) {
            foreach ($needles as $needle) {
                if ($haystack !== '' && str_contains($haystack, $needle)) {
                    return compact('code', 'title', 'hint', 'detail');
                }
            }
        }
        return ['code' => $errorCode ?: 'unknown', 'title' => $detail ?: '未知错误', 'hint' => '查看原始错误和实际请求字段后排查。', 'detail' => $detail];
    }
}
