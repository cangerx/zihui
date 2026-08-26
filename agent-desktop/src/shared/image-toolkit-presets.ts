/**
 * 图像处理菜单卡片配置 + AI 跳转预设。
 *
 * 卡片点击后的分流：
 *  - direct-route       直接跳转，不需要选图（如 AI 改图 Agent → ImageGenView 空白页）
 *  - pick-then-tool     先选图 → 跳到纯前端工具子页（拼图 / 加水印 / 格式转换 ...）
 *  - pick-then-edit     先选图 → 跳 ImageEditView 并预设工具/模板（AI 消除 / 去水印 / 改字 / 改尺寸 ...）
 *  - pick-then-gen      先选图（可选）→ 跳 ImageGenView 预填 prompt/size/refImages（老照片修复 / AI 变清晰 ...）
 *
 * 预设 prompt 的设计原则：
 *  1. 用英文描述（更兼容多模态生图模型）
 *  2. 留有"用户在生图页可微调"的空间，prompt 是"起点"而非"终点"
 *  3. presetSize 可选；不传时跟随原图比例（refImages 已知）或默认 1:1（不带 ref）
 */

export type CardCategory = 'hero' | 'recommend' | 'tool' | 'ai-enhance' | 'ecommerce' | 'batch'

export type CardAction =
  | { type: 'direct-route'; path: string }
  | { type: 'pick-then-tool'; toolRoute: string; multiple?: boolean; minImages?: number; maxImages?: number }
  | { type: 'pick-then-edit'; tool?: 'inpaint' | 'crop' | 'corner' | 'sticker'; template?: 'replace' | 'remove' | 'fix' | 'enhance'; presetPrompt?: string }
  | { type: 'pick-then-gen'; presetPrompt: string; presetSize?: string; needRef: boolean; autoSize?: boolean }

export interface ToolCard {
  id: string
  label: string
  /** 简短描述，hero 卡片下方副标题 */
  desc?: string
  /** Hero 卡片右下角 CTA 文案 */
  cta?: string
  /** 是否高亮（已废弃：原"常用 AI"橙色高亮在 1.4 设计中移除） */
  highlight?: boolean
  /** SVG path d 字符串（heroicons / lucide 风格，作为 inline 图标） */
  iconPath: string
  category: CardCategory
  action: CardAction
  /** 底部小标签：可批量、商品图等 */
  badge?: string
}

/** Hero 卡片（顶部大卡） */
export const HERO_CARDS: ToolCard[] = [
  {
    id: 'ai-gen-agent',
    label: 'AI 生图',
    desc: '描述你想要的图片，AI 帮你画',
    cta: '去生成图片',
    iconPath: 'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z',
    category: 'hero',
    action: { type: 'direct-route', path: '/image-gen' }
  },
  {
    id: 'batch-gen',
    label: '批量生图',
    desc: '一次提交多组提示词，批量产出',
    cta: '去批量生图',
    iconPath: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
    category: 'hero',
    action: { type: 'direct-route', path: '/batch-gen' }
  },
  {
    id: 'photo-editor',
    label: '图片编辑',
    desc: '裁剪、涂抹、修图，AI 辅助编辑',
    cta: '去编辑图片',
    iconPath: 'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125 M3 21h18',
    category: 'hero',
    action: { type: 'pick-then-edit' }
  }
]

/** 通用工具（含原"常用 AI"4 张，统一并入推荐区，去除橙色高亮） */
export const TOOL_CARDS: ToolCard[] = [
  // ===== 电商作图：5 个一键电商功能（点击进入各自独立功能页 /ecom/*）=====
  {
    id: 'ecom-batch-sku',
    label: 'AI 批量SKU生成',
    iconPath: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
    category: 'ecommerce',
    badge: '可批量',
    action: { type: 'direct-route', path: '/ecom/batch-sku' }
  },
  {
    id: 'ecom-clone',
    label: 'AI 电商图复刻',
    iconPath: 'M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m11.25 5.5H16.5a1.125 1.125 0 0 1-1.125-1.125v-3.5',
    category: 'ecommerce',
    action: { type: 'direct-route', path: '/ecom/clone' }
  },
  {
    id: 'ecom-main',
    label: 'AI 生成主图',
    iconPath: 'm2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
    category: 'ecommerce',
    action: { type: 'direct-route', path: '/ecom/main' }
  },
  {
    id: 'ecom-detail',
    label: 'AI 生成详情页',
    iconPath: 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
    category: 'ecommerce',
    action: { type: 'direct-route', path: '/ecom/detail' }
  },
  {
    id: 'ecom-poster',
    label: 'AI 海报生成',
    iconPath: 'M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m0 0a2.246 2.246 0 0 0-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0 1 21 12v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6c0-.98.626-1.813 1.5-2.122',
    category: 'ecommerce',
    action: { type: 'direct-route', path: '/ecom/poster' }
  },
  // 原"常用 AI"四张：合并进推荐区头部，降级为白底普通卡
  {
    id: 'ai-erase',
    label: 'AI 消除',
    iconPath: 'm15 5 4 4M13 7l6 6-7.5 7.5a3 3 0 0 1-2.121.879H4.5A1.5 1.5 0 0 1 3 19.879v-2.379a3 3 0 0 1 .879-2.121L13 7Z',
    category: 'ai-enhance',
    action: { type: 'pick-then-edit', tool: 'inpaint', template: 'remove' }
  },
  {
    id: 'ai-clear',
    label: 'AI 变清晰',
    iconPath: 'M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z',
    category: 'ai-enhance',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      autoSize: true,
      presetPrompt: '提升图片质量：锐化细节、去噪点、提高清晰度与分辨率，写实摄影质感，保留原图构图与颜色。'
    }
  },
  {
    id: 'id-photo',
    label: 'AI 证件照',
    iconPath: 'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z',
    category: 'ai-enhance',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      presetSize: '2:3',
      presetPrompt: '专业证件照：纯白底色、正装、表情自然、正面证件照构图、干净的棚拍光、面部焦点清晰。'
    }
  },
  {
    id: 'ai-outfit-change',
    label: 'AI 换装',
    // lucide 「shirt」图标 path，表示上衣轮廓
    iconPath: 'M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z',
    category: 'ai-enhance',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      autoSize: true,
      // 兑底 prompt：ImageToolkitView 会用 composeOutfitChangePrompt 动态覆盖
      presetPrompt: '将照片中人物身上的服装替换为得体服装。严格保留人物的脸部五官、肤色、发型、姿势与背景。'
    }
  },
  {
    id: 'ai-pose-change',
    label: 'AI 换姿势',
    // lucide 「person-standing」多 subpath：圆头 + 躯干竖线 + 双臂横展 + 双腿 V 字
    // 关键改良：双腿在 (12,14) 与躯干底部连接，整体连贯
    iconPath: 'M12 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 7v7M6 10l6 2 6-2M9 22l3-8 3 8',
    category: 'ai-enhance',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      autoSize: true,
      // 兑底 prompt：ImageToolkitView 会用 composePoseChangePrompt 动态覆盖
      presetPrompt: '将照片中人物的姿势调整为更自然得体的姿势。严格保留人物的脸部五官、肤色、服装、发型与背景。'
    }
  },
  {
    id: 'style-transfer',
    label: '风格迁移',
    iconPath: 'M4.5 5.25h6.75v6.75H4.5V5.25Zm8.25 0h6.75v6.75h-6.75V5.25ZM4.5 14.25h6.75v4.5H4.5v-4.5Zm8.25 0h6.75v4.5h-6.75v-4.5Z',
    category: 'ai-enhance',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      autoSize: true,
      presetPrompt: '将第一张参考图的视觉风格迁移到第二张参考图上，保留第二张图的主体、构图和结构。'
    }
  },
  {
    id: 'product-shot',
    label: '电商白底图',
    iconPath: 'm21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9',
    category: 'ecommerce',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      autoSize: true,
      presetSize: '1:1',
      presetPrompt: '产品电商照片：纯白底 (#FFFFFF)、产品下方柔和阴影、产品焦点清晰、干净的棚拍光线、无其他干扰物品、主体独立。'
    }
  },
  {
    id: 'collage',
    label: '拼图拼接',
    iconPath: 'M3.75 3v18M3.75 12h16.5M20.25 3v18M3.75 7.5h16.5M3.75 16.5h16.5',
    category: 'tool',
    action: { type: 'pick-then-tool', toolRoute: '/image-toolkit/collage', multiple: true, minImages: 2, maxImages: 9 }
  },
  {
    id: 'replace-text',
    label: '无痕改字',
    iconPath: 'M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z',
    category: 'ai-enhance',
    action: { type: 'pick-then-edit', tool: 'inpaint', template: 'replace', presetPrompt: '' }
  },
  {
    id: 'remove-watermark',
    label: '图片去水印',
    iconPath: 'M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    category: 'ai-enhance',
    action: { type: 'pick-then-edit', tool: 'inpaint', template: 'remove' }
  },
  {
    id: 'sticker',
    label: '贴图',
    // heroicons 24-outline face-smile，贴近贴纸/表情语义
    iconPath: 'M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75h.008v.008H9.75V9.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm4.875 0h.008v.008h-.008V9.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
    category: 'tool',
    action: { type: 'pick-then-edit', tool: 'sticker' }
  },
  {
    id: 'add-watermark',
    label: '加水印',
    iconPath: 'M16.5 8.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25m8.25-8.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-7.5A2.25 2.25 0 0 1 8.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 0 0-2.25 2.25v6',
    category: 'tool',
    badge: '可批量',
    action: { type: 'pick-then-tool', toolRoute: '/image-toolkit/watermark', multiple: true, minImages: 1 }
  },
  {
    id: 'format-convert',
    label: '格式转换',
    iconPath: 'm15.75 15.75-2.489-2.489m0 0a3.375 3.375 0 1 0-4.773-4.773 3.375 3.375 0 0 0 4.774 4.774ZM21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    category: 'tool',
    badge: '可批量',
    action: { type: 'pick-then-tool', toolRoute: '/image-toolkit/format-convert', multiple: true, minImages: 1 }
  },
  {
    id: 'compress',
    label: '图片压缩',
    iconPath: 'M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3v11.25',
    category: 'tool',
    badge: '可批量',
    action: { type: 'pick-then-tool', toolRoute: '/image-toolkit/compress', multiple: true, minImages: 1 }
  },
  {
    id: 'resize',
    label: '改尺寸/比例',
    iconPath: 'M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125V14.25m18.375 5.25c.621 0 1.125-.504 1.125-1.125V14.25m-17.25 4.5v-1.5a1.125 1.125 0 0 1 1.125-1.125h13.5c.621 0 1.125.504 1.125 1.125v1.5m-15.75 0V8.25m0 0V6.375A1.125 1.125 0 0 1 4.5 5.25h7.5a1.125 1.125 0 0 1 1.125 1.125V8.25m-12 0h12m0 0h6.375a1.125 1.125 0 0 1 1.125 1.125v6m-7.5-7.125v3.75',
    category: 'tool',
    action: { type: 'pick-then-edit', tool: 'crop' }
  },
  {
    id: 'image-corner',
    label: '图片边角',
    iconPath: 'M4.5 9.75V6.75A2.25 2.25 0 0 1 6.75 4.5h3m3.75 0h3A2.25 2.25 0 0 1 18.75 6.75v3m0 3.75v3A2.25 2.25 0 0 1 16.5 18.75h-3m-3.75 0h-3A2.25 2.25 0 0 1 4.5 16.5v-3',
    category: 'tool',
    action: { type: 'pick-then-edit', tool: 'corner' }
  },
  {
    id: 'change-bg',
    label: 'AI 换背景',
    iconPath: 'M2.25 15.75 7.409 10.591a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
    category: 'ecommerce',
    badge: '商品图',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      autoSize: true,
      presetPrompt: '替换背景为：[请描述新背景]。主体、主体上的光线与构图保持不变，阴影与色调自然过渡。'
    }
  },
  {
    id: 'expand-image',
    label: 'AI 扩图',
    iconPath: 'M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15',
    category: 'ai-enhance',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      presetPrompt: '向外扩充画面（outpainting），保持原图风格、构图与光线一致，生成无缝自然的场景延伸。'
    }
  },
  {
    id: 'super-portrait',
    label: 'AI 超清人像',
    iconPath: 'M15.75 7.5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0',
    category: 'ai-enhance',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      autoSize: true,
      presetPrompt: '人像超清增强：面部细节锐化、肤质自然优化、去噪点、专业人像修图、自然光线、高分辨率写实质感。保留原人面部特征与身份。'
    }
  },
  {
    id: 'old-photo-restore',
    label: '老照片修复',
    iconPath: 'M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5',
    category: 'ai-enhance',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      autoSize: true,
      presetPrompt: '修复老照片：去除划痕、修补破损、去噪点；黑白照可自然上色；增强清晰度与细节。保留原始构图、人物面部及历史原貌。'
    }
  },
  {
    id: 'gif-maker',
    label: 'GIF 制作',
    iconPath: 'M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 0 1-1.125-1.125V14.25M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-7.5M3.375 8.25v-1.5A1.125 1.125 0 0 1 4.5 5.625h7.5a1.125 1.125 0 0 1 1.125 1.125v1.5',
    category: 'tool',
    action: { type: 'pick-then-tool', toolRoute: '/image-toolkit/gif', multiple: true, minImages: 2, maxImages: 30 }
  },
  {
    id: 'slice',
    label: '切图',
    iconPath: 'M7.848 8.25l1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm1.536.887a2.165 2.165 0 0 1 1.083 1.839c.005.19.005.383 0 .575m0 0-1.647 1.647m1.647-1.647a2.165 2.165 0 0 1 1.083-1.839l.115-.066m-3.886 7.302.706-1.226m0 0a3 3 0 1 0 5.197 3 3 3 0 0 0-5.197-3Zm0 0 1.605-2.781m0 0 .226-.39m-.226.39 1.5 2.598',
    category: 'tool',
    action: { type: 'pick-then-tool', toolRoute: '/image-toolkit/slice', multiple: false }
  },
  {
    id: 'avatar-portrait',
    label: '形象照',
    iconPath: 'M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    category: 'ai-enhance',
    action: {
      type: 'pick-then-gen',
      needRef: true,
      autoSize: true,
      presetSize: '3:4',
      presetPrompt: '专业形象照：棚拍光线、面部焦点清晰、商务装扮、干净中性背景、自信表情、杂志级摄影质感。保留原人面部特征与身份。'
    }
  }
]

/** 全部卡片（用于"推荐"页和搜索） */
export const ALL_CARDS: ToolCard[] = [...HERO_CARDS, ...TOOL_CARDS]

/** 分类 tabs 定义（去掉「推荐」，默认展示「电商作图」） */
export const CATEGORY_TABS: Array<{ id: 'ecommerce' | 'ai-enhance' | 'tool'; label: string }> = [
  { id: 'ecommerce', label: '电商作图' },
  { id: 'ai-enhance', label: 'AI 处理' },
  { id: 'tool', label: '高效办公' }
]

/** 按分类筛选卡片（不含 hero） */
export function getCardsByCategory(cat: string): ToolCard[] {
  return TOOL_CARDS.filter(c => c.category === cat)
}

/**
 * O9: 根据图片实际尺寸找最接近的预设尺寸值（"1:1" / "3:2" / "16:9" 等）。
 * 算法：以图片宽高比 (w/h) 与每个预设的 ratio 做 log 差最小化（log 更符合人眼对比例差异的感知）。
 * 不依赖 image-size.ts 避免 shared 层环引用；预设值与 IMAGE_SIZE_PRESETS 保持同步。
 */
const PRESET_RATIOS: Array<{ value: string; ratio: number }> = [
  { value: '1:1', ratio: 1 },
  { value: '2:1', ratio: 2 },
  { value: '3:1', ratio: 3 },
  { value: '3:2', ratio: 3 / 2 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '5:4', ratio: 5 / 4 },
  { value: '16:9', ratio: 16 / 9 },
  { value: '21:9', ratio: 21 / 9 },
  { value: '1:2', ratio: 1 / 2 },
  { value: '1:3', ratio: 1 / 3 },
  { value: '2:3', ratio: 2 / 3 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '4:5', ratio: 4 / 5 },
  { value: '9:16', ratio: 9 / 16 },
  { value: '9:21', ratio: 9 / 21 }
]

export function findClosestPresetSize(width: number, height: number): string {
  if (!width || !height) return '1:1'
  const target = width / height
  let best = PRESET_RATIOS[0]
  let bestDiff = Math.abs(Math.log(best.ratio) - Math.log(target))
  for (const p of PRESET_RATIOS) {
    const diff = Math.abs(Math.log(p.ratio) - Math.log(target))
    if (diff < bestDiff) { best = p; bestDiff = diff }
  }
  return best.value
}
