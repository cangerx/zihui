<?php

namespace App\Http\Controllers;

use App\Models\HomepageImage;
use App\Models\SystemSetting;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * 官网（根域名 / 下的 public/home/index.html）设置管理。
 *
 * 职责：
 *  - 管理 Hero 文案、版本说明、Windows/Mac 下载链接（复用 SystemSetting 键值表）
 *  - 管理首页所有位置的截图（上传 / 替换 / 删除，存 homepage_images 表）
 *  - 提供公开接口供 public/home/index.html 首屏拉取
 */
class HomepageController extends Controller
{
    private const SUBDIR = 'home/images';
    private const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

    /**
     * 模板代号白名单（与 public/home-{template} 的目录名对应）。
     * 'default' 特指 public/home/index.html（历史官网模板）。
     */
    public const TEMPLATES = ['default', 'minimal', 'workspace'];

    /**
     * 文本白名单 + 默认值。只有这里列出的 key 可以从 /settings 读写。
     * 值优先取用户设置，空串时回退默认。
     *
     * 字段命名约定：
     *  - 通用字段（所有模板共用）：homepage_*
     *  - 模板专属字段：{template}_*（如 minimal_section_create_title）
     *
     * 后台编辑面板按当前激活的模板动态展示对应字段子集。
     */
    private const TEXT_KEYS = [
        // ============ 通用字段（所有模板共用） ============
        'homepage_hero_title'       => '好伙伴AI Agent助手',
        'homepage_hero_desc'        => '打开一个文件夹，就开始工作。对话、知识库与创作默认留在本机；模型用你自己的密钥，不必把资料先送进云端对话框。',
        'homepage_version_text'     => '本地存储 · 自带密钥 · Windows / macOS',
        'homepage_download_windows' => '',
        'homepage_download_mac'     => '',
        'homepage_download_mac_arm' => '',
        // 左上角导航 + 浏览器 tab
        'homepage_nav_title'        => '',
        'homepage_page_title'       => '',
        // footer 三段：公司名 / 联系方式 / 备案号（任一为空都不显示对应部分）
        'homepage_footer_company'   => '',
        'homepage_footer_contact'   => '',
        'homepage_footer_beian'     => '',

        // ============ minimal 模板专属字段 ============
        // Section 1: 创作能力（图像 + 画布）
        'minimal_section_create_badge' => 'AI 创作',
        'minimal_section_create_title' => '对话即创作',
        'minimal_section_create_desc'  => '图像生成、批量、反推、编辑、抠图、灵感广场，全套创作能力一站完成。',
        // Section 2: 对话能力
        'minimal_section_chat_badge' => '对话核心',
        'minimal_section_chat_title' => '你的桌面 AI 助手',
        'minimal_section_chat_desc'  => '处理工作文件、社媒文案、文档撰写、多人格切换、长上下文延续。',
        // Section 3: 双特性卡（本地知识库 + 持续记忆）
        'minimal_feat_kb_title'      => '本地知识库',
        'minimal_feat_kb_desc'       => '文档导入、向量检索、对话引用，一气呵成。数据完整存于本地。',
        'minimal_feat_memory_title'  => '持续记忆',
        'minimal_feat_memory_desc'   => '对话摘要、习惯沉淀，跨会话不丢上下文。',
        // Section 4: 六宫格能力
        'minimal_grid_1_title' => 'BYOK 模型自由',
        'minimal_grid_1_desc'  => '接入 OpenAI / Claude / 国产 / 自部署，自带 API Key',
        'minimal_grid_2_title' => '工具自治',
        'minimal_grid_2_desc'  => 'AI 自主读写文件、执行命令、调用工具',
        'minimal_grid_3_title' => '多 Agent 协作',
        'minimal_grid_3_desc'  => 'Bot、人设、技能可编排，协同完成复杂任务',
        'minimal_grid_4_title' => '插件生态',
        'minimal_grid_4_desc'  => 'Skill 系统 + MCP 协议，可插拔可定制',
        'minimal_grid_5_title' => '数据本地',
        'minimal_grid_5_desc'  => '对话、知识库、文档全部存于本地 SQLite',
        'minimal_grid_6_title' => '流式画布',
        'minimal_grid_6_desc'  => '拖拽编排你的 AI 工作流',
        // Section 5: 双 CTA 卡（社群 + 文档）
        'minimal_cta_left_title'  => '加入用户群',
        'minimal_cta_left_desc'   => '加入用户交流群',
        'minimal_cta_left_link'   => '',
        'minimal_cta_right_title' => '使用文档',
        'minimal_cta_right_desc'  => '玩转桌面 AI 助手',
        'minimal_cta_right_link'  => '',
    ];

    /**
     * 暴露 TEXT_KEYS 给 HomepagePhrasePackController::apply 等外部消费方做白名单校验。
     * 仍保留 TEXT_KEYS 私有不被直接外部覆盖；只读不可变。
     *
     * @return array<string,string>
     */
    public static function getTextKeys(): array
    {
        return self::TEXT_KEYS;
    }

    /**
     * 返回某个模板的"专属字段" key 列表（按 {template}_ 前缀筛选）。
     * 'default' 模板没有自己的前缀字段（沿用通用 homepage_* 字段），返回空数组。
     * 用于 apply 话术包时仅 reset 当前模板的专属字段，不污染通用 / 其他模板字段。
     *
     * @return string[]
     */
    public static function getTemplateOwnedKeys(string $template): array
    {
        if ($template === 'default') {
            return [];
        }
        $prefix = $template . '_';
        $owned = [];
        foreach (array_keys(self::TEXT_KEYS) as $key) {
            if (str_starts_with($key, $prefix)) {
                $owned[] = $key;
            }
        }
        return $owned;
    }

    /**
     * GET /admin/homepage/settings
     * 返回文本/链接 + 所有图片位置白名单（含已有图片 URL）。
     */
    public function index(): JsonResponse
    {
        $texts = [];
        foreach (self::TEXT_KEYS as $key => $default) {
            $val = (string) SystemSetting::getValue($key, '');
            $texts[$key] = $val !== '' ? $val : $default;
        }

        return response()->json([
            'homepage_enabled'           => (bool) SystemSetting::getValue('homepage_enabled', true),
            'homepage_use_docs_as_index' => (bool) SystemSetting::getValue('homepage_use_docs_as_index', false),
            'docs_enabled'               => (bool) SystemSetting::getValue('docs_enabled', false),
            // 当前模板代号 + 可选模板列表（前端按此渲染模板选择卡）
            'homepage_template'          => (string) SystemSetting::getValue('homepage_template', 'default'),
            'available_templates'        => self::TEMPLATES,
            // 两个模板各自当前激活的话术包 slug（前端按当前模板高亮）
            'homepage_active_phrase_pack_default' => (string) SystemSetting::getValue('homepage_active_phrase_pack_default', ''),
            'homepage_active_phrase_pack_minimal' => (string) SystemSetting::getValue('homepage_active_phrase_pack_minimal', ''),
            'texts'     => $texts,
            'positions' => HomepageImage::buildPositionMap(),
        ]);
    }

    /**
     * PUT /admin/homepage/settings
     * 保存文本/链接。只接受白名单字段。
     */
    public function update(Request $request): JsonResponse
    {
        // 已知字段的精细校验（短文本/中文本/链接/badge 等长度差异）
        $specificRules = [
            'homepage_hero_title'        => ['nullable', 'string', 'max:100'],
            'homepage_hero_desc'         => ['nullable', 'string', 'max:500'],
            'homepage_version_text'      => ['nullable', 'string', 'max:100'],
            'homepage_download_windows'  => ['nullable', 'string', 'max:500'],
            'homepage_download_mac'      => ['nullable', 'string', 'max:500'],
            'homepage_download_mac_arm'  => ['nullable', 'string', 'max:500'],
            'homepage_nav_title'         => ['nullable', 'string', 'max:60'],
            'homepage_page_title'        => ['nullable', 'string', 'max:80'],
            'homepage_footer_company'    => ['nullable', 'string', 'max:120'],
            'homepage_footer_contact'    => ['nullable', 'string', 'max:120'],
            'homepage_footer_beian'      => ['nullable', 'string', 'max:120'],
            // minimal 模板专属：badge 短，title 中，desc 较长，link 是 URL
            'minimal_section_create_badge' => ['nullable', 'string', 'max:30'],
            'minimal_section_create_title' => ['nullable', 'string', 'max:80'],
            'minimal_section_create_desc'  => ['nullable', 'string', 'max:240'],
            'minimal_section_chat_badge'   => ['nullable', 'string', 'max:30'],
            'minimal_section_chat_title'   => ['nullable', 'string', 'max:80'],
            'minimal_section_chat_desc'    => ['nullable', 'string', 'max:240'],
            'minimal_feat_kb_title'        => ['nullable', 'string', 'max:60'],
            'minimal_feat_kb_desc'         => ['nullable', 'string', 'max:240'],
            'minimal_feat_memory_title'    => ['nullable', 'string', 'max:60'],
            'minimal_feat_memory_desc'     => ['nullable', 'string', 'max:240'],
            'minimal_cta_left_link'        => ['nullable', 'string', 'max:500'],
            'minimal_cta_right_link'       => ['nullable', 'string', 'max:500'],
        ];

        // 基础规则：开关 + 模板代号 + 当前激活话术包
        $rules = [
            'homepage_enabled'                    => ['nullable', 'boolean'],
            'homepage_use_docs_as_index'          => ['nullable', 'boolean'],
            'homepage_template'                   => ['nullable', 'string', Rule::in(self::TEMPLATES)],
            // 当前激活的话术包（按模板独立记录），slug 由 HomepagePhrasePack 校验合法性
            'homepage_active_phrase_pack_default' => ['nullable', 'string', 'max:80'],
            'homepage_active_phrase_pack_minimal' => ['nullable', 'string', 'max:80'],
        ];
        // 把 specificRules 合并进来；剩余 TEXT_KEYS 字段用通用兜底（max:120）
        // grid_*/feat_*/cta_*_title 等都是短文本，120 足够；desc/link 都已在 specific 列表
        foreach (array_keys(self::TEXT_KEYS) as $key) {
            if (isset($specificRules[$key])) {
                $rules[$key] = $specificRules[$key];
            } else {
                $rules[$key] = ['nullable', 'string', 'max:120'];
            }
        }

        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            return response()->json([
                'error'   => 'validation_failed',
                'details' => $validator->errors(),
            ], 422);
        }

        if ($request->has('homepage_enabled')) {
            SystemSetting::setValue('homepage_enabled', $request->boolean('homepage_enabled'));
        }
        if ($request->has('homepage_use_docs_as_index')) {
            SystemSetting::setValue('homepage_use_docs_as_index', $request->boolean('homepage_use_docs_as_index'));
        }
        if ($request->has('homepage_template')) {
            SystemSetting::setValue('homepage_template', (string) $request->input('homepage_template', 'default'));
        }
        foreach (['homepage_active_phrase_pack_default', 'homepage_active_phrase_pack_minimal'] as $packKey) {
            if ($request->has($packKey)) {
                SystemSetting::setValue($packKey, (string) $request->input($packKey, ''));
            }
        }

        foreach (array_keys(self::TEXT_KEYS) as $key) {
            if ($request->has($key)) {
                SystemSetting::setValue($key, (string) $request->input($key, ''));
            }
        }

        return $this->index();
    }

    /**
     * POST /admin/homepage/images
     * multipart/form-data:  position + image (file)
     * 上传单张图片到指定位置。已有图片会被覆盖（旧文件保留在磁盘，不自动清理）。
     */
    public function uploadImage(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'position' => ['required', 'string'],
            'image'    => [
                'required',
                'file',
                'mimetypes:image/png,image/jpeg,image/webp',
                'max:' . (int) (self::MAX_BYTES / 1024),
            ],
        ]);
        if ($validator->fails()) {
            return response()->json([
                'error'   => 'validation_failed',
                'details' => $validator->errors(),
            ], 422);
        }

        $position = (string) $request->input('position');
        if (!HomepageImage::isValidPosition($position)) {
            return response()->json(['error' => 'invalid_position'], 422);
        }

        $file = $request->file('image');
        $info = @getimagesize($file->getRealPath());
        if (!$info) {
            return response()->json(['error' => 'not_a_real_image'], 422);
        }
        [$width, $height] = $info;

        $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'png');
        if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) {
            $ext = 'png';
        }

        $uuid = (string) Str::uuid();
        $filename = $position . '_' . $uuid . '.' . $ext;
        // 文件大小要在 move 前取，move 后原 UploadedFile 已失效
        $originalName = $file->getClientOriginalName();
        $size = @filesize($file->getRealPath()) ?: null;

        // 走统一存储服务（local 或 cos，由 system_settings.storage_type 决定）
        $imageUrl = StorageService::upload($file, self::SUBDIR, $filename);
        if ($imageUrl === null) {
            return response()->json(['error' => 'storage_unavailable'], 500);
        }

        $row = HomepageImage::updateOrCreate(
            ['position' => $position],
            [
                'image_url' => $imageUrl,
                'filename'  => $originalName,
                'size'      => $size,
                'width'     => $width,
                'height'    => $height,
            ]
        );

        return response()->json([
            'position' => $row->position,
            'image_url' => $row->image_url,
            'filename' => $row->filename,
            'size'     => $row->size,
            'width'    => $row->width,
            'height'   => $row->height,
        ]);
    }

    /**
     * DELETE /admin/homepage/images/{position}
     * 清除某个位置的图片（只删数据库记录，磁盘文件保留做简单回滚兜底）。
     */
    public function deleteImage(string $position): JsonResponse
    {
        if (!HomepageImage::isValidPosition($position)) {
            return response()->json(['error' => 'invalid_position'], 422);
        }
        HomepageImage::where('position', $position)->delete();
        return response()->json(['ok' => true]);
    }

    /**
     * GET /public/homepage-config（公开，首页静态 HTML 拉取）
     */
    public function publicConfig(): JsonResponse
    {
        $texts = [];
        foreach (self::TEXT_KEYS as $key => $default) {
            $val = (string) SystemSetting::getValue($key, '');
            $texts[$key] = $val !== '' ? $val : $default;
        }

        $images = [];
        foreach (HomepageImage::all() as $img) {
            $images[$img->position] = $img->image_url;
        }

        return response()->json([
            'texts'  => $texts,
            'images' => $images,
            'site'   => [
                'title'        => (string) SystemSetting::getValue('site_title', 'Agent Admin'),
                'product_name' => (string) SystemSetting::getValue('cloud_build_app_name', ''),
            ],
            // 文档入口控制：首页顶部导航按 docs_enabled 动态显示「文档」链接
            // homepage_use_docs_as_index 主要供路由层（routes/web.php）判断“/”走 /docs 还是走首页；
            // 顶部静态页也能用该值检测“首页被重定向」场景下是否需要添加「返回官网」错误返回项
            'docs_enabled'               => (bool) SystemSetting::getValue('docs_enabled', false),
            'homepage_use_docs_as_index' => (bool) SystemSetting::getValue('homepage_use_docs_as_index', false),
            // 当前模板代号（公开暴露，方便前端调试/SSR 工具识别使用的是哪个模板）
            'homepage_template'          => (string) SystemSetting::getValue('homepage_template', 'default'),
        ]);
    }
}
