import type Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import {
  buildIconIndex,
  iconIndexMeta,
  type DeckEmbedder,
  type IconRecord
} from './icon-search'

// 图标索引构建(设备级缓存): 首次使用 / 模型或维度变更时, 把内置(+未来云端)图标库嵌入写库。
// 图标库为内置资产(resources/deck-icons/), 索引(deck_icon_vectors/vec0)是设备级产物, 不进 git。

type DB = Database.Database

interface IconManifestItem {
  id: string
  name: string
  keywords: string
  file: string
}

/** 内置图标资源目录(prod 走 resourcesPath, dev 走源码 resources/, 与 schema.sql 一致) */
export function builtinDeckIconsDir(): string {
  // dev: electron-vite 把 main 打包进 out/main, __dirname=out/main, 两级回到项目根(与 database/index.ts 一致)
  return app.isPackaged
    ? join(process.resourcesPath, 'deck-icons')
    : join(__dirname, '../../resources/deck-icons')
}

/** 读取图标目录下 manifest.json → IconRecord[](svgPath 为绝对路径) */
export function loadIconRecords(iconsDir: string): IconRecord[] {
  const manifestPath = join(iconsDir, 'manifest.json')
  if (!existsSync(manifestPath)) return []
  const items = JSON.parse(readFileSync(manifestPath, 'utf8')) as IconManifestItem[]
  return items
    .filter((it) => it && it.id && it.file)
    .map((it) => ({
      id: it.id,
      name: it.name ?? it.id,
      keywords: it.keywords ?? '',
      svgPath: join(iconsDir, it.file)
    }))
}

export interface EnsureIconIndexOptions {
  db: DB
  embedder: DeckEmbedder
  /** 覆盖图标目录(测试用); 默认内置目录 */
  iconsDir?: string
  /** 覆盖图标记录(测试用); 优先于 iconsDir */
  records?: IconRecord[]
  sqliteVecOk?: boolean
  /** 强制重建(忽略已有索引) */
  force?: boolean
}

/**
 * 确保图标索引就绪。已有索引且 (model,dim) 与当前 embedder 一致、数量>0 → 跳过;
 * 否则用当前 embedder 全量重建。返回是否执行了重建。
 */
export async function ensureIconIndex(opts: EnsureIconIndexOptions): Promise<{ rebuilt: boolean; count: number }> {
  const { db, embedder } = opts
  const meta = iconIndexMeta(db)
  const upToDate =
    !opts.force && meta.count > 0 && meta.model === embedder.model && meta.dim === embedder.dim
  if (upToDate) return { rebuilt: false, count: meta.count }

  const records = opts.records ?? loadIconRecords(opts.iconsDir ?? builtinDeckIconsDir())
  if (records.length === 0) return { rebuilt: false, count: 0 }

  const res = await buildIconIndex(records, {
    db,
    embedder,
    sqliteVecOk: opts.sqliteVecOk
  })
  return { rebuilt: true, count: res.count }
}
