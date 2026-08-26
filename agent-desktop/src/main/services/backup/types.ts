// 备份模块共享类型。
//
// 设计原则：
// - BackupInfo 是面向 UI / IPC 的稳定结构，所有版本格式都收敛到它。
// - Manifest 是 v1 zip 格式内嵌的元数据契约，formatVersion 用于未来格式升级时的兼容判断。

export type BackupType = 'auto' | 'full'

/** UI / IPC 暴露的备份记录项。fileName 是 backups/ 内相对路径，含扩展名（.zip 或 legacy .sqlite/.bak）。 */
export interface BackupInfo {
  fileName: string
  type: BackupType
  size: number
  createdAt: string
  /** 仅 v1 格式有；legacy 备份为空。便于 UI 区分能否做完整性校验。 */
  appVersion?: string
  /** 'v1' 表示新 zip 格式，'legacy' 表示旧 .bak/.sqlite 直拷贝。 */
  format?: 'v1' | 'legacy'
}

/** Manifest 文件 (manifest.json) 的契约。zip 内第一个或最后一个 entry。 */
export interface ManifestV1 {
  formatVersion: 1
  appVersion: string
  type: BackupType
  createdAt: string
  platform: NodeJS.Platform
  /**
   * files 中的 path 是 zip 内相对路径，约定都以 'data/' 开头，
   * 恢复时 stripPrefix('data/') → 写到 dataDir。
   */
  files: ManifestFile[]
  /** 所有文件未压缩字节数之和，UI 显示用。 */
  totalSize: number
}

export interface ManifestFile {
  path: string
  size: number
  sha256: string
}

/** 进度事件结构，与 IPC channel 'backup:progress' / 'backup:restoreProgress' 对齐。 */
export interface ProgressEvent {
  phase: 'snapshot' | 'pack' | 'verify' | 'extract' | 'apply'
  current: number
  total: number
  fileName: string
  /** 当前文件已处理字节，可用于细粒度展示。 */
  bytes?: number
}

export interface RestoreResult {
  success: boolean
  error?: string
  /** 当 success=true 且需要重启时为 true（恢复都需要重启，固定 true，预留语义）。 */
  needsRelaunch?: boolean
}

export interface BackupSettings {
  interval: 'off' | 'daily' | 'weekly'
  maxCount: number
}

/** 主进程内的取消令牌：由 IPC 'backup:cancel' 触发，备份/恢复函数轮询 isAborted。 */
export interface AbortToken {
  isAborted(): boolean
  throwIfAborted(): void
}
