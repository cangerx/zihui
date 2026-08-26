<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Crypt;

class SystemSetting extends Model
{
    protected $fillable = ['key', 'value', 'remark'];

    /**
     * Key whitelist. Only these keys are readable/writable.
     */
    public const ALLOWED_KEYS = [
        'register_enabled'         => 'bool',
        'register_bonus_enabled'   => 'bool',
        'register_bonus_token'     => 'float',
        'register_bonus_credit'    => 'float',
        'register_bonus_plan_id'   => 'int_nullable',
        'register_bonus_remark'    => 'string',
        'register_ip_daily_limit'  => 'int',
        'register_device_unique'   => 'bool',
        // 新用户默认权限：注册时是否自动开通「灵感大王」（桌面端可上传创作到灵感广场）
        'register_default_inspiration_uploader' => 'bool',
        // ===== 短信服务（阿里云 Dysmsapi，RPC 签名直连，无第三方 SDK 依赖）=====
        // 总开关：关闭后所有短信发送（注册验证 / 找回密码）直接拒绝
        'sms_enabled'                 => 'bool',
        // 阿里云 RAM 子账号 AccessKey（建议仅授予 AliyunDysmsFullAccess）
        'sms_access_key_id'           => 'string',
        // AccessKey Secret，加密存储，绝不下发桌面端（与 matting/oss 同款安全策略）
        'sms_access_key_secret'       => 'encrypted',
        // 短信签名（阿里云短信控制台「签名管理」审核通过的签名名称）
        'sms_sign_name'               => 'string',
        // 验证码短信模板 CODE（注册 / 找回密码共用；模板正文必须含且仅含一个变量 ${code}）
        'sms_template_code'           => 'string',
        // 验证码有效期（秒），默认 300（5 分钟）
        'sms_code_expire_seconds'     => 'int',
        // 同一手机号两次发送的最小间隔（秒），默认 60
        'sms_send_interval_seconds'   => 'int',
        // 单手机号每日发送上限（条），默认 10
        'sms_daily_limit_per_mobile'  => 'int',
        // 注册短信验证开关：开启后桌面端注册手机号必填且需校验验证码
        'register_sms_verify_enabled' => 'bool',
        // 找回密码开关：开启后桌面端登录页显示「忘记密码」，凭手机号 + 验证码重置
        'forgot_password_enabled'     => 'bool',
        'wxpay_enabled'            => 'bool',
        'wxpay_mchid'              => 'string',
        'wxpay_app_id'             => 'string',
        'wxpay_apiv3_key'          => 'encrypted',
        'wxpay_cert_serial_no'     => 'string',
        'wxpay_private_key'        => 'encrypted',
        // 验签材料（二选一，公钥模式优先）：
        //   - 公钥模式（推荐，永不轮换）：wxpay_pub_key_id + wxpay_pub_key
        //   - 平台证书模式（兼容旧配置，每 12 个月需手工换证）：wxpay_platform_cert
        // 若 pub_key_id 与 pub_key 都已填写，自动启用公钥模式；否则回退到平台证书模式。
        'wxpay_pub_key_id'         => 'string',
        'wxpay_pub_key'            => 'text',
        'wxpay_platform_cert'      => 'text',
        // ===== 天阙支付（聚合支付：微信/支付宝/云闪付/数字人民币）=====
        // 主扫模式（用户扫码付款），与微信 Native 用户体验一致
        // 天阙公钥（测试/生产各一个固定值）由 TianquePayService 代码内置，无需用户配置
        'tianque_enabled'          => 'bool',
        'tianque_env'              => 'string',  // 'test' | 'prod'
        'tianque_version'          => 'string',  // '1.2'(商户) | '1.0'(服务商)
        'tianque_org_id'           => 'string',  // 机构号 8 或 10 位数字
        'tianque_mno'              => 'string',  // 商户号 399 开头 15 位数字
        'tianque_private_key'      => 'encrypted',  // PKCS8 私钥 PEM
        'tianque_public_key'       => 'text',       // 平台公钥 PEM（天阙商户后台「密钥管理 / 平台公钥下载」获取，验签响应用；留空回退代码内置默认公钥）
        // ===== 虎皮椒支付（xunhupay 聚合扫码：微信/支付宝，MD5 签名 + 异步 notify）=====
        'xunhupay_enabled'         => 'bool',
        'xunhupay_appid'           => 'string',      // 虎皮椒 APPID（支付渠道管理 → 我的支付渠道）
        'xunhupay_appsecret'       => 'encrypted',   // 虎皮椒 APPSECRET，MD5 签名密钥，加密存储绝不下发
        'xunhupay_gateway'         => 'string',      // 可选：自定义/备用网关域名（留空走默认 api.xunhupay.com）
        // 货币文案（业务上：balance_type=token 表示现金钱包 / credit 表示积分钱包）
        'currency_label_token'     => 'string',
        'currency_label_credit'    => 'string',
        // ===== 直充（用户自助按金额充值金币/积分）=====
        // 自由金额按比例充值 + 阶梯赠送；快捷档位存 recharge_packages 表
        'recharge_enabled'            => 'bool',
        'recharge_min_amount'         => 'float',   // 自由金额起充（元）
        'recharge_token_ratio'        => 'float',   // 1 元 = N 金币
        'recharge_credit_ratio'       => 'float',   // 1 元 = N 积分
        'recharge_token_bonus_rules'  => 'text',    // json: [{"threshold":100,"bonus":10}]
        'recharge_credit_bonus_rules' => 'text',    // json: [{"threshold":100,"bonus":10}]
        // 直充分类型显示开关：关闭后桌面端充值页隐藏对应 tab，后端 quote 也拒绝该类型下单
        'recharge_token_enabled'      => 'bool',
        'recharge_credit_enabled'     => 'bool',
        // 套餐商城开关：关闭后桌面端用户中心隐藏「套餐商城」入口（兑换码 / 后台发放仍可获得套餐）
        'plans_store_enabled'         => 'bool',
        // 站点标题（左上角侧边栏 + 浏览器 tab title），由 install.php 写入初值
        'site_title'               => 'string',
        // 登录页背景图 URL（桌面端登录页全屏背景，空=用内置品牌橙光晕）
        'login_background_url'     => 'string',
        // 智能体列表页背景图 URL（桌面端首页=/bots 整页 cover 背景，空=默认纯色）
        'bot_list_background_url'  => 'string',
        // 全局主题主色（hex，如 #F27638；桌面端据此派生整套 primary 色阶换肤）
        'theme_primary_color'      => 'string',
        // 云打包白标配置（应用名 + 图标 URL），由「一键云打包」页面持久化
        'cloud_build_app_name'     => 'string',
        'cloud_build_icon_url'     => 'string',
        'cloud_build_owner_name'   => 'string',
        'cloud_build_owner_phone'  => 'string',
        'github_build_repo'        => 'string',
        'github_build_token'       => 'encrypted',
        // 桌面 inspirations.json 只允许灌一次；写入 ISO8601，空=未灌
        'shared_hub_desktop_imported_at' => 'string',
        'cloud_build_customer_service_title' => 'string',
        'cloud_build_customer_service_image_url' => 'string',
        // 官网设置：总开关（关闭后根域名 302 → /admin）
        'homepage_enabled'          => 'bool',
        // 官网设置：hero 文案
        'homepage_hero_title'      => 'string',
        'homepage_hero_desc'       => 'text',
        'homepage_version_text'    => 'string',
        // 官网设置：下载链接
        'homepage_download_windows' => 'string',
        'homepage_download_mac'     => 'string',
        // 官网设置：左上角导航 + 浏览器 tab 标题
        'homepage_nav_title'        => 'string',
        'homepage_page_title'       => 'string',
        // 官网设置：footer 三段（公司名 / 联系方式 / 备案号），任一为空都不显示对应段
        'homepage_footer_company'   => 'string',
        'homepage_footer_contact'   => 'string',
        'homepage_footer_beian'     => 'string',
        // 官网设置：根域名 / 命中时把文档站当首页（true）还是显示官网首页（false）
        'homepage_use_docs_as_index' => 'bool',
        // 官网设置：当前激活的模板代号（'default' / 'minimal' / 'workspace'，白名单见 HomepageController::TEMPLATES）
        'homepage_template'         => 'string',
        // 官网设置：每个模板各自当前激活的话术包 slug（apply 时由 HomepagePhrasePackController 写入）
        'homepage_active_phrase_pack_default' => 'string',
        'homepage_active_phrase_pack_minimal' => 'string',
        // 官网设置：Mac Apple Silicon 单独下载链接（与 homepage_download_mac/Intel 分开）
        'homepage_download_mac_arm' => 'string',
        // ===== 极简模板（minimal）专属字段 =====
        // 与 HomepageController::TEXT_KEYS 一一对应；apply 话术包 / 后台直接编辑都会写到这里
        // Section 1 创作能力（图像 + 画布）
        'minimal_section_create_badge' => 'string',
        'minimal_section_create_title' => 'string',
        'minimal_section_create_desc'  => 'text',
        // Section 2 对话能力
        'minimal_section_chat_badge'   => 'string',
        'minimal_section_chat_title'   => 'string',
        'minimal_section_chat_desc'    => 'text',
        // Section 3 双特性卡（本地知识库 + 持续记忆）
        'minimal_feat_kb_title'        => 'string',
        'minimal_feat_kb_desc'         => 'text',
        'minimal_feat_memory_title'    => 'string',
        'minimal_feat_memory_desc'     => 'text',
        // Section 4 六宫格能力（BYOK / 工具自治 / 多 Agent / 插件生态 / 数据本地 / 流式画布）
        'minimal_grid_1_title'         => 'string',
        'minimal_grid_1_desc'          => 'string',
        'minimal_grid_2_title'         => 'string',
        'minimal_grid_2_desc'          => 'string',
        'minimal_grid_3_title'         => 'string',
        'minimal_grid_3_desc'          => 'string',
        'minimal_grid_4_title'         => 'string',
        'minimal_grid_4_desc'          => 'string',
        'minimal_grid_5_title'         => 'string',
        'minimal_grid_5_desc'          => 'string',
        'minimal_grid_6_title'         => 'string',
        'minimal_grid_6_desc'          => 'string',
        // Section 5 双 CTA（左：用户群 / 右：文档），_link 为目标 URL
        'minimal_cta_left_title'       => 'string',
        'minimal_cta_left_desc'        => 'string',
        'minimal_cta_left_link'        => 'string',
        'minimal_cta_right_title'      => 'string',
        'minimal_cta_right_desc'       => 'string',
        'minimal_cta_right_link'       => 'string',
        // 灵感免审开关：true = 桌面端用户上传时直接 approved（跳过审核），false = 默认 pending 走审核流
        'inspiration_skip_audit'    => 'bool',
        // ===== 共享灵感库（对接 agent-build 的跨 OEM 共享 hub）=====
        // 总开关：false 时桌面端 / 后台均不走 hub相关路径，仅本地灵感库生效
        'inspiration_hub_enabled'   => 'bool',
        // hub 服务端点，如 https://your-build-domain.example.com（不加尾斜杠）
        'inspiration_hub_endpoint'  => 'string',
        // 本云控端在 hub 上授权的 Origin，后端调 hub /api/inspiration-hub/* 时会带此头进行域名鉴权
        // 留空时回退 config('app.url')
        'inspiration_hub_origin'    => 'string',
        // ===== 云同步与容量计费 =====
        // 同步总开关：关闭后 client/sync/* 全部拒绝（桌面端隐藏云同步入口）
        'sync_enabled'              => 'bool',
        // 注册默认赠送的云存储容量（字节）；用户总配额 = 此值 + Σ 有效套餐 storage_granted
        'storage_default_bytes'     => 'int',
        // 容量计费开关：关闭时不限制容量（仅统计用量用于展示）
        'storage_billing_enabled'   => 'bool',
        // 超额策略：readonly = 转只读（禁新增/上传，允许下载删除）；reject = 直接拒绝
        'storage_overage_policy'    => 'string',
        // 单个媒体文件大小上限（MB）
        'sync_max_blob_mb'          => 'int',
        // 资源上传存储方式：local = 服务器本地, cos = 腾讯云对象存储, oss = 阿里云对象存储
        'storage_type'              => 'string',
        // 腾讯云 COS 配置
        'cos_secret_id'             => 'string',
        'cos_secret_key'            => 'encrypted',
        'cos_region'                => 'string',  // ap-shanghai / ap-guangzhou ...
        'cos_bucket'                => 'string',  // 桶名前缀（不含 APPID）；兼容旧值「bucket-1234567890」整体填入
        'cos_app_id'                => 'string',  // 腾讯云 APPID（10 位数字），运行时与 bucket 拼为 bucket-APPID 作为 host 前缀
        'cos_domain'                => 'string',  // 自定义 CDN 域名（可选），留空走默认 cos 域名
        // 阿里云 OSS 配置（storage_type=oss 时生效）
        'oss_access_key_id'         => 'string',
        'oss_access_key_secret'     => 'encrypted',
        'oss_endpoint'              => 'string',  // 地域节点，如 oss-cn-hangzhou.aliyuncs.com（不含 bucket 前缀）
        'oss_bucket'                => 'string',  // 桶名，运行时与 endpoint 拼为 bucket.endpoint 作为访问 host
        'oss_domain'                => 'string',  // 自定义 CDN 域名（可选），留空走默认 oss 域名
        // 桌面端注册页协议（标题 + HTML 富文本，由 publicConfig 公开端点输出供注册前阅读）
        'register_agreement_title'   => 'string',
        'register_agreement_content' => 'text',
        'privacy_agreement_title'    => 'string',
        'privacy_agreement_content'  => 'text',
        // 桌面端「对话页面默认模型」：新建会话时填入 conversation.active_model_*；用户切换会覆盖
        // - chat_default_model_provider: 通常 'cloud:default'（云端虚拟服务商）；留空时桌面端回退本地第一个 chat 模型
        // - chat_default_model_id: cloud_models 表的 model_id（裸值；桌面端拉到后会自动 upgrade 到复合 key）
        'chat_default_model_provider' => 'string',
        'chat_default_model_id'       => 'string',
        // ===== AI 抠图（阿里云 viapi SegmentHDCommonImage）=====
        // 总开关：关闭后所有抠图请求直接拒绝（包括桌面端「AI 抠图」入口）
        'matting_enabled'              => 'bool',
        // 阿里云 RAM 子账号 AccessKey（需开通分割抠图服务 + AliyunVIAPIFullAccess）
        'matting_access_key_id'        => 'string',
        'matting_access_key_secret'    => 'encrypted',
        // 阿里云 viapi 接口地址。可选 cn-shanghai（推荐）/ cn-beijing；地域必须与 region_id 匹配
        'matting_endpoint'             => 'string',
        'matting_region_id'            => 'string',
        // 单次抠图扣费（积分），按用户实际计费；管理员可调，默认 0.2
        'matting_credit_per_call'      => 'float',
        // ===== 精细抠图（抠抠图 koukoutu 异步 API，按尺寸三档计费）=====
        // 总开关：关闭后所有精细抠图请求直接拒绝（包括桌面端「精细抠图」入口）
        'fine_matting_enabled'          => 'bool',
        // 抠抠图 API Key（X-API-Key），加密存储，绝不下发桌面端
        'fine_matting_api_key'          => 'encrypted',
        // 三档单价（本系统积分）：长边 <阈值1 / 阈值1~阈值2 / ≥阈值2。默认留空=0，管理员必须配置
        'fine_matting_tier1_credit'     => 'float',
        'fine_matting_tier2_credit'     => 'float',
        'fine_matting_tier3_credit'     => 'float',
        // 三档长边像素阈值：默认 4096（4K 界限）/ 7680（8K 界限）
        'fine_matting_tier_threshold_1' => 'int',
        'fine_matting_tier_threshold_2' => 'int',
        // ===== 去AI标记（本地清除元数据/溯源标识，按次计费）=====
        // 显示总开关：开=所有用户桌面端显示「去AI标记」入口；关=全部隐藏且功能整体停用
        'ai_mark_removal_enabled'         => 'bool',
        // 全局可用开关：开=所有能看到的用户都可直接使用（免逐个授权）；关=需在权限/套餐授权 allow_ai_mark_removal 才能用
        'ai_mark_removal_use_all'         => 'bool',
        // 单次去标记扣费（积分），按用户实际计费；管理员可调，默认 0.1
        'ai_mark_removal_credit_per_call' => 'float',
        // ===== 文档管理（doc 模块）=====
        // 文档站点总开关：关闭后 /docs 路径不可访问
        'docs_enabled'                => 'bool',
        // 是否允许游客访问：关闭后必须登录用户账户密码才能浏览
        'docs_guest_access'           => 'bool',
        // 文档站标题（顶部 logo / 浏览器 tab title）
        'docs_site_title'             => 'string',
        // ===== 文档 RAG（智能问答）=====
        // RAG 总开关：关闭后右下角对话框不渲染，chat 接口返回 503
        'docs_rag_enabled'            => 'bool',
        // 是否允许游客提问（独立于浏览开关）
        'docs_chat_allow_guest'       => 'bool',
        // 对话模型 cloud_models.id（type=chat），由 admin 在文档设置中下拉选择
        'docs_chat_model_id'          => 'int_nullable',
        // 向量模型 cloud_models.id（type=embedding）；切换时已索引数据作废，需重建
        'docs_embedding_model_id'     => 'int_nullable',
        // 文档切片参数：单片 token 数 / 重叠 token 数
        'docs_chunk_size'             => 'int',
        'docs_chunk_overlap'          => 'int',
        // 检索参数：top-K 召回 / 最低相似度阈值（< 阈值视为无关）
        'docs_retrieve_top_k'         => 'int',
        'docs_min_similarity'         => 'float',
        // 系统提示词（强制锁死「只准从文档回答」），支持占位符 {site_title} {context} {query}
        'docs_system_prompt'          => 'text',
        // ===== 云端知识库（kb 模块，独立于文档中心；向量存 Qdrant）=====
        // 全局向量模型 cloud_models.id（type=embedding）；知识库可按库覆盖 embedding_model_id
        'kb_embedding_model_id'       => 'int_nullable',
        // 切片参数：单片 token 数 / 重叠 token 数
        'kb_chunk_size'               => 'int',
        'kb_chunk_overlap'            => 'int',
        // 检索参数：top-K 召回 / 最低相似度阈值（余弦，越大越相似）
        'kb_retrieve_top_k'           => 'int',
        'kb_min_similarity'           => 'float',
        // 是否启用 hybrid（向量 + MySQL 全文关键词 RRF 融合）
        'kb_hybrid_enabled'           => 'bool',
        // Qdrant 向量库连接（在「知识库设置」配置，不走 .env）
        // url 形如 http://127.0.0.1:6333；api_key 加密存储，绝不下发前端；collection 为空时用 kb_chunks
        'kb_qdrant_url'               => 'string',
        'kb_qdrant_api_key'           => 'encrypted',
        'kb_qdrant_collection'        => 'string',
        // ===== 桌面端左侧菜单配置（显隐 + 自定义名称）=====
        // JSON: { "<menu_key>": { "visible": bool, "title": string } }；menu_key 见 DesktopMenuController::MENU_ITEMS
        // 「模型服务 / AI 抠图」由用户功能权限控制，不纳入此配置。
        'desktop_menu_config'         => 'text',
        // ===== 桌面端自定义菜单项 =====
        // JSON: { "<key>": { title, group_key, target_type(internal|external), target, open_mode(browser|window), icon, sort, visible } }
        // 由 DesktopMenuController::adminCustomUpdate 整体写入；随 /client/desktop-menu 的 custom_items 下发（仅可见项）。
        'desktop_menu_custom_items'   => 'text',
        // ===== Pixabay 图片搜索（deck 配图三级中的第一级；在「系统设置」配置，不走 .env）=====
        // api_key 加密存储、绝不下发前端；deck 取配图时由 /client/image-search 服务端代调，key 不接触桌面端。
        'pixabay_enabled'             => 'bool',
        'pixabay_api_key'             => 'encrypted',
        // ===== 店铺商品图（多商城对接）按商城显示名称 =====
        // 桌面端「店铺商品图」功能里对接的各商城/平台对终端用户显示的名称；不暴露具体平台品牌。
        // 键名为 {mall}_shop_mall_name；随 /client/permissions 下发桌面端；在「桌面端设置 → 店铺商品图」按商城自定义。
        'ewei_shop_mall_name'         => 'string',
        'dianda_shop_mall_name'       => 'string',
        'qdyun_shop_mall_name'        => 'string',
    ];

    /**
     * 店铺商品图各商城的「真实平台名」（仅云控端后台展示用，绝不下发终端用户）。
     * 新增第 N 个商城时在此加一行（key 必须与三端约定的 mall_key 一致）。
     */
    public const SHOP_PLATFORM_LABELS = [
        'ewei'   => 'eweishop',
        'dianda' => '点大商城',
        'qdyun'  => '全端云商城',
    ];

    /**
     * 业务默认值（覆盖 defaultFor() 的原生默认）。
     * 只限未设置或设为空字符串的场景。设置为空字符串会回退默认，避免前端显示空。
     */
    public const DEFAULT_VALUES = [
        'register_enabled'      => true,
        // 短信服务默认全部关闭 / 保守值：未配置时行为与升级前完全一致（向后兼容）
        'sms_enabled'                 => false,
        'sms_code_expire_seconds'     => 300,
        'sms_send_interval_seconds'   => 60,
        'sms_daily_limit_per_mobile'  => 10,
        'register_sms_verify_enabled' => false,
        'forgot_password_enabled'     => false,
        'currency_label_token'  => '金币',
        'currency_label_credit' => '积分',
        'recharge_enabled'      => false,
        'recharge_min_amount'   => 1,
        'recharge_token_ratio'  => 1,
        'recharge_credit_ratio' => 1,
        // 直充分类型显示开关 + 套餐商城开关：默认开启，保持升级前行为不变
        'recharge_token_enabled'  => true,
        'recharge_credit_enabled' => true,
        'plans_store_enabled'     => true,
        'site_title'            => 'Agent Admin',
        // 店铺商品图各商城显示名（终端用户可见，隐藏平台品牌；云控端按商城自定义）。缺省「商城」。
        'ewei_shop_mall_name'   => '商城',
        'dianda_shop_mall_name' => '商城',
        'qdyun_shop_mall_name'  => '商城',
        'homepage_enabled'      => true,
        // 未配置过 homepage_template 时（旧站点升级 / 全新装）默认走原 default 模板，
        // 老客户升级后官网展示完全不变，需要才在后台切到 minimal
        'homepage_template'     => 'default',
        // 共享灵感库默认关闭，需 admin 显式开启并填 endpoint
        'inspiration_hub_enabled' => false,
        'shared_hub_desktop_imported_at' => '',
        'storage_type'          => 'local',
        // 云同步：默认开启同步开关，但容量计费默认关闭（不限制），管理员按需开启并配置套餐容量
        'sync_enabled'             => true,
        'storage_default_bytes'    => 0,
        'storage_billing_enabled'  => false,
        'storage_overage_policy'   => 'readonly',
        'sync_max_blob_mb'         => 200,
        // 桌面端默认对话模型：未设置时默认指向云端虚拟服务商；具体 model_id 留空让桌面端回退本地第一个 chat 模型
        'chat_default_model_provider' => 'cloud:default',
        // 文档管理默认值
        'docs_enabled'           => true,
        'docs_guest_access'      => true,
        'docs_site_title'        => '帮助文档',
        // RAG 默认关闭，需 admin 显式开启并选择模型
        'docs_rag_enabled'       => false,
        'docs_chat_allow_guest'  => false,
        'docs_chunk_size'        => 800,
        'docs_chunk_overlap'     => 100,
        'docs_retrieve_top_k'    => 6,
        'docs_min_similarity'    => 0.30,
        // 云端知识库默认值（需 admin 在「知识库设置」选择 embedding 模型后才能向量化）
        'kb_chunk_size'          => 800,
        'kb_chunk_overlap'       => 100,
        'kb_retrieve_top_k'      => 6,
        'kb_min_similarity'      => 0.30,
        'kb_hybrid_enabled'      => true,
        // Qdrant collection 缺省名（url 留空表示未配置，向量化/检索不可用）
        'kb_qdrant_collection'   => 'kb_chunks',
        // AI 抠图默认值（管理员可在「AI 抠图 → 自定义设置」覆盖）
        'matting_enabled'             => false,
        'matting_endpoint'            => 'imageseg.cn-shanghai.aliyuncs.com',
        'matting_region_id'           => 'cn-shanghai',
        'matting_credit_per_call'     => 0.2,
        // 精细抠图默认值（三档单价不预设，留空=0，管理员必须在「精细抠图 → 自定义设置」配置）
        'fine_matting_enabled'          => false,
        'fine_matting_tier_threshold_1' => 4096,
        'fine_matting_tier_threshold_2' => 7680,
        // 去AI标记默认值（默认关闭，需管理员在系统设置开启并配置单价）
        'ai_mark_removal_enabled'         => false,
        'ai_mark_removal_use_all'         => false,
        'ai_mark_removal_credit_per_call' => 0.1,
        // 默认系统提示词：友好版，区分寒暄 / 业务问题 / 文档不足三种场景
        // 旧版（1.3.13 及之前）对寒暄过严，会把「你好」也回成「未找到相关信息」并机械附 [1] [2]
        // 新版加入寒暄豁免 + 引用编号仅在真引用文档时使用
        // 占位符：{site_title} 站点标题，{context} 召回的文档片段，{query} 用户问题
        'docs_system_prompt'     => "你是「{site_title}」的文档助手。请按以下原则回答用户问题：\n\n1. 优先依据下方 <文档片段> 回答；如果文档里有相关信息，请清晰、有条理地总结，并在引用某段时在末尾用 [1] [2] 标注来源。\n2. 如果用户在打招呼、寒暄或问你是谁，请友好简短回应一两句，并主动告诉用户你可以帮他查站内文档，邀请他提具体问题。这种情况下不要带 [1] [2]。\n3. 如果 <文档片段> 不足以回答用户的具体问题，回答「抱歉，我在文档里没有找到相关信息，可以换个说法或换个关键词再试一下」，不要带 [1] [2]，不要编造。\n4. 不要使用文档之外的外部知识回答业务问题。\n\n<文档片段>\n{context}\n</文档片段>\n\n用户问题：{query}",
    ];

    /**
     * 加密字段集合（getAll 时不返回明文，仅返回 has_xxx 标志位）
     */
    public static function isEncrypted(string $key): bool
    {
        return (self::ALLOWED_KEYS[$key] ?? null) === 'encrypted';
    }

    /**
     * 「非加密但留空即视为不修改」的关键存储凭据键：防止前端一打开设置表单、未重填就把已配好的
     * 存储凭据/地域/桶覆盖成空串——空串会让 loadCosConfig/loadOssConfig 直接判定配置不完整而返回
     * null，导致上传等功能整体失效。与加密字段的留空保护同源。自定义域名 cos_domain/oss_domain
     * 是可选项、允许清空（清空 = 走默认对象存储域名），故不在此列。
     */
    public const EMPTY_PROTECTED_KEYS = [
        'cos_secret_id', 'cos_region', 'cos_bucket', 'cos_app_id',
        'oss_access_key_id', 'oss_endpoint', 'oss_bucket',
    ];

    /**
     * 该键在「提交值为空」时是否应跳过更新（保持原值）：加密字段 + 关键存储凭据。
     */
    public static function skipEmptyUpdate(string $key): bool
    {
        return self::isEncrypted($key) || in_array($key, self::EMPTY_PROTECTED_KEYS, true);
    }

    public static function getValue(string $key, $default = null)
    {
        if (!array_key_exists($key, self::ALLOWED_KEYS)) return $default;

        $row = static::query()->where('key', $key)->first();
        if (!$row) return self::businessDefault($key, $default);

        $cast = self::cast($row->value, self::ALLOWED_KEYS[$key]);
        // 字符串类型 且 设置为空 且 有业务默认 -> 返回业务默认
        if ($cast === '' && isset(self::DEFAULT_VALUES[$key])) {
            return self::DEFAULT_VALUES[$key];
        }
        return $cast;
    }

    private static function businessDefault(string $key, $fallback)
    {
        return self::DEFAULT_VALUES[$key] ?? $fallback;
    }

    public static function setValue(string $key, $value): void
    {
        if (!array_key_exists($key, self::ALLOWED_KEYS)) {
            throw new \InvalidArgumentException("Key not allowed: {$key}");
        }

        $serialized = self::serialize($value, self::ALLOWED_KEYS[$key]);

        static::query()->updateOrCreate(['key' => $key], ['value' => $serialized]);
    }

    public static function getAll(): array
    {
        $rows = static::whereIn('key', array_keys(self::ALLOWED_KEYS))->get();
        $result = [];
        foreach (self::ALLOWED_KEYS as $key => $type) {
            $row = $rows->firstWhere('key', $key);
            if ($type === 'encrypted') {
                // 永不返回明文，仅返回是否已配置
                $result[$key] = '';
                $result['has_' . $key] = $row ? !empty($row->value) : false;
            } else {
                $cast = $row ? self::cast($row->value, $type) : self::businessDefault($key, self::defaultFor($type));
                // 业务默认值覆盖（限字符串类型、值为空串时）
                if ($cast === '' && isset(self::DEFAULT_VALUES[$key])) {
                    $cast = self::DEFAULT_VALUES[$key];
                }
                $result[$key] = $cast;
            }
        }
        return $result;
    }

    /**
     * 获取原始值（解密后的明文），仅供后端 Service 内部使用，不要暴露给 API 响应。
     */
    public static function getRawValue(string $key, $default = null)
    {
        if (!array_key_exists($key, self::ALLOWED_KEYS)) return $default;
        $row = static::query()->where('key', $key)->first();
        if (!$row) return $default;
        $type = self::ALLOWED_KEYS[$key];
        if ($type === 'encrypted') {
            if ($row->value === '' || $row->value === null) return $default;
            try {
                return Crypt::decryptString($row->value);
            } catch (\Throwable $e) {
                return $default;
            }
        }
        return self::cast($row->value, $type);
    }

    private static function cast($raw, string $type)
    {
        switch ($type) {
            case 'bool':
                return in_array($raw, ['1', 1, true, 'true'], true);
            case 'int':
                return (int)$raw;
            case 'int_nullable':
                return ($raw === '' || $raw === null) ? null : (int)$raw;
            case 'float':
                return (float)$raw;
            case 'encrypted':
                // cast 在 getAll 中不再走此分支（已在上面单独处理）
                if ($raw === '' || $raw === null) return '';
                try { return Crypt::decryptString($raw); } catch (\Throwable $e) { return ''; }
            case 'text':
            case 'string':
            default:
                return (string)$raw;
        }
    }

    private static function serialize($value, string $type): string
    {
        switch ($type) {
            case 'bool':
                return ($value === true || $value === '1' || $value === 1 || $value === 'true') ? '1' : '0';
            case 'int':
                return (string)(int)$value;
            case 'int_nullable':
                return ($value === null || $value === '') ? '' : (string)(int)$value;
            case 'float':
                return (string)(float)$value;
            case 'encrypted':
                $str = (string)$value;
                if ($str === '') return '';
                return Crypt::encryptString($str);
            case 'text':
            case 'string':
            default:
                return (string)$value;
        }
    }

    private static function defaultFor(string $type)
    {
        switch ($type) {
            case 'bool': return false;
            case 'int': return 0;
            case 'int_nullable': return null;
            case 'float': return 0.0;
            case 'encrypted': return '';
            case 'text':
            case 'string':
            default: return '';
        }
    }
}
