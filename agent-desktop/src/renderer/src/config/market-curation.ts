export type MarketScene = 'recommended' | 'office' | 'image' | 'video' | 'all'

export const MARKET_SCENES: Array<{ key: MarketScene; label: string }> = [
  { key: 'recommended', label: '推荐' },
  { key: 'office', label: '办公' },
  { key: 'image', label: '生图' },
  { key: 'video', label: '视频' },
  { key: 'all', label: '全部' }
]

type MarketLikeItem = {
  id?: string
  slug?: string
  name?: string
  description?: string
  category?: string
  categoryLabel?: string
  source?: string
  official?: boolean
  featured?: boolean
}

const OFFICE_CATEGORIES = new Set([
  'office-efficiency', 'data-analysis', 'business-ops', '办公效率', '数据分析', '商务运营'
])
const OFFICE_TERMS = [
  'office', 'document', 'docs', 'word', 'excel', 'spreadsheet', 'ppt', 'powerpoint',
  'pdf', 'markdown', 'calendar', 'email', 'mail', 'drive', 'notion', 'knowledge',
  '办公', '文档', '表格', '演示', '日历', '邮件', '云盘', '知识库', '翻译', '摘要'
]
const IMAGE_TERMS = [
  'image', 'photo', 'design', 'figma', 'canva', 'photoshop', 'illustration', 'drawing',
  '图片', '图像', '生图', '绘图', '设计', '海报', '抠图', '修图', '素材'
]
const VIDEO_TERMS = [
  'video', 'movie', 'subtitle', 'caption', 'transcript', 'audio', 'voice', 'runway',
  '视频', '字幕', '剪辑', '转码', '抽帧', '音频', '语音', '配音'
]

function searchable(item: MarketLikeItem): string {
  return [item.id, item.slug, item.name, item.description, item.category, item.categoryLabel, item.source]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term))
}

export function matchesMarketScene(item: MarketLikeItem, scene: MarketScene): boolean {
  if (scene === 'all') return true
  const text = searchable(item)
  const category = String(item.category || '').trim()
  const office = OFFICE_CATEGORIES.has(category) || containsAny(text, OFFICE_TERMS)
  const image = containsAny(text, IMAGE_TERMS)
  const video = containsAny(text, VIDEO_TERMS)
  if (scene === 'office') return office
  if (scene === 'image') return image
  if (scene === 'video') return video
  return office || image || video
}

export function skillMarketCategoryForScene(scene: MarketScene): string {
  if (scene === 'office') return 'office-efficiency'
  if (scene === 'image' || scene === 'video') return 'content-creation'
  return ''
}
