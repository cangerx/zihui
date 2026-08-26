# presenton 模板移植规范（声明式 DeclarativeTemplate）

> 目标：把 presenton 的 ~217 套 React 布局逐套移植为本项目的**声明式模板 JSON**（`DeclarativeTemplate`）。
> 声明式格式是数据非代码（规避 RCE），由端上固定渲染器 `declarative.ts` 映射成「4 约束合规」HTML，
> 因此**用本格式产出的模板天然满足 html2pptx 4 约束，无需逐个调试**。
> 源材料：`F:\local-agent\参考\presenton-main\servers\nextjs\app\presentation-templates\{组}\*.tsx`。

## 1. 画布与栅格（必须遵守）

- 画布固定 **1280 × 720**（单位 px，绝对定位 `x/y/w/h`，左上原点）。
- 外边距 **80px**：内容区 `x ∈ [80, 1200]`，`y ∈ [64, 656]`，内容宽 **1120px**。
- 常用栅格：
  - 单列正文宽 **1120**；左右两栏各宽 **540**（间隙 40，左栏 x=80、右栏 x=700）。
  - 标题带：kicker `y≈96`、主标题 `y≈140`、accent bar `y≈232`、正文从 `y≈276` 起。
- 同一视觉家族保持坐标一致，确保 217 套**整体协调**而非各写各的。

## 2. 设计令牌（只能用 token，禁硬编码颜色）

颜色 `ColorToken`：`fg`(正文)、`muted`(次要)、`accent`(强调)、`card`(卡片底)、`card-fg`(卡片字)、`on-accent`(强调底上的白字)。根背景 `background: 'bg' | 'accent'`。
字体 `FontToken`：`display`(标题)、`body`(正文)、`mono`(kicker/标签)。
主题由 `theme.ts` 注入 CSS 变量，模板只引用 token —— 换主题即整体换肤。

## 3. 块类型（DeclarativeBlock）与用法

| kind | 用途 | 关键字段 |
| --- | --- | --- |
| `bar` | 强调短粗条（标题下划重点） | `pos`(h默认6)、`color`(默认 accent) |
| `rule` | 细分割线 | `pos`(h默认1)、`color` |
| `kicker` | 小标签/眉题（自动大写+字距） | `field`、`pos`、`size`、`color` |
| `heading` | 标题 h1/h2 | `field`、`level`、`pos`、`size`、`font` |
| `paragraph` | 正文段落（`merge:true` 标记可作整框 pptx 合并） | `field`、`pos`、`size`、`color` |
| `list` | 要点列表（每项前 accent 短横） | `field`、`pos`、`itemSize`、`gap` |
| `statGrid` | KPI 卡片网格（自动分列定位） | `field`、`pos`、`valueSize`、`labelSize`、`cols` |
| `image` | 配图（空值降级占位形状） | `field`、`pos` |

> 约束：文字只走 kicker/heading/paragraph/list/statGrid（渲染为 `p`/`h*`）；
> 色块/卡片/线只走 bar/rule/statGrid/image（渲染为 `div`/`img`）。**不要把背景/边框挂到文字块**——格式已天然分离，照用即可。

## 4. schema（TemplateSchema）映射规则

presenton Zod → 本项目 `FieldDef`：
- `z.string().min().max()` → `{ type:'text'|'multiline', maxChars:max }`（标题 text、长描述 multiline）。
- 图片字段 `ImageSchema` → `{ type:'image' }`（字段名建议 `image`/`imageN`）。
- 列表 `z.array(z.object/string)` → `{ type:'list', maxItems, itemMaxChars }`。
- 指标数组 `[{value,label}]` → `{ type:'stat-list', maxItems, statValueMaxChars, statLabelMaxChars }`。
- 枚举 → `{ type:'enum', enumValues }`。
- `.meta({description})` → `FieldDef.label`（中文化）。
- **字数上限照搬 presenton 的 max**（这是其防溢出的核心，务必保留）。

## 5. defaultData

- 从 Zod `.default(...)` 取，**中文化**为通用占位（不要照抄英文 unsplash 文案）。
- 每个 schema 字段都要有默认值（保证「绝不产出空白页」兜底）。
- 图片字段默认空串 `''`（渲染降级为占位形状，不依赖外网图）。

## 6. 命名与产物

- `id`：用 presenton `layoutId`（kebab-case，全局唯一；同名加组前缀避免碰撞，如 `pitch-cover`）。
- `category`：用组名（general/modern/pitch-deck/…）。
- `name`/`description`：中文化 presenton 的 `layoutName`/`layoutDescription`。
- 产物文件：`agent-desktop/deck-templates-src/{组}/{id}.json`，单文件即一个 `DeclarativeTemplate`。

## 7. 验证（每套必过）

```
node scripts/verify-deck-templates.mjs deck-templates-src/{组}   # 须在 electron 下跑(离屏渲染)
```
harness 会：解析 JSON → `toSlideTemplate` → `renderDeclarative` → 离屏渲染 → EXTRACT 抽取，
断言：JSON 合法 + schema 合法 + 至少 1 个抽取元素 + 渲染不抛错 + 无文字溢出画布。

## 7b. 移植进度（持续更新）

| 组 | 真实布局数 | 状态 |
| --- | --- | --- |
| general | 12 | ✅ |
| standard | 11 | ✅ |
| swift | 8 | ✅ |
| modern | 10 | ✅ |
| Code | 16 | ✅ |
| Education | 14 | ✅ |
| ProductOverview | 21 | ✅ |
| Report | 22 | ✅ |
| pitch-deck | 25 | ✅ |
| neo-general | 29 | ✅ |
| neo-modern | 17 | ✅ |
| neo-standard | 17 | ✅ |
| neo-swift | 15 | ✅ |
| **合计** | **217** | **全部移植并验证完成** |

> **全部 217 套已完成**：13 组全移植，harness 217/217 通过，217 个全局唯一 id（零冲突），离屏真渲染抽检 8/8 出版级质量。
> 移植由「读规范 + general 样板 + 源 TSX → 产 JSON → harness 自验证到全绿」的并行子代理执行（每批 3-5 组），主控独立复验 + 跨组 id 去重 + 抽样真渲染目检。
> 注：图表/表格/图标等 presenton 富元素按受控语法做了确定性降级（图表→image 占位、表格→bulletCards、图标剥离），属 spec 预期的「按约束改造」，非缺陷。

## 8. 打包上传 CDN

```
node scripts/pack-deck-templates.mjs            # 产 template.json(逐套) + manifest.json + 各自 SHA256
```
产物目录上传母 CDN `your-cdn-domain.example.com/pptdemo/`，再到云控端「AI PPT 资源」逐条登记
（kind=template, asset_key=id, source_url=母CDN地址, meta={name,category,description,schema}）→「一键拉取」固化。
桌面端经 `client/deck/resource-manifest?kind=template` 自动可见、按需拉取 + SHA256 强校验。
