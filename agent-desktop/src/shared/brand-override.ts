const OVERRIDE = [
  '不要品牌色',
  '不用规范',
  '忽略vi',
  '忽略规范',
  '不要用品牌',
  '不用品牌',
  '忽略 vi',
  '这次不要品牌'
]

const VOICE_OVERRIDE = [
  '这次别用品牌口吻',
  '不要品牌口吻',
  '不用口吻',
  '用正经一点',
  '别用口吻'
]

export function isBrandOverride(text: string): boolean {
  const t = String(text || '').toLowerCase()
  return OVERRIDE.some((k) => t.includes(k)) || /改用.{0,6}色/.test(t)
}

export function isVoiceOverride(text: string): boolean {
  const t = String(text || '').toLowerCase()
  return VOICE_OVERRIDE.some((k) => t.includes(k))
}
