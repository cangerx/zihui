import type { SyncEntityDef } from './types'

// ============================================================================
// 同步实体注册表
// ----------------------------------------------------------------------------
// 收录所有「与账号有关、值得跨设备同步」的结构化业务表。每条声明驱动：
//   - schema.ts 据此为该表安装 INSERT/UPDATE/DELETE 触发器（写 oplog/tombstone）
//   - serializer.ts 据此做行↔payload、媒体外置、集合/JSON 字段识别
//   - engine.ts 据此按 order 拓扑序 apply（父先于子）
//
// 刻意排除（理由）：
//   - settings        : 混入设备级配置（trusted_read_dirs 本机路径、backup_*、
//                       cloud_sync_* 本设备同步配置本身），整表同步会污染其它设备
//   - usage_logs      : 统计流水，自增主键，无同步价值
//   - vector_chunks   : embedding BLOB 体积大且与模型维度强绑定，换设备按需重建
//   - vector_provider : 本机向量服务配置，设备相关
//   - cloud_kb_cache  : 7 天 TTL 在线检索缓存
//   - matting_providers: AK Secret 以 device-id 派生密钥本地加密，跨设备无法解密
//   - ewei_connectors  : 第三方商城密码以 device-id 派生密钥本地加密，跨设备无法解密
//   - ewei_goods_image_logs: 本机商品图替换审计/回滚载体，设备相关，无同步价值
// ============================================================================

export const SYNC_ENTITIES: SyncEntityDef[] = [
  // ---- order 10：无父依赖 ----
  {
    entity: 'model_providers',
    order: 10,
    category: 'data',
    updatedField: 'updated_at',
    jsonFields: ['models', 'custom_params', 'request_override_patch'],
    secretFields: ['api_key'],
  },
  {
    entity: 'personas',
    order: 10,
    category: 'data',
    updatedField: 'updated_at',
  },
  {
    entity: 'kb_categories',
    order: 10,
    category: 'data',
    updatedField: 'created_at',
    // watch_paths 是本机监视目录，跨设备无意义
    skipColumns: ['watch_paths'],
  },
  {
    entity: 'prompt_categories',
    order: 10,
    category: 'data',
    updatedField: 'created_at',
  },
  {
    entity: 'gallery_categories',
    order: 10,
    category: 'data',
    updatedField: 'created_at',
  },
  {
    entity: 'creative_template_categories',
    order: 10,
    category: 'data',
    updatedField: 'updated_at',
  },
  {
    entity: 'image_sessions',
    order: 10,
    category: 'data',
    updatedField: 'updated_at',
  },
  {
    entity: 'canvas_projects',
    order: 10,
    category: 'data',
    updatedField: 'updated_at',
  },
  {
    entity: 'skills',
    order: 10,
    category: 'data',
    updatedField: 'created_at',
    jsonFields: ['function_def'],
  },
  {
    entity: 'mcp_servers',
    order: 10,
    category: 'data',
    updatedField: 'created_at',
    jsonFields: ['args', 'env', 'tools'],
    // env 通常装 API key 等敏感凭据：冲突记录里只留掩码，不存明文（与 model_providers.api_key 同策略）
    secretFields: ['env'],
  },
  {
    entity: 'canvas_characters',
    order: 10,
    category: 'data',
    updatedField: 'created_at',
    blobFields: [{ field: 'ref_image_path', kind: 'path', category: 'image' }],
  },

  // ---- order 20：依赖 order 10 ----
  {
    entity: 'knowledge_bases',
    order: 20,
    category: 'data',
    updatedField: 'created_at',
    // file_path 多指向用户本机外部文件，不在 dataDir 内；仅同步元数据，向量与原文件按需重建
  },
  {
    entity: 'bots',
    order: 20,
    category: 'data',
    updatedField: 'updated_at',
    setFields: ['kb_category_ids', 'cloud_kb_ids', 'skill_ids', 'mcp_ids', 'prompt_skill_dirs'],
    blobFields: [{ field: 'avatar', kind: 'path', category: 'image' }],
  },
  {
    entity: 'prompt_presets',
    order: 20,
    category: 'data',
    updatedField: 'created_at',
  },
  {
    entity: 'gallery_items',
    order: 20,
    category: 'data',
    updatedField: 'created_at',
    blobFields: [{ field: 'file_path', kind: 'path', category: 'auto' }],
  },
  {
    entity: 'creative_templates',
    order: 20,
    category: 'data',
    updatedField: 'updated_at',
    jsonFields: ['variables', 'example_ref_images'],
    blobFields: [
      { field: 'cover_image', kind: 'path', category: 'image' },
      { field: 'source_image', kind: 'path', category: 'image' },
      { field: 'example_ref_images', kind: 'pathArray', category: 'image' },
    ],
  },
  {
    entity: 'image_generations',
    order: 20,
    category: 'data',
    updatedField: 'created_at',
    jsonFields: ['ref_images'],
    blobFields: [{ field: 'result_path', kind: 'path', category: 'image' }],
  },
  {
    entity: 'video_generations',
    order: 20,
    category: 'data',
    updatedField: 'updated_at',
    jsonFields: ['reference_assets', 'reference_image_urls', 'reference_video_urls'],
    blobFields: [{ field: 'local_path', kind: 'path', category: 'video' }],
  },
  {
    entity: 'matting_tasks',
    order: 20,
    category: 'data',
    updatedField: 'created_at',
    blobFields: [{ field: 'result_path', kind: 'path', category: 'image' }],
  },
  {
    entity: 'fine_matting_tasks',
    order: 20,
    category: 'data',
    updatedField: 'created_at',
    blobFields: [{ field: 'result_path', kind: 'path', category: 'image' }],
  },

  // ---- order 30：依赖 order 20 ----
  {
    entity: 'conversations',
    order: 30,
    category: 'data',
    updatedField: 'updated_at',
  },
  {
    entity: 'canvas_nodes',
    order: 30,
    category: 'data',
    updatedField: 'created_at',
    jsonFields: ['data'],
    blobFields: [
      { field: 'data', kind: 'jsonPaths', category: 'auto', jsonKeys: ['image_path', 'video_path'] },
    ],
  },
  {
    entity: 'conversation_summaries',
    order: 30,
    category: 'data',
    updatedField: 'updated_at',
  },

  // ---- order 40：依赖 order 30 ----
  {
    entity: 'canvas_edges',
    order: 40,
    category: 'data',
    updatedField: 'created_at',
  },
  {
    entity: 'messages',
    order: 40,
    category: 'data',
    updatedField: 'created_at',
    appendOnly: true,
    jsonFields: ['attachments', 'tool_calls'],
    blobFields: [{ field: 'attachments', kind: 'attachments', category: 'image' }],
    // card 是对话内交互卡片（ask_user / 生图参数卡）的 UI 留痕，会话/本机相关，不跨设备同步
    skipColumns: ['card'],
  },
]

/** 实体名 → 定义 的索引。 */
export const ENTITY_MAP: Record<string, SyncEntityDef> = Object.fromEntries(
  SYNC_ENTITIES.map((e) => [e.entity, e]),
)

/** 所有同步实体名（按 order 升序）。 */
export const ENTITIES_ASC: string[] = [...SYNC_ENTITIES]
  .sort((a, b) => a.order - b.order)
  .map((e) => e.entity)

/** 所有同步实体名（按 order 降序，用于删除）。 */
export const ENTITIES_DESC: string[] = [...ENTITIES_ASC].reverse()

export function getEntityDef(entity: string): SyncEntityDef | undefined {
  return ENTITY_MAP[entity]
}

/** 某分类是否应纳入本次同步（纯数据恒同步；图片/视频按 scope）。 */
export function categoryEnabled(category: string, scope: { image: boolean; video: boolean }): boolean {
  if (category === 'image') return scope.image
  if (category === 'video') return scope.video
  return true
}
