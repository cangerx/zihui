export interface ClawbotImageParams { size: string; batchCount: number }

const RATIO_ALIASES: Array<[RegExp, string]> = [
  [/(横版|横图|宽屏)/u, '16:9'],
  [/(竖版|竖图|手机海报)/u, '9:16'],
  [/(方图|正方形)/u, '1:1'],
]

export function isImageRequest(text: string): boolean {
  return /(生图|生成.{0,4}(图|图片|海报)|画一?[张幅个]?|做一?[张幅个]?(图|海报))/u.test(text)
}

export function parseImageParams(text: string): Partial<ClawbotImageParams> {
  const result: Partial<ClawbotImageParams> = {}
  const ratio = text.match(/\b(1:1|2:1|3:1|3:2|4:3|5:4|16:9|21:9|1:2|1:3|2:3|3:4|4:5|9:16|9:21)\b/u)
  if (ratio) result.size = ratio[1]
  if (!result.size) for (const [pattern, value] of RATIO_ALIASES) if (pattern.test(text)) { result.size = value; break }
  const arabic = text.match(/(?:来|出|生成|做)?\s*([1-4])\s*(?:张|幅|个)/u)
  const chinese = text.match(/(?:来|出|生成|做)?\s*([一二三四两])\s*(?:张|幅|个)/u)
  if (arabic) result.batchCount = Number(arabic[1])
  else if (chinese) result.batchCount = ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 } as Record<string, number>)[chinese[1]]
  return result
}

export function imageParamInstruction(params: ClawbotImageParams): string {
  return `\n\n[微信生图参数：用户已确定尺寸 ${params.size}、数量 ${params.batchCount} 张。调用 image_gen.generate 时必须传 size="${params.size}" 和 batch_count=${params.batchCount}，不要再次询问。]`
}

export const IMAGE_PARAM_OPTIONS: ClawbotImageParams[] = [
  { size: '1:1', batchCount: 1 }, { size: '16:9', batchCount: 1 }, { size: '9:16', batchCount: 1 },
  { size: '1:1', batchCount: 4 }, { size: '16:9', batchCount: 4 }, { size: '9:16', batchCount: 4 },
]

export function imageParamMenu(): string {
  return ['请选择生图尺寸和张数（60 秒内回复编号）：', ...IMAGE_PARAM_OPTIONS.map((p, i) => `${i + 1}. ${p.size} · ${p.batchCount} 张`)].join('\n')
}
