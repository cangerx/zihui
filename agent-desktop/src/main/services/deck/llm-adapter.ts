import type { BrowserWindow } from 'electron'
import { callLLM } from '../llm'
import type { DeckLlm } from './deck-generator'
import type { CritiqueLlm } from './critique'
import { tryExtractJson } from '@shared/json-extract'

// 把 llm.ts 的 callLLM 包成 deck-generator 需要的 DeckLlm(结构化 JSON 产出)。
// 这是 deck-generator 与真实 LLM 之间唯一接线点(deck-generator 本身 LLM 无关、可 fake 单测)。

/** 宽松解析 LLM 返回 JSON: 剥 markdown 代码围栏 / 取首个平衡 {…}, 失败回退空对象 */
export function parseJsonLoose(text: string): unknown {
  return tryExtractJson(text, { expect: 'object' }) ?? {}
}

export function toDeckLlm(
  providerId: string,
  modelId: string,
  window?: BrowserWindow | null
): DeckLlm {
  return {
    async generateJson({ system, user, schema, signal }) {
      const res = await callLLM(
        providerId,
        {
          modelId,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content:
                user +
                '\n\n只输出一个 JSON 对象, 严格符合下列 JSON Schema, 不要任何额外说明或代码围栏:\n' +
                JSON.stringify(schema)
            }
          ],
          response_format: { type: 'json_object' },
          // 流式: 首字节秒级到达避开网关 524(JSON 模式同样能流式, 累积全文再解析)。
          // 后台调用 notifyStream:false 不串扰对话流。
          stream: true,
          notifyStream: false,
          signal
        },
        window ?? null
      )
      return parseJsonLoose(res.content)
    },
    // 流式纯文本: stream:true 让首字节秒级到达, 避开云端网关 524。res.content 是累积全文。
    async generateText({ system, user, signal, onContent }) {
      const res = await callLLM(
        providerId,
        {
          modelId,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          stream: true,
          notifyStream: false, // 不串扰对话流; 增量经 streamContext.onContent 回调
          streamContext: onContent ? { onContent } : undefined,
          signal
        },
        window ?? null
      )
      return res.content
    }
  }
}

/**
 * 把 llm.ts 的 callLLM 包成 critique.ts 需要的 CritiqueLlm(多模态图像评审)。
 * 用 OpenAI 兼容多模态 content 数组([text, image_url]); 截图 dataURL 由 llm.ts 的
 * materializeMessageImages 自动转云端临时 URL(避免 base64 污染上游日志)。
 */
export function toCritiqueLlm(
  providerId: string,
  modelId: string,
  window?: BrowserWindow | null
): CritiqueLlm {
  return {
    async reviewImage({ system, user, imageDataUrl, schema, signal }) {
      const res = await callLLM(
        providerId,
        {
          modelId,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    user +
                    '\n\n只输出一个 JSON 对象, 严格符合下列 JSON Schema, 不要任何额外说明或代码围栏:\n' +
                    JSON.stringify(schema)
                },
                { type: 'image_url', image_url: { url: imageDataUrl } }
              ]
            }
          ],
          response_format: { type: 'json_object' },
          // 流式同 generateJson: 避开网关 524(多模态评审输出也走流式)
          stream: true,
          notifyStream: false,
          signal
        },
        window ?? null
      )
      return parseJsonLoose(res.content)
    }
  }
}
