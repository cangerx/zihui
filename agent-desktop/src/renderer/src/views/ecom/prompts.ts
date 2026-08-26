// 电商 AI 生图：内置提示词与模式枚举（全部内置，不展示给用户）。
//
// 设计原则：提示词 = 固定骨架(System) + 模式片段(按开关拼接) + 用户输入(填空)。
// - 一步直出型（batchsku）：directTemplate 直接拼成生图 prompt。
// - 两步法型（ecomclone / main / detail / poster）：先用 systemPrompt 让 LLM
//   产出"详细生图描述词"，再把描述词交给生图模型。两步对用户均不可见。
//
// 枚举值大量沿用 koukoutu 的成熟分类（语言 / 平台 / 风格 / 海报场景 / 行业 /
// 详情页模块），但 systemPrompt 为自有撰写，避免直接抄袭后端实现。

import type {
  BatchSkuForm,
  EcomCloneForm,
  EcomGeneratorForm,
  Option,
  PosterForm,
} from './types'

/** 语言选项（画面文字语言）。 */
export const LANGUAGES: Option[] = [
  { value: '简体中文', label: '简体中文' },
  { value: '英语', label: '英语' },
  { value: '繁体中文', label: '繁体中文' },
  { value: '日语', label: '日语' },
  { value: '韩语', label: '韩语' },
  { value: '泰语', label: '泰语' },
  { value: '西班牙语', label: '西班牙语' },
  { value: '法语', label: '法语' },
  { value: '德语', label: '德语' },
  { value: '马来语', label: '马来语' },
  { value: '阿拉伯语', label: '阿拉伯语' },
  { value: '俄语', label: '俄语' },
  { value: '越南语', label: '越南语' },
  { value: '印尼语', label: '印尼语' },
  { value: '意大利语', label: '意大利语' },
  { value: '葡萄牙语', label: '葡萄牙语' },
  { value: '无文字', label: '无文字' },
  { value: '自定义', label: '自定义' },
]

/** 电商平台调性。 */
export const PLATFORMS: Option[] = [
  { value: 'general', label: '通用' },
  { value: 'taobao', label: '淘宝' },
  { value: 'tmall', label: '天猫' },
  { value: 'jd', label: '京东' },
  { value: 'pinduoduo', label: '拼多多' },
  { value: 'douyin', label: '抖音电商' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'amazon', label: '亚马逊' },
  { value: 'temu', label: 'Temu' },
  { value: 'shein', label: 'SHEIN' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'lazada', label: 'Lazada' },
  { value: 'independent', label: '独立站' },
]

/** 内置风格预设（主图 / 海报共用）。 */
export const STYLE_PRESETS: Option[] = [
  { value: 'minimalist', label: '极简白', desc: '纯白背景，简洁排版，突出产品本身' },
  { value: 'dark-luxury', label: '暗调奢华', desc: '深色背景，金色点缀，营造高级感' },
  { value: 'fresh-nature', label: '清新自然', desc: '绿植搭配，自然光感，清新文艺风' },
  { value: 'bold-color', label: '撞色活力', desc: '高饱和撞色，视觉冲击强，年轻潮流' },
  { value: 'warm-lifestyle', label: '温暖生活', desc: '暖色调，生活场景，亲切居家感' },
  { value: 'tech-cool', label: '科技冷酷', desc: '蓝黑色调，科技感线条，数码产品首选' },
  { value: 'vintage', label: '复古胶片', desc: '胶片质感，复古色调，文艺怀旧风' },
  { value: 'pastel-soft', label: '马卡龙', desc: '粉嫩马卡龙配色，甜美少女风' },
]

/** 详情页模块（imageType==='detail'）。 */
export const DETAIL_MODULES: Option[] = [
  { value: '首屏主视觉', label: '首屏主视觉', desc: '传递核心价值' },
  { value: '核心卖点图', label: '核心卖点图', desc: '突出差异化优势' },
  { value: '使用场景图', label: '使用场景图', desc: '呈现真实使用场景' },
  { value: '多角度图', label: '多角度图', desc: '多角度呈现外观' },
  { value: '商品细节图', label: '商品细节图', desc: '放大材质与工艺' },
  { value: '品牌故事图', label: '品牌故事图', desc: '传达品牌理念' },
  { value: '尺寸规格图', label: '尺寸规格图', desc: '展示规格信息' },
  { value: '效果对比图', label: '效果对比图', desc: '使用前后效果对比' },
  { value: '参数表', label: '参数表', desc: '展示详细商品数据' },
  { value: '配件赠品图', label: '配件赠品图', desc: '明确收货的所有物品' },
]

/** 海报用途场景。 */
export const POSTER_SCENARIOS: Option[] = [
  { value: 'general', label: '通用海报', desc: '不限制场景，AI 自由设计' },
  { value: 'promotion', label: '促销营销', desc: '突出促销、价格优势、限时优惠' },
  { value: 'branding', label: '品牌宣传', desc: '突出品牌形象与企业文化' },
  { value: 'event', label: '活动通知', desc: '发布会、展会、线下活动通知' },
  { value: 'social', label: '社交媒体', desc: '适合朋友圈、小红书等平台传播' },
  { value: 'festival', label: '节日节庆', desc: '节日主题，营造氛围与祝福' },
  { value: 'food', label: '美食饮品', desc: '突出食欲感与产品质感' },
  { value: 'beauty', label: '美妆时尚', desc: '突出质感与时尚调性' },
]

/** 行业。 */
export const POSTER_INDUSTRIES: Option[] = [
  { value: 'general', label: '通用' },
  { value: 'food', label: '食品饮料' },
  { value: 'fashion', label: '服装鞋帽' },
  { value: 'electronics', label: '3C数码' },
  { value: 'beauty', label: '美妆护肤' },
  { value: 'home', label: '家居日用' },
  { value: 'sports', label: '运动户外' },
  { value: 'automotive', label: '汽车交通' },
  { value: 'realestate', label: '房地产' },
  { value: 'education', label: '教育培训' },
]

function labelOf(list: Option[], value: string): string {
  return list.find((o) => o.value === value)?.label || value
}
function descOf(list: Option[], value: string): string {
  return list.find((o) => o.value === value)?.desc || ''
}
/** 把语言枚举解析为真实语言名（处理"自定义"/"无文字"）。 */
function resolveLanguage(language: string, custom: string): string {
  if (language === '自定义') return (custom || '').trim() || '简体中文'
  return language
}
/** 风格预设 value → 注入提示词的「视觉风格」描述句；空值 / 未命中返回空串。 */
export function styleClause(value: string): string {
  if (!value) return ''
  const s = STYLE_PRESETS.find((o) => o.value === value)
  return s ? `视觉风格：${s.label}（${s.desc}）` : ''
}

/**
 * 参考图使用说明（主图 / 详情页 / 海报用）。两步法的 LLM 看不到图、描述词不含图的角色，
 * 这里用确定性文字把「产品图 / 风格参考图 / 品牌 Logo」的用途与图序讲清，拼到最终生图
 * prompt 末尾，让出图模型知道每张参考图该怎么用（尤其 Logo 要原样叠加、产品要严格还原）。
 *
 * 调用方须保证 refImages 的实际顺序与此一致：产品图… → 风格参考图? → 品牌 Logo?
 */
export function buildRefImageInstruction(opts: {
  productCount: number
  hasStyle: boolean
  hasLogo: boolean
}): string {
  const { productCount, hasStyle, hasLogo } = opts
  const total = productCount + (hasStyle ? 1 : 0) + (hasLogo ? 1 : 0)
  if (total === 0) return ''
  // 图号严格对应调用方拼接 refImages 的顺序：产品图… → 风格参考图? → 品牌 Logo?
  // 用「图N」显式锁定每张图的角色，避免模型把风格图当产品、或忽略 Logo。
  const productLabel = productCount > 1 ? `图1-图${productCount}` : '图1'
  const styleIndex = productCount + 1
  const logoIndex = productCount + (hasStyle ? 1 : 0) + 1
  const order: string[] = []
  if (productCount > 0) order.push(`${productLabel} 为产品图`)
  if (hasStyle) order.push(`图${styleIndex} 为风格参考图`)
  if (hasLogo) order.push(`图${logoIndex} 为品牌 Logo`)
  const lines: string[] = [
    `【参考图使用说明】本次随附 ${total} 张参考图，请严格按图号区分用途：${order.join('、')}。`,
  ]
  if (productCount > 0)
    lines.push(
      `· ${productLabel}（产品图）：画面主体，必须严格以产品图为准还原产品的造型、颜色、材质、比例与细节，不得改变、替换或臆造。`,
    )
  if (hasStyle)
    lines.push(
      `· 图${styleIndex}（风格参考图）：严格参考其整体视觉风格、配色、光影与构图版式，使成图风格与之高度一致；但不要照搬其中的产品、文字或具体元素。`,
    )
  if (hasLogo)
    lines.push(
      `· 图${logoIndex}（品牌 Logo）：必须原样、清晰、不变形、不改色地放置在画面中不遮挡主体的合适位置（如某一角落），尺寸适中。`,
    )
  return lines.join('\n')
}

// ============ 1) 批量 SKU 生成：一步直出 ============
export const batchSku = {
  /** 内置默认提示词（用户可在 UI 编辑） */
  directTemplate:
    '复刻图1整体画面构图、光影、背景、场景与风格，将图1主体产品替换为图2中的产品；' +
    '全程保证图2产品造型、细节、角度、画质、色调完全统一，不改变产品本身的形状、颜色、材质与logo。',
  /** 直接返回最终生图提示词（图序在调用处保证：图1=模板，图2=产品） */
  buildDirectPrompt(form: BatchSkuForm): string {
    return (form.prompt || batchSku.directTemplate).trim()
  },
}

// ============ 2) 电商图复刻：一步直出（图生图编辑） ============
// 图1=版式参考图，图2=产品图。指令显式锁定图序，避免模型混淆两图角色。
export const ecomClone = {
  /** 最终生图指令骨架（图序在调用处保证：图1=参考图，图2=产品图） */
  directTemplate:
    '这是图生图编辑任务，共两张参考图：图1为版式参考图，图2为产品图。' +
    '请严格复刻图1的整体构图、版式、配色、光影与场景氛围，仅把图1中的主体产品替换为图2中的产品；' +
    '必须 100% 保持图2产品的造型、颜色、材质、Logo 与细节，不得改变或臆造。',
  /** 拼接用户侧约束（把模式开关翻译成自然语言要求） */
  buildUserPrompt(form: EcomCloneForm): string {
    const lang = resolveLanguage(form.language, form.customLanguage)
    const lines: string[] = []
    if (form.textContentMode === 'keep') lines.push('文字内容：保留图1中的全部文字，一字不改。')
    else if (form.textContentMode === 'custom')
      lines.push(`文字内容：将文案替换为「${form.customText || ''}」。`)
    else lines.push('文字内容：在保持版式的前提下，创意优化文案，使其更具营销力。')
    if (form.textLayoutMode === 'keep') lines.push('文字排版：保持图1中文字的位置与排版布局不变。')
    else lines.push('文字排版：可重新设计文字排版，使其更协调美观。')
    if (lang !== '无文字') lines.push(`画面文字语言：${lang}（如与图1不同则翻译）。`)
    else lines.push('画面不出现任何文字。')
    if (form.otherRequirements.trim()) lines.push(`其他要求：${form.otherRequirements.trim()}`)
    return lines.join('\n')
  },
}

// ============ 3) 主图 / 详情页：两步法 ============
export const ecomGenerator = {
  /** 第一步 system：让 LLM 产出 N 条独立生图描述词（JSON 数组） */
  buildSystemPrompt(form: EcomGeneratorForm, opts: { withImages?: boolean } = {}): string {
    const isDetail = form.imageType === 'detail'
    const role = isDetail
      ? '你是资深电商详情页视觉设计师与提示词工程师。'
      : '你是资深电商主图视觉设计师与提示词工程师。'
    const focus = isDetail
      ? '每条描述对应详情页的一屏，需图文结合、信息层次清晰、阅读节奏顺畅。'
      : '每条描述聚焦一张主图，要求主体突出、3 秒抓眼球、首屏留出标题区。'
    // withImages：第一步描述词模型支持视觉时，已随消息附上产品图/风格图，应让其据图撰写；
    // 否则模型看不到图，沿用"不要臆造产品外观"的盲写约束。
    const refClause = opts.withImages
      ? '本次已随附产品图（可能还有风格参考图）供你直接观察：请准确理解产品的真实品类、外观与材质，并贴合风格参考图的调性来撰写画面描述；描述须与所附图片一致，不要写出与图片冲突的产品外观。最终出图模型也会拿到这些参考图。'
      : '用户会另行向出图模型提供产品图（可能还有品牌 Logo）作为参考，你只需描述画面、版式、光影与氛围，不要臆造产品的具体外观（颜色、形状、文字、Logo），以免与真实产品冲突。'
    return [
      role,
      `根据用户提供的产品信息，撰写 {count} 条独立、详细、可直接用于"图生图/文生图"模型的中文画面描述。`,
      '每条描述需包含：主体与摆位、背景与场景、光影、色调、构图、镜头与氛围；',
      focus,
      refClause,
      '严格围绕产品卖点，符合所选电商平台调性与画面比例；画面文字简短有力，使用指定语言。',
      '只输出 JSON 字符串数组，例如 ["描述1","描述2"]，不要任何解释或多余字符。',
    ].join('\n')
  },
  /** 第一步 user：产品信息 + 模式片段 */
  buildUserPrompt(form: EcomGeneratorForm): string {
    const lang = resolveLanguage(form.language, form.customLanguage)
    const lines: string[] = [
      `产品名称：${form.productName || '（见参考图）'}`,
      `核心卖点：${form.sellingPoints || '（自行从产品图提炼）'}`,
      `电商平台：${labelOf(PLATFORMS, form.platform)}`,
      `画面文字语言：${lang}`,
      `画面比例：${form.aspectRatio}`,
    ]
    const sc = styleClause(form.stylePreset)
    if (sc) lines.push(sc)
    if (form.imageType === 'detail' && form.detailModules.length) {
      lines.push(`需要的详情页模块（按顺序各生成一屏）：${form.detailModules.join('、')}`)
    }
    if (form.imageType === 'main' && form.ctaText.trim()) {
      lines.push(`促销角标 / 行动号召文案：${form.ctaText.trim()}（请醒目地排布在画面合适位置）`)
    }
    if (form.requirements.trim()) lines.push(`特殊要求：${form.requirements.trim()}`)
    return lines.join('\n')
  },
  /**
   * 把"必须精确"的确定性字段拼成硬约束块，原样追加到最终生图 prompt。
   * 这些字段（画面文字语言、CTA 文案、卖点、风格、特殊要求）在两步法里只喂给了第一步
   * 描述词模型，若 LLM 转述不力会丢失；此处再原样注入最终 prompt，作为对出图模型的硬约束。
   */
  buildHardConstraints(form: EcomGeneratorForm): string {
    const lang = resolveLanguage(form.language, form.customLanguage)
    const lines: string[] = []
    if (form.language === '无文字') lines.push('· 画面不出现任何文字。')
    else lines.push(`· 画面文字一律使用${lang}。`)
    if (form.imageType === 'main' && form.ctaText.trim())
      lines.push(`· 必须在画面醒目位置准确无误地呈现文案：「${form.ctaText.trim()}」。`)
    if (form.sellingPoints.trim()) lines.push(`· 重点突出卖点：${form.sellingPoints.trim()}。`)
    const sc = styleClause(form.stylePreset)
    if (sc) lines.push(`· ${sc}。`)
    if (form.requirements.trim()) lines.push(`· 特殊要求：${form.requirements.trim()}。`)
    if (!lines.length) return ''
    return ['【画面硬性要求（务必逐条满足）】', ...lines].join('\n')
  },
}

// ============ 4) 海报生成：两步法 ============
export const poster = {
  buildSystemPrompt(form: PosterForm, opts: { withImages?: boolean } = {}): string {
    const base = form.hasProductImage
      ? '你是资深商业海报设计师与提示词工程师。用户会提供产品图与信息，请结合二者设计海报。'
      : '你是资深商业海报设计师与提示词工程师。用户不提供产品图，请依据文字描述创意生成整张海报。'
    const count = form.posterType === 'double' ? 2 : '{count}'
    const dual =
      form.posterType === 'double'
        ? '本次需生成 2 张：第 1 张为正面（主视觉 + 主标题 + 核心信息），第 2 张为背面（详细信息 + 行动号召）。'
        : `本次需生成 ${count} 张独立海报，各有不同的视觉切入点。`
    // withImages：描述词模型支持视觉时，已随消息附上产品图/风格图，应据图撰写；否则盲写。
    const refClause = opts.withImages
      ? '本次已随附产品图（可能还有风格参考图）供你直接观察：请准确理解产品的真实外观与品类，并贴合风格参考图的调性撰写海报描述；描述须与所附图片一致，不要臆造与图片冲突的产品外观或 Logo。最终出图模型也会拿到这些参考图。'
      : '若用户提供了产品图 / 品牌 Logo，将由出图模型直接使用，你只需描述画面与版式，不要臆造产品外观或 Logo，以免与真实素材冲突。'
    return [
      base,
      dual,
      refClause,
      '每条描述需包含：主视觉、版式布局、配色、字体气质、文案位置与层级、氛围。',
      `海报用途：${descOf(POSTER_SCENARIOS, form.scenario) || labelOf(POSTER_SCENARIOS, form.scenario)}；`,
      `行业调性：${labelOf(POSTER_INDUSTRIES, form.industry)}。`,
      '只输出 JSON 字符串数组，不要任何解释。',
    ].join('\n')
  },
  buildUserPrompt(form: PosterForm): string {
    const lang = resolveLanguage(form.language, form.customLanguage)
    const lines: string[] = [
      `主题/产品：${form.productName || '（见描述）'}`,
      `核心信息/卖点：${form.sellingPoints || ''}`,
      `画面文字语言：${lang}`,
      `画面比例：${form.aspectRatio}`,
    ]
    const sc = styleClause(form.stylePreset)
    if (sc) lines.push(sc)
    if (form.userDescription.trim()) lines.push(`画面描述：${form.userDescription.trim()}`)
    if (form.ctaText.trim()) lines.push(`行动号召文案（CTA）：${form.ctaText.trim()}`)
    if (form.requirements.trim()) lines.push(`补充要求：${form.requirements.trim()}`)
    return lines.join('\n')
  },
  /** 同 ecomGenerator.buildHardConstraints：把确定性字段原样追加进最终生图 prompt。 */
  buildHardConstraints(form: PosterForm): string {
    const lang = resolveLanguage(form.language, form.customLanguage)
    const lines: string[] = []
    if (form.language === '无文字') lines.push('· 画面不出现任何文字。')
    else lines.push(`· 画面文字一律使用${lang}。`)
    if (form.ctaText.trim()) lines.push(`· 必须准确呈现行动号召文案：「${form.ctaText.trim()}」。`)
    if (form.sellingPoints.trim()) lines.push(`· 重点突出核心信息/卖点：${form.sellingPoints.trim()}。`)
    if (form.userDescription.trim()) lines.push(`· 画面需体现：${form.userDescription.trim()}。`)
    const sc = styleClause(form.stylePreset)
    if (sc) lines.push(`· ${sc}。`)
    if (form.requirements.trim()) lines.push(`· 补充要求：${form.requirements.trim()}。`)
    if (!lines.length) return ''
    return ['【画面硬性要求（务必逐条满足）】', ...lines].join('\n')
  },
}

export const PROMPTS = { batchSku, ecomClone, ecomGenerator, poster }
