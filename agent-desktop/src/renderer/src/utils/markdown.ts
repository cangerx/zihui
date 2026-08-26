import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import DOMPurify from 'dompurify'

// 按需注册常用语言，避免全量 hljs（~900KB gz）进入 ChatView bundle。
// xml 语言在 hljs 里同时覆盖 html，shell 同时覆盖 console/sh。
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('css', css)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('php', php)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('python', python)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('scss', scss)
hljs.registerLanguage('shell', shell)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)
// 常见别名
hljs.registerAliases(['js', 'mjs', 'cjs'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['sh', 'zsh', 'console'], { languageName: 'bash' })
hljs.registerAliases(['ps', 'ps1', 'pwsh'], { languageName: 'powershell' })
hljs.registerAliases(['html', 'xhtml', 'svg', 'vue'], { languageName: 'xml' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerAliases(['md'], { languageName: 'markdown' })
hljs.registerAliases(['rs'], { languageName: 'rust' })
hljs.registerAliases(['rb'], { languageName: 'ruby' })
hljs.registerAliases(['cs'], { languageName: 'csharp' })
hljs.registerAliases(['kt', 'kts'], { languageName: 'kotlin' })
hljs.registerAliases(['c++', 'cc', 'hpp', 'h'], { languageName: 'cpp' })
hljs.registerAliases(['text', 'txt'], { languageName: 'plaintext' })

marked.setOptions({
  breaks: true,
  gfm: true
})

const renderer = new marked.Renderer()

renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
  const highlighted = hljs.highlight(text, { language }).value
  // 用 data-action 走事件委托，避免 inline onclick 被生产环境 CSP 拦截（main/index.ts 的 script-src 'self' 不允许 inline）
  return `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${language}</span><button class="copy-btn" data-action="copy-code" type="button">复制</button></div><pre><code class="hljs language-${language}">${highlighted}</code></pre></div>`
}

marked.use({ renderer })

// 可跳转目标识别（仅作用于文本节点 / inline code 内容）：
//  - Windows 盘符路径：反斜杠 C:\foo\bar.png 或正斜杠 F:/foo/bar.png
//    （core-tools 给 LLM 的 displayUrl 就是正斜杠形态，LLM 正文照抄必须能识别）
//  - Unix 绝对路径：限定常见根前缀（Users/home/root/...），避免把正文里 / 开头的普通文本误判为路径
//  - local-file:// 应用内文件协议（生图回显等）
//  - http(s) URL
//
// 裸文本目标的字符集边界：排除空白、标签定界符、引号、&（文本节点里字面 & 均被
// 转义为 &amp;，凡是 & 必然属于实体，如 &quot;）、CJK 与全角字符、弯引号。
// 中文路径在裸文本里无法与正文中文划界（如「已保存（F:\a\报告.png）请查收」），
// 截断在中文前、由主进程 fallback 打开父目录；含中文路径的完整识别由系统提示
// 约定的反引号包裹（inline code 整体匹配，无字符集限制）承载。
const WIN_PATH_RE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s<"'&\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2018\u2019\u201c\u201d]+/g
const UNIX_PATH_RE = /(?<![\w.:])\/(?:Users|home|root|var|tmp|opt|data|Applications)\/[^\s<"'&\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2018\u2019\u201c\u201d]+/g
const LOCAL_FILE_URL_RE = /local-file:\/\/[^\s<"'&\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2018\u2019\u201c\u201d]+/g
const URL_RE = /https?:\/\/[^\s<"')\]]+/g
const JUMP_ICON = '<svg class="link-jump-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-4.5-6H21m0 0v7.5m0-7.5-9 9" /></svg>'

// 路径/URL 匹配会吃进紧随其后的句子标点（如「已保存到 C:\a\b.png。」里的句号），
// 剥离尾部标点再作为跳转目标，避免定位到一个不存在的路径。
// 按钮插在路径与标点之间，标点保留在按钮之后。
function trimTrailingPunct(s: string): string {
  // 非括号类尾部标点直接剥
  let out = s.replace(/[.,;:!?，。；：！？、'"]+$/g, '')
  // 尾部闭括号仅在其无配对开括号时才剥（如「路径 C:\a\b.png)」的 ) 属于句子；
  // 而 D:\backup(1) 的 ) 在串内有 ( 配对，属于路径本身，保留）
  const pairs: Record<string, string> = { ')': '(', '）': '（', ']': '[', '】': '【', '}': '{', '》': '《' }
  for (;;) {
    const last = out.slice(-1)
    const open = pairs[last]
    if (!open) break
    const closes = out.split(last).length - 1
    const opens = out.split(open).length - 1
    if (opens >= closes) break
    out = out.slice(0, -1)
  }
  return out
}

// 生成跳转按钮 HTML。target 来自 HTML 文本节点/属性（已是实体编码态），
// 只转义双引号防止突破属性边界；& 保持原样，浏览器解析属性时统一解码一层，路径还原正确。
function jumpBtn(target: string, type: 'local' | 'external' | 'localfile', title: string): string {
  const escaped = target.replace(/"/g, '&quot;')
  return `<button class="link-jump-btn" data-link="${escaped}" data-link-type="${type}" title="${title}">${JUMP_ICON}</button>`
}

/** 依次识别 local-file:// / Windows 路径 / Unix 路径 / URL，返回按钮 HTML（无法识别返回空串） */
function jumpBtnForTarget(raw: string): string {
  const t = trimTrailingPunct(raw)
  if (!t) return ''
  if (/^local-file:\/\//.test(t)) return jumpBtn(t, 'localfile', '打开所在目录')
  if (/^[A-Za-z]:[\\/]/.test(t)) return jumpBtn(t, 'local', '打开所在目录')
  if (/^\/(?:Users|home|root|var|tmp|opt|data|Applications)\//.test(t)) return jumpBtn(t, 'local', '打开所在目录')
  if (/^https?:\/\//.test(t)) return jumpBtn(t, 'external', '在浏览器中打开')
  return ''
}

/** 在 inline code / 文本节点的匹配回调里统一使用：按各目标类型正则查找首个可跳转目标 */
function findFirstTarget(inner: string): string {
  const m =
    inner.match(/local-file:\/\/[^\s<"'&\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2018\u2019\u201c\u201d]+/) ||
    inner.match(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s<"'&\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2018\u2019\u201c\u201d]+/) ||
    inner.match(/(?<![\w.:])\/(?:Users|home|root|var|tmp|opt|data|Applications)\/[^\s<"'&\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u2018\u2019\u201c\u201d]+/) ||
    inner.match(/https?:\/\/[^\s<"')\]]+/)
  return m ? jumpBtnForTarget(m[0]) : ''
}

/** 文本节点内追加跳转按钮：先 URL（防 Unix 路径正则误吃 URL 的路径段），再 local-file，最后文件路径。
 *  匹配到的「目标文本+按钮」整体替换为占位 token，全部替换完成后统一还原——
 *  避免后续正则扫到已处理文本的残留片段（如 URL 里的 /Users/xx 路径段）造成二次加按钮。
 *  token 用纯字母数字 JBTNMARK<n>JBTNMARK：不含下划线/方括号，marked 不会解析、
 *  路径正则不命中、用户正文撞字面的概率可忽略；段内序号从 0 开始。 */
function addButtonsToText(text: string): string {
  const stash: string[] = []
  const put = (html: string): string => {
    stash.push(html)
    return `JBTNMARK${stash.length - 1}JBTNMARK`
  }
  const appendBtn = (match: string): string => {
    // 匹配串吃进占位 token（路径紧贴 inline code / code block / 已处理目标时）放弃加按钮：
    // 否则 data-link 会包含 token 字面量导致定位必失败，不加按钮至少保证文本显示正常
    if (/(?:XINLCODE|XCODEBLK|JBTNMARK)\d+(?:XINLCODE|XCODEBLK|JBTNMARK)/.test(match)) return match
    const t = trimTrailingPunct(match)
    const btn = jumpBtnForTarget(t)
    if (!btn) return match
    return put(t + btn) + match.slice(t.length)
  }
  let out = text.replace(URL_RE, appendBtn)
  out = out.replace(LOCAL_FILE_URL_RE, appendBtn)
  out = out.replace(WIN_PATH_RE, appendBtn)
  out = out.replace(UNIX_PATH_RE, appendBtn)
  // 还原用函数形式：替换串里的 $& / $' 等会被 String.replace 当特殊模式展开，
  // 路径含 $ 字符（如 C:\$Recycle.Bin）时会被错误替换
  stash.forEach((html, i) => {
    out = out.replace(`JBTNMARK${i}JBTNMARK`, () => html)
  })
  return out
}

/** local-file:// 图片包装：加 hover 角标按钮（打开所在目录）。
 *  按钮 class 保持裸 link-jump-btn（shield 正则 / ChatView 点击委托均按此类名匹配），
 *  角标定位样式通过 .img-file-wrap .link-jump-btn 结构选择器施加。 */
function wrapLocalFileImages(html: string): string {
  return html.replace(/<img\s+[^>]*?src="(local-file:\/\/[^"]+)"[^>]*?>/gi, (match, url) => {
    return `<span class="img-file-wrap">${match}${jumpBtn(url, 'localfile', '打开所在目录')}</span>`
  })
}

function insertLinkButtons(html: string): string {
  const codeBlockPlaceholders: string[] = []
  let processed = html.replace(/<pre[\s>][\s\S]*?<\/pre>/gi, (match) => {
    codeBlockPlaceholders.push(match)
    return `XCODEBLK${codeBlockPlaceholders.length - 1}XCODEBLK`
  })

  // inline code：优先把内容整体当作跳转目标（反引号包裹的路径即使含空格也能完整命中，
  // 不受 \s 截断影响——mac 数据目录 Application Support 含空格就靠这条路径）；
  // 整体不是目标时退回到子串匹配（如 `运行 C:\foo\bar.bat` 这类混合文本）
  processed = processed.replace(/<code>([^<]*)<\/code>/gi, (match, inner: string) => {
    const btn = jumpBtnForTarget(inner.trim()) || findFirstTarget(inner)
    return btn ? `${match}${btn}` : match
  })

  const inlineCodePlaceholders: string[] = []
  processed = processed.replace(/<code>[^<]*<\/code>(?:<button class="link-jump-btn"[^>]*>.*?<\/button>)?/gi, (match) => {
    inlineCodePlaceholders.push(match)
    return `XINLCODE${inlineCodePlaceholders.length - 1}XINLCODE`
  })

  // 文本节点级替换：按标签切分，只对文本段做目标识别——
  // 避免把按钮 HTML 插进 <a href="..."> / <img alt="..."> 等标签属性里撑破标签。
  // <a> 内的文本本身就是可点链接（ChatView 委托 openExternal），不再重复追加按钮。
  const segments = processed.split(/(<[^>]+>)/g)
  let anchorDepth = 0
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!seg) continue
    if (seg[0] === '<') {
      if (/^<a[\s>]/i.test(seg)) anchorDepth++
      else if (/^<\/a\s*>/i.test(seg)) anchorDepth = Math.max(0, anchorDepth - 1)
      continue
    }
    if (anchorDepth > 0) continue
    segments[i] = addButtonsToText(seg)
  }
  processed = segments.join('')

  inlineCodePlaceholders.forEach((code, i) => {
    processed = processed.replace(`XINLCODE${i}XINLCODE`, () => code)
  })
  codeBlockPlaceholders.forEach((code, i) => {
    processed = processed.replace(`XCODEBLK${i}XCODEBLK`, () => code)
  })

  return processed
}

function convertLocalImages(html: string): string {
  return html.replace(/<img\s+([^>]*?)src="([^"]+)"([^>]*?)>/gi, (_match, before, src, after) => {
    if (src.startsWith('local-file:') || src.startsWith('data:') || src.startsWith('http')) return _match
    // marked 会对 img src 做 URL 编码（反斜杠 → %5C），先解码再判断，
    // 否则最常见的 `![图](F:\a\b.png)` 反斜杠形态永远匹配不到
    let decoded = src
    try { decoded = decodeURIComponent(src) } catch { /* 含非法 % 序列时按原样处理 */ }
    const isWinImage = /^[A-Z]:[/\\].+\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(decoded)
    // Unix 绝对路径图片（mac 侧 AI 用 markdown 图片语法贴本地图的场景），根前缀限定与文本识别一致
    const isUnixImage = /^\/(?:Users|home|root|var|tmp|opt|data|Applications)\/.+\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(decoded)
    if (isWinImage || isUnixImage) {
      const url = `local-file://img?p=${encodeURIComponent(decoded.replace(/\\/g, '/'))}`
      return `<img ${before}src="${url}"${after}>`
    }
    return _match
  })
}

const LINK_JUMP_BTN_RE = /<button class="link-jump-btn"[^>]*>[\s\S]*?<\/button>/g

/**
 * local-file:// URL → 文件路径。
 * ?rel=<数据目录相对路径> 原样返回（主进程 showItemInFolder 对相对路径会自动拼数据目录，
 * 基准与 local-file 协议解析一致）；?p=<绝对路径> 直接用。
 * 参数优先级 rel 优先于 p——与主进程 local-file 协议 handler（main/index.ts）保持一致，
 * 避免「预览显示的是 rel 的图、定位打开的却是 p 的文件」这种两端分叉。
 *
 * query 手工切分而不走 URLSearchParams：后者会把未编码的字面 + 解码成空格，
 * 而 + 是合法文件名字符（系统产出侧恒 encodeURIComponent，手写未编码形态也要兜住）。
 * 入参须为解码态 URL（来自 DOM 属性 dataset.link / img.src 的读取结果）。
 */
export function resolveLocalFileTarget(url: string): string | null {
  try {
    const q = url.split('?')[1]
    if (!q) return null
    let rel: string | null = null
    let p: string | null = null
    for (const pair of q.split('&')) {
      const idx = pair.indexOf('=')
      if (idx <= 0) continue
      const k = pair.slice(0, idx)
      const v = pair.slice(idx + 1)
      if (k === 'rel') rel = v
      else if (k === 'p') p = v
    }
    const raw = rel ?? p
    if (!raw) return null
    try {
      return decodeURIComponent(raw)
    } catch {
      // 含非法 % 序列（如手写 URL 里的字面 %）时按原样返回
      return raw
    }
  } catch {
    return null
  }
}

// 渲染结果按内容缓存（LRU）：流式期间每个 token 都会触发整列表重渲染，
// 历史消息内容不可变却被反复全量重算（marked+hljs+DOMPurify），缓存后命中即返。
// 流式中的气泡内容每 token 都变（永不命中），会挤占缓存——故调用方对流式气泡应走 renderMarkdownLive。
const mdCache = new Map<string, string>()
const MD_CACHE_CAP = 60

export function renderMarkdown(content: string): string {
  const cached = mdCache.get(content)
  if (cached !== undefined) {
    // LRU：命中项提到末尾
    mdCache.delete(content)
    mdCache.set(content, cached)
    return cached
  }
  const html = renderMarkdownLive(content)
  mdCache.set(content, html)
  if (mdCache.size > MD_CACHE_CAP) {
    const first = mdCache.keys().next().value
    if (first !== undefined) mdCache.delete(first)
  }
  return html
}

/** 不缓存的实时渲染（流式中的气泡用：内容每 token 都变，缓存只会污染 LRU） */
export function renderMarkdownLive(content: string): string {
  const html = marked.parse(content) as string
  const withImages = convertLocalImages(html)
  const wrapped = wrapLocalFileImages(withImages)
  const processed = insertLinkButtons(wrapped)
  // Protect self-generated link-jump buttons from DOMPurify stripping their SVG icons.
  // Use a plain-ASCII token so it survives DOMPurify's HTML5 parsing round-trip.
  const jumpButtons: string[] = []
  const shielded = processed.replace(LINK_JUMP_BTN_RE, (match) => {
    jumpButtons.push(match)
    return `__LINK_JUMP_BTN_${jumpButtons.length - 1}__`
  })
  let sanitized = DOMPurify.sanitize(shielded, {
    ADD_ATTR: ['data-link', 'data-link-type', 'data-action'],
    ADD_TAGS: ['button'],
    // 注意：不要再加 ADD_URI_SAFE_ATTR: ['src']——它会豁免 src 的 URI 协议校验，
    // 使 ALLOWED_URI_REGEXP 对 img src 完全失效（javascript:/file: 均原样通过）
    ALLOWED_URI_REGEXP: /^(?:(?:https?|data|local-file):)/i
  })
  jumpButtons.forEach((btn, i) => {
    // 函数形式还原：避免 data-link 里路径含 $& 等字符时被 replace 当特殊模式展开
    sanitized = sanitized.replace(`__LINK_JUMP_BTN_${i}__`, () => btn)
  })
  return sanitized
}
