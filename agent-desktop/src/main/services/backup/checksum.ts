import { createReadStream } from 'fs'
import { createHash } from 'crypto'

/**
 * 流式计算文件 SHA-256，恒定内存占用。
 * 用于备份时给 manifest 写每个文件的 hash，恢复时校验完整性。
 */
export function sha256File(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(absPath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** 同步版，仅用于小 buffer（manifest 等）。 */
export function sha256Buffer(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}
