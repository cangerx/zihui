// 风格分组(界面统一称「风格」; 内部代码沿用 family 命名): 把 217 套模板按 presenton 组归入不同风格, 解决两个问题——
//  ① 选型时只在所选家族内挑模板(避免一份 PPT 风格混搭 + 控制选型 prompt 体量);
//  ② 每个家族绑定一套主题, 恢复 presenton 各组的视觉身份(避免所有模板同一种皮肤)。
// 家族 id = 云端模板的 category(组名); 内置 6 套(category=structure/content/opening)统一归 'basic'。

export interface StyleFamily {
  id: string
  label: string
  description: string
  /** 该家族默认主题(theme.ts 中的 id) */
  theme: string
}

export const STYLE_FAMILIES: StyleFamily[] = [
  { id: 'basic', label: '基础内置', description: '离线可用的通用版式(封面/目录/要点/两栏/数据)', theme: 'editorial-serif' },
  { id: 'general', label: '通用商务', description: '标题正文配图、要点卡、指标等常规商务版式', theme: 'clean-sans' },
  { id: 'standard', label: '标准简洁', description: '克制留白、栏式排布的标准版式', theme: 'corporate-blue' },
  { id: 'swift', label: '轻快现代', description: '页脚条与图标要点风格的轻量版式', theme: 'forest-green' },
  { id: 'modern', label: '现代图文', description: '强调图文与图表占位的现代版式', theme: 'slate-gray' },
  { id: 'Code', label: '技术代码', description: '代码片段、终端、文件树等技术演示版式', theme: 'dark-pro' },
  { id: 'Education', label: '教育课程', description: '课程封面、目录、议程、评估矩阵等教学版式', theme: 'amber-warm' },
  { id: 'ProductOverview', label: '产品介绍', description: '产品封面、特性、流程、路线图等产品版式', theme: 'clean-sans' },
  { id: 'Report', label: '分析报告', description: '发现、指标、行动计划、风险矩阵等报告版式', theme: 'slate-gray' },
  { id: 'pitch-deck', label: '融资路演', description: '问题、方案、市场、财务、竞争等路演版式', theme: 'royal-purple' },
  { id: 'neo-general', label: 'Neo 通用', description: 'Neo 系通用版式(卡片/漏斗/团队/时间线)', theme: 'clean-sans' },
  { id: 'neo-modern', label: 'Neo 现代', description: 'Neo 系现代版式(对比卡/KPI 网格/图表)', theme: 'dark-pro' },
  { id: 'neo-standard', label: 'Neo 标准', description: 'Neo 系标准版式(进度环/指标/图表网格)', theme: 'corporate-blue' },
  { id: 'neo-swift', label: 'Neo 轻快', description: 'Neo 系轻快版式(级联统计/3x3/图表侧栏)', theme: 'forest-green' }
]

const BY_ID = new Map(STYLE_FAMILIES.map((f) => [f.id, f]))
// 内置 6 套的 category, 统一归入 basic 家族
const BUILTIN_CATEGORIES = new Set(['structure', 'content', 'opening'])

/** 模板 category → 所属家族 id(未知 category 归 basic, 保证永不落空) */
export function familyIdForCategory(category: string): string {
  if (!category || BUILTIN_CATEGORIES.has(category)) return 'basic'
  return BY_ID.has(category) ? category : 'basic'
}

export function familyById(id: string): StyleFamily | undefined {
  return BY_ID.get(id)
}

/** 家族默认主题 id(未知家族回退 editorial-serif) */
export function familyTheme(id: string): string {
  return BY_ID.get(id)?.theme ?? 'editorial-serif'
}
