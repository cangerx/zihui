import { join } from 'path'
import { getRootDir } from '../data-path'
import { IconEmbedderNotReadyError, type DeckEmbedder } from './icon-search'
import { createMiniLmEmbedder } from './minilm-embedder'

// 图标嵌入器解析: 首选 MiniLM 本地(离线/免费), 权重未就绪则退到 app 既有云端语义嵌入(embedBatch)。
// 两条均为"真向量语义嵌入", 绝不退化为关键词(对齐 spec H6 "绝不退化关键词"之本意);
// 索引级的 vec0→JS cosine 回退在 icon-search.ts 内。

/** MiniLM 权重默认落盘目录(D11 三层按需缓存目标) */
export function defaultMiniLmDir(): string {
  return join(getRootDir(), 'bin', 'models', 'minilm')
}

/** 云端语义嵌入器: 包装 app 既有 embedBatch(走用户云网关/本地 OpenAI 兼容端点)。首次探测确定维度。 */
export async function createCloudEmbedder(): Promise<DeckEmbedder> {
  const { embedBatch } = await import('../embedding')
  // 探测一次确定维度/模型(云端模型维度不固定)
  const probe = await embedBatch(['icon'])
  const dim = probe.meta.dim
  if (!dim) throw new Error('云端嵌入返回维度为 0')
  const model = `cloud:${probe.meta.model}`
  return {
    model,
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const r = await embedBatch(texts)
      return r.embeddings.map((e) => Float32Array.from(e.embedding))
    }
  }
}

export interface ResolveEmbedderOptions {
  /** 覆盖 MiniLM 权重目录(测试用) */
  modelDir?: string
  /** 跳过 MiniLM 直接用云端(用户在设置里偏好云端时) */
  preferCloud?: boolean
}

/**
 * 解析当前可用的图标嵌入器。
 * 默认: MiniLM 本地优先; 缺权重/缺 onnxruntime → 回退云端语义嵌入; 都不可用 → IconEmbedderNotReadyError。
 */
export async function resolveDeckEmbedder(opts: ResolveEmbedderOptions = {}): Promise<DeckEmbedder> {
  const modelDir = opts.modelDir ?? defaultMiniLmDir()
  let lastErr: unknown
  if (!opts.preferCloud) {
    try {
      return createMiniLmEmbedder(modelDir)
    } catch (e) {
      lastErr = e // 权重未就绪, 尝试云端
    }
  }
  try {
    return await createCloudEmbedder()
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    const head = lastErr instanceof Error ? lastErr.message + '; ' : ''
    throw new IconEmbedderNotReadyError(`图标嵌入不可用: ${head}云端嵌入也失败: ${detail}`)
  }
}
