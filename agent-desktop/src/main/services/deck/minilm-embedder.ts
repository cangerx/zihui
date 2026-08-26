import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { IconEmbedderNotReadyError, type DeckEmbedder } from './icon-search'

// MiniLM 本地语义嵌入器(spec H6 主路): onnxruntime-node + all-MiniLM-L6-v2(dim 384)。
// 权重经 D11 三层按需缓存落 getRootDir()/bin/models/, 未就绪抛 IconEmbedderNotReadyError(门控)。
// 纯离线、免登录、免计费; 这是图标检索的首选嵌入路径, 失败再由 icon-embedder 解析到云端语义嵌入。
//
// onnxruntime-node 为原生可选依赖: 用 require 懒加载并以 any 承接, 不引入编译期类型依赖;
// 缺包/缺权重时优雅降级(抛门控错误), 不阻断主模块加载。

const MODEL_FILE = 'model.onnx'
const VOCAB_FILE = 'vocab.txt'
const MAX_SEQ = 256
const DIM = 384

interface WordPiece {
  vocab: Map<string, number>
  unkId: number
  clsId: number
  sepId: number
  padId: number
}

function loadWordPiece(modelDir: string): WordPiece {
  const vocabPath = join(modelDir, VOCAB_FILE)
  const lines = readFileSync(vocabPath, 'utf8').split(/\r?\n/)
  const vocab = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const tok = lines[i]
    if (tok !== undefined && tok.length > 0) vocab.set(tok, i)
  }
  const get = (t: string): number => vocab.get(t) ?? -1
  const unkId = get('[UNK]')
  const clsId = get('[CLS]')
  const sepId = get('[SEP]')
  const padId = get('[PAD]')
  if (unkId < 0 || clsId < 0 || sepId < 0) throw new Error('vocab.txt 缺少 [UNK]/[CLS]/[SEP]')
  return { vocab, unkId, clsId, sepId, padId: padId < 0 ? 0 : padId }
}

// BERT 基础切分: 按空白分词, 标点单独成 token, 统一小写(MiniLM 为 uncased)。
function basicTokenize(text: string): string[] {
  const out: string[] = []
  const cleaned = text.toLowerCase().normalize('NFKC')
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue
    let buf = ''
    for (const ch of raw) {
      if (/[\p{P}\p{S}]/u.test(ch)) {
        if (buf) {
          out.push(buf)
          buf = ''
        }
        out.push(ch)
      } else {
        buf += ch
      }
    }
    if (buf) out.push(buf)
  }
  return out
}

// WordPiece 贪心最长匹配: 命中前缀切分, 续接片用 '##' 前缀。
function wordpiece(token: string, wp: WordPiece): number[] {
  if (token.length > 100) return [wp.unkId]
  const ids: number[] = []
  let start = 0
  while (start < token.length) {
    let end = token.length
    let curId = -1
    while (start < end) {
      const sub = (start > 0 ? '##' : '') + token.slice(start, end)
      const id = wp.vocab.get(sub)
      if (id !== undefined) {
        curId = id
        break
      }
      end--
    }
    if (curId < 0) return [wp.unkId] // 任一片不可切 → 整词 UNK
    ids.push(curId)
    start = end
  }
  return ids
}

function encode(text: string, wp: WordPiece): { ids: number[]; mask: number[] } {
  const pieces: number[] = [wp.clsId]
  for (const tok of basicTokenize(text)) {
    for (const id of wordpiece(tok, wp)) {
      if (pieces.length >= MAX_SEQ - 1) break
      pieces.push(id)
    }
  }
  pieces.push(wp.sepId)
  const mask = pieces.map(() => 1)
  return { ids: pieces, mask }
}

/**
 * 创建 MiniLM 嵌入器。modelDir 需含 model.onnx + vocab.txt。
 * 缺包/缺文件 → IconEmbedderNotReadyError(IPC 据此引导按需拉取权重)。
 */
export function createMiniLmEmbedder(modelDir: string): DeckEmbedder {
  const modelPath = join(modelDir, MODEL_FILE)
  if (!existsSync(modelPath) || !existsSync(join(modelDir, VOCAB_FILE))) {
    throw new IconEmbedderNotReadyError(`MiniLM 权重未就绪(缺 ${MODEL_FILE}/${VOCAB_FILE})`)
  }
  let ort: any
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ort = require('onnxruntime-node')
  } catch {
    throw new IconEmbedderNotReadyError('onnxruntime-node 未安装')
  }
  const wp = loadWordPiece(modelDir)
  let sessionPromise: Promise<any> | null = null
  const getSession = (): Promise<any> => {
    if (!sessionPromise) sessionPromise = ort.InferenceSession.create(modelPath)
    return sessionPromise as Promise<any>
  }

  return {
    model: 'all-MiniLM-L6-v2',
    dim: DIM,
    async embed(texts: string[]): Promise<Float32Array[]> {
      const session = await getSession()
      const out: Float32Array[] = []
      // 逐条推理(批量需 padding 对齐; 图标检索量小, 逐条足够且更稳)
      for (const text of texts) {
        const { ids, mask } = encode(text, wp)
        const n = ids.length
        const idsArr = BigInt64Array.from(ids.map((v) => BigInt(v)))
        const maskArr = BigInt64Array.from(mask.map((v) => BigInt(v)))
        const typeArr = new BigInt64Array(n) // token_type_ids 全 0
        const feeds: Record<string, any> = {
          input_ids: new ort.Tensor('int64', idsArr, [1, n]),
          attention_mask: new ort.Tensor('int64', maskArr, [1, n]),
          token_type_ids: new ort.Tensor('int64', typeArr, [1, n])
        }
        const results = await session.run(feeds)
        // 取 last_hidden_state [1, n, 384], 按 mask 均值池化 + L2 归一
        const key = results.last_hidden_state ? 'last_hidden_state' : Object.keys(results)[0]!
        const data = results[key].data as Float32Array
        const pooled = new Float32Array(DIM)
        let maskSum = 0
        for (let t = 0; t < n; t++) {
          if (mask[t] === 0) continue
          maskSum++
          const base = t * DIM
          for (let d = 0; d < DIM; d++) pooled[d]! += data[base + d]!
        }
        if (maskSum > 0) for (let d = 0; d < DIM; d++) pooled[d]! /= maskSum
        let norm = 0
        for (let d = 0; d < DIM; d++) norm += pooled[d]! * pooled[d]!
        norm = Math.sqrt(norm)
        if (norm > 0) for (let d = 0; d < DIM; d++) pooled[d]! /= norm
        out.push(pooled)
      }
      return out
    }
  }
}
