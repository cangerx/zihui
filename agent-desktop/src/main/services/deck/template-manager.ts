import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import type { DeclarativeTemplate } from './declarative'
import type { TemplateManifestEntry, TemplateSchema } from './types'

// 模板按需云缓存(D11/D13): 桌面端从【其绑定云控端 API】拉取声明式模板包,
// SHA256 强校验后落 设备级缓存 getRootDir()/templates/{id}/{version}/。
// 元数据(manifest, 轻量, 供 LLM 选型) 与 渲染包(按需拉) 分离。
// fetchBytes + cacheRoot 经依赖注入, 便于无网络单测。

/** manifest 中单个模板的轻量元数据(供选型) + 拉取信息 */
export interface RemoteTemplateEntry {
  id: string
  version: string
  url: string
  sha256: string
  size?: number
  name: string
  category: string
  description: string
  /** 供 LLM 填槽的 schema(轻量, 随 manifest 下发, 无需先拉渲染包) */
  schema: TemplateSchema
}

export interface TemplateManifest {
  schema_version: number
  updated_at?: string
  templates: RemoteTemplateEntry[]
}

export type FetchBytes = (url: string, signal?: AbortSignal) => Promise<Buffer>

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

export class TemplateManager {
  private cacheRoot: string
  private fetchBytes: FetchBytes

  constructor(cacheRoot: string, fetchBytes: FetchBytes) {
    this.cacheRoot = cacheRoot
    this.fetchBytes = fetchBytes
  }

  private pkgDir(id: string, version: string): string {
    return join(this.cacheRoot, id, version)
  }
  private pkgPath(id: string, version: string): string {
    return join(this.pkgDir(id, version), 'template.json')
  }

  /** 命中且 SHA256 匹配则返回缓存的声明式模板, 否则 null(损坏/被篡改也视为未命中) */
  private readCached(entry: RemoteTemplateEntry): DeclarativeTemplate | null {
    const p = this.pkgPath(entry.id, entry.version)
    if (!existsSync(p)) return null
    try {
      const buf = readFileSync(p)
      if (sha256(buf) !== entry.sha256) return null
      return JSON.parse(buf.toString('utf-8')) as DeclarativeTemplate
    } catch {
      return null
    }
  }

  /** 确保模板就绪: 命中缓存直接用; 未命中从云控端拉取 + SHA256 强校验 + 原子落盘。 */
  async ensureTemplate(entry: RemoteTemplateEntry, signal?: AbortSignal): Promise<DeclarativeTemplate> {
    const cached = this.readCached(entry)
    if (cached) return cached

    const buf = await this.fetchBytes(entry.url, signal)
    const actual = sha256(buf)
    if (actual !== entry.sha256) {
      throw new Error(
        `模板 ${entry.id}@${entry.version} SHA256 不符(期望 ${entry.sha256.slice(0, 12)}… 实得 ${actual.slice(0, 12)}…), 拒绝使用`
      )
    }
    const tpl = JSON.parse(buf.toString('utf-8')) as DeclarativeTemplate

    // 原子落盘: 写 .tmp 再 rename, 失败不留半包
    const dir = this.pkgDir(entry.id, entry.version)
    mkdirSync(dir, { recursive: true })
    const final = this.pkgPath(entry.id, entry.version)
    const tmp = final + '.tmp'
    writeFileSync(tmp, buf)
    try {
      rmSync(final, { force: true })
    } catch {
      /* ignore */
    }
    renameSync(tmp, final)
    return tpl
  }

  /** 拉取并解析 manifest(轻量全量元数据) */
  async loadManifest(url: string, signal?: AbortSignal): Promise<TemplateManifest> {
    const buf = await this.fetchBytes(url, signal)
    return JSON.parse(buf.toString('utf-8')) as TemplateManifest
  }

  /** manifest → 供 LLM 选型/用户浏览的轻量元数据(含 schema, 不含渲染块) */
  static toManifestEntries(m: TemplateManifest): TemplateManifestEntry[] {
    return m.templates.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      schema: t.schema
    }))
  }
}

// 真实接线(未来 ipc/service 层):
//   new TemplateManager(join(getRootDir(),'templates'), (url,signal)=>下载器(复用 sync/api downloadBlobToFile + checksum))
// manifest URL = `${getCloudApiBase()}/deck/templates/manifest`(其绑定云控端, 非母 CDN)。
