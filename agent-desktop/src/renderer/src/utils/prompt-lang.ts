/** 按汉字 vs 拉丁字母数量判断提示词语言。混写品牌名时汉字占优则走中文。 */
export function detectPromptLang(text: string): 'cn' | 'en' {
  const t = (text || '').trim()
  if (!t) return 'cn'
  const cjk = (t.match(/[\u3400-\u9fff]/g) || []).length
  const latin = (t.match(/[A-Za-z]/g) || []).length
  if (cjk === 0 && latin === 0) return 'cn'
  return cjk >= latin ? 'cn' : 'en'
}
