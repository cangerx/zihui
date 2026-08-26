CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'openai_compatible',
  api_base TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  models TEXT NOT NULL DEFAULT '[]',
  purpose TEXT NOT NULL DEFAULT 'general',
  provider_preset TEXT NOT NULL DEFAULT '',
  protocol_adapter TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  -- 生图扩展字段（仅作用于 callImageAPI 的自定义 + 多米分支，云端固定协议不受影响）
  -- custom_params: JSON 数组 [{name, value}]，逐条 set 进 body 顶层；空字符串值仅占位不下发
  -- request_override_patch: JSON 对象，最后 Object.assign 到 body 上做最终覆盖
  custom_params TEXT NOT NULL DEFAULT '[]',
  request_override_patch TEXT NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vector_provider (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'openai',
  api_base TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kb_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  watch_paths TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL DEFAULT '',
  file_type TEXT NOT NULL DEFAULT '',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  source_mtime INTEGER NOT NULL DEFAULT 0,
  source_size INTEGER NOT NULL DEFAULT 0,
  source_hash TEXT NOT NULL DEFAULT '',
  last_indexed_at TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES kb_categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  model_provider_id TEXT,
  model_id TEXT NOT NULL DEFAULT '',
  persona_id TEXT,
  kb_only INTEGER NOT NULL DEFAULT 0,
  kb_category_ids TEXT NOT NULL DEFAULT '[]',
  -- 云端知识库绑定（来自云控端智能体预设，acquire 时下发；对话时在线检索）
  cloud_kb_ids TEXT NOT NULL DEFAULT '[]',
  cloud_kb_only INTEGER NOT NULL DEFAULT 0,
  cloud_kb_top_k INTEGER NOT NULL DEFAULT 5,
  skill_ids TEXT NOT NULL DEFAULT '[]',
  mcp_ids TEXT NOT NULL DEFAULT '[]',
  prompt_skill_dirs TEXT NOT NULL DEFAULT '[]',
  skill_bindings TEXT NOT NULL DEFAULT '[]',
  skill_selection_mode TEXT NOT NULL DEFAULT 'legacy_all',
  default_workspace_id TEXT NOT NULL DEFAULT '',
  tool_approval TEXT NOT NULL DEFAULT 'destructive',
  -- 智能体市场相关：avatar 本地形象图（2:3，落盘绝对路径）；source 'local'|'market'；
  -- cloud_agent_id 市场来源云端 id（去重）；submission_* 投稿到市场的审核态
  avatar TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  cloud_agent_id INTEGER NOT NULL DEFAULT 0,
  cloud_template_version INTEGER NOT NULL DEFAULT 0,
  cloud_template_snapshot TEXT NOT NULL DEFAULT '{}',
  submission_status TEXT NOT NULL DEFAULT '',
  submission_reject_reason TEXT NOT NULL DEFAULT '',
  submission_reviewed_at TEXT NOT NULL DEFAULT '',
  submission_synced_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (model_provider_id) REFERENCES model_providers(id) ON DELETE SET NULL,
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  -- D-26：未绑智能体时为空；空会话不写空串（空串会撞 bots 外键）
  bot_id TEXT,
  title TEXT NOT NULL DEFAULT 'New Chat',
  -- 当前会话使用的模型（每个会话独立持久记忆）：
  -- - 新建时：填入云控端「对话页面默认模型」（site-config.chat_default_model）；缺省时留空
  -- - 用户在对话页输入框左下角切换：写回这两列
  -- - sendMessage 时优先用这两列，缺省时回退到云端默认 / 本地第一个 chat 模型
  -- 之前依赖 bots.model_provider_id / bots.model_id 强绑定的设计已废弃，新模型策略「智能体不再绑定模型」
  active_model_provider_id TEXT NOT NULL DEFAULT '',
  active_model_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- D-20：关联品牌工作区（空=普通会话）
  brand_workspace_id TEXT NOT NULL DEFAULT '',
  -- 本次任务实际使用的文件夹工作区；创建后持久化，避免全局切换导致目录漂移
  workspace_id TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS digital_employee_profiles (
  bot_id TEXT PRIMARY KEY,
  role_summary TEXT NOT NULL DEFAULT '',
  responsibilities_json TEXT NOT NULL DEFAULT '[]',
  boundaries_json TEXT NOT NULL DEFAULT '[]',
  standard_inputs_json TEXT NOT NULL DEFAULT '[]',
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  advanced_instructions TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

-- default_workspace_id / workspace_id 索引依赖旧库需 ALTER 才有的列，放到 runMigrations() 在加列之后创建。

CREATE TABLE IF NOT EXISTS digital_employee_assets (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  current_version_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_employee_assets_scope ON digital_employee_assets(bot_id, workspace_id, status, asset_type);

CREATE TABLE IF NOT EXISTS digital_employee_asset_versions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  body_json TEXT NOT NULL DEFAULT '{}',
  source_type TEXT NOT NULL DEFAULT 'user',
  source_ref TEXT NOT NULL DEFAULT '',
  change_summary TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (asset_id) REFERENCES digital_employee_assets(id) ON DELETE CASCADE,
  UNIQUE(asset_id, version)
);

CREATE TABLE IF NOT EXISTS digital_employee_candidates (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  workspace_id TEXT NOT NULL DEFAULT '',
  candidate_type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'workspace',
  title TEXT NOT NULL,
  body_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  fingerprint TEXT NOT NULL,
  conflict_ref TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  target_type TEXT NOT NULL DEFAULT '',
  target_ref TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_candidates_fingerprint ON digital_employee_candidates(bot_id, workspace_id, fingerprint) WHERE status IN ('pending', 'accepted', 'rejected');
CREATE INDEX IF NOT EXISTS idx_employee_candidates_status ON digital_employee_candidates(bot_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS digital_employee_task_runs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT '',
  conversation_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  asset_version_ids_json TEXT NOT NULL DEFAULT '[]',
  output_refs_json TEXT NOT NULL DEFAULT '[]',
  approval_summary_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_employee_task_runs_bot ON digital_employee_task_runs(bot_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_task_runs_conversation ON digital_employee_task_runs(conversation_id, started_at DESC);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  -- 已被摘要覆盖的 user/assistant 消息数（增量摘要水位线）：
  -- 下次摘要只压缩 covered_count 之后、滑动窗口之前的新增段落，避免每轮全量重压，
  -- 同时让摘要覆盖范围紧贴最近窗口，消除「滑出窗口但未被摘要覆盖」的记忆空洞。
  covered_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  tool_calls TEXT NOT NULL DEFAULT '[]',
  tool_call_id TEXT NOT NULL DEFAULT '',
  -- 对话内交互卡片（ask_user / 生图参数确认卡）的 JSON 留痕；仅 UI 用，不回传模型、不跨设备同步
  card TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  function_def TEXT NOT NULL DEFAULT '{}',
  implementation TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  version TEXT NOT NULL DEFAULT '1.0.0',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  unsandboxed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '[]',
  env TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  tools TEXT NOT NULL DEFAULT '[]',
  always_load INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vector_chunks (
  id TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding BLOB,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding_model TEXT NOT NULL DEFAULT '',
  embedding_dim INTEGER NOT NULL DEFAULT 0,
  embedding_source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vector_chunks_kb ON vector_chunks(knowledge_base_id);

CREATE VIRTUAL TABLE IF NOT EXISTS vector_chunks_fts USING fts5(
  content, knowledge_base_id UNINDEXED, chunk_id UNINDEXED,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_provider ON usage_logs(provider_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS image_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Image',
  model_provider_id TEXT,
  model_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (model_provider_id) REFERENCES model_providers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS image_generations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  revised_prompt TEXT NOT NULL DEFAULT '',
  ref_images TEXT NOT NULL DEFAULT '[]',
  model_provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '1:1',
  quality TEXT NOT NULL DEFAULT 'auto',
  result_path TEXT NOT NULL DEFAULT '',
  result_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  -- 失败诊断用：发送给上游 API 的原始请求快照（脱敏后 JSON 字符串）；成功记录通常为空
  raw_request TEXT NOT NULL DEFAULT '',
  -- 去AI标记：该图是否经过「去AI标记」本地处理（1=已处理），用于创作记录/图库角标
  ai_mark_removed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES image_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_image_generations_session ON image_generations(session_id);
CREATE INDEX IF NOT EXISTS idx_image_generations_status_created ON image_generations(status, created_at DESC);

CREATE TABLE IF NOT EXISTS video_generations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'cloud',
  provider_id TEXT NOT NULL DEFAULT '',
  provider_task_id TEXT NOT NULL DEFAULT '',
  protocol_adapter TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  request_params TEXT NOT NULL DEFAULT '{}',
  provider_status TEXT NOT NULL DEFAULT '',
  poll_count INTEGER NOT NULL DEFAULT 0,
  next_poll_at TEXT NOT NULL DEFAULT '',
  last_polled_at TEXT NOT NULL DEFAULT '',
  cloud_task_id TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL DEFAULT '',
  provider_protocol TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  sku_key TEXT NOT NULL DEFAULT '',
  sku_title TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  resolution TEXT NOT NULL DEFAULT '',
  aspect_ratio TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  reference_assets TEXT NOT NULL DEFAULT '[]',
  reference_image_urls TEXT NOT NULL DEFAULT '[]',
  reference_video_urls TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  estimated_credits REAL NOT NULL DEFAULT 0,
  credits_used REAL NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  remote_url TEXT NOT NULL DEFAULT '',
  storage_url TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  local_path TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  download_status TEXT NOT NULL DEFAULT 'pending',
  download_error TEXT NOT NULL DEFAULT '',
  download_attempts INTEGER NOT NULL DEFAULT 0,
  remote_expires_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT NOT NULL DEFAULT '',
  downloaded_at TEXT NOT NULL DEFAULT '',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_video_generations_cloud_task ON video_generations(cloud_task_id);
-- idempotency / poll 索引依赖旧库需 ALTER 才有的列，放到 runMigrations() 在加列之后创建。
CREATE INDEX IF NOT EXISTS idx_video_generations_status_created ON video_generations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_generations_download_status ON video_generations(download_status);
CREATE TABLE IF NOT EXISTS prompt_categories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_categories_type ON prompt_categories(type);

CREATE TABLE IF NOT EXISTS prompt_presets (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES prompt_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prompt_presets_type ON prompt_presets(type);
CREATE INDEX IF NOT EXISTS idx_prompt_presets_category ON prompt_presets(category_id);

CREATE TABLE IF NOT EXISTS canvas_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Canvas',
  text_provider_id TEXT NOT NULL DEFAULT '',
  text_model_id TEXT NOT NULL DEFAULT '',
  image_provider_id TEXT NOT NULL DEFAULT '',
  image_model_id TEXT NOT NULL DEFAULT '',
  concurrency INTEGER NOT NULL DEFAULT 1,
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS canvas_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 240,
  height REAL NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES canvas_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canvas_nodes_project ON canvas_nodes(project_id);

CREATE TABLE IF NOT EXISTS canvas_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  source_handle TEXT NOT NULL DEFAULT 'output',
  target_node_id TEXT NOT NULL,
  target_handle TEXT NOT NULL DEFAULT 'input',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES canvas_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (source_node_id) REFERENCES canvas_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES canvas_nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canvas_edges_project ON canvas_edges(project_id);

CREATE TABLE IF NOT EXISTS gallery_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gallery_items (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'file',
  folder_root TEXT NOT NULL DEFAULT '',
  folder_recursive INTEGER NOT NULL DEFAULT 0,
  -- 去AI标记：该图是否经过「去AI标记」本地处理（1=已处理），用于图库缩略图角标
  ai_mark_removed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES gallery_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gallery_items_category ON gallery_items(category_id);
CREATE INDEX IF NOT EXISTS idx_gallery_items_path ON gallery_items(file_path);
CREATE INDEX IF NOT EXISTS idx_gallery_items_name ON gallery_items(name);

-- AI 抠图自定义接口（v0.6.9+）。仅当用户在「模型服务 → 抠图接口」tab 配置自己的阿里 AK 时
-- 才写入；云控端中转模式不依赖此表。ak/sk 用 AES-256-GCM 加密后存储（key 由 device-id 派生）。
CREATE TABLE IF NOT EXISTS matting_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- 当前仅支持 type='aliyun_viapi'（阿里 SegmentHDCommonImage）。预留字段方便后续接腾讯 / 移除轻量等
  type TEXT NOT NULL DEFAULT 'aliyun_viapi',
  -- AK ID 明文存，便于列表展示（masked）
  access_key_id TEXT NOT NULL DEFAULT '',
  -- AK Secret 加密存：格式 "v1:{iv_hex}:{authTag_hex}:{ciphertext_hex}"，解密 key 由 device-id 派生
  access_key_secret_enc TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL DEFAULT 'imageseg.cn-shanghai.aliyuncs.com',
  region_id TEXT NOT NULL DEFAULT 'cn-shanghai',
  is_default INTEGER NOT NULL DEFAULT 0,
  remark TEXT NOT NULL DEFAULT '',
  last_test_at TEXT NOT NULL DEFAULT '',
  last_test_status TEXT NOT NULL DEFAULT '',
  last_test_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 抠图本地任务历史（v0.6.9+）。云端模式 / 自定义模式都记一条，便于「我的抠图」分类展示 + 失败重试
CREATE TABLE IF NOT EXISTS matting_tasks (
  id TEXT PRIMARY KEY,
  -- 任务来源：'cloud'（云控端中转）/ 'custom'（自定义阿里 AK 直连）
  source TEXT NOT NULL DEFAULT 'cloud',
  -- custom 模式下指向 matting_providers.id；cloud 模式留空
  provider_id TEXT NOT NULL DEFAULT '',
  -- 原图绝对路径（用户选的或临时落盘的）；用于失败重试
  source_image_path TEXT NOT NULL DEFAULT '',
  -- 结果 PNG 绝对路径；保存到 dataDir/matting/{taskId}.png
  result_path TEXT NOT NULL DEFAULT '',
  -- 结果 URL（阿里临时 URL，24h 过期，仅作 trace）
  result_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  -- 阿里端 trace ID
  aliyun_request_id TEXT NOT NULL DEFAULT '',
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  -- 关联画布节点（画布抠图节点用），普通 AI 抠图页面留空
  canvas_project_id TEXT NOT NULL DEFAULT '',
  canvas_node_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_matting_tasks_status ON matting_tasks(status);
CREATE INDEX IF NOT EXISTS idx_matting_tasks_created ON matting_tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_matting_tasks_canvas ON matting_tasks(canvas_project_id);

-- 精细抠图本地任务历史（抠抠图 koukoutu，仅云端中转）。
-- 记录 tier（1/2/3 长边尺寸档）与 cost（本系统积分扣费），便于「我的精细抠图」分类展示 + 失败重试。
CREATE TABLE IF NOT EXISTS fine_matting_tasks (
  id TEXT PRIMARY KEY,
  -- 原图绝对路径（用户选的或临时落盘的）；用于失败重试
  source_image_path TEXT NOT NULL DEFAULT '',
  -- 结果 PNG 绝对路径；保存到 dataDir/fine-matting/{taskId}.png
  result_path TEXT NOT NULL DEFAULT '',
  -- 结果 URL（抠抠图临时 URL，仅作 trace）
  result_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  -- 我们端 trace ID
  request_id TEXT NOT NULL DEFAULT '',
  -- 抠抠图端 task_id
  provider_task_id TEXT NOT NULL DEFAULT '',
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  -- 长边尺寸档位（1=4K以下 / 2=4K-8K / 3=8K以上）
  tier INTEGER NOT NULL DEFAULT 0,
  -- 本次扣费（本系统积分）
  cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fine_matting_tasks_status ON fine_matting_tasks(status);
CREATE INDEX IF NOT EXISTS idx_fine_matting_tasks_created ON fine_matting_tasks(created_at);

-- 创意模板（v0.7.7+）：本地用户私有的创意模板系统
-- 数据完全本地，与云端模板独立；云端模板由云控端提供，不写入此表。
-- 用 TEXT/UUID 主键以便与 ipc 调用 stringly 兼容。
CREATE TABLE IF NOT EXISTS creative_template_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 模板表
-- - variables: JSON 数组，每项 {key,label,type,required,placeholder,default,options}
-- - example_ref_images: JSON 字符串数组，单条最长不限（path/data uri/http url 都可能存）
-- - source_type: manual / image / inspiration
-- - source_image: 图片反推创建时记录用户原图（绝对路径或 data uri）
-- - source_inspiration_id: 灵感转换创建时记录关联灵感来源 id（字符串，桌面端 inspiration id 是 'custom-N' / 'ernie-N'）
CREATE TABLE IF NOT EXISTS creative_templates (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_image TEXT NOT NULL DEFAULT '',
  example_ref_images TEXT NOT NULL DEFAULT '[]',
  requires_ref_image INTEGER NOT NULL DEFAULT 0,
  default_size TEXT NOT NULL DEFAULT '',
  prompt_template TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '[]',
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_image TEXT NOT NULL DEFAULT '',
  source_inspiration_id TEXT NOT NULL DEFAULT '',
  cloud_template_id INTEGER NOT NULL DEFAULT 0,
  submission_status TEXT NOT NULL DEFAULT '',
  submission_reject_reason TEXT NOT NULL DEFAULT '',
  submission_reviewed_at TEXT NOT NULL DEFAULT '',
  submission_published_at TEXT NOT NULL DEFAULT '',
  submission_synced_at TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES creative_template_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_creative_templates_category ON creative_templates(category_id);
CREATE INDEX IF NOT EXISTS idx_creative_templates_source ON creative_templates(source_type);
CREATE INDEX IF NOT EXISTS idx_creative_templates_created ON creative_templates(created_at);

-- 云端知识库检索结果离线缓存（hybrid 降级用）：云端不可达/超时时回退命中过的片段
CREATE TABLE IF NOT EXISTS cloud_kb_cache (
  id TEXT PRIMARY KEY,
  query_hash TEXT NOT NULL,           -- sha256(normalized_query + sorted_kb_ids + top_k)
  cloud_kb_id INTEGER NOT NULL DEFAULT 0,
  chunk_id INTEGER NOT NULL DEFAULT 0,
  source_doc TEXT NOT NULL DEFAULT '',
  kb_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL DEFAULT 0,
  cached_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cloud_kb_cache_query ON cloud_kb_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_cloud_kb_cache_cached ON cloud_kb_cache(cached_at);

-- ewei 商城连接器（业务管理端账号绑定）。第三方商城域名 + 账号 + 密码，登录后管理门店商品图。
-- 安全同 matting_providers：密码 AES-256-GCM 加密存（device-id 派生 key），不参与云同步。
-- session_id 不落库（纯内存态，过期用存的 password 静默重登，见 services/ewei-client.ts）。
CREATE TABLE IF NOT EXISTS ewei_connectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                              -- 连接器别名
  base_url TEXT NOT NULL DEFAULT '',               -- 业务管理端域名，末尾带 /
  account TEXT NOT NULL DEFAULT '',                -- 登录账号（明文，列表 masked 展示）
  password_enc TEXT NOT NULL DEFAULT '',           -- 登录密码：v1:{iv}:{tag}:{ct} 加密
  account_version TEXT NOT NULL DEFAULT '2.1.6',   -- web_site(账户)接口 version 头（仅 ewei 用）
  shop_version TEXT NOT NULL DEFAULT '4.6.11',     -- shop_web(商品/上传)接口 version 头（仅 ewei 用）
  platform TEXT NOT NULL DEFAULT 'ewei',           -- 对接平台：ewei / dianda…（多商城泛化，旧行默认 ewei）
  extra_json TEXT NOT NULL DEFAULT '{}',           -- 各平台专属参数（如点大 cookie/remember）
  current_shop_id INTEGER NOT NULL DEFAULT 0,      -- 当前选中门店主键（ewei 用；点大无需切店）
  current_shop_name TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT NOT NULL DEFAULT '',
  last_login_status TEXT NOT NULL DEFAULT '',
  last_login_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ewei 商品图替换审计/回滚载体。回写前写 pending+备份原值，上传成功 uploaded，落库成功 done，失败 error。
CREATE TABLE IF NOT EXISTS ewei_goods_image_logs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL DEFAULT '',
  shop_id INTEGER NOT NULL DEFAULT 0,
  goods_id INTEGER NOT NULL DEFAULT 0,
  goods_title TEXT NOT NULL DEFAULT '',
  slot TEXT NOT NULL DEFAULT '',                   -- mainThumb/galleryReplace/galleryAppend/detailAppend/optionThumb
  old_value_json TEXT NOT NULL DEFAULT '',         -- 受影响字段的原值（回滚用）
  new_paths_json TEXT NOT NULL DEFAULT '[]',       -- 本次上传得到的相对 path 数组
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ewei_logs_goods ON ewei_goods_image_logs(goods_id);
CREATE INDEX IF NOT EXISTS idx_ewei_logs_created ON ewei_goods_image_logs(created_at);

-- ============================================================
-- AI Deck(设计/PPT/视频工作台) 持久化 4 表  (参见 docs/deck-feature-spec.md §5.5)
-- 仅追加新表; 对齐既有约定: TEXT datetime('now') 时间列 + 表级 FK ON DELETE CASCADE
-- 注: 语义图标向量的 vec0 虚表由运行时 icon-index-builder 加载 sqlite-vec 扩展后创建,
--     不写入 schema.sql, 以免扩展未加载时 db.exec 整体失败(与 vector_chunks vec0 同策略)
-- ============================================================
CREATE TABLE IF NOT EXISTS deck_projects (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL DEFAULT '',
  text_provider_id  TEXT NOT NULL DEFAULT '',
  text_model_id     TEXT NOT NULL DEFAULT '',
  image_provider_id TEXT NOT NULL DEFAULT '',
  image_model_id    TEXT NOT NULL DEFAULT '',
  theme_id          TEXT NOT NULL DEFAULT '',
  template_id       TEXT NOT NULL DEFAULT '',
  style_family      TEXT NOT NULL DEFAULT '',
  grammar           TEXT NOT NULL DEFAULT '{}',
  outline           TEXT NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'draft',
  aspect_ratio      TEXT NOT NULL DEFAULT '16:9',
  system_prompt     TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deck_slides (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  layout      TEXT NOT NULL DEFAULT '',
  ir          TEXT NOT NULL DEFAULT '{}',
  html        TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  image_path  TEXT NOT NULL DEFAULT '',
  render_path TEXT NOT NULL DEFAULT '',
  review      TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES deck_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deck_slides_project ON deck_slides(project_id);
CREATE INDEX IF NOT EXISTS idx_deck_slides_project_sort ON deck_slides(project_id, sort_order);

CREATE TABLE IF NOT EXISTS deck_assets (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT '',
  local_path  TEXT NOT NULL DEFAULT '',
  file_size   INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending',
  error       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES deck_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_deck_assets_project ON deck_assets(project_id);

CREATE TABLE IF NOT EXISTS deck_icon_vectors (
  icon_id         TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  keywords        TEXT NOT NULL DEFAULT '',
  svg_path        TEXT NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT '',
  embedding_dim   INTEGER NOT NULL DEFAULT 384,
  embedding       BLOB
);

-- ============================================================
-- 微信 ClawBot(iLink) 桥接 3 表  (参见 docs/微信ClawBot对接-开发计划.md)
-- bot_token 与 matting_providers 同策略: AES-256-GCM 加密存(device-id 派生 key), 不参与云同步。
-- ============================================================

-- 微信 ClawBot 连接（一行为一个扫码绑定的微信 Bot；首期 UI 只暴露单连接）
CREATE TABLE IF NOT EXISTS clawbot_connections (
  id TEXT PRIMARY KEY,
  ilink_bot_id TEXT NOT NULL DEFAULT '',      -- xxx@im.bot，每次扫码登录会变，更新而非新建
  ilink_user_id TEXT NOT NULL DEFAULT '',     -- 扫码者微信 id
  baseurl TEXT NOT NULL DEFAULT '',           -- confirmed 返回的 baseurl（可覆盖默认域名）
  bot_token_enc TEXT NOT NULL DEFAULT '',     -- bot_token 密文：v1:{iv}:{tag}:{ct}
  bot_id TEXT NOT NULL DEFAULT '',            -- 绑定的本地智能体 bots.id
  enabled INTEGER NOT NULL DEFAULT 1,         -- 总开关
  status TEXT NOT NULL DEFAULT 'offline',     -- offline/connecting/online/paused/expired
  get_updates_buf TEXT NOT NULL DEFAULT '',   -- 长轮询游标，每轮持久化，重启续传
  paused_until TEXT NOT NULL DEFAULT '',      -- errcode=-14 后的暂停截止时刻（ISO）
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 微信联系人 → 本地会话映射（上下文连续性靠它）
CREATE TABLE IF NOT EXISTS clawbot_peers (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL DEFAULT '',     -- clawbot_connections.id
  peer_id TEXT NOT NULL DEFAULT '',           -- 微信 from_user_id（如 o9cq80xxx@im.wechat）
  conversation_id TEXT NOT NULL DEFAULT '',   -- 映射的本地会话 conversations.id
  last_context_token TEXT NOT NULL DEFAULT '',-- 最新入站消息的 context_token（回复必用最新）
  last_message_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(connection_id, peer_id)
);
CREATE INDEX IF NOT EXISTS idx_clawbot_peers_conn ON clawbot_peers(connection_id);

-- 消息流水（UI 日志页 + 排障），定期清理
CREATE TABLE IF NOT EXISTS clawbot_logs (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL DEFAULT '',
  peer_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'in',       -- in/out
  msg_type TEXT NOT NULL DEFAULT 'text',      -- text/image/file/voice/video/system
  summary TEXT NOT NULL DEFAULT '',           -- 内容摘要（截断 200 字）
  status TEXT NOT NULL DEFAULT 'ok',          -- ok/error/dropped
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clawbot_logs_created ON clawbot_logs(created_at);

-- P2-2 每日回顾 / 深度分析历史
CREATE TABLE IF NOT EXISTS daily_reviews (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'daily',
  title TEXT NOT NULL DEFAULT '',
  range_start TEXT NOT NULL DEFAULT '',
  range_end TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok',
  error TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  conversation_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_reviews_created ON daily_reviews(created_at DESC);

-- P2-3 定时任务
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  schedule_type TEXT NOT NULL DEFAULT 'daily',
  schedule_value TEXT NOT NULL DEFAULT '09:00',
  enabled INTEGER NOT NULL DEFAULT 1,
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT '',
  workspace_id TEXT NOT NULL DEFAULT '',
  skill_dir TEXT NOT NULL DEFAULT '',
  intra_repeat INTEGER NOT NULL DEFAULT 0,
  intra_end TEXT NOT NULL DEFAULT '',
  intra_interval_min INTEGER NOT NULL DEFAULT 60,
  next_run_at TEXT NOT NULL DEFAULT '',
  last_run_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next ON scheduled_tasks(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok',
  content TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_started ON scheduled_task_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_runs_task ON scheduled_task_runs(task_id);

-- D-20 品牌工作区：跨会话持久的品牌资产包（文档 KB + 图库分类 + 产出目录）
CREATE TABLE IF NOT EXISTS brand_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kb_category_id TEXT NOT NULL DEFAULT '',
  gallery_category_id TEXT NOT NULL DEFAULT '',
  output_dir TEXT NOT NULL DEFAULT '',
  default_bot_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_brand_workspaces_updated ON brand_workspaces(updated_at DESC);

-- D-21 文件夹工作区（对标 NewMax：顶栏切换本地目录）
CREATE TABLE IF NOT EXISTS agent_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  kb_category_id TEXT NOT NULL DEFAULT '',
  gallery_category_id TEXT NOT NULL DEFAULT '',
  last_opened_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_workspaces_opened ON agent_workspaces(last_opened_at DESC);
