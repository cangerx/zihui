# 复刻 huashu 工作流 — AI PPT 质量跃升实施方案

> 目标：把 PPT 质量从「presenton 模板地板」提到「huashu 天花板」。
> 核心认知：huashu 的好看根源**不是渲染引擎，而是工作流（showcase 先行 + grammar 贯穿全 deck）+ 设计方法论**。
> 前提：**零 Python / 零 Playwright / 零 CDN**——全部跑在 Electron 内置 Chromium + 纯 JS 库（沿用现有 deck 架构）。

---

## 0. 已锁定决策（用户确认）

| 项 | 决策 |
| --- | --- |
| 工作流 | **完整复刻 huashu**：showcase 先行 → 用户确认 grammar → grammar 贯穿后续每页 |
| 交付格式 | **必须可编辑 PPTX（主）**；cinematic 视频（次，独立路径） |
| 字体 | **保持系统字体**，不内置 |
| 动画 | **React + Babel 打包进离线包**（cinematic 能力，离线，非 CDN） |
| 素材图 | **云端图搜代理，Pixabay**（免费商用、无需署名） |
| 运行时 | **零 Python**：复用现有 Electron 内置 Chromium + pptxgenjs/pdf-lib + 按需 ffmpeg |

---

## 1. 为什么模板质量差 / huashu 好在哪（问题定性）

| | huashu | 我们的模板引擎 | 我们的自由设计引擎 |
| --- | --- | --- | --- |
| grammar 来源 | **为这份 deck 现场设计、用户确认的专属 grammar** | 217 套**通用预制**模板里选一个 | **没有 grammar** |
| 跨页一致性 | 全 deck 复用同一套 → 浑然一体 | 每页独立填槽 | **每页独立生成 → 东一页西一页** |
| 工作流 | showcase 确认 → 批量 | 一次性填完 | 一次性逐页生成 |
| 质量定位 | 天花板 | 地板 | 高但不连贯 |

**关键洞察**：huashu 的质量 = 「**为这份内容现场设计一套专属 grammar、用户确认、然后全 deck 复用**」。它既不是死板的通用模板，也不是放飞的逐页自由。**问题的根不在"模板 vs 自由设计"，在缺了"bespoke grammar + 跨页复用 + showcase 确认"这条工作流。**

> 本方案的心脏：**把"选一个通用模板"换成"AI 为这份 deck 现场设计一套专属 grammar（需要可编辑 PPTX 时就在 4 约束内设计），用户 showcase 确认，全 deck 复用"。** 这一个改动同时解决两条交付路径的质量。

---

## 2. 零 Python 保证（huashu 工具 → 我们的内置替代）

huashu 工具栈很重（Playwright + Python + Node + sharp + CDN），但我们**只借方法、不跑它的工具**。每个环节都有现成的零依赖替代：

| huashu 用什么 | 我们的零依赖替代（现成） |
| --- | --- |
| Playwright 渲染/截图/量布局 | Electron 内置 Chromium 离屏 `offscreen-renderer.ts` |
| Playwright + html2pptx → PPTX | pptxgenjs 主进程 `pptx-exporter.ts`（已含 merge/多run/旋转/阴影） |
| Playwright + export_deck_pdf → PDF | `webContents.printToPDF` + pdf-lib `pdf-exporter.ts` |
| Playwright + ffmpeg → 视频 | 离屏 capturePage + ffmpeg（按需下载，唯一外部二进制） |
| `verify.py`（Python） | 离屏 renderExtract + `critique.ts` 评审 |
| `fetch_images.py`（Python 取图） | **云端图搜代理（Pixabay），见 §6** |
| CDN React/Babel/字体 | **本地打包 React/Babel（见 §5）+ 系统字体**；HTML 强制自包含 |

**结论：复刻 huashu 质量完全不需要用户机有 Python/Playwright/Node。** 这是 deck 架构从第一天就锁定的 H1 铁律，本方案完全继承。

---

## 3. 两条交付路径（解决"可编辑 PPTX vs cinematic"的张力）

可编辑 PPTX 与 cinematic 动画**本质互斥**（PPTX 要静态可编辑、动画要视频）。huashu 自己的解法是「**开工前先定交付格式**」。我们照搬：

```
PPT 设计师对话 → 先问/判断交付格式
   │
   ├─ Path A【可编辑 PPTX，默认】
   │    bespoke grammar 在 4 约束内设计(文字包 p/h*、无渐变、无复杂SVG)
   │    → showcase 确认 → 批量复用 grammar → 导出【可编辑 PPTX】(+PDF)
   │    质量 = huashu-grammar-under-constraints，远高于通用模板
   │
   └─ Path B【cinematic / 视觉优先】
        freeform 自由 HTML + 离线 React 动画
        → showcase 确认 → 批量复用 grammar → 导出【视频/PDF/图片】(PPTX=整页图)
        质量 = huashu 满血视觉上限
```

**两条路都用 §4 的「showcase + grammar 贯穿」**——这是通用质量杠杆；区别只在各自的视觉约束。默认走 Path A（用户主需求是可编辑 PPTX），用户要 cinematic 视频时切 Path B。

---

## 4. 核心改造：showcase 先行 + grammar 贯穿（质量根源）

### 4.1 新工作流（PPT 设计师对话）

```
1. 确认需求 + 交付格式(Path A/B)
2. 生成 1-2 页 showcase(视觉差异最大: 封面 + 一个典型内容页)
3. 给用户看 → 用户确认 grammar(masthead/字体/色/间距/结构) 或要求调整
4. 确认后: 从 showcase 抽取/固化 deck 级 grammar(骨架 + 设计 token) 存入 project
5. 批量生成剩余页, 每页【复用 grammar】作上下文 → 全 deck 连贯
6. critique 评审 + 低分页修订
7. 导出(按 Path A/B)
```

### 4.2 grammar 是什么（数据结构）

一个 deck 级的「设计语法」对象，由 showcase 确立、贯穿全 deck：

```ts
interface DeckGrammar {
  /** 版面骨架: masthead/页脚/留白/网格(描述 + 可选 HTML 骨架模板字符串) */
  skeleton: string
  /** 设计 token: 主色/强调色/字号阶梯/字族/间距单位 */
  tokens: { colors: string[]; accent: string; fontScale: number[]; fontFamily: string; spacing: number }
  /** 版面规则文字描述(供后续页生成时复用) */
  rules: string
  /** showcase 两页的 HTML(作为后续页的"参照范本") */
  exemplars: string[]
  /** 路径: 'pptx'(4约束) | 'visual'(自由) */
  path: 'pptx' | 'visual'
}
```

### 4.3 新增/改造的工具与模块

| 模块/工具 | 作用 | 新建/改造 |
| --- | --- | --- |
| `deck_make_showcase` (工具) | 生成 1-2 页 showcase(按 Path 走约束或自由) | 新建(复用 freeform/受约束生成) |
| `deck_set_grammar` (工具) | 用户确认后, 从 showcase 抽取/固化 grammar 存 project | 新建 |
| `deck-grammar.ts` (模块) | grammar 抽取(从 showcase HTML 提 token/骨架)+ 注入(拼进后续页生成提示) | 新建 |
| `gen_slide_*` 改造 | 接收 grammar 上下文, 复用骨架/token/exemplar 生成连贯页 | 改造 deck-generator/freeform |
| `deck_projects.grammar` (列) | 持久化 grammar(JSON)。ALTER 加列(同 style_family 范式) | schema 改造 |
| PPT 设计师 persona | 改成新工作流: 先定格式 → showcase → 确认 → 批量复用 grammar | 改 persona.ts |

### 4.4 为什么这样能到 huashu 质量

- **bespoke**：grammar 是为这份内容现场设计的，不是 217 套里硬挑一个 → 贴合度高。
- **连贯**：全 deck 复用同一 grammar + exemplar 参照 → 视觉浑然一体（解决"东一页西一页"）。
- **用户在环**：showcase 确认把"方向错了返工 N 页"降成"返工 2 页"（huashu 实测 2-3 小时 → 0）。

---

## 5. 离线 cinematic 动画（Path B，React + Babel 打包进包）

- **打包**：React + ReactDOM(~140KB) + @babel/standalone(~3MB) 作 `extraResources` 进 app，离屏窗口经 `local-file://` 加载（**非 CDN**，离线可用）。
- **生成**：freeform 引擎可写 React 组件动画 HTML，`<script src="local-file://.../react.js">` 引本地 React/Babel；动画走 Stage 时钟 `window.__seek(t)`（已有逐帧机制）。
- **方法论**：注入 huashu `animation-best-practices` / `cinematic-patterns` 蒸馏提示。
- **导出**：离屏 `renderFrames` 逐帧 → ffmpeg → MP4（已有链路）。
- **注**：更轻的 `__seek` + CSS 入场动画也保留（不需 React 的简单动画）；React+Babel 只在要 huashu 级 cinematic 时启用。
- **体积代价**：~3MB 进安装包（一次性，离线，可接受）。

---

## 6. 云端图搜（Pixabay，无署名）

和现有 LLM 网关 / TTS 代理**同构**——key 留云端，桌面端只拿 URL，零 Python：

```
桌面端 deck_search_image("科技 团队 办公")
   → 云控端 ImageSearchController (Pixabay key 在云配置)
   → Pixabay API → 返回 [{url, thumb}]   (Pixabay 免费商用、无需署名)
   → 桌面端拿 https URL 填 image 槽
       · 自由设计: <img src="https://...">
       · 可编辑 PPTX: 下载嵌入(pptxgenjs addImage)
```

| 端 | 改造 |
| --- | --- |
| 云控端(Laravel) | 新增 `ImageSearchController`(代理 Pixabay, key 云配置, 返回 url+thumb) + 路由 `client/image-search` |
| 桌面端 | 新增 `deck_search_image` 工具(平行 `deck_search_icon`) → 调云端 → 填 image 槽 |

- Pixabay 选型理由：免费商用、**无需署名**（用户要求）、API 简单。
- 图片本就被现有 image 槽接受（freeform 允许 https、声明式 image 块走 object-fit:cover）。

---

## 7. 方法论增强（注入 huashu 完整设计方法论）

现状 `design-rules.ts` 只蒸馏了 grammar + anti-slop（约 45 行）。增强：

- 把 huashu `slide-decks.md` 的**出版物 grammar 骨架**（masthead/网格/双语比例）蒸馏进 grammar 提示。
- `design-context.md` / `design-styles.md` 的**设计哲学 + 风格库**蒸馏进 showcase 生成提示（拉高审美上限）。
- 与 §4 的 grammar 机制配合：showcase 阶段用满方法论出高质量范本，后续页复用。

---

## 8. 模块清单与改动面

**桌面端（agent-desktop）**
- 新建：`deck-grammar.ts`（grammar 抽取/注入）、`deck_make_showcase`/`deck_set_grammar`/`deck_search_image` 工具
- 改造：`deck-generator.ts`/`freeform-engine.ts`（接 grammar 上下文）、`deck-tools.ts`（注册新工具）、`persona.ts`（新工作流）、`design-rules.ts`（方法论增强）、`persistence.ts` + schema（grammar 列）
- 打包：`electron-builder.yml` extraResources 加 React/Babel；`resources/` 放本地 React/Babel

**云控端（agent-admin）**
- 新建：`ImageSearchController` + 路由 + Pixabay key 配置

---

## 9. 排期（分阶段，各可独立验证）

| 阶段 | 内容 | 可验证产出 |
| --- | --- | --- |
| **P1 grammar 工作流核心** | deck-grammar + showcase/set_grammar 工具 + gen_slide 接 grammar + persona 新流程 + grammar 持久化 | 对话: 出 showcase → 确认 → 批量复用 grammar → 全 deck 连贯(Path A 可编辑 PPTX) |
| **P2 方法论增强** | design-rules 注入 huashu 完整方法论 + 风格库 | showcase 质量肉眼对比提升 |
| **P3 云端图搜** | ImageSearchController(Pixabay) + deck_search_image | 对话: AI 取真实素材图填进 deck |
| **P4 离线 cinematic 动画** | 打包 React/Babel + freeform 写动画 + 导出视频 | Path B: 出 cinematic 视频(离线、零 CDN) |

> 验证沿用现有：fake LLM/离屏自检 + 真 Electron e2e + electron-vite build + 真机目检。

---

## 10. 一句话总结

> huashu 的质量根源是「**showcase 先行 + 为这份 deck 现场设计的专属 grammar 贯穿全 deck**」，不是它的 Python/Playwright 工具。我们把这套**方法**搬进现有零依赖的 Electron deck 引擎：默认 Path A 出高质量可编辑 PPTX（bespoke grammar 远胜通用模板），需要时 Path B 出离线 cinematic 视频，真实素材图走云端 Pixabay 代理——全程零 Python。
