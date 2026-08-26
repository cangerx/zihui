import type Database from 'better-sqlite3'
import { readFileSync, existsSync } from 'fs'

// 语义图标检索(满血, 见 docs/deck-feature-spec.md H6/§5.7 项7)。
// 主路: 真向量(默认 MiniLM dim384, embedder 经 DI)写 deck_icon_vectors + sqlite-vec vec0 KNN;
// 任一环节失败 → 在同一组 Float32 向量上回退 JS cosine(绝不退化为关键词匹配)。
// embedder 注入(DeckEmbedder): 真实 = MiniLM/云端语义嵌入; 验证用 fake 确定性嵌入。

type DB = Database.Database

/** 语义嵌入器(依赖注入)。真实实现见 icon-embedder.ts; 单测用 fake。 */
export interface DeckEmbedder {
  /** 嵌入模型标识(用于检测索引是否需按模型变更重建) */
  readonly model: string
  /** 向量维度(MiniLM=384; 云端模型按其维度) */
  readonly dim: number
  /** 批量嵌入; 返回与输入等长、各为单位向量(或非单位, 由 cosine 归一)的 Float32 向量 */
  embed(texts: string[]): Promise<Float32Array[]>
}

/** 一枚内置/云端图标(svg_path 指向磁盘 SVG 源文件) */
export interface IconRecord {
  id: string
  name: string
  /** 中英描述/同义词, 与 name 一并嵌入, 提升召回 */
  keywords: string
  /** SVG 源文件绝对路径 */
  svgPath: string
}

/** 检索命中 */
export interface IconHit {
  id: string
  name: string
  svgPath: string
  score: number
}

/** 当前图标索引元信息(用于判断是否需重建) */
export interface IconIndexMeta {
  model: string
  dim: number
  count: number
}

/** embedder 不就绪(如 MiniLM 权重未按需缓存到位)。IPC 层据此提示前端拉取权重, 与 ffmpeg 门控同构。 */
export class IconEmbedderNotReadyError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'IconEmbedderNotReadyError'
    this.reason = reason
  }
}

const VEC_TABLE = 'deck_icon_vec0'

function embeddingToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

// 直接在 Float32 BLOB 上算余弦, 跨维(长度不符)返回 0(被 threshold 过滤), 对齐 vector-store 范式。
function cosineF32(query: Float32Array, buf: Buffer): number {
  const v = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  if (v.length !== query.length) return 0
  let dot = 0
  let nq = 0
  let nv = 0
  for (let i = 0; i < query.length; i++) {
    dot += query[i]! * v[i]!
    nq += query[i]! * query[i]!
    nv += v[i]! * v[i]!
  }
  const denom = Math.sqrt(nq) * Math.sqrt(nv)
  return denom === 0 ? 0 : dot / denom
}

// ── sqlite-vec vec0 KNN(可用时加速; 任一失败回退 JS cosine, 零降级)──
let _vecReady = false
let _vecBroken = false

/** 确保 vec0 虚表存在并与 deck_icon_vectors 对齐(懒灌入); 返回 false 表示交由 JS cosine。 */
function ensureIconVecTable(db: DB, dim: number, sqliteVecOk: boolean): boolean {
  if (!sqliteVecOk || !dim || dim <= 0 || _vecBroken) return false
  if (_vecReady) return true
  try {
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(icon_id TEXT PRIMARY KEY, embedding float[${dim}] distance_metric=cosine)`
    )
    const cnt = (db.prepare(`SELECT COUNT(*) AS c FROM ${VEC_TABLE}`).get() as { c: number }).c
    if (cnt === 0) {
      const rows = db
        .prepare(
          'SELECT icon_id, embedding FROM deck_icon_vectors WHERE embedding IS NOT NULL AND embedding_dim = ?'
        )
        .all(dim) as Array<{ icon_id: string; embedding: Buffer }>
      if (rows.length > 0) {
        const ins = db.prepare(`INSERT OR REPLACE INTO ${VEC_TABLE}(icon_id, embedding) VALUES (?, ?)`)
        const tx = db.transaction(() => {
          for (const r of rows) ins.run(r.icon_id, r.embedding)
        })
        tx()
      }
    }
    _vecReady = true
    return true
  } catch {
    _vecBroken = true
    return false
  }
}

/** 重置 vec0 缓存状态(索引重建后调用, 让下次检索重新对齐) */
export function resetIconVecState(): void {
  _vecReady = false
  _vecBroken = false
}

export interface BuildIconIndexOptions {
  db: DB
  embedder: DeckEmbedder
  /** sqlite-vec 是否可用(默认探测); 测试可强制 false 走纯 JS 路径 */
  sqliteVecOk?: boolean
}

/**
 * 全量构建图标向量索引: 嵌入每枚图标(name+keywords) → 写 deck_icon_vectors → 双写 vec0。
 * 覆盖式(先清空), 用于首次构建或模型/维度变更后的重建。
 */
export async function buildIconIndex(
  records: IconRecord[],
  opts: BuildIconIndexOptions
): Promise<{ count: number; model: string; dim: number }> {
  const { db, embedder } = opts
  const sqliteVecOk = opts.sqliteVecOk ?? false
  if (records.length === 0) return { count: 0, model: embedder.model, dim: embedder.dim }

  const vectors = await embedder.embed(records.map((r) => `${r.name} ${r.keywords}`.trim()))
  if (vectors.length !== records.length) {
    throw new Error(`embedder 返回数量不符: ${vectors.length} != ${records.length}`)
  }

  resetIconVecState()
  const upsert = db.prepare(
    `INSERT INTO deck_icon_vectors (icon_id, name, keywords, svg_path, embedding_model, embedding_dim, embedding)
     VALUES (@icon_id, @name, @keywords, @svg_path, @model, @dim, @embedding)
     ON CONFLICT(icon_id) DO UPDATE SET
       name=excluded.name, keywords=excluded.keywords, svg_path=excluded.svg_path,
       embedding_model=excluded.embedding_model, embedding_dim=excluded.embedding_dim, embedding=excluded.embedding`
  )
  // 重建前清掉其它模型/维度的旧行与 vec0(避免脏召回)
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM deck_icon_vectors').run()
    try {
      db.exec(`DROP TABLE IF EXISTS ${VEC_TABLE}`)
    } catch {
      /* vec0 可能尚未建, 忽略 */
    }
    for (let i = 0; i < records.length; i++) {
      const r = records[i]!
      const v = vectors[i]!
      upsert.run({
        icon_id: r.id,
        name: r.name,
        keywords: r.keywords,
        svg_path: r.svgPath,
        model: embedder.model,
        dim: embedder.dim,
        embedding: embeddingToBuffer(v)
      })
    }
  })
  tx()

  // 双写 vec0(best-effort): 失败不影响主流程, 检索时回退 JS cosine
  if (ensureIconVecTable(db, embedder.dim, sqliteVecOk)) {
    try {
      const ins = db.prepare(`INSERT OR REPLACE INTO ${VEC_TABLE}(icon_id, embedding) VALUES (?, ?)`)
      const tx2 = db.transaction(() => {
        for (let i = 0; i < records.length; i++) ins.run(records[i]!.id, embeddingToBuffer(vectors[i]!))
      })
      tx2()
    } catch {
      /* 回退 JS cosine */
    }
  }

  return { count: records.length, model: embedder.model, dim: embedder.dim }
}

export function iconIndexMeta(db: DB): IconIndexMeta {
  const row = db
    .prepare(
      `SELECT embedding_model AS model, embedding_dim AS dim, COUNT(*) AS count
       FROM deck_icon_vectors WHERE embedding IS NOT NULL
       GROUP BY embedding_model, embedding_dim ORDER BY count DESC LIMIT 1`
    )
    .get() as { model: string; dim: number; count: number } | undefined
  return row ?? { model: '', dim: 0, count: 0 }
}

export interface SearchIconsOptions {
  db: DB
  embedder: DeckEmbedder
  topK?: number
  /** 余弦相似度阈值(低于此值丢弃) */
  threshold?: number
  sqliteVecOk?: boolean
}

/** 语义检索: 嵌入 query → vec0 KNN(可用时) → 否则 JS cosine 全量。返回 Top-K 命中。 */
export async function searchIcons(query: string, opts: SearchIconsOptions): Promise<IconHit[]> {
  const { db, embedder } = opts
  const topK = opts.topK ?? 6
  const threshold = opts.threshold ?? 0.15
  const sqliteVecOk = opts.sqliteVecOk ?? false
  if (!query.trim()) return []

  const qv = (await embedder.embed([query]))[0]
  if (!qv) return []

  // 1) vec0 KNN 加速路径
  if (ensureIconVecTable(db, embedder.dim, sqliteVecOk)) {
    try {
      const rows = db
        .prepare(
          `SELECT v.icon_id, v.distance FROM ${VEC_TABLE} v
           WHERE v.embedding MATCH ? AND k = ? ORDER BY v.distance`
        )
        .all(embeddingToBuffer(qv), topK) as Array<{ icon_id: string; distance: number }>
      const hits: IconHit[] = []
      for (const r of rows) {
        const score = 1 - r.distance
        if (score < threshold) continue
        const meta = db
          .prepare('SELECT icon_id, name, svg_path FROM deck_icon_vectors WHERE icon_id = ?')
          .get(r.icon_id) as { icon_id: string; name: string; svg_path: string } | undefined
        if (!meta) continue
        hits.push({ id: meta.icon_id, name: meta.name, svgPath: meta.svg_path, score })
      }
      if (hits.length > 0) return hits
      // KNN 命中为空(阈值过滤光了)时继续走 JS 兜底, 不直接返回空
    } catch {
      _vecBroken = true
    }
  }

  // 2) JS cosine 全量回退(同一组 Float32 向量, 非关键词)
  const rows = db
    .prepare(
      'SELECT icon_id, name, svg_path, embedding FROM deck_icon_vectors WHERE embedding IS NOT NULL AND embedding_dim = ?'
    )
    .all(embedder.dim) as Array<{ icon_id: string; name: string; svg_path: string; embedding: Buffer }>
  const scored: IconHit[] = []
  for (const r of rows) {
    const score = cosineF32(qv, r.embedding)
    if (score >= threshold) scored.push({ id: r.icon_id, name: r.name, svgPath: r.svg_path, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

/**
 * 渲染图标 SVG → PNG Buffer(@resvg, 无字体依赖)。可选 color 覆盖描边/填充(单色图标)。
 * 用于 PPTX/图片导出时把矢量图标栅格化为预栅格 PNG(对齐 html2pptx 约束: 图标用 PNG 而非内联 SVG)。
 */
export function renderIconPng(svgPath: string, sizePx = 96, color?: string): Buffer {
  if (!existsSync(svgPath)) throw new Error(`图标文件不存在: ${svgPath}`)
  let svg = readFileSync(svgPath, 'utf8')
  if (color) {
    // 单色图标: 把 currentColor / 占位色替换为目标色(内置图标统一用 currentColor)
    svg = svg.replace(/currentColor/g, color)
  }
  // 延迟 require: @resvg 是原生包, 仅导出/渲染时加载
  const { Resvg } = require('@resvg/resvg-js') as typeof import('@resvg/resvg-js')
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: sizePx } })
  return Buffer.from(resvg.render().asPng())
}
