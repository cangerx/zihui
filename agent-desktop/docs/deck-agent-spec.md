# AI PPT Agent（对话式 PPT 智能体）— 实施方案

> 把现有"一次性管线 deck"升级为"多轮对话 + 知识库 + 双引擎"的专业 PPT 智能体。
> 复用 app 已有的 Agent 底座（chat-engine / 知识库 RAG / bots / core-tools），不另起炉灶。
> 本文档为**排期依据**，不含已落地代码；所有接入点经真实代码侦察取证（file:line）。

---

## 0. 背景与决策（已与用户确认）

| 决策 | 结论 | 出处 |
| --- | --- | --- |
| 范式 | 从"表单一键生成"升级为"**对话式 PPT 智能体**"（豆包/Gamma 式多轮可控） | 用户确认 |
| 引擎 | **双引擎并存**：引擎1 受控模板管线（快/稳/PPTX 可编辑）+ 引擎2 AI 自由写 HTML（上限高/精品页） | 用户选"双引擎" |
| 产品形态 | **两者结合**：deck 页改造成对话式工作台（主入口）+ 在 bots 注册"PPT 设计师"智能体（通用对话也能召唤），**共享底座** | 用户选"两者结合" |
| 知识库 | PPT Agent 可**绑知识库取真实素材**（数据/文案/品牌）填 PPT | 用户要求 |
| 与对话功能关系 | **不冲突**：PPT Agent = 一个绑了 PPT 工具集的专用 bot，复用同一 Agent loop | 见 §2 |

### 核心洞察（决定了工作量）
- 现有 `chat-engine.ts` 已是完整 Agent loop（工具调用循环 + 上下文压缩 + 审批 + 知识库 RAG），**PPT Agent 就是给它喂一组 PPT 工具 + 设计师人设**。
- deck 现有 27 个能力**全部"直接可用"**，包装成工具只需薄胶水。
- 引擎2 复用现有渲染/导出 **95%+**（offscreen-renderer 对任意 HTML 通用）。
- 知识库接入**几乎零成本**（`kb_search` 工具现成、本地+云端自动合并降级）。

---

## 1. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│  共享底座（已存在，复用）                                        │
│  chat-engine.ts(Agent loop, MAX_TOOL_ROUNDS=40)                │
│  · 知识库 RAG(kb_search/searchHybrid/searchCloudKnowledgeBases) │
│  · core-tools(coreToolDefs + executeCoreToolCall 按 name 分发)  │
│  · bots(persona 人设 + 知识库绑定 + 工具集限定)                  │
└───────────────┬──────────────────────────┬───────────────────┘
        入口A: deck 页→对话式工作台      入口B: bots 内置"PPT 设计师"
        (主入口, 左对话/右预览)           (通用对话里也能召唤)
                └──────────┬───────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │  PPT Agent = 专用 bot                  │
        │  人设(设计师 + huashu 方法论)           │
        │  + 绑知识库(取素材)                     │
        │  + 专属工具集(deck-* tools)            │
        └──────────────┬───────────────────────┘
              Agent 按页按需调下面两套引擎
        ┌──────────────┴───────────────┐
        ▼                              ▼
  ┌──────────────────┐        ┌────────────────────────┐
  │ 引擎1: 受控模板    │        │ 引擎2: AI 自由写 HTML     │
  │ (现有 deck 全套)   │        │ (新建薄通道)             │
  │ 快稿/批量/数据页    │        │ 精品页/封面/创意页        │
  │ PPTX 可编辑·稳·快  │        │ 上限高·当场设计           │
  └──────────────────┘        └────────────────────────┘
        共用 offscreen-renderer + 导出层（95% 复用）
```

---

## 2. 为什么不与现有对话功能冲突（分层与分工）

| 维度 | 通用对话/智能体（现有） | AI PPT Agent（新） |
| --- | --- | --- |
| 任务 | 聊天/问答/查 KB/通用工具 | 专做 PPT 的多轮设计会话 |
| 实现 | bot + chat-engine | **同一个 chat-engine**，换一组工具+人设 |
| 工具集 | core + skill + mcp | core(含 kb_search) + **deck-* 专属工具** |
| 底座 | 共享 | **共享**（零重复造） |

**结论**：PPT Agent 是 bots 体系里一个"绑了 PPT 工具集 + 设计师人设 + 知识库"的预设 bot。两者不抢，靠 `buildToolsList`（chat-engine.ts:1771-1857）按 bot 配置动态拼工具集天然隔离。

---

## 3. PPT Agent 工具集契约

> Agent loop 的工具定义是 OpenAI function-calling 形态：`{ type:'function', function:{ name, description, parameters(JSON Schema) } }`（core-tools.ts:141 `coreToolDefs`）。
> 执行按 name 分发（core-tools.ts:375 `executeCoreToolCall` 返回 `{handled, result}`；chat-engine.ts:1892 `executeToolCall` 多级路由）。
> 新工具落地 = 往工具定义数组加几条 + 在执行分发里加分支。

### 3.1 工具清单（背后全是现成 deck 能力，仅加胶水）

| 工具 name | 背后接（现状=直接可用） | 作用 | 引擎 |
| --- | --- | --- | --- |
| `kb_search` | **已存在**（core-tools.ts:262） | 从知识库取真实素材 | — |
| `deck_plan_outline` | `deck-generator.generateOutline` | 出大纲（停下来等用户确认） | — |
| `deck_gen_slide_template` | `deck-generator.generateSlide` + 受控模板 | 生成一页（PPTX 可编辑） | 引擎1 |
| `deck_gen_slide_freeform` | 引擎2（新建）+ `offscreen-renderer.renderExtract` | AI 自由写一页 HTML | 引擎2 |
| `deck_make_chart` | `infographic.renderChartPng` | 数据可视化 | 共用 |
| `deck_search_icon` | `deck-service.searchDeckIcons` | 语义图标 | 共用 |
| `deck_update_slide` | `persistence.updateSlide` | 改某一页（内容/HTML/解说稿） | — |
| `deck_reorder` | `persistence.reorderSlides` | 调整页序 | — |
| `deck_list_slides` | `persistence.listSlides` | 读当前 deck 状态 | — |
| `deck_critique` | `deck-service.critiqueDeck` | 评审 → 驱动自动重做低分页 | — |
| `deck_export` | `deck-service.exportDeck` | 导出 PPTX/PDF/GIF/MP4/原型 | — |
| `ask_user` | **已存在**（core-tools.ts，弹卡片） | 多轮里让用户做"看得见"的选择 | — |

### 3.2 工具落地清单（以 `deck_plan_outline` 为样板）
1. 新建 `deck/deck-tools.ts`：导出 `deckToolDefs`（工具定义数组）+ `executeDeckTool(name, args, ctx)`（按 name 分发，复用 deck-service 函数）。
2. 在 `chat-engine.ts:1892 executeToolCall` 的核心工具之后、skill 之前，加一级 `executeDeckTool` 路由（仿 `executeCoreToolCall` 的 `{handled,result}` 协议）。
3. 在 `buildToolsList`（chat-engine.ts:1771）按 `bot.enable_deck` 标志注入 `deckToolDefs`（仿 `enable_image_gen` 过滤 image_gen 的写法 :1773）。
4. 工具结果回填遵守现有协议（字符串化 + `offloadOrLimitToolResult` 截断，chat-engine.ts:1366）。

### 3.3 上下文压缩注意（硬约束）
- 工具结果硬上限 `MAX_TOOL_RESULT_CHARS = 12_000`（chat-engine.ts:81），**整页 HTML 可能超限被截**。
- 对策：`deck_gen_slide_*` 工具**不回传整页 HTML 字符串**给 LLM，只回 `{slideId, templateId, ok, warnings, previewPngPath?}`；HTML 落库（`createSlide`），UI 从库读预览。Agent 拿 slideId 即可后续 `deck_update_slide`。

---

## 4. 引擎2：AI 自由写 HTML（新建薄通道）

> 这是唯一"全新"的渲染逻辑，但复用现有渲染/导出 95%+。

### 4.1 流程
```
Agent 决定某页走精品路线
  → deck_gen_slide_freeform(title, intent, styleHint, kbContext)
  → 子 LLM 调用：产出一页完整 standalone HTML（1280×720, 受 §4.3 安全约束）
  → offscreen-renderer.renderExtract(html) 校验可渲染 + 抽度量
  → persistence.createSlide({ layout:'freeform', html, ir })
  → 回 Agent: { slideId, ok, warnings }
```

### 4.2 复用现有（零改造）
- 渲染：`offscreen-renderer` 全套（renderPng/renderExtract/renderRgba/renderPdf/renderReview/renderFrames）对任意 HTML 通用。
- 导出：`renderExtract → buildPptxFromExtracted` 链路完整；PDF/GIF/MP4/原型同理。
- 评审：`renderReview → critiqueSlide` 对自由 HTML 同样适用。

### 4.3 安全约束（自由 HTML 的护栏，必须写进生成提示）
- 图片只用 `data:` / `https:` / 仓内 `local-file://`（offscreen 侧），**禁相对路径、禁 `<iframe src>` 跨域**。
- 页面内 `<script>` 可（动画/`window.__seek`），但无 Node API（contextIsolation:true 已隔离）。
- 离屏 session CSP 须实测放行注入脚本（offscreen-renderer 已有 readyBarrier）。

### 4.4 引擎2 的硬权衡（产品须告知用户）
| 维度 | 引擎1 受控模板 | 引擎2 自由 HTML |
| --- | --- | --- |
| PPTX 可编辑 | ✅ 高保真可编辑 | ⚠️ <30% 通过率 → **降级整页图片或只导 PDF/视频** |
| 速度/成本 | 快/低 | 慢/高（每页一次 LLM+渲染） |
| 稳定性 | 模板保底 | 可能溢出/丑 → 靠 `deck_critique` 兜底重试 |
| 视觉上限 | 中（模板天花板） | 高（当场设计+动画） |

**产品规则**：要可编辑 PPTX → 引擎1；要视觉上限/动画 → 引擎2 出图片/PDF/视频。Agent 默认引擎1，用户点"精修此页/封面创意"才走引擎2。

---

## 5. 知识库接入（几乎零成本）

- **直接复用 `kb_search` 工具**（core-tools.ts:262，本地 `searchHybrid` + 云端 `searchCloudKnowledgeBases` 自动合并、按 score 排序、网络故障降 7 天缓存）。
- bot 绑定 `kb_category_ids`（本地）/ `cloud_kb_ids`（云端），chat-engine 在对话启动时**自动注入首轮 RAG**（chat-engine.ts:860-1013），Agent 不满意可主动调 `kb_search` 重写 query。
- 素材支持：txt/md/pdf/docx/json/csv（自动解析为文本）。**品牌图片**走云端 KB 的图片 URL（参照 reference-image-cloud-url 记忆）。
- 可选增强（非必须）：给 `deck-generator` 加 `kbSearch?` 注入点，让大纲/逐页生成阶段也带 KB 素材（deck-generator.ts `DeckGeneratorDeps` 加一个回调）。

---

## 6. "PPT 设计师"内置 bot（入口B）

> 复用现有预设机制（persona.ts `seedPresetPersonas` + database/index.ts:71），**数据库表零改动**。

1. `persona.ts` `PRESET_PERSONAS` 加一条"PPT 设计师"：system_prompt = 设计师人设 + huashu 方法论精要（反 AI-slop 视觉禁区 + 出版物 grammar + 位置四问）+ 工具使用引导（先 plan_outline→ask_user 确认→逐页生成→critique）。
2. `bot.ts` 加 `PRESET_BOTS` + `seedPresetBots()`：建"PPT 设计师"bot，`persona_id` 关联上条，加 `enable_deck:1` 标志。
3. `database/index.ts:71` 调 `seedPresetBots()`（紧跟 `seedPresetPersonas`）。
4. `bot` 数据结构加 `enable_deck`（迁移用 ALTER ADD COLUMN，对齐现有 `enable_image_gen` 范式）。

---

## 7. 对话式工作台 UI（入口A，改造 DeckView）

- 现状：DeckView 是左表单/右预览网格（一次性生成）。
- 改造：**左对话流 / 右实时预览**（仿豆包）。左侧是和 PPT Agent 的多轮对话（复用 chat 的消息流组件 + ask_user 卡片），右侧是 slide 预览网格（点页可"让 AI 改这页"= 触发 `deck_update_slide` 对话）。
- 复用 chat 渲染层（消息流/卡片/流式），新增的是右侧预览联动 + "改此页/精修此页"的右键动作。
- 保留现有一键生成作为"快速模式"（不进对话，直接走引擎1 管线）。

---

## 8. 实施排期（建议分 4 阶段，每阶段可独立验证）

| 阶段 | 内容 | 可验证产出 | 依赖 |
| --- | --- | --- | --- |
| **P1 工具化 + MVP 闭环** | deck-tools.ts（包装 plan_outline/gen_slide_template/list/update/export/critique/make_chart/search_icon）+ 接入 chat-engine 工具路由 + enable_deck 标志 + 内置 PPT 设计师 bot | 在**现有通用对话**里召唤"PPT 设计师"，多轮对话→调工具→出 deck→导出。**引擎1 全程，纯文本验证** | 仅 P1 |
| **P2 知识库接入** | bot 绑 KB + 验证 kb_search 在 PPT 会话里取素材填页 | 绑一个素材 KB，对话"用知识库里的数据做一页"→真实数据进 PPT | P1 |
| **P3 引擎2 自由 HTML** | deck_gen_slide_freeform + 安全沙箱 + 导出降级规则（自由页 PPTX→图片）+ critique 兜底重试 | 对话"这页帮我做个创意封面"→AI 自由写 HTML→渲染→导出 PDF/图片 | P1 |
| **P4 对话式工作台 UI** | DeckView 改左对话/右预览 + 点页改单页 + 保留快速模式 | GUI 实测：完整豆包式体验 | P1-P3 |

> 每阶段验证方式对齐现有：纯逻辑/fake LLM 自检 + 真 Electron 离屏 e2e + electron-vite build。

---

## 9. 接入点取证总表（file:line，写代码时对照）

| 用途 | 接入点 |
| --- | --- |
| Agent loop 主循环 | `chat-engine.ts:1181-1468`（while round<=MAX_TOOL_ROUNDS=40） |
| 工具定义形态 | `core-tools.ts:141 coreToolDefs`（OpenAI function 数组） |
| 工具执行分发 | `core-tools.ts:375 executeCoreToolCall` / `chat-engine.ts:1892 executeToolCall` |
| 工具集动态拼装 | `chat-engine.ts:1771-1857 buildToolsList`（按 enable_image_gen/skill_ids 过滤=enable_deck 样板） |
| 工具结果回填+截断 | `chat-engine.ts:1366 offloadOrLimitToolResult`，硬上限 `:81 MAX_TOOL_RESULT_CHARS=12000` |
| 工具样板 | `use_skill`(core-tools.ts:911) / `image_gen` 异步(:787) / `ask_user` 卡片(:634) |
| bot 数据结构 | `bot.ts:6-42`（persona_id/kb_category_ids/cloud_kb_ids/skill_ids/mcp_ids/enable_image_gen） |
| bot 人设注入 | `chat-engine.ts:846-854`（persona.system_prompt → system 消息） |
| 预设 bot/persona | `persona.ts:59 PRESET_PERSONAS` + `seedPresetPersonas`，`database/index.ts:71` 调用 |
| 知识库工具 | `core-tools.ts:262 kb_search 定义` + `:524 executeKbTool`（本地+云端合并） |
| 知识库自动注入 | `chat-engine.ts:860-943`（本地 searchHybrid）/ `:946-1013`（云端） |
| deck 生成（拆好的两阶段） | `deck-generator.ts generateOutline / generateSlide`（独立可调） |
| deck 服务编排 | `deck-service.ts generateAndSaveDeck/exportDeck/critiqueDeck/searchDeckIcons` |
| deck 单页 CRUD | `persistence.ts createSlide/updateSlide/deleteSlide/reorderSlides/listSlides` |
| 离屏渲染（任意 HTML） | `offscreen-renderer.ts renderExtract/renderPng/renderReview/renderFrames` |
| 自由 HTML 导出链 | `renderExtract → pptx-exporter.buildPptxFromExtracted`；pdf/gif/mp4/原型同理 |

---

## 10. 风险与边界

| 风险 | 措施 |
| --- | --- |
| 工具结果整页 HTML 超 12K 被截 | 工具只回 slideId+元信息，HTML 落库（§3.3） |
| 引擎2 PPTX 不可编辑 | 自由页导 PPTX 降级整页图片，明确告知用户走引擎1 才可编辑（§4.4） |
| 引擎2 慢/贵/不稳 | 默认引擎1，引擎2 仅"精修此页"触发 + critique 兜底重试 |
| 多轮长会话上下文膨胀 | 复用现有 compactAgentContext（chat-engine.ts:1184） |
| bot 表加 enable_deck | ALTER ADD COLUMN（对齐 enable_image_gen 范式，遵 Migration 铁律） |
| 引擎2 自由 HTML 安全 | 生成提示内置安全约束（§4.3）+ contextIsolation 已隔离 Node |

---

## 11. 一句话总结
> PPT Agent **不是重写**，而是把现成的 deck 27 个能力包成工具、挂到现成的 Agent loop 上、配一个绑知识库的设计师 bot。引擎1 保稳/快/可编辑，引擎2（新增薄通道，复用渲染 95%）补视觉上限。P1 一个阶段就能在现有对话里跑通多轮出 PPT 的最小闭环。
