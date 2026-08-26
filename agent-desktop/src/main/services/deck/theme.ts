import type { ThemeTokens } from './types'

// 跨平台字体栈(D16 字体三重保险之②): 拉丁用 Win/mac 两端都自带的字体;
// 中文给常见名 + 稳妥回退栈。配合导出端 fit:'shrink' 自动收缩兜住回落字宽变化。
export const FONT_SERIF =
  `Georgia, 'Times New Roman', 'Songti SC', SimSun, 'Noto Serif CJK SC', serif`
export const FONT_SANS =
  `'Helvetica Neue', Helvetica, Arial, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif`
export const FONT_MONO = `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace`

const EDITORIAL_SERIF: ThemeTokens = {
  id: 'editorial-serif',
  name: '出版物衬线',
  vars: {
    bg: '#faf8f4',
    fg: '#1a1a1a',
    muted: '#6b6b6b',
    accent: '#9a3b2e',
    rule: '#e3ddd2',
    card: '#ffffff',
    'card-fg': '#1a1a1a',
    'font-display': FONT_SERIF,
    'font-body': FONT_SERIF,
    'font-mono': FONT_MONO
  }
}

const CLEAN_SANS: ThemeTokens = {
  id: 'clean-sans',
  name: '极简无衬线',
  vars: {
    bg: '#ffffff',
    fg: '#111418',
    muted: '#6a7280',
    accent: '#2256d6',
    rule: '#e6e8ec',
    card: '#f6f8fa',
    'card-fg': '#111418',
    'font-display': FONT_SANS,
    'font-body': FONT_SANS,
    'font-mono': FONT_MONO
  }
}

const DARK_PRO: ThemeTokens = {
  id: 'dark-pro',
  name: '深色专业',
  vars: {
    bg: '#14161a',
    fg: '#f2f4f7',
    muted: '#9aa3ad',
    accent: '#e0a458',
    rule: '#2a2e35',
    card: '#1c1f25',
    'card-fg': '#f2f4f7',
    'font-display': FONT_SANS,
    'font-body': FONT_SANS,
    'font-mono': FONT_MONO
  }
}

const CORPORATE_BLUE: ThemeTokens = {
  id: 'corporate-blue',
  name: '商务蓝',
  vars: {
    bg: '#f7f9fc',
    fg: '#0f172a',
    muted: '#64748b',
    accent: '#1d4ed8',
    rule: '#e2e8f0',
    card: '#ffffff',
    'card-fg': '#0f172a',
    'font-display': FONT_SANS,
    'font-body': FONT_SANS,
    'font-mono': FONT_MONO
  }
}

const FOREST_GREEN: ThemeTokens = {
  id: 'forest-green',
  name: '森野绿',
  vars: {
    bg: '#f6faf7',
    fg: '#14241c',
    muted: '#5f7268',
    accent: '#15803d',
    rule: '#dde8e0',
    card: '#ffffff',
    'card-fg': '#14241c',
    'font-display': FONT_SANS,
    'font-body': FONT_SANS,
    'font-mono': FONT_MONO
  }
}

const SLATE_GRAY: ThemeTokens = {
  id: 'slate-gray',
  name: '石板灰',
  vars: {
    bg: '#f8fafc',
    fg: '#1e293b',
    muted: '#64748b',
    accent: '#475569',
    rule: '#e2e8f0',
    card: '#ffffff',
    'card-fg': '#1e293b',
    'font-display': FONT_SANS,
    'font-body': FONT_SANS,
    'font-mono': FONT_MONO
  }
}

const AMBER_WARM: ThemeTokens = {
  id: 'amber-warm',
  name: '暖琥珀',
  vars: {
    bg: '#fdfaf3',
    fg: '#2a2118',
    muted: '#8a7a63',
    accent: '#b45309',
    rule: '#ece3d2',
    card: '#ffffff',
    'card-fg': '#2a2118',
    'font-display': FONT_SERIF,
    'font-body': FONT_SANS,
    'font-mono': FONT_MONO
  }
}

const ROYAL_PURPLE: ThemeTokens = {
  id: 'royal-purple',
  name: '皇家紫',
  vars: {
    bg: '#faf8fd',
    fg: '#1e1633',
    muted: '#6b6480',
    accent: '#6d28d9',
    rule: '#e7e1f2',
    card: '#ffffff',
    'card-fg': '#1e1633',
    'font-display': FONT_SERIF,
    'font-body': FONT_SANS,
    'font-mono': FONT_MONO
  }
}

export const THEMES: Record<string, ThemeTokens> = {
  [EDITORIAL_SERIF.id]: EDITORIAL_SERIF,
  [CLEAN_SANS.id]: CLEAN_SANS,
  [DARK_PRO.id]: DARK_PRO,
  [CORPORATE_BLUE.id]: CORPORATE_BLUE,
  [FOREST_GREEN.id]: FOREST_GREEN,
  [SLATE_GRAY.id]: SLATE_GRAY,
  [AMBER_WARM.id]: AMBER_WARM,
  [ROYAL_PURPLE.id]: ROYAL_PURPLE
}

/** 列出全部主题(供 UI 选择) */
export function listThemes(): Array<{ id: string; name: string }> {
  return Object.values(THEMES).map((t) => ({ id: t.id, name: t.name }))
}

export function defaultTheme(): ThemeTokens {
  return EDITORIAL_SERIF
}

export function themeById(id: string): ThemeTokens {
  return THEMES[id] ?? EDITORIAL_SERIF
}

/** 主题 token -> CSS :root 变量声明字符串 */
export function themeToCssVars(theme: ThemeTokens): string {
  return Object.entries(theme.vars)
    .map(([k, v]) => `--${k}: ${v};`)
    .join(' ')
}
