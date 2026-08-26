// 云同步类型定义。
// 设计要点：所有可同步业务表均为 TEXT(UUID) 主键，故 sync_uid 直接等于业务行 id，
// 外键引用同为 UUID，跨设备天然不冲突，无需 id↔uid 翻译。

/** 数据分类：结构化纯数据 / 图片 / 视频。blob 按此分类做选择性传输。 */
export type SyncCategory = 'data' | 'image' | 'video'

/** 冲突解决模式：智能融合 / 以本机为准 / 以云端为准。 */
export type ConflictMode = 'merge' | 'local' | 'cloud'

/** 同步范围（用户可勾选；纯数据恒为 true）。 */
export interface SyncScope {
  data: boolean
  image: boolean
  video: boolean
}

/** 自动同步频率。 */
export type SyncMode = 'off' | 'realtime' | 'hourly' | 'daily'

/**
 * blob 字段规格：声明某列/某 JSON 路径承载本地媒体文件或内嵌 base64，
 * serializer 据此把媒体外置为 content-addressed blob，payload 内只留引用。
 */
export interface BlobFieldSpec {
  /** 列名 */
  field: string
  /**
   * - path: 列值是单个本地文件路径（绝对 / 相对 dataDir / local-file:// 协议）
   * - pathArray: 列值是 JSON 字符串数组，每项为路径或 data URL
   * - attachments: messages.attachments 专用（数组，元素可能是含 base64 data 的对象）
   * - jsonPaths: 列值是 JSON 对象/数组，需在 jsonKeys 指定的键上替换路径
   */
  kind: 'path' | 'pathArray' | 'attachments' | 'jsonPaths'
  /** 分类；auto = 按扩展名/同行 file_type 判定 image/video */
  category: SyncCategory | 'auto'
  /** kind=jsonPaths 时，需要外置的键名（递归匹配），如 ['image_path','video_path'] */
  jsonKeys?: string[]
}

/** 单个可同步实体（= 一张表）的同步声明。 */
export interface SyncEntityDef {
  /** 实体名（= 表名） */
  entity: string
  /** 依赖拓扑序：父实体序号小于子实体，apply 升序、删除降序 */
  order: number
  /** 归属分类（结构化实体恒为 data；其引用的 blob 各自带 category） */
  category: SyncCategory
  /** 用于 LWW 的时间列；缺省回退 oplog 时间 */
  updatedField?: 'updated_at' | 'created_at'
  /** JSON 数组型集合字段：融合时做集合三路合并（增删并集） */
  setFields?: string[]
  /** JSON 对象/数组字段：比较时按解析后结构比较 */
  jsonFields?: string[]
  /** 含媒体的字段 */
  blobFields?: BlobFieldSpec[]
  /** append-only（如 messages）：融合 = 并集，几乎无字段冲突 */
  appendOnly?: boolean
  /** 不参与同步的列（本机特定，如本地监视路径） */
  skipColumns?: string[]
  /** 敏感字段：上云前由云控端 Crypt 加密入库（payload 仍是明文传输走 HTTPS） */
  secretFields?: string[]
}

/** blob 引用（payload 内对媒体的占位）。 */
export interface BlobRef {
  sha256: string
  size: number
  category: SyncCategory
  ext: string
  /** 原字段形态，apply 时按此还原：绝对路径 / 相对 dataDir / local-file 协议 / data URL */
  form?: 'abs' | 'rel' | 'protocol' | 'dataurl'
  /** MIME（dataurl 还原用） */
  mime?: string
}

/** 实体序列化后的载荷。 */
export interface EntityPayload {
  entity: string
  uid: string
  /** 业务列（媒体字段已替换为 sync-blob:// 引用） */
  fields: Record<string, any>
  /** 本实体引用到的 blob 清单 */
  blobs: BlobRef[]
  /** LWW 毫秒时间戳 */
  updated_ms: number
}

/** 推送给云端的一条变更。 */
export interface PushChange {
  entity: string
  uid: string
  /** 基线 server_rev（冲突检测用；0 = 新建） */
  base_rev: number
  deleted: boolean
  content_hash: string
  updated_ms: number
  payload: EntityPayload | null
  /** 该变更引用的 blob sha256 列表（服务端校验引用完整性） */
  blobs: string[]
}

/** 从云端拉取的一条变更。 */
export interface RemoteChange {
  server_seq: number
  entity: string
  uid: string
  rev: number
  deleted: boolean
  content_hash: string
  updated_ms: number
  payload: EntityPayload | null
}

/** push 单条结果。 */
export interface PushResult {
  uid: string
  entity: string
  /** rejected：服务端校验未通过（如引用的 blob 不存在）；oplog 保留待下次重推 */
  status: 'applied' | 'conflict' | 'rejected'
  server_seq?: number
  rev?: number
  reason?: string
  /** conflict 时返回服务端当前版本，供客户端合并 */
  remote?: RemoteChange
}

export interface SyncProgress {
  phase: 'idle' | 'pull' | 'merge' | 'upload' | 'push' | 'reconcile' | 'done' | 'error'
  current: number
  total: number
  message: string
}

export interface SyncStatusSnapshot {
  running: boolean
  lastSyncAt: number
  lastError: string
  pendingChanges: number
  conflicts: number
  progress: SyncProgress
}

/** 容量信息（云端返回）。 */
export interface QuotaInfo {
  used: number
  base_quota: number
  extra_quota: number
  total: number
  percent: number
  overage_policy: string
}

/** 冲突副本记录（不静默丢数据）。 */
export interface ConflictRecord {
  entity: string
  uid: string
  field: string
  localValue: string
  remoteValue: string
  resolution: 'local' | 'remote' | 'copy'
  ts_ms: number
}
