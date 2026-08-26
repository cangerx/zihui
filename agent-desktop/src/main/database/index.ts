import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, mkdirSync } from 'fs'
import { getDataDir } from '../services/data-path'
// import { seedPresetPersonas } from '../services/persona' // 暂停人格规则预设
// import { seedPresetBots } from '../services/bot' // 暂停智能体预设
import { seedBuiltinPresets } from '../services/prompt-preset'
import { seedBuiltinSkillPresets } from '../services/skill'
import { seedCreativeTemplatePresets } from '../services/creative-template'
import { assertEpoch } from '../services/account-epoch'
import { installSyncSchema } from '../services/sync/schema'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  // 账号热切换守卫：旧账号的 inflight 任务在切库后调用本函数，会因账号代次不符抛错，
  // 从而拒绝拿到新库写入（防串数据，详见 services/account-epoch.ts）。
  // 必须在 `if (db) return db` 之前，否则旧任务会直接返回已切换的新库实例。
  assertEpoch()
  if (db) return db

  // 账号子目录（accounts/...）首次使用前可能尚不存在；better-sqlite3 不会自动建目录，
  // 必须先 mkdir，否则 new Database() 抛 "unable to open database file"。
  const dir = getDataDir()
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'local-agent.db')
  db = new Database(dbPath)

  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    // 让 FK 级联删除（如删会话级联删消息）也触发子表的 AFTER DELETE 触发器，
    // 使云同步能捕获到级联产生的子记录删除并生成对应墓碑，跨设备正确传播删除。
    // 应用内除云同步触发器外无其它触发器，开启此项无副作用。
    db.pragma('recursive_triggers = ON')

    tryLoadSqliteVec(db)

    initSchema()
    return db
  } catch (e) {
    // 初始化失败时不能留下半开连接：否则下次 getDatabase() 会直接复用未跑完 migration 的实例。
    try { db.close() } catch { /* ignore */ }
    db = null
    throw e
  }
}

// sqlite-vec 原生扩展:可用时为向量检索提供 vec0 KNN 加速;不可用时静默回退 JS cosine(零降级)。
let sqliteVecAvailable = false
export function isSqliteVecAvailable(): boolean {
  return sqliteVecAvailable
}
function tryLoadSqliteVec(database: Database.Database): void {
  try {
    // 延迟 require:未安装 / 原生未随 Electron 版本 rebuild 时不影响应用启动
    const sqliteVec = require('sqlite-vec')
    sqliteVec.load(database)
    sqliteVecAvailable = true
    console.log('[db] sqlite-vec extension loaded (vector KNN enabled)')
  } catch (e: any) {
    sqliteVecAvailable = false
    console.warn('[db] sqlite-vec unavailable, using JS cosine fallback:', e?.message || e)
  }
}

function initSchema(): void {
  if (!db) return
  const isProd = app.isPackaged
  const schemaPath = isProd
    ? join(process.resourcesPath, 'schema.sql')
    : join(__dirname, '../../resources/schema.sql')
  const schema = readFileSync(schemaPath, 'utf-8')
  db.exec(schema)
  runMigrations()
  expireStalePendingCards()
  // seedPresetPersonas() // 暂停人格规则预设
  // seedPresetBots() // 暂停智能体预设
  seedBuiltinPresets()
  seedBuiltinSkillPresets()
  seedCreativeTemplatePresets()
  // 同步基础设施放在内置数据 seed 之后安装：触发器此刻才生效，
  // 内置预设（persona/skill/prompt）不会被记入 oplog 推送到云端，
  // 新设备靠各自本地 seed 自然拥有同 id 的内置数据。
  installSyncSchema(db)
}

// 进程重启后，DB 里仍处于 pending 的交互卡片（ask_user / 生图参数卡）必然已失去其等待回环
// （pendingChoices 是内存态，随进程消失），标记为 expired，避免重开会话时出现「可点击但点了无反应」
// 的僵尸卡片。在 installSyncSchema 之前调用：此刻同步触发器尚未安装，不产生 oplog 噪音。
function expireStalePendingCards(): void {
  if (!db) return
  try {
    db.exec(
      `UPDATE messages SET card = REPLACE(card, '"status":"pending"', '"status":"expired"') WHERE card LIKE '%"status":"pending"%'`
    )
  } catch (e) {
    console.warn('[db] expireStalePendingCards failed:', e)
  }
}

function runMigrations(): void {
  if (!db) return
  // model_providers: 生图扩展字段（custom_params + request_override_patch）
  // 旧库升级幂等加列；JSON 文本，默认空数组 / 空对象。
  const mpCols = db.prepare("PRAGMA table_info(model_providers)").all() as any[]
  const mpColNames = mpCols.map((c: any) => c.name)
  if (mpCols.length > 0 && !mpColNames.includes('custom_params')) {
    db.exec("ALTER TABLE model_providers ADD COLUMN custom_params TEXT NOT NULL DEFAULT '[]'")
  }
  if (mpCols.length > 0 && !mpColNames.includes('request_override_patch')) {
    db.exec("ALTER TABLE model_providers ADD COLUMN request_override_patch TEXT NOT NULL DEFAULT '{}'")
  }
  if (mpCols.length > 0 && !mpColNames.includes('system_prompt')) {
    db.exec("ALTER TABLE model_providers ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''")
  }
  if (mpCols.length > 0 && !mpColNames.includes('purpose')) {
    db.exec("ALTER TABLE model_providers ADD COLUMN purpose TEXT NOT NULL DEFAULT 'general'")
  }
  if (mpCols.length > 0 && !mpColNames.includes('provider_preset')) {
    db.exec("ALTER TABLE model_providers ADD COLUMN provider_preset TEXT NOT NULL DEFAULT ''")
  }
  if (mpCols.length > 0 && !mpColNames.includes('protocol_adapter')) {
    db.exec("ALTER TABLE model_providers ADD COLUMN protocol_adapter TEXT NOT NULL DEFAULT ''")
  }
  if (mpCols.length > 0 && !mpColNames.includes('enabled')) {
    db.exec("ALTER TABLE model_providers ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
  }

  // mcp_servers: always_load 白名单（false 时该 server 的工具不直接注入 LLM tools，仅通过
  // mcp_list_servers / mcp_describe_tools / mcp_call 元工具按需发现），旧库幂等加列。
  const mcpCols = db.prepare("PRAGMA table_info(mcp_servers)").all() as any[]
  const mcpColNames = mcpCols.map((c: any) => c.name)
  if (mcpCols.length > 0 && !mcpColNames.includes('always_load')) {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN always_load INTEGER NOT NULL DEFAULT 0")
  }

  // deck_projects: 风格家族(限定选型作用域+主题), 旧库幂等加列
  const dpCols = db.prepare("PRAGMA table_info(deck_projects)").all() as any[]
  const dpNames = dpCols.map((c: any) => c.name)
  if (dpCols.length > 0 && !dpNames.includes('style_family')) {
    db.exec("ALTER TABLE deck_projects ADD COLUMN style_family TEXT NOT NULL DEFAULT ''")
  }
  // deck_projects: grammar(huashu 式 deck 级设计语法: showcase 确立后贯穿全 deck), 旧库幂等加列
  if (dpCols.length > 0 && !dpNames.includes('grammar')) {
    db.exec("ALTER TABLE deck_projects ADD COLUMN grammar TEXT NOT NULL DEFAULT '{}'")
  }

  const botCols = db.prepare("PRAGMA table_info(bots)").all() as any[]
  const botColNames = botCols.map((c: any) => c.name)
  if (!botColNames.includes('kb_only')) {
    db.exec("ALTER TABLE bots ADD COLUMN kb_only INTEGER NOT NULL DEFAULT 0")
  }
  const catCols = db.prepare("PRAGMA table_info(kb_categories)").all() as any[]
  const catColNames = catCols.map((c: any) => c.name)
  if (!catColNames.includes('watch_paths')) {
    db.exec("ALTER TABLE kb_categories ADD COLUMN watch_paths TEXT NOT NULL DEFAULT '[]'")
  }
  const kbCols = db.prepare("PRAGMA table_info(knowledge_bases)").all() as any[]
  const kbColNames = kbCols.map((c: any) => c.name)
  const kbColumnUpgrades: Array<[string, string]> = [
    ['source_mtime', "INTEGER NOT NULL DEFAULT 0"],
    ['source_size', "INTEGER NOT NULL DEFAULT 0"],
    ['source_hash', "TEXT NOT NULL DEFAULT ''"],
    ['last_indexed_at', "TEXT NOT NULL DEFAULT ''"],
    ['error_code', "TEXT NOT NULL DEFAULT ''"],
    ['error_message', "TEXT NOT NULL DEFAULT ''"]
  ]
  for (const [name, definition] of kbColumnUpgrades) {
    if (kbCols.length > 0 && !kbColNames.includes(name)) {
      db.exec(`ALTER TABLE knowledge_bases ADD COLUMN ${name} ${definition}`)
    }
  }
  if (!botColNames.includes('prompt_skill_dirs')) {
    db.exec("ALTER TABLE bots ADD COLUMN prompt_skill_dirs TEXT NOT NULL DEFAULT '[]'")
  }
  if (!botColNames.includes('skill_bindings')) {
    db.exec("ALTER TABLE bots ADD COLUMN skill_bindings TEXT NOT NULL DEFAULT '[]'")
  }
  try {
    const botRows = db.prepare('SELECT id, prompt_skill_dirs, skill_bindings FROM bots').all() as Array<{
      id: string
      prompt_skill_dirs: string
      skill_bindings: string
    }>
    const updateBindings = db.prepare('UPDATE bots SET skill_bindings = ? WHERE id = ?')
    for (const row of botRows) {
      let bindings: unknown[] = []
      try { bindings = JSON.parse(row.skill_bindings || '[]') } catch { bindings = [] }
      let dirs: string[] = []
      try { dirs = JSON.parse(row.prompt_skill_dirs || '[]') } catch { dirs = [] }
      if ((!Array.isArray(bindings) || bindings.length === 0) && dirs.length > 0) {
        updateBindings.run(JSON.stringify(dirs.filter(Boolean).map((dir) => ({ source: 'local', dir_name: dir }))), row.id)
      }
    }
  } catch {
    /* 旧库无 bots 表时跳过 */
  }
  if (!botColNames.includes('skill_selection_mode')) {
    db.exec("ALTER TABLE bots ADD COLUMN skill_selection_mode TEXT NOT NULL DEFAULT 'legacy_all'")
  }
  if (!botColNames.includes('default_workspace_id')) {
    db.exec("ALTER TABLE bots ADD COLUMN default_workspace_id TEXT NOT NULL DEFAULT ''")
  }
  if (!botColNames.includes('tool_approval')) {
    db.exec("ALTER TABLE bots ADD COLUMN tool_approval TEXT NOT NULL DEFAULT 'destructive'")
  }
  // v0.6.6+ 「调用生图能力」总开关：智能体级别控制是否暴露 image_gen tool +「生图：」切换条
  // 默认 0=关：避免对没图片需求的智能体浪费 system prompt token、避免 LLM 误调
  if (!botColNames.includes('enable_image_gen')) {
    db.exec("ALTER TABLE bots ADD COLUMN enable_image_gen INTEGER NOT NULL DEFAULT 0")
  }
  // AI PPT 能力总开关：智能体级别控制是否暴露 deck_* 工具集(规划/生成/图表/评审/导出)。默认 0=关。
  if (!botColNames.includes('enable_deck')) {
    db.exec("ALTER TABLE bots ADD COLUMN enable_deck INTEGER NOT NULL DEFAULT 0")
  }
  // 智能体市场（云端创建/投稿 → 桌面保存到本地）：旧库幂等加列
  if (!botColNames.includes('avatar')) {
    db.exec("ALTER TABLE bots ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
  }
  if (!botColNames.includes('source')) {
    db.exec("ALTER TABLE bots ADD COLUMN source TEXT NOT NULL DEFAULT 'local'")
  }
  if (!botColNames.includes('cloud_agent_id')) {
    db.exec("ALTER TABLE bots ADD COLUMN cloud_agent_id INTEGER NOT NULL DEFAULT 0")
  }
  if (!botColNames.includes('submission_status')) {
    db.exec("ALTER TABLE bots ADD COLUMN submission_status TEXT NOT NULL DEFAULT ''")
  }
  if (!botColNames.includes('cloud_template_version')) {
    db.exec("ALTER TABLE bots ADD COLUMN cloud_template_version INTEGER NOT NULL DEFAULT 0")
  }
  if (!botColNames.includes('cloud_template_snapshot')) {
    db.exec("ALTER TABLE bots ADD COLUMN cloud_template_snapshot TEXT NOT NULL DEFAULT '{}'")
  }
  if (!botColNames.includes('submission_reject_reason')) {
    db.exec("ALTER TABLE bots ADD COLUMN submission_reject_reason TEXT NOT NULL DEFAULT ''")
  }
  if (!botColNames.includes('submission_reviewed_at')) {
    db.exec("ALTER TABLE bots ADD COLUMN submission_reviewed_at TEXT NOT NULL DEFAULT ''")
  }
  if (!botColNames.includes('submission_synced_at')) {
    db.exec("ALTER TABLE bots ADD COLUMN submission_synced_at TEXT NOT NULL DEFAULT ''")
  }
  // 云端知识库绑定（云控端智能体预设下发；对话时在线检索 + 离线缓存降级）：旧库幂等加列
  if (!botColNames.includes('cloud_kb_ids')) {
    db.exec("ALTER TABLE bots ADD COLUMN cloud_kb_ids TEXT NOT NULL DEFAULT '[]'")
  }
  if (!botColNames.includes('cloud_kb_only')) {
    db.exec("ALTER TABLE bots ADD COLUMN cloud_kb_only INTEGER NOT NULL DEFAULT 0")
  }
  if (!botColNames.includes('cloud_kb_top_k')) {
    db.exec("ALTER TABLE bots ADD COLUMN cloud_kb_top_k INTEGER NOT NULL DEFAULT 5")
  }
  // 单轮对话最大工具调用步数(0=用默认)。长任务(如多页 PPT)可调高，避免被步数上限中断 bug1
  if (!botColNames.includes('max_tool_rounds')) {
    db.exec("ALTER TABLE bots ADD COLUMN max_tool_rounds INTEGER NOT NULL DEFAULT 0")
  }
  // messages: persist tool_call_id so OpenAI tool_calls/tool pairs replay correctly
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as any[]
  const msgColNames = msgCols.map((c: any) => c.name)
  if (!msgColNames.includes('tool_call_id')) {
    db.exec("ALTER TABLE messages ADD COLUMN tool_call_id TEXT NOT NULL DEFAULT ''")
  }
  // conversations：手动改名锁定标记（自动标题生成不再覆盖用户命名）
  const convTitleCols = db.prepare("PRAGMA table_info(conversations)").all() as any[]
  if (!convTitleCols.some((c: any) => c.name === 'title_locked')) {
    db.exec("ALTER TABLE conversations ADD COLUMN title_locked INTEGER NOT NULL DEFAULT 0")
  }
  // reasoning 思维链持久化(仅 UI 展示用，不回传模型)：旧库幂等加列
  if (!msgColNames.includes('reasoning')) {
    db.exec("ALTER TABLE messages ADD COLUMN reasoning TEXT NOT NULL DEFAULT ''")
  }
  // 对话内交互卡片（ask_user / 生图参数确认卡）的 JSON 留痕：仅 UI 用，不回传模型。
  // 已在 sync/registry.ts 的 messages.skipColumns 排除，不参与云同步。
  if (!msgColNames.includes('card')) {
    db.exec("ALTER TABLE messages ADD COLUMN card TEXT NOT NULL DEFAULT ''")
  }
  // conversation_summaries: 增量摘要水位线列（旧库幂等加列）
  const csCols = db.prepare("PRAGMA table_info(conversation_summaries)").all() as any[]
  const csColNames = csCols.map((c: any) => c.name)
  if (csCols.length > 0 && !csColNames.includes('covered_count')) {
    db.exec("ALTER TABLE conversation_summaries ADD COLUMN covered_count INTEGER NOT NULL DEFAULT 0")
  }
  // canvas_projects: add model provider columns
  const canvasCols = db.prepare("PRAGMA table_info(canvas_projects)").all() as any[]
  const canvasColNames = canvasCols.map((c: any) => c.name)
  if (canvasCols.length > 0 && !canvasColNames.includes('text_provider_id')) {
    db.exec("ALTER TABLE canvas_projects ADD COLUMN text_provider_id TEXT NOT NULL DEFAULT ''")
    db.exec("ALTER TABLE canvas_projects ADD COLUMN text_model_id TEXT NOT NULL DEFAULT ''")
    db.exec("ALTER TABLE canvas_projects ADD COLUMN image_provider_id TEXT NOT NULL DEFAULT ''")
    db.exec("ALTER TABLE canvas_projects ADD COLUMN image_model_id TEXT NOT NULL DEFAULT ''")
  }
  if (canvasCols.length > 0 && !canvasColNames.includes('concurrency')) {
    db.exec("ALTER TABLE canvas_projects ADD COLUMN concurrency INTEGER NOT NULL DEFAULT 1")
  }
  if (canvasCols.length > 0 && !canvasColNames.includes('system_prompt')) {
    db.exec("ALTER TABLE canvas_projects ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''")
  }
  // 画布自动整理布局方向：'LR' 左到右（默认，保持老画布行为不变）/ 'TB' 上到下。
  // dagre.rankdir 的子集，仅暴露 LR / TB 两种到 UI；RL / BT 算法层支持但不暴露。
  if (canvasCols.length > 0 && !canvasColNames.includes('layout_direction')) {
    db.exec("ALTER TABLE canvas_projects ADD COLUMN layout_direction TEXT NOT NULL DEFAULT 'LR'")
  }
  // v0.6.9+ 「图片反推」节点的视觉模型默认值（project 级）：
  // 反推节点本身可单独覆盖；不覆盖时回退到这两列。
  // 默认空字符串：未配置时反推节点会要求用户先在画布设置或节点上选模型
  if (canvasCols.length > 0 && !canvasColNames.includes('vision_provider_id')) {
    db.exec("ALTER TABLE canvas_projects ADD COLUMN vision_provider_id TEXT NOT NULL DEFAULT ''")
    db.exec("ALTER TABLE canvas_projects ADD COLUMN vision_model_id TEXT NOT NULL DEFAULT ''")
  }
  // vector_chunks: track which embedding model/dim/source produced each chunk's vector
  // 用于检测模型变更后强制重向量化（不同模型的向量空间不可混用）
  const chunkCols = db.prepare("PRAGMA table_info(vector_chunks)").all() as any[]
  const chunkColNames = chunkCols.map((c: any) => c.name)
  if (!chunkColNames.includes('embedding_model')) {
    db.exec("ALTER TABLE vector_chunks ADD COLUMN embedding_model TEXT NOT NULL DEFAULT ''")
  }
  if (!chunkColNames.includes('embedding_dim')) {
    db.exec("ALTER TABLE vector_chunks ADD COLUMN embedding_dim INTEGER NOT NULL DEFAULT 0")
  }
  if (!chunkColNames.includes('embedding_source')) {
    db.exec("ALTER TABLE vector_chunks ADD COLUMN embedding_source TEXT NOT NULL DEFAULT ''")
  }
  // skills: 加 is_builtin 字段，用于标识 6 个内置预设（不可删除、启动自动 seed）
  const skillCols = db.prepare("PRAGMA table_info(skills)").all() as any[]
  const skillColNames = skillCols.map((c: any) => c.name)
  if (skillCols.length > 0 && !skillColNames.includes('is_builtin')) {
    db.exec("ALTER TABLE skills ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0")
  }
  // 小工具「脱离沙箱」白名单开关（per-skill）：1=放开路径/命令限制（仍保留 vm 隔离）。
  // 默认 0=沙箱内运行；仅用户在小工具设置里手动开启的自定义工具可为 1。
  if (skillCols.length > 0 && !skillColNames.includes('unsandboxed')) {
    db.exec("ALTER TABLE skills ADD COLUMN unsandboxed INTEGER NOT NULL DEFAULT 0")
  }

  // image_generations: 失败诊断用「原始请求快照」字段（v0.6.7+）
  // 每次生图调用上游 API 前抓一份脱敏后的 {url, method, headers, body} JSON，失败时写入此列
  // 与 error 字段一同展示，供用户复制贴给排错方定位字段/协议问题
  const igCols = db.prepare("PRAGMA table_info(image_generations)").all() as any[]
  const igColNames = igCols.map((c: any) => c.name)
  if (igCols.length > 0 && !igColNames.includes('raw_request')) {
    db.exec("ALTER TABLE image_generations ADD COLUMN raw_request TEXT NOT NULL DEFAULT ''")
  }
  // 分辨率档位（1k/2k/4k）：持久化后「重新生成」才能精确复现原档位，否则静默回退默认 2K（v0.9.x+）
  if (igCols.length > 0 && !igColNames.includes('tier_id')) {
    db.exec("ALTER TABLE image_generations ADD COLUMN tier_id TEXT NOT NULL DEFAULT ''")
  }
  // 去AI标记：该图是否经过「去AI标记」本地处理（1=已处理），用于在创作记录/图库缩略图上打角标
  if (igCols.length > 0 && !igColNames.includes('ai_mark_removed')) {
    db.exec('ALTER TABLE image_generations ADD COLUMN ai_mark_removed INTEGER NOT NULL DEFAULT 0')
  }
  if (igCols.length > 0) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_image_generations_status_created ON image_generations(status, created_at DESC)')
  }

  // gallery_items: 去AI标记处理标志（1=已处理），用于图库缩略图角标
  const giCols = db.prepare("PRAGMA table_info(gallery_items)").all() as any[]
  if (giCols.length > 0 && !giCols.some((c: any) => c.name === 'ai_mark_removed')) {
    db.exec('ALTER TABLE gallery_items ADD COLUMN ai_mark_removed INTEGER NOT NULL DEFAULT 0')
  }

  db.exec(`
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
      canvas_project_id TEXT NOT NULL DEFAULT '',
      canvas_node_id TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_video_generations_cloud_task ON video_generations(cloud_task_id);
    CREATE INDEX IF NOT EXISTS idx_video_generations_status_created ON video_generations(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_video_generations_download_status ON video_generations(download_status);
  `)
  const videoCols = db.prepare("PRAGMA table_info(video_generations)").all() as any[]
  const videoColNames = videoCols.map((c: any) => c.name)
  if (videoCols.length > 0 && !videoColNames.includes('is_deleted')) {
    db.exec("ALTER TABLE video_generations ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
  }
  if (videoCols.length > 0 && !videoColNames.includes('deleted_at')) {
    db.exec("ALTER TABLE video_generations ADD COLUMN deleted_at TEXT NOT NULL DEFAULT ''")
  }
  // v0.7.14+ 流式画布视频节点：标记任务来源画布，用于落盘到 canvas/{projectId}/ 与删节点级联清理
  if (videoCols.length > 0 && !videoColNames.includes('canvas_project_id')) {
    db.exec("ALTER TABLE video_generations ADD COLUMN canvas_project_id TEXT NOT NULL DEFAULT ''")
  }
  if (videoCols.length > 0 && !videoColNames.includes('canvas_node_id')) {
    db.exec("ALTER TABLE video_generations ADD COLUMN canvas_node_id TEXT NOT NULL DEFAULT ''")
  }
  const localVideoColumns = [
    ["source", "TEXT NOT NULL DEFAULT 'cloud'"],
    ["provider_id", "TEXT NOT NULL DEFAULT ''"],
    ["provider_task_id", "TEXT NOT NULL DEFAULT ''"],
    ["protocol_adapter", "TEXT NOT NULL DEFAULT ''"],
    ["idempotency_key", "TEXT NOT NULL DEFAULT ''"],
    ["request_params", "TEXT NOT NULL DEFAULT '{}'"],
    ["provider_status", "TEXT NOT NULL DEFAULT ''"],
    ["poll_count", "INTEGER NOT NULL DEFAULT 0"],
    ["next_poll_at", "TEXT NOT NULL DEFAULT ''"],
    ["last_polled_at", "TEXT NOT NULL DEFAULT ''"],
  ] as const
  for (const [name, definition] of localVideoColumns) {
    if (videoCols.length > 0 && !videoColNames.includes(name)) db.exec(`ALTER TABLE video_generations ADD COLUMN ${name} ${definition}`)
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_video_generations_deleted ON video_generations(is_deleted, created_at DESC)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_video_generations_canvas ON video_generations(canvas_project_id, canvas_node_id)')
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_video_generations_idempotency ON video_generations(idempotency_key) WHERE idempotency_key <> ''")
  db.exec('CREATE INDEX IF NOT EXISTS idx_video_generations_poll ON video_generations(source, status, next_poll_at)')

  // v0.7.14+ 流式画布角色一致性库：跨镜头复用同一角色参考图，保证人物一致
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_characters (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      ref_image_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_canvas_characters_project ON canvas_characters(project_id);
  `)

  // 画布助手（AI 副驾）对话记录：按画布持久化一个 JSON blob（含可见消息 + 模型上下文），
  // 刷新页面 / 重开画布后载回。撤销栈按设计不持久（引用会话内节点 id，跨重载易悬空）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS canvas_agent_chat (
      project_id TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // conversations: 「智能体不再绑定模型」改造（v0.6.5+）
  // 每个会话独立记忆模型：新建会话从云控端默认拉取，用户输入框切换持久写回
  // 旧库的 conversation 行为：active_model_* 为空字符串，sendMessage 时按回退链解析
  const convCols = db.prepare("PRAGMA table_info(conversations)").all() as any[]
  const convColNames = convCols.map((c: any) => c.name)
  if (convCols.length > 0 && !convColNames.includes('active_model_provider_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN active_model_provider_id TEXT NOT NULL DEFAULT ''")
  }
  if (convCols.length > 0 && !convColNames.includes('active_model_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN active_model_id TEXT NOT NULL DEFAULT ''")
  }
  // v0.6.6+ 「对话内生图模型独立选择」：会话级记忆生图服务商/模型，输入框第二个切换器写回。
  // 默认空字符串：chat-engine 调 image_gen tool 时若 args 缺 provider/model 才回退到这两列；
  // 仍空则让 LLM 自行 list_providers（保持向后兼容）
  if (convCols.length > 0 && !convColNames.includes('active_image_provider_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN active_image_provider_id TEXT NOT NULL DEFAULT ''")
  }
  if (convCols.length > 0 && !convColNames.includes('active_image_model_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN active_image_model_id TEXT NOT NULL DEFAULT ''")
  }
  // 会话级工具审批档（P1-4）：空串 = 继承智能体；off/destructive/all 覆盖智能体
  if (convCols.length > 0 && !convColNames.includes('tool_approval')) {
    db.exec("ALTER TABLE conversations ADD COLUMN tool_approval TEXT NOT NULL DEFAULT ''")
  }
  if (convCols.length > 0 && !convColNames.includes('workspace_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN workspace_id TEXT NOT NULL DEFAULT ''")
  }

  // 数字员工岗位档案、不可变资产版本与待确认沉淀。候选在 accepted 前不会进入运行上下文。
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bots_default_workspace ON bots(default_workspace_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id);
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
  `)

  // Populate FTS index from existing chunks if FTS table is empty
  const ftsCount = (db.prepare("SELECT COUNT(*) as cnt FROM vector_chunks_fts").get() as any).cnt
  const chunkCount = (db.prepare("SELECT COUNT(*) as cnt FROM vector_chunks").get() as any).cnt
  if (ftsCount === 0 && chunkCount > 0) {
    db.exec("INSERT INTO vector_chunks_fts (chunk_id, knowledge_base_id, content) SELECT id, knowledge_base_id, content FROM vector_chunks")
  }

  // gallery 系统默认「创作」分类：AI 生图 / 批量生图 / 画布产图自动归档
  // 固定 id __sys_creation__ 便于服务端 hardcoded 引用，避免查表开销
  const sysCreationExists = db
    .prepare("SELECT id FROM gallery_categories WHERE id = ?")
    .get('__sys_creation__') as any
  if (!sysCreationExists) {
    db.prepare(
      "INSERT INTO gallery_categories (id, name, description, is_system, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      '__sys_creation__',
      '创作',
      'AI 生图 / 批量生图 / 画布产图自动归档',
      1,
      -1000,
      new Date().toISOString()
    )
  }

  // v0.6.9+ gallery 系统「我的抠图」分类：AI 抠图 / 画布抠图节点产图自动归档
  // 固定 id __sys_matting__ 跟 __sys_creation__ 同等地位
  const sysMattingExists = db
    .prepare("SELECT id FROM gallery_categories WHERE id = ?")
    .get('__sys_matting__') as any
  if (!sysMattingExists) {
    db.prepare(
      "INSERT INTO gallery_categories (id, name, description, is_system, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      '__sys_matting__',
      '我的抠图',
      'AI 抠图 / 画布抠图节点自动归档（透明 PNG）',
      1,
      -999,
      new Date().toISOString()
    )
  }

  // 精细抠图系统「我的精细抠图」分类：精细抠图产图自动归档
  const sysFineMattingExists = db
    .prepare("SELECT id FROM gallery_categories WHERE id = ?")
    .get('__sys_fine_matting__') as any
  if (!sysFineMattingExists) {
    db.prepare(
      "INSERT INTO gallery_categories (id, name, description, is_system, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      '__sys_fine_matting__',
      '我的精细抠图',
      '精细抠图自动归档（透明 PNG）',
      1,
      -998,
      new Date().toISOString()
    )
  } else {
    db.prepare(
      "UPDATE gallery_categories SET description = ? WHERE id = ? AND description LIKE '%抠抠图%'"
    ).run('精细抠图自动归档（透明 PNG）', '__sys_fine_matting__')
  }

  // v0.7.7+ creative_templates / creative_template_categories 表幂等建表（旧库升级路径）
  // 完整字段语义见 resources/schema.sql 顶部注释
  db.exec(`
    CREATE TABLE IF NOT EXISTS creative_template_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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
  `)
  const creativeTemplateCols = db.prepare("PRAGMA table_info(creative_templates)").all() as any[]
  const creativeTemplateColNames = creativeTemplateCols.map((c: any) => c.name)
  if (creativeTemplateCols.length > 0 && !creativeTemplateColNames.includes('requires_ref_image')) {
    db.exec("ALTER TABLE creative_templates ADD COLUMN requires_ref_image INTEGER NOT NULL DEFAULT 0")
  }
  if (creativeTemplateCols.length > 0 && !creativeTemplateColNames.includes('cloud_template_id')) {
    db.exec("ALTER TABLE creative_templates ADD COLUMN cloud_template_id INTEGER NOT NULL DEFAULT 0")
  }
  if (creativeTemplateCols.length > 0 && !creativeTemplateColNames.includes('submission_status')) {
    db.exec("ALTER TABLE creative_templates ADD COLUMN submission_status TEXT NOT NULL DEFAULT ''")
  }
  if (creativeTemplateCols.length > 0 && !creativeTemplateColNames.includes('submission_reject_reason')) {
    db.exec("ALTER TABLE creative_templates ADD COLUMN submission_reject_reason TEXT NOT NULL DEFAULT ''")
  }
  if (creativeTemplateCols.length > 0 && !creativeTemplateColNames.includes('submission_reviewed_at')) {
    db.exec("ALTER TABLE creative_templates ADD COLUMN submission_reviewed_at TEXT NOT NULL DEFAULT ''")
  }
  if (creativeTemplateCols.length > 0 && !creativeTemplateColNames.includes('submission_published_at')) {
    db.exec("ALTER TABLE creative_templates ADD COLUMN submission_published_at TEXT NOT NULL DEFAULT ''")
  }
  if (creativeTemplateCols.length > 0 && !creativeTemplateColNames.includes('submission_synced_at')) {
    db.exec("ALTER TABLE creative_templates ADD COLUMN submission_synced_at TEXT NOT NULL DEFAULT ''")
  }

  // v0.6.9+ matting_providers / matting_tasks 表幂等建表（旧库升级路径）
  // 注：schema.sql 已 CREATE TABLE IF NOT EXISTS，正常启动时由 db.exec(schema) 完成；
  // 这里仅作兜底，处理 schema.sql 未及时刷新但 migrations 已跑的边界场景
  db.exec(`
    CREATE TABLE IF NOT EXISTS matting_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'aliyun_viapi',
      access_key_id TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS matting_tasks (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'cloud',
      provider_id TEXT NOT NULL DEFAULT '',
      source_image_path TEXT NOT NULL DEFAULT '',
      result_path TEXT NOT NULL DEFAULT '',
      result_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      aliyun_request_id TEXT NOT NULL DEFAULT '',
      elapsed_ms INTEGER NOT NULL DEFAULT 0,
      canvas_project_id TEXT NOT NULL DEFAULT '',
      canvas_node_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_matting_tasks_status ON matting_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_matting_tasks_created ON matting_tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_matting_tasks_canvas ON matting_tasks(canvas_project_id);
  `)

  // 精细抠图本地任务表幂等建表（旧库升级路径）。完整字段语义见 resources/schema.sql。
  db.exec(`
    CREATE TABLE IF NOT EXISTS fine_matting_tasks (
      id TEXT PRIMARY KEY,
      source_image_path TEXT NOT NULL DEFAULT '',
      result_path TEXT NOT NULL DEFAULT '',
      result_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      request_id TEXT NOT NULL DEFAULT '',
      provider_task_id TEXT NOT NULL DEFAULT '',
      elapsed_ms INTEGER NOT NULL DEFAULT 0,
      tier INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fine_matting_tasks_status ON fine_matting_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_fine_matting_tasks_created ON fine_matting_tasks(created_at);
  `)

  // ewei 商城连接器 + 商品图替换审计表幂等建表（旧库升级路径）。完整字段语义见 resources/schema.sql。
  // 与 matting_providers 同策略：本地加密、排除云同步（见 services/sync/registry.ts）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS ewei_connectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '',
      password_enc TEXT NOT NULL DEFAULT '',
      account_version TEXT NOT NULL DEFAULT '2.1.6',
      shop_version TEXT NOT NULL DEFAULT '4.6.11',
      platform TEXT NOT NULL DEFAULT 'ewei',
      extra_json TEXT NOT NULL DEFAULT '{}',
      current_shop_id INTEGER NOT NULL DEFAULT 0,
      current_shop_name TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT NOT NULL DEFAULT '',
      last_login_status TEXT NOT NULL DEFAULT '',
      last_login_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ewei_goods_image_logs (
      id TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL DEFAULT '',
      shop_id INTEGER NOT NULL DEFAULT 0,
      goods_id INTEGER NOT NULL DEFAULT 0,
      goods_title TEXT NOT NULL DEFAULT '',
      slot TEXT NOT NULL DEFAULT '',
      old_value_json TEXT NOT NULL DEFAULT '',
      new_paths_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ewei_logs_goods ON ewei_goods_image_logs(goods_id);
    CREATE INDEX IF NOT EXISTS idx_ewei_logs_created ON ewei_goods_image_logs(created_at);
  `)

  // ewei_connectors 多商城泛化：platform 区分对接平台(ewei/dianda…)，extra_json 存各平台专属参数
  // (如点大的 cookie/remember)。旧库幂等加列，旧行默认 platform='ewei' 保证向后兼容。
  const eweiCols = db.prepare("PRAGMA table_info(ewei_connectors)").all() as any[]
  const eweiColNames = eweiCols.map((c: any) => c.name)
  if (eweiCols.length > 0 && !eweiColNames.includes('platform')) {
    db.exec("ALTER TABLE ewei_connectors ADD COLUMN platform TEXT NOT NULL DEFAULT 'ewei'")
  }
  if (eweiCols.length > 0 && !eweiColNames.includes('extra_json')) {
    db.exec("ALTER TABLE ewei_connectors ADD COLUMN extra_json TEXT NOT NULL DEFAULT '{}'")
  }

  // 微信 ClawBot(iLink) 桥接 3 表幂等建表（旧库升级路径）。完整字段语义见 resources/schema.sql。
  // 与 ewei_connectors 同策略：凭据本地加密、排除云同步（见 services/sync/registry.ts）。
  db.exec(`
    CREATE TABLE IF NOT EXISTS clawbot_connections (
      id TEXT PRIMARY KEY,
      ilink_bot_id TEXT NOT NULL DEFAULT '',
      ilink_user_id TEXT NOT NULL DEFAULT '',
      baseurl TEXT NOT NULL DEFAULT '',
      bot_token_enc TEXT NOT NULL DEFAULT '',
      bot_id TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'offline',
      get_updates_buf TEXT NOT NULL DEFAULT '',
      paused_until TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS clawbot_peers (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL DEFAULT '',
      peer_id TEXT NOT NULL DEFAULT '',
      conversation_id TEXT NOT NULL DEFAULT '',
      last_context_token TEXT NOT NULL DEFAULT '',
      last_message_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(connection_id, peer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_clawbot_peers_conn ON clawbot_peers(connection_id);
    CREATE TABLE IF NOT EXISTS clawbot_logs (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL DEFAULT '',
      peer_id TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'in',
      msg_type TEXT NOT NULL DEFAULT 'text',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ok',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_clawbot_logs_created ON clawbot_logs(created_at);
  `)

  // 旧库升级：peer 已发水位列（messages.rowid），重启后 baseline 只标水位之前、遗留未发可补发
  const cbPeerCols = db.prepare("PRAGMA table_info(clawbot_peers)").all() as any[]
  if (!cbPeerCols.some((c) => c.name === 'last_sent_rowid')) {
    db.exec("ALTER TABLE clawbot_peers ADD COLUMN last_sent_rowid INTEGER NOT NULL DEFAULT 0")
  }

  // P2-2 每日回顾 / 深度分析历史
  db.exec(`
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
  `)

  // P2-3 定时任务定义与执行记录
  db.exec(`
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
  `)

  // D-20 品牌工作区表 + 会话关联字段（旧库升级）
  db.exec(`
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
  `)
  const convBrandCols = db.prepare('PRAGMA table_info(conversations)').all() as any[]
  if (!convBrandCols.some((c: any) => c.name === 'brand_workspace_id')) {
    db.exec("ALTER TABLE conversations ADD COLUMN brand_workspace_id TEXT NOT NULL DEFAULT ''")
  }
  // D-26：未绑智能体的会话 bot_id 可空。旧库 bot_id NOT NULL + FK，写入空串会 FOREIGN KEY failed。
  migrateConversationsBotIdNullable()
  // 旧库 bot_id 可空重建表时曾丢掉 workspace_id；每次启动把缺列补回。
  ensureConversationColumns()
  // D-21 文件夹工作区表
  db.exec(`
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
  `)
  const wsCols = db.prepare('PRAGMA table_info(agent_workspaces)').all() as Array<{ name: string }>
  const wsColNames = wsCols.map((c) => c.name)
  if (!wsColNames.includes('brand_card_status')) {
    db.exec("ALTER TABLE agent_workspaces ADD COLUMN brand_card_status TEXT NOT NULL DEFAULT ''")
  }
  if (!wsColNames.includes('brand_source_fingerprint')) {
    db.exec("ALTER TABLE agent_workspaces ADD COLUMN brand_source_fingerprint TEXT NOT NULL DEFAULT ''")
  }
}

/** D-26：把 conversations.bot_id 从 NOT NULL 改为可空。SQLite 不能直接 DROP NOT NULL，需重建表。 */
function migrateConversationsBotIdNullable(): void {
  if (!db) return
  const cols = db.prepare('PRAGMA table_info(conversations)').all() as Array<{
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>
  if (cols.length === 0) return
  const botCol = cols.find((c) => c.name === 'bot_id')
  if (!botCol || botCol.notnull === 0) return

  const colSql = cols
    .map((c) => {
      const type = c.type || 'TEXT'
      if (c.name === 'bot_id') return 'bot_id TEXT'
      let sql = `${quoteIdent(c.name)} ${type}`
      if (c.pk) sql += ' PRIMARY KEY'
      else if (c.notnull) sql += ' NOT NULL'
      if (c.dflt_value !== null && c.dflt_value !== undefined) sql += ` DEFAULT ${c.dflt_value}`
      return sql
    })
    .join(',\n')
  const names = cols.map((c) => quoteIdent(c.name))
  const select = cols
    .map((c) => (c.name === 'bot_id' ? "NULLIF(bot_id, '')" : quoteIdent(c.name)))
    .join(', ')

  db.pragma('foreign_keys = OFF')
  const run = db.transaction(() => {
    db!.exec(`
      CREATE TABLE conversations_botid_nullable (
        ${colSql},
        FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
      );
    `)
    db!.exec(
      `INSERT INTO conversations_botid_nullable (${names.join(', ')}) SELECT ${select} FROM conversations`
    )
    db!.exec('DROP TABLE conversations')
    db!.exec('ALTER TABLE conversations_botid_nullable RENAME TO conversations')
  })
  try {
    run()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** 旧库升级或 bot_id 重建表后，补齐会话表缺列（尤其 workspace_id）。 */
function ensureConversationColumns(): void {
  if (!db) return
  const cols = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>
  if (cols.length === 0) return
  const names = new Set(cols.map((c) => c.name))
  const add: Array<[string, string]> = [
    ['workspace_id', "TEXT NOT NULL DEFAULT ''"],
    ['brand_workspace_id', "TEXT NOT NULL DEFAULT ''"],
    ['title_locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['active_model_provider_id', "TEXT NOT NULL DEFAULT ''"],
    ['active_model_id', "TEXT NOT NULL DEFAULT ''"],
    ['active_image_provider_id', "TEXT NOT NULL DEFAULT ''"],
    ['active_image_model_id', "TEXT NOT NULL DEFAULT ''"],
    ['tool_approval', "TEXT NOT NULL DEFAULT ''"]
  ]
  for (const [name, def] of add) {
    if (!names.has(name)) {
      db.exec(`ALTER TABLE conversations ADD COLUMN ${quoteIdent(name)} ${def}`)
    }
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id)')
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
