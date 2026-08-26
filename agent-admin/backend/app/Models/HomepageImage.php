<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class HomepageImage extends Model
{
    protected $fillable = [
        'position', 'image_url', 'filename', 'size', 'width', 'height',
    ];

    /**
     * 官网所有图片位置白名单（key => 描述/说明/比例）
     * 用于前端渲染图片上传列表 + 后端校验 position 合法性。
     */
    public const POSITIONS = [
        'nav_logo' => [
            'label' => '左上角 Logo',
            'desc'  => '导航栏左侧的小图标。建议方形或正方形，背景透明。不上传则显示默认的字母缩写圆角块。',
            'ratio' => '1:1',
            'size'  => '建议 64x64 或 128x128',
        ],
        'hero_main' => [
            'label' => '首屏主截图',
            'desc'  => 'Hero 区域展示 Agent 对话 + 工具调用的完整流程',
            'ratio' => '16:9.5',
            'size'  => '建议 1280x760',
        ],
        'feat_file' => [
            'label' => '功能 · 文件读写',
            'desc'  => '展示 AI 调用 file_ops 写入文件的对话过程',
            'ratio' => '4:3',
            'size'  => '建议 960x720',
        ],
        'feat_command' => [
            'label' => '功能 · 命令执行',
            'desc'  => '展示 AI 执行 npm install / git status 等命令的过程',
            'ratio' => '4:3',
            'size'  => '建议 960x720',
        ],
        'feat_imagegen' => [
            'label' => '功能 · 对话生图',
            'desc'  => '展示 AI 在对话中生成图片的完整流程',
            'ratio' => '4:3',
            'size'  => '建议 960x720',
        ],
        'feat_approval' => [
            'label' => '功能 · 工具审批',
            'desc'  => '展示工具调用确认弹窗 + Diff 预览',
            'ratio' => '4:3',
            'size'  => '建议 960x720',
        ],
        'suite_gen' => [
            'label' => '生图套件 · AI 生图',
            'desc'  => '展示生图配置面板 + 生成结果',
            'ratio' => '16:9',
            'size'  => '建议 1280x720',
        ],
        'suite_batch' => [
            'label' => '生图套件 · 批量生图',
            'desc'  => '展示批量任务列表 + 并行进度',
            'ratio' => '16:9',
            'size'  => '建议 1280x720',
        ],
        'suite_reverse' => [
            'label' => '生图套件 · 图片反推',
            'desc'  => '展示上传图片 + 反推出的提示词结果',
            'ratio' => '16:9',
            'size'  => '建议 1280x720',
        ],
        'suite_edit' => [
            'label' => '生图套件 · 图片编辑',
            'desc'  => '展示编辑器画布 + AI 局部重绘涂抹区域',
            'ratio' => '16:9',
            'size'  => '建议 1280x720',
        ],
        'suite_inspire' => [
            'label' => '生图套件 · 灵感广场',
            'desc'  => '展示灵感卡片瀑布流 + 分类筛选',
            'ratio' => '16:9',
            'size'  => '建议 1280x720',
        ],
        'canvas_main' => [
            'label' => '流式画布',
            'desc'  => '展示多节点连线的完整工作流画布',
            'ratio' => '16:9',
            'size'  => '建议 1280x720',
        ],

        // ============ minimal 模板专属图位（独立于默认模板）============
        // 命名以 minimal_ 前缀区分；默认模板的 12 个图位不受影响
        'minimal_nav_logo' => [
            'label' => '[极简模板] 左上角 Logo',
            'desc'  => '极简模板导航栏的 Logo。建议方形，背景透明。',
            'ratio' => '1:1',
            'size'  => '建议 128x128',
        ],
        'minimal_hero_main' => [
            'label' => '[极简模板] 首屏主截图',
            'desc'  => 'Hero 区右侧或下方展示的桌面端主界面截图',
            'ratio' => '16:10',
            'size'  => '建议 1280x800',
        ],
        'minimal_section_create' => [
            'label' => '[极简模板] 创作能力区块图',
            'desc'  => '对应「对话即创作」区块：生图、画布、批量、反推合成的截图',
            'ratio' => '16:10',
            'size'  => '建议 1280x800',
        ],
        'minimal_section_chat' => [
            'label' => '[极简模板] 对话能力区块图',
            'desc'  => '对应「桌面 AI 助手」区块：chat + bots + 知识库引用合成的截图',
            'ratio' => '16:10',
            'size'  => '建议 1280x800',
        ],
    ];

    public static function isValidPosition(string $pos): bool
    {
        return array_key_exists($pos, self::POSITIONS);
    }

    /**
     * 返回所有位置 + 已有图片信息（map 形式）
     * @return array<string, array{position:string,label:string,desc:string,ratio:string,size:string,image_url:?string}>
     */
    public static function buildPositionMap(): array
    {
        $images = self::query()->get()->keyBy('position');
        $result = [];
        foreach (self::POSITIONS as $pos => $meta) {
            $img = $images->get($pos);
            $result[$pos] = array_merge(
                ['position' => $pos],
                $meta,
                [
                    'image_url' => $img?->image_url,
                    'filename'  => $img?->filename,
                    'width'     => $img?->width,
                    'height'    => $img?->height,
                ]
            );
        }
        return $result;
    }
}
