/**
 * mock 数据（dev-only）
 * 与真实接口同路径同签名，联调时 VITE_USE_MOCK=false 即可切换。
 * 占位图在 src/static/mock/，上线前可整体移除。
 */
import type {
  AppCategory,
  AppDetailRaw,
  ImageCaptchaResult,
  LoginResult,
  WorkflowQueryResult,
  WorkflowRunResult,
} from '../types'

const img = (n: number) => `/static/mock/m${((n - 1) % 12) + 1}.jpg`

/* ========== 首页 ========== */

export interface HomeCategory {
  key: string
  name: string
}

export interface HomeShowcase {
  id: string
  cover: string
  title: string
  /** 是否视频卡 */
  video?: boolean
  /**
   * 点卡后回填进 AI 输入卡的内容（对照 原型图/0d2c…jpg）：
   * prompt 为整段生成描述，refs 为参考图缩略图（原型为 3 张）。
   */
  prompt?: string
  refs?: string[]
}

export interface HomeEntry {
  key: string
  name: string
  icon: string
  badge?: 'NEW' | 'HOT'
  /** 目标：intro=介绍页，run=通用功能页，suite=电商套图独立运行页 */
  target: 'intro' | 'run' | 'canvas' | 'ai-image' | 'suite'
  appUuid?: string
}

export interface TemplateItem {
  id: string
  cover: string
  /**
   * 仅用于无障碍标签。原型的模板卡是纯图片卡，文案印在图里，
   * 卡片之间只有 25–31px 纯白间隙，装不下标题行——不要渲染成可见文字。
   */
  title: string
  /** 卡片高度比例，用于瀑布流 */
  ratio: number
  /**
   * 点击后进入的功能 uuid。
   * TODO(api)：模板→功能的映射后端未定义，/template 接口也没这个字段，
   * 这里 mock 统一给 app-ai-image（模板本质是图像风格参考，最贴近生图）。
   * 真实映射待后端提供，联调时替换。
   */
  appUuid: string
  /** 任务态（仅最近任务页用）：running=生成中 done=已完成。TODO(api) 待后端任务列表接口 */
  status?: 'running' | 'done'
}

export const homeCategories: HomeCategory[] = [
  { key: 'hot', name: '热门🔥' },
  { key: 'ecommerce', name: '电商套图' },
  { key: 'social', name: '社交媒体' },
  { key: 'video', name: '带货视频' },
  { key: 'wear', name: '服饰穿戴' },
  { key: 'people', name: '人物互动' },
]

/**
 * 案例卡的回填内容。原型里点卡后输入卡会出现 3 张参考图 + 一段完整生成描述，
 * 这里按卡片标题合成，保证每张卡都有可回填的内容。
 * TODO(api)：案例配方接口后端未提供
 */
function withFill(list: Array<{ id: string; cover: string; title: string; video?: boolean }>, seed: number) {
  return list.map((item, i) => ({
    ...item,
    prompt: `${item.title}：商品居中构图，干净通透的背景，柔和自然光加轻微投影，突出材质与卖点细节，商业摄影质感，画面整洁留白得当`,
    refs: [item.cover, img(seed + i + 1), img(seed + i + 5)],
  }))
}

export const homeShowcases: Record<string, HomeShowcase[]> = {
  hot: withFill(
    [
      { id: 's1', cover: img(1), title: '穿搭切片海报' },
      { id: 's2', cover: img(2), title: '防晒衣淘宝详情长图' },
      { id: 's3', cover: img(3), title: '世界杯球衣穿搭' },
      { id: 's4', cover: img(4), title: '夏日饮品主图' },
    ],
    1,
  ),
  ecommerce: withFill(
    [
      { id: 's5', cover: img(5), title: '跨境电商套图' },
      { id: 's6', cover: img(6), title: '亚马逊 Listing 图' },
      { id: 's7', cover: img(7), title: '详情页 A+ 模板' },
    ],
    3,
  ),
  social: withFill(
    [
      { id: 's8', cover: img(8), title: '小红书封面' },
      { id: 's9', cover: img(9), title: '朋友圈九宫格' },
      { id: 's10', cover: img(10), title: '公众号头图' },
    ],
    5,
  ),
  video: withFill(
    [
      { id: 's11', cover: img(11), title: '香调香水带货视频', video: true },
      { id: 's12', cover: img(12), title: '夏日卡点变装营销视频', video: true },
      { id: 's13', cover: img(1), title: '社媒营销带货视频', video: true },
    ],
    7,
  ),
  wear: withFill(
    [
      { id: 's14', cover: img(2), title: '模特试穿图' },
      { id: 's15', cover: img(3), title: '平铺转上身' },
      { id: 's16', cover: img(4), title: '服饰细节图' },
    ],
    9,
  ),
  people: withFill(
    [
      { id: 's17', cover: img(5), title: '双人互动场景' },
      { id: 's18', cover: img(6), title: '人物合影生成' },
      { id: 's19', cover: img(7), title: '人物换装' },
    ],
    2,
  ),
}

/**
 * 原型是 2 行 × 4 列共 8 项、不可翻页（已像素验证：两行标签组各 4 个）。
 * 不要加到 8 项以上，否则 entry-grid 会切成多页产生原型没有的翻页交互。
 */
export const homeEntries: HomeEntry[] = [
  // 电商套图有专属内页（原型图/9403…jpg），直达独立运行页，不再经介绍页分发
  { key: 'ecommerce-suite', name: '电商套图', icon: 'suite', badge: 'NEW', target: 'suite', appUuid: 'app-ecommerce-suite' },
  { key: 'matting', name: '智能抠图', icon: 'matting', target: 'run', appUuid: 'app-matting' },
  { key: 'erase', name: 'AI消除', icon: 'erase', target: 'run', appUuid: 'app-erase' },
  { key: 'hd', name: '画质修复', icon: 'hd', target: 'run', appUuid: 'app-hd' },
  { key: 'canvas', name: '空白画布', icon: 'canvas', target: 'canvas' },
  { key: 'edit', name: '图片编辑', icon: 'edit', target: 'run', appUuid: 'app-edit' },
  { key: 'hot-video', name: '爆款视频', icon: 'video', badge: 'NEW', target: 'intro', appUuid: 'app-hot-video' },
  { key: 'aplus', name: '详情页A+', icon: 'aplus', target: 'intro', appUuid: 'app-aplus' },
]

export const homeRecommendTabs = ['推荐', '爆款视频', '小暑时节', '电商主图']

const titles = [
  '社媒带货视频',
  '早起的动力是什么',
  '一岁九个月的宝宝会说话了吗',
  '喜报海报模板',
  '限时特惠主图',
  '为什么今天这么多瓜',
  '盛夏序章 2026',
  'GOOD LUCK 毕业季',
  '暑期计划手账',
  '怎么在短期内上岸编制',
  '夏日新品上新',
  '母婴用品详情页',
]

export interface TemplateQuery {
  keyword?: string
  /** 一级分类 tab 名，'全部' 视为不过滤 */
  tab?: string
  /** 筛选行选中值，键为 templateFilters.key */
  filters?: Record<string, string>
  sort?: string
}

/**
 * mock 模板列表。必须真的按 query 过滤——否则页面上搜索/筛选/排序点了没反应，
 * 看起来像功能坏了。
 */
export function makeTemplates(page: number, size = 20, query: TemplateQuery = {}): TemplateItem[] {
  const all = Array.from({ length: size }, (_, i) => {
    const n = (page - 1) * size + i + 1
    return {
      id: `tpl-${n}`,
      cover: img(n),
      title: titles[(n - 1) % titles.length],
      ratio: [1.33, 1.0, 1.5, 1.2, 1.78][(n - 1) % 5],
      appUuid: 'app-ai-image',
    }
  })

  const keyword = query.keyword?.trim()
  let list = keyword ? all.filter((item) => item.title.includes(keyword)) : all

  // tab / 筛选：mock 没有真实标签维度，按 id 做稳定的确定性抽样，保证「切了有变化」
  const picks = [query.tab, query.filters?.industry, query.filters?.usage, query.filters?.layout]
    .filter((v): v is string => Boolean(v) && v !== '全部')
  if (picks.length) {
    const seed = picks.join('').length
    list = list.filter((item) => (Number(item.id.replace('tpl-', '')) + seed) % 3 !== 0)
  }

  if (query.sort === '最新') list = [...list].reverse()
  else if (query.sort === '最热') list = [...list].sort((a, b) => b.ratio - a.ratio)

  return list
}

/**
 * 模板 id → 功能 uuid。tool-run 拿模板 id 反查该进哪个功能。
 * TODO(api)：真实应由 /template/GetTemplate 返回 appUuid，现 mock 统一 app-ai-image。
 * makeTemplates 是按页动态生成、无全局表，故这里不查表、直接返回既定映射。
 */
export function getTemplateAppUuid(_templateId: string): string {
  return 'app-ai-image'
}

/* ========== 模板页 ========== */

export const templateTabs = ['全部', 'VIP', '爆款视频', '电商', '社交媒体', '教育培训', '餐饮美食']

export const templateFilters = [
  { key: 'industry', name: '行业' },
  { key: 'usage', name: '用途' },
  { key: 'layout', name: '版式' },
  { key: 'more', name: '更多' },
]

export const templateSorts = ['综合排序', '最新', '最热']

/* ========== 工具页 ========== */

export const appCategories: AppCategory[] = [
  {
    name: '常用工具',
    apps: [
      { uuid: 'app-erase', name: 'AI消除', poster: img(1), icon: 'erase', description: '一键去除多余元素' },
      { uuid: 'app-matting', name: '智能抠图', poster: img(2), icon: 'matting', description: '发丝级精准抠图' },
      { uuid: 'app-hd', name: '画质修复', poster: img(3), icon: 'hd', description: '视频图片都能修，拯救渣画质' },
      { uuid: 'app-edit', name: '图片编辑', poster: img(4), icon: 'edit', description: '裁剪滤镜文字一站式' },
      { uuid: 'app-canvas', name: '空白画布', poster: img(5), icon: 'canvas', description: '自定义尺寸从零开始' },
      { uuid: 'app-ai-image', name: 'AI生图', poster: img(6), icon: 'ai-image', description: '文生图 / 图生图' },
    ],
  },
  {
    name: '电商设计',
    apps: [
      { uuid: 'app-ecommerce-suite', name: '电商套图', poster: img(5), icon: 'suite', description: '一句话生成全套主图' },
      { uuid: 'app-aplus', name: '详情页A+', poster: img(6), icon: 'aplus', description: '上传商品图，AI 生成专业详情页' },
      { uuid: 'app-replica', name: '爆款图复刻', poster: img(7), icon: 'replica', description: '参考爆款 + 产品图 = 你的爆款图' },
      { uuid: 'app-goods', name: 'AI商品图', poster: img(8), icon: 'goods', description: '白底图转场景图' },
      { uuid: 'app-resize', name: '无损改尺寸', poster: img(9), icon: 'resize', description: '多平台尺寸一键适配' },
      { uuid: 'app-model', name: 'AI模特', poster: img(10), icon: 'model', description: '平铺衣服换真人模特' },
    ],
  },
  {
    name: '视频创作',
    apps: [
      { uuid: 'app-hot-video', name: '爆款视频', poster: img(11), icon: 'video', description: '上传商品图和卖点，生成爆款视频' },
      // TODO(design)：「爆款复刻」不在原型工具清单里，只出现在介绍页，是否保留待产品确认
      { uuid: 'app-video-replica', name: '爆款复刻', poster: img(12), icon: 'replica', description: '复刻爆款节奏与画面风格' },
      { uuid: 'app-live-ppt', name: 'LivePPT', poster: img(1), icon: 'ppt', description: '静态 PPT 变动态演示' },
    ],
  },
  {
    name: '图片处理',
    apps: [
      { uuid: 'app-expand', name: 'AI扩图', poster: img(2), icon: 'expand', description: '智能补全画面边界' },
      { uuid: 'app-text-edit', name: '无痕改字', poster: img(3), icon: 'text', description: '图片文字直接改' },
      { uuid: 'app-collage', name: '拼图', poster: img(4), icon: 'collage', description: '多图自由排版' },
      { uuid: 'app-repaint', name: '局部重绘', poster: img(5), icon: 'repaint', description: '框选区域重新生成' },
      { uuid: 'app-portrait-bg', name: '人像背景', poster: img(6), icon: 'portrait', description: '证件照背景一键换' },
      { uuid: 'app-recolor', name: '一键换色', poster: img(7), icon: 'recolor', description: '商品配色批量生成' },
      { uuid: 'app-mosaic', name: '马赛克', poster: img(8), icon: 'mosaic', description: '隐私打码' },
      { uuid: 'app-watermark', name: '加水印', poster: img(9), icon: 'watermark', description: '批量加图片/文字水印' },
      { uuid: 'app-ai-collage', name: 'AI拼图', poster: img(10), icon: 'collage', description: 'AI 自动排版多图' },
      { uuid: 'app-marker', name: '标记笔', poster: img(11), icon: 'marker', description: '图上圈点标注' },
      { uuid: 'app-magnifier', name: '放大镜', poster: img(12), icon: 'magnifier', description: '局部细节放大展示' },
    ],
  },
  {
    name: '文案与其他',
    apps: [
      { uuid: 'app-ai-text', name: 'AI文案', poster: img(10), icon: 'text', description: '商品卖点一键成稿' },
      { uuid: 'app-ai-article', name: 'AI图文', poster: img(11), icon: 'article', description: '图文笔记自动排版' },
      { uuid: 'app-dedup', name: '图文去重', poster: img(12), icon: 'dedup', description: '规避平台重复检测' },
      { uuid: 'app-logo', name: 'AI Logo', poster: img(1), icon: 'logo', description: '品牌标识智能生成' },
      { uuid: 'app-qrcode', name: '二维码', poster: img(2), icon: 'qrcode', description: '美化二维码' },
    ],
  },
]

/* ========== 工具介绍页 ========== */

/**
 * 主视觉形态。原型 5 个实例里 3 个是多面板拼接（参考图 + 产品图 → 结果），
 * 不是单张图，所以这里做判别式。
 */
export type IntroVisual =
  | { type: 'single'; src: string }
  | { type: 'compose'; refs: string[]; result: string; connector: '+' | '→' }

export interface IntroSlide {
  key: string
  title: string
  desc: string
  cover: string
  visual?: IntroVisual
  /** 页面主题色（渐变起始），取值为原型实测顶色 */
  theme: string
  /**
   * 渐变模式：
   * top  —— y=0 即满色，35% 收白
   * band —— 顶部先白，11% 到峰值色，68% 收白
   */
  gradient?: 'top' | 'band'
  appUuid: string
}

export const introSlides: Record<string, IntroSlide[]> = {
  'app-ecommerce-suite': [
    {
      key: 'suite',
      title: '爆款图复刻',
      desc: '想参考的爆款 + 你的产品图 = 你的爆款图',
      cover: img(5),
      visual: { type: 'compose', refs: [img(5), img(2), img(3)], result: img(7), connector: '+' },
      theme: '#fee3c8',
      gradient: 'top',
      appUuid: 'app-replica',
    },
    {
      key: 'aplus',
      title: 'A+详情',
      desc: '上传商品图，AI 即刻生成 符合多电商平台规范 的专业详情页。',
      cover: img(6),
      visual: { type: 'compose', refs: [img(6), img(8)], result: img(9), connector: '→' },
      theme: '#c9eefe',
      gradient: 'top',
      appUuid: 'app-aplus',
    },
  ],
  'app-hot-video': [
    {
      key: 'hot',
      title: '生成爆款',
      desc: '上传商品图和卖点，快速生成适合投放的爆款视频。',
      cover: img(11),
      visual: { type: 'single', src: img(11) },
      theme: '#deffd2',
      gradient: 'band',
      appUuid: 'app-hot-video',
    },
    {
      key: 'replica',
      title: '爆款复刻',
      desc: '上传商品图和参考视频，一键复刻爆款节奏与画面风格。',
      cover: img(12),
      visual: { type: 'compose', refs: [img(12), img(4)], result: img(1), connector: '→' },
      theme: '#fde9d0',
      gradient: 'band',
      appUuid: 'app-video-replica',
    },
  ],
  'app-aplus': [
    {
      key: 'aplus',
      title: 'A+详情',
      desc: '上传商品图，AI 即刻生成 符合多电商平台规范 的专业详情页。',
      cover: img(6),
      visual: { type: 'compose', refs: [img(6), img(8)], result: img(9), connector: '→' },
      theme: '#c9eefe',
      gradient: 'top',
      appUuid: 'app-aplus',
    },
  ],
  // 原型第 5 个实例，此前缺失，导致从「服饰穿戴」进来会回落到套图内容
  'app-dress': [
    {
      key: 'dress',
      title: 'AI服饰穿戴',
      desc: '上传服装，选定模特，同场景多姿势像图即刻生成。',
      cover: img(2),
      visual: { type: 'single', src: img(2) },
      theme: '#ffebc8',
      gradient: 'top',
      appUuid: 'app-dress',
    },
  ],
  // tools.vue 的 introApps 含 app-replica，此前无此 key 会静默回落
  'app-replica': [
    {
      key: 'replica',
      title: '爆款图复刻',
      desc: '想参考的爆款 + 你的产品图 = 你的爆款图',
      cover: img(5),
      visual: { type: 'compose', refs: [img(5), img(2), img(3)], result: img(7), connector: '+' },
      theme: '#fee3c8',
      gradient: 'top',
      appUuid: 'app-replica',
    },
  ],
}

/* ========== 应用详情（GetApp 原始结构） ========== */

const appDetails: Record<string, AppDetailRaw> = {
  'app-hd': {
    uuid: 'app-hd',
    name: '画质修复',
    description: '视频图片都能修，拯救渣画质',
    type: 1,
    price: 2,
    input_image: 1,
    internal_prompt: [],
    workflow_uuid: 'wf-hd',
    input_form: [
      {
        name: 'general',
        label: '通用',
        type: 'one-level-label-value',
        required: true,
        attach: {
          options: [
            { label: '高清', value: 'hd' },
            { label: '超清', value: 'uhd' },
            { label: 'AI超清', value: 'ai-uhd' },
          ],
        },
        default: '高清',
      },
      {
        name: 'scene',
        label: '场景',
        type: 'one-level-label-value',
        attach: {
          options: [
            { label: '人像增强', value: 'portrait' },
            { label: '商品超清', value: 'goods' },
            { label: '文字增强', value: 'text' },
          ],
        },
      },
    ],
  },
  'app-replica': {
    uuid: 'app-replica',
    name: '爆款图复刻',
    description: '想参考的爆款 + 你的产品图 = 你的爆款图',
    type: 1,
    price: 5,
    input_image: 2,
    internal_prompt: [
      { label: '高度复刻', value: 'high' },
      { label: '参考风格', value: 'style' },
    ],
    workflow_uuid: 'wf-replica',
    input_form: [
      {
        name: 'desc',
        label: '补充描述',
        type: 'input-textarea',
        attach: { rows: 3, maxlength: 200, placeholder: '补充你的商品卖点或想要的风格', optimize: 1 },
      },
    ],
  },
  'app-aplus': {
    uuid: 'app-aplus',
    name: 'A+详情',
    description: '上传商品图，AI 即刻生成符合多电商平台规范的专业详情页',
    type: 1,
    price: 8,
    input_image: 3,
    internal_prompt: [],
    workflow_uuid: 'wf-aplus',
    input_form: [
      {
        name: 'platform',
        label: '目标平台',
        type: 'select',
        required: true,
        attach: {
          options: [
            { label: '淘宝/天猫', value: 'taobao' },
            { label: '京东', value: 'jd' },
            { label: '亚马逊', value: 'amazon' },
          ],
        },
        default: 'taobao',
      },
      {
        name: 'selling_points',
        label: '商品卖点',
        type: 'input-textarea',
        required: true,
        attach: { rows: 4, maxlength: 300, placeholder: '例如：50+ 防晒、冰感面料、速干', optimize: 1 },
      },
      {
        name: 'count',
        label: '生成张数',
        type: 'input-number',
        attach: { min: 1, max: 6 },
        default: 3,
      },
    ],
  },
  /**
   * 电商套图：此前 appDetails 无此 key，会回落到 fallbackDetail 的单条「描述」，
   * 表单上只剩一个 textarea，与原型（商品图 + 生成设置三行 + 商品信息）完全不符。
   * 字段按 原型图/9403…jpg 实测文案补齐，见 docs/电商套图内页.md §1。
   */
  'app-ecommerce-suite': {
    uuid: 'app-ecommerce-suite',
    name: '商品套图',
    description: '上传商品图，一句话生成全套主图与详情页',
    type: 1,
    price: 6,
    input_image: 3,
    internal_prompt: [],
    workflow_uuid: 'wf-ecommerce-suite',
    input_form: [
      {
        name: 'platform',
        label: '目标平台',
        type: 'select',
        required: true,
        attach: {
          options: [
            { label: '淘宝天猫1688', value: 'taobao' },
            { label: '京东', value: 'jd' },
            { label: '拼多多', value: 'pdd' },
            { label: '抖音电商', value: 'douyin' },
            { label: '亚马逊', value: 'amazon' },
          ],
        },
        default: 'taobao',
      },
      {
        name: 'market',
        label: '目标市场',
        type: 'select',
        required: true,
        attach: {
          options: [
            { label: '中国', value: 'cn' },
            { label: '美国', value: 'us' },
            { label: '东南亚', value: 'sea' },
            { label: '欧洲', value: 'eu' },
          ],
        },
        default: 'cn',
      },
      {
        name: 'language',
        label: '输出语言',
        type: 'select',
        required: true,
        attach: {
          options: [
            { label: '中文', value: 'zh' },
            { label: '英文', value: 'en' },
            { label: '日文', value: 'ja' },
          ],
        },
        default: 'zh',
      },
      {
        name: 'product_info',
        label: '商品信息',
        type: 'input-textarea',
        attach: {
          rows: 4,
          maxlength: 500,
          placeholder: '品名、核心卖点、目标受众、使用场景',
          optimize: 1,
        },
      },
    ],
  },
}

/** AI 帮写产出示例：原型弹层里的结构化商品信息（青稞类零食） */
export const aiWriteSample = `品名：高原青稞脆片（原味 · 独立小包装）
核心卖点：
· 青藏高原青稞原粮，粗纤维含量高
· 非油炸烘焙工艺，0 反式脂肪
· 独立小包 25g，随身带不占地方
目标受众：25–40 岁注重健康的都市白领、健身人群、宝妈
使用场景：办公下午茶、健身后补给、追剧代餐、送礼伴手`

function fallbackDetail(uuid: string): AppDetailRaw {
  const found = appCategories.flatMap((c) => c.apps).find((a) => a.uuid === uuid)
  return {
    uuid,
    name: found?.name || '功能',
    description: found?.description || '',
    type: 1,
    price: 2,
    input_image: 1,
    internal_prompt: [],
    workflow_uuid: `wf-${uuid}`,
    input_form: [
      {
        name: 'prompt',
        label: '描述',
        type: 'input-textarea',
        attach: { rows: 3, maxlength: 200, placeholder: '描述你想要的效果', optimize: 1 },
      },
    ],
  }
}

export function getAppDetailMock(uuid: string): AppDetailRaw {
  return appDetails[uuid] || fallbackDetail(uuid)
}

/* ========== 任务 ========== */

const taskStore = new Map<string, { createdAt: number; images: string[] }>()

export function runWorkflowMock(): WorkflowRunResult {
  const taskUuid = `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  // 两张必须不同：两次独立 random 可能撞号 → 结果列表 :key="url" 重复 key 报错
  const first = Math.floor(Math.random() * 12) + 1
  const second = (first % 12) + 1 // 保证与 first 不同
  taskStore.set(taskUuid, {
    createdAt: Date.now(),
    images: [img(first), img(second)],
  })
  return {
    task_uuid: taskUuid,
    task_id: taskUuid,
    queue_key: 'mock-queue',
    task_type: 'image',
    status: 'pending',
  }
}

/** mock 任务 6 秒后完成，用于验证轮询与进度动效 */
export function queryWorkflowMock(taskUuid: string): WorkflowQueryResult {
  const task = taskStore.get(taskUuid)
  const elapsed = task ? Date.now() - task.createdAt : 9999
  const done = elapsed > 6000
  return {
    task_uuid: taskUuid,
    task_id: taskUuid,
    task_type: 'image',
    queue_key: 'mock-queue',
    status: done ? 'completed' : elapsed > 2000 ? 'running' : 'pending',
    result: done
      ? { images: (task?.images || []).map((url) => ({ url, mime_type: 'image/jpeg' })) }
      : {},
  }
}

/* ========== 会员 ========== */

export interface VipPlan {
  key: string
  name: string
  price: string
  originPrice: string
  perDay: string
  badge?: string
  recommend?: boolean
}

export interface VipTier {
  key: 'basic' | 'premium'
  name: string
  slogan: string
  benefits: string[]
  plans: VipPlan[]
  beanTip: string
  agreement: string
  cta: { title: string; sub: string }
}

export const vipTiers: VipTier[] = [
  {
    key: 'basic',
    name: '基础会员',
    slogan: '设计功能，无限畅用',
    benefits: ['每月330美豆', '会员多端通用', '商用模版与素材'],
    plans: [
      { key: 'month', name: '连续包月', price: '30', originPrice: '48', perDay: '¥1/天' },
      { key: 'year', name: '连续包年', price: '1.1', originPrice: '358', perDay: '¥0.6/天', badge: '¥1.1试用7天', recommend: true },
      { key: 'quarter', name: '连续包季', price: '68', originPrice: '128', perDay: '¥0.73/天' },
    ],
    beanTip: '试用期间赠送120美豆，7天有效；开通会员后每月赠送330美豆，月内有效',
    agreement: '《会员协议（含自动续费协议）》，¥1.1试用7天，到期自动续费¥218/年，购买后若需取消续费，可在此页面进入续费管理关闭即可',
    cta: { title: '¥1.1试用', sub: '第7天自动续费，¥218/年' },
  },
  {
    key: 'premium',
    name: '高级会员',
    slogan: '高级模型，全量解锁',
    benefits: ['每月1200美豆', '高级模型不限次', '专属客服与优先出图'],
    plans: [
      { key: 'month', name: '连续包月', price: '88', originPrice: '128', perDay: '¥2.9/天' },
      { key: 'year', name: '连续包年', price: '598', originPrice: '1288', perDay: '¥1.6/天', badge: '省690元', recommend: true },
      { key: 'quarter', name: '连续包季', price: '198', originPrice: '368', perDay: '¥2.2/天' },
    ],
    beanTip: '开通高级会员每月赠送1200美豆，月内有效',
    agreement: '《会员协议（含自动续费协议）》，到期自动续费¥598/年，可随时在续费管理中关闭',
    cta: { title: '立即开通', sub: '连续包年 ¥598/年' },
  },
]

/** 会员购买弹窗（1.1 元限时福利） */
export const vipPromo = {
  title: '恭喜获得限时福利',
  subtitle: '1.1元开通会员',
  benefits: ['无限抠图', 'AI消除', '专属素材', '专属模板', '更多权益'],
  cta: '立即开通',
}

/** 模式选择弹窗 */
export const runModes = {
  options: [
    { key: 'normal', name: '普通模式', desc: '适合日常简单创作，节省算力' },
    { key: 'advanced', name: '高级模式', desc: '生成增加更多模型，保持更高还原度的商品', badge: '推荐' },
  ],
  table: [
    { name: '图片生成', normal: '2🫘/次', advanced: '5~15🫘/次' },
    { name: '视频生成', normal: '3🫘/秒', advanced: '4~35🫘/秒' },
    { name: '图片编辑', normal: '1🫘/次', advanced: '' },
    { name: '视频编辑', normal: '4🫘/次', advanced: '' },
  ],
}

/* ========== 空白画布 ========== */

export const canvasSizes = [
  { key: 'xhs-cover', name: '小红书适配封面图', ratio: '3:4', width: 1242, height: 1656 },
  // TODO(design)：原型未标抖音尺寸，按平台常见 3:4 规格取值；与小红书同尺寸会让单选无法区分
  { key: 'douyin', name: '抖音图文带货', ratio: '3:4', width: 1080, height: 1440 },
  { key: 'taobao-main', name: '淘宝主图', ratio: '1:1', width: 1200, height: 1200 },
  { key: 'wechat-cover', name: '公众号首图', ratio: '2.35:1', width: 900, height: 383 },
  { key: 'poster', name: '手机海报', ratio: '9:16', width: 1080, height: 1920 },
]

/* ========== 我的 ========== */

export const mineMenus = [
  { key: 'favorite', name: '我的收藏', icon: 'star' },
  { key: 'feedback', name: '意见与反馈', icon: 'feedback' },
  { key: 'preference', name: '个性化选项', icon: 'setting' },
  { key: 'invite', name: '邀请有礼', icon: 'gift' },
]

/* ========== 资产库 ========== */

export const assetTabs = ['最近保存', '套图配方', '模特库']

/**
 * 资产库内容，按 assetTabs 顺序。
 * 原型只截到空态，但组件有 pick 事件、home 有消费者，说明「有资产」是设计内路径——
 * 之前硬编码空数组让 grid 分支成了死代码、选图链路无法自测。
 * 这里给「最近保存」铺数据，另两个 tab 保留空态以便同时验两条分支。
 * TODO(api)：资产库接口后端未提供
 */
export const assetLibrary: Record<number, string[]> = {
  0: Array.from({ length: 9 }, (_, i) => img(i + 1)),
  1: [],
  2: [],
}

/* ========== 认证 ========== */

export const captchaMock: ImageCaptchaResult = {
  aes: 'mock-aes-token',
  image: '',
}

export const loginMock: LoginResult = {
  token: 'mock-token-0001',
  account: {
    uuid: 'user-mock-0001',
    nickname: 'Mock 用户',
    avatar: '',
    email: 'mock@example.com',
  },
}
