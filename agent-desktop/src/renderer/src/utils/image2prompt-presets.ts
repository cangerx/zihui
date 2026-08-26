/**
 * 图片反推（Image2Prompt）的风格 / 语言 / system prompt 模板共享 utils。
 *
 * 历史：原本嵌在 Image2PromptView.vue 里。v0.6.9 流式画布加「图片反推」节点后，
 * 两处共用同一份模板，因此抽到此模块作为 single source of truth。
 *
 * 修改 prompt 文案只需改这一处，画布反推节点和独立反推页都会同步生效。
 */

export type StylePreset = 'general' | 'sd_phrase' | 'sd_tag' | 'mj' | 'danbooru'
export type OutputLang = 'cn' | 'en'

export const STYLE_OPTIONS: ReadonlyArray<{ label: string; value: StylePreset }> = [
  { label: '通用描述', value: 'general' },
  { label: 'SD 短语', value: 'sd_phrase' },
  { label: 'SD 标签', value: 'sd_tag' },
  { label: 'Midjourney', value: 'mj' },
  { label: 'Danbooru', value: 'danbooru' }
]

export const LANG_OPTIONS: ReadonlyArray<{ label: string; value: OutputLang }> = [
  { label: '中文', value: 'cn' },
  { label: '英文', value: 'en' }
]

/**
 * 仅支持英文输出的风格。UI 上中文按钮应禁用，
 * 调用 `effectiveLang` 时这两个风格的 lang 会被强制改为 'en'。
 */
export const EN_ONLY_STYLES: ReadonlySet<StylePreset> = new Set(['sd_tag', 'danbooru'])

export function isEnOnly(style: StylePreset): boolean {
  return EN_ONLY_STYLES.has(style)
}

/** 风格强制英文时把 lang 改成 'en'，否则原样返回 */
export function effectiveLang(style: StylePreset, lang: OutputLang): OutputLang {
  return isEnOnly(style) ? 'en' : lang
}

/**
 * 8 条 system prompt：5 种风格 × 中英文，sd_tag / danbooru 仅英文（共 8 = 3×2 + 2）。
 *
 * 文案要求：
 *   - 明确告诉模型"反推 prompt"、"只输出 prompt 本身"
 *   - 让模型按图片复杂度自行控制长度，避免硬塞固定字数
 *   - 强调风格特征（SD 用逗号短语 / Midjourney 加参数 / Danbooru 用下划线 tag）
 */
export const SYSTEM_PROMPTS: Record<string, string> = {
  'general_cn': `你是一位 AI 生图提示词反推专家。你的任务是观察图片，反推出一段可直接用于 AI 文生图模型的中文提示词。根据图片实际内容，描述关键要素（如主体、场景、风格、材质、视角、光线等），简单图片简短描述，复杂图片详细描述，无需固定字数。只输出提示词本身。`,
  'general_en': `You are an AI image prompt reverse-engineering expert. Your task is to observe the image and produce a prompt that can be directly used with AI text-to-image models. Describe the key elements based on actual image content (e.g. subject, scene, style, materials, perspective, lighting). Keep it concise for simple images and detailed for complex ones — no fixed word limit. Output only the prompt itself.`,
  'sd_phrase_cn': `你是 Stable Diffusion / Flux 提示词反推专家。请观察图片，反推出可直接用于 SD/Flux 文生图的中文短语式提示词。按主体、场景、风格、材质、光影、画面质感的顺序，使用逗号分隔的短语。根据图片复杂度自行控制长度，简单图片精炼，复杂图片详尽。只输出提示词本身。`,
  'sd_phrase_en': `You are a Stable Diffusion / Flux prompt reverse-engineering expert. Observe the image and produce a phrase-style English prompt suitable for SD/Flux text-to-image generation. Use comma-separated natural-language phrases covering subject, scene, style, materials, lighting, and quality modifiers. Adapt length to image complexity. Output only the prompt itself.`,
  'sd_tag_en': `You are a Stable Diffusion tag reverse-engineering expert. Observe the image and produce an English comma-separated tag list suitable for SD text-to-image generation. Include subject, scene, style, and quality tags using concise words or short compounds. Adapt the number of tags to image complexity. Output only the tags.`,
  'mj_cn': `你是 Midjourney 提示词反推专家。请观察图片，反推出可直接用于 Midjourney 的中文提示词。描述主体、场景细节、风格氛围、光影与视角，结尾根据图片内容推荐合适的参数（如 --ar、--v、--style 等）。只输出提示词本身。`,
  'mj_en': `You are a Midjourney prompt reverse-engineering expert. Observe the image and produce an English prompt suitable for Midjourney. Describe the main subject, scene details, style and mood, camera angle and lighting. Append appropriate parameters (e.g. --ar, --v, --style) based on the image content. Output only the prompt itself.`,
  'danbooru_en': `You are a Danbooru tag reverse-engineering expert. Observe the image and produce Danbooru-style English tags separated by commas. Cover subject, clothing, pose, expression, background, and style using standard Danbooru tag format with underscores. Adapt the number of tags to image complexity. Output only the tags.`
}

/**
 * 按 style + lang 取对应 system prompt。lang 会先经过 `effectiveLang` 处理，
 * 不存在的组合（如 `sd_tag_cn`）兜底返回 `general_cn`。
 */
export function getSystemPrompt(style: StylePreset, lang: OutputLang): string {
  const key = `${style}_${effectiveLang(style, lang)}`
  return SYSTEM_PROMPTS[key] || SYSTEM_PROMPTS['general_cn']
}

/** 判断文本是否就是 8 条预设之一（用于 watch：用户没改过预设才自动覆盖） */
export function isPresetText(text: string): boolean {
  return Object.values(SYSTEM_PROMPTS).includes(text)
}

/** 调上游视觉模型时附带的 user 提示词，本身不带语义，只是触发"开始反推"。 */
export function getUserPrompt(lang: OutputLang): string {
  return lang === 'cn' ? '请为这张图片生成提示词。' : 'Please generate a prompt for this image.'
}
