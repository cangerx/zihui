/**
 * 图标库：内联 SVG path，运行时转 data URI 给 <image> 用（小程序不支持内联 svg 标签）
 * 线性图标统一 24x24 viewBox、stroke-width 1.8；实心图标用 fill。
 * TODO(design)：设计交付正式图标后替换为 PNG/字体图标资源
 */
import { svgToDataUri } from './base64'

type IconDef = { d: string; fill?: boolean; extra?: string }

const ICONS: Record<string, IconDef> = {
  /* 通用 */
  search: { d: 'M10.8 4.2a6.6 6.6 0 1 1 0 13.2 6.6 6.6 0 0 1 0-13.2ZM15.6 15.6 20 20' },
  close: { d: 'M6 6l12 12M18 6 6 18' },
  back: { d: 'M15 4 7.5 12 15 20' },
  arrow: { d: 'M9.5 5 16.5 12l-7 7' },
  'arrow-down': { d: 'M5.5 9 12 15.5 18.5 9' },
  'arrow-up': { d: 'M5.5 15 12 8.5 18.5 15' },
  plus: { d: 'M12 5v14M5 12h14' },
  check: { d: 'M5 12.8 9.5 17 19 7.4' },
  camera: {
    d: 'M4 9.4c0-1.2 1-2.2 2.2-2.2h1.3l1-1.7c.2-.3.6-.5 1-.5h4.9c.4 0 .8.2 1 .5l1 1.7h1.4c1.2 0 2.2 1 2.2 2.2v7c0 1.2-1 2.2-2.2 2.2H6.2A2.2 2.2 0 0 1 4 16.4v-7Z',
    extra: '<circle cx="12" cy="12.6" r="3.1" fill="none" stroke="COLOR" stroke-width="1.8"/>',
  },
  mic: {
    d: 'M12 4.5a2.6 2.6 0 0 1 2.6 2.6v4a2.6 2.6 0 0 1-5.2 0v-4A2.6 2.6 0 0 1 12 4.5ZM6.5 11.4a5.5 5.5 0 0 0 11 0M12 17v3',
  },
  send: { d: 'M4.5 12 20 5l-3.4 14.5-4.3-4.8L4.5 12Zm7.8 2.7L20 5' },
  grid: {
    d: 'M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z',
  },
  image: {
    d: 'M4.5 7.2c0-1.2 1-2.2 2.2-2.2h10.6c1.2 0 2.2 1 2.2 2.2v9.6c0 1.2-1 2.2-2.2 2.2H6.7a2.2 2.2 0 0 1-2.2-2.2V7.2Z',
    extra:
      '<circle cx="9" cy="9.8" r="1.5" fill="none" stroke="COLOR" stroke-width="1.6"/><path d="M5 16.2l3.9-3.4c.6-.5 1.5-.5 2.1 0l2.4 2.1M13 14.6l1.9-1.7c.6-.5 1.5-.5 2.1 0l2 1.8" fill="none" stroke="COLOR" stroke-width="1.6" stroke-linecap="round"/>',
  },
  book: { d: 'M5 5.5h5.5c.8 0 1.5.7 1.5 1.5v11c0-.8-.7-1.5-1.5-1.5H5v-11ZM19 5.5h-5.5c-.8 0-1.5.7-1.5 1.5v11c0-.8.7-1.5 1.5-1.5H19v-11Z' },
  star: { d: 'm12 4.6 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 10.3l5.4-.8L12 4.6Z' },
  gift: {
    d: 'M4.6 9.6h14.8v3H4.6zM6.1 12.6h11.8v6.2H6.1zM12 9.6v9.2',
    extra:
      '<path d="M12 9.6C10.6 7 9.4 5.6 8.1 5.6a1.9 1.9 0 0 0 0 3.8M12 9.6c1.4-2.6 2.6-4 3.9-4a1.9 1.9 0 0 1 0 3.8" fill="none" stroke="COLOR" stroke-width="1.8" stroke-linejoin="round"/>',
  },
  setting: {
    d: 'M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z',
    extra:
      '<path d="M19.4 12c0-.5-.05-1-.14-1.5l1.5-1.2-1.6-2.8-1.8.7c-.75-.6-1.6-1.1-2.5-1.4L14.5 4h-5l-.35 1.9c-.9.3-1.75.8-2.5 1.4l-1.8-.7-1.6 2.8 1.5 1.2c-.09.5-.14 1-.14 1.5s.05 1 .14 1.5l-1.5 1.2 1.6 2.8 1.8-.7c.75.6 1.6 1.1 2.5 1.4L9.5 20h5l.35-1.9c.9-.3 1.75-.8 2.5-1.4l1.8.7 1.6-2.8-1.5-1.2c.09-.5.14-1 .14-1.5Z" fill="none" stroke="COLOR" stroke-width="1.8" stroke-linejoin="round"/>',
  },
  feedback: {
    d: 'M4.6 8.2c0-1.4 1.1-2.5 2.5-2.5h9.8c1.4 0 2.5 1.1 2.5 2.5v5.6c0 1.4-1.1 2.5-2.5 2.5H10l-4 3v-3h-.9v-8.1Z',
  },
  scan: {
    d: 'M4.6 8.6V6.4c0-1 .8-1.8 1.8-1.8h2.2M19.4 8.6V6.4c0-1-.8-1.8-1.8-1.8h-2.2M4.6 15.4v2.2c0 1 .8 1.8 1.8 1.8h2.2M19.4 15.4v2.2c0 1-.8 1.8-1.8 1.8h-2.2M4 12h16',
  },
  vip: { d: 'm4 7.5 3.6 2.6L12 4.8l4.4 5.3L20 7.5l-1.6 9.7H5.6L4 7.5Z' },
  bean: {
    d: 'M12 4.4c4.2 0 7.6 3.4 7.6 7.6S16.2 19.6 12 19.6 4.4 16.2 4.4 12 7.8 4.4 12 4.4Z',
    extra: '<path d="M9.4 14.6c1.6-.6 2.8-1.8 3.4-3.4.6-1.6.4-3.2-.6-4.4" fill="none" stroke="COLOR" stroke-width="1.8" stroke-linecap="round"/>',
  },
  question: {
    d: 'M12 4.4a7.6 7.6 0 1 1 0 15.2 7.6 7.6 0 0 1 0-15.2Z',
    extra:
      '<path d="M9.9 9.6c0-1.2 1-2.1 2.1-2.1s2.1.9 2.1 2.1c0 1.4-2.1 1.5-2.1 3M12 16.2v.4" fill="none" stroke="COLOR" stroke-width="1.8" stroke-linecap="round"/>',
  },
  history: {
    d: 'M12 4.6a7.4 7.4 0 1 1-7.2 9.2',
    extra:
      '<path d="M4.6 8.6v3.6h3.6M12 8.6V12l2.6 1.8" fill="none" stroke="COLOR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  play: { d: 'M9 6.6 18 12l-9 5.4V6.6Z', fill: true },
  expand: { d: 'M9.6 4.6H6.4c-1 0-1.8.8-1.8 1.8v3.2M14.4 4.6h3.2c1 0 1.8.8 1.8 1.8v3.2M9.6 19.4H6.4c-1 0-1.8-.8-1.8-1.8v-3.2M14.4 19.4h3.2c1 0 1.8-.8 1.8-1.8v-3.2' },
  trash: { d: 'M5.5 7.5h13M9.5 7.5V5.6h5v1.9M7 7.5l.9 11.1c.05.6.55 1 1.15 1h5.9c.6 0 1.1-.4 1.15-1L17 7.5' },
  refresh: {
    d: 'M19.2 12a7.2 7.2 0 1 1-2.1-5.1',
    extra: '<path d="M19.4 4.8v3.9h-3.9" fill="none" stroke="COLOR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  download: { d: 'M12 4.6v10.2M8.2 11.4 12 15.2l3.8-3.8M5 18.4h14' },
  share: {
    d: 'M12 4.6v9.6M8.4 8 12 4.4 15.6 8M5.4 13.4v4c0 1 .8 1.8 1.8 1.8h9.6c1 0 1.8-.8 1.8-1.8v-4',
  },
  wechat: {
    d: 'M9.4 5.2c3.1 0 5.6 1.9 5.6 4.4 0 .3 0 .5-.07.8a6.6 6.6 0 0 0-.9-.06c-3 0-5.4 1.8-5.4 4.1 0 .4.06.7.16 1.05-.4-.06-.8-.1-1.2-.2L4.9 16.4l.6-2.1C4.3 13.4 3.6 12 3.6 10.4c0-2.9 2.6-5.2 5.8-5.2Z',
  },

  /* 功能入口 / 工具（简化线性符号，配彩色底） */
  suite: { d: 'M5 6.5h6v6H5zM13 6.5h6v3.5h-6zM13 12h6v5.5h-6zM5 14h6v3.5H5z' },
  matting: {
    d: 'M4.5 4.5h5v5h-5zM14.5 4.5h5v5h-5zM4.5 14.5h5v5h-5z',
    extra: '<path d="M12 12c2.2 0 4 1.8 4 4s1.6 3.4 3.4 3.4" fill="none" stroke="COLOR" stroke-width="1.8" stroke-linecap="round"/>',
  },
  erase: { d: 'M9 19.4H5.6l-1.2-3.2 9.4-9.4c.7-.7 1.9-.7 2.6 0l2.6 2.6c.7.7.7 1.9 0 2.6l-9.4 9.4M14 19.4h5.4' },
  hd: {
    d: 'M4.6 7.4c0-1 .8-1.8 1.8-1.8h11.2c1 0 1.8.8 1.8 1.8v9.2c0 1-.8 1.8-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V7.4Z',
    extra:
      '<path d="M8 9.6v4.8M11.4 9.6v4.8M8 12h3.4M14 9.6v4.8h1.4c1.1 0 1.9-.9 1.9-2.4s-.8-2.4-1.9-2.4H14Z" fill="none" stroke="COLOR" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  canvas: { d: 'M4.6 6.4c0-1 .8-1.8 1.8-1.8h11.2c1 0 1.8.8 1.8 1.8v11.2c0 1-.8 1.8-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V6.4ZM4.6 12h14.8M12 4.6v14.8' },
  edit: { d: 'M14.6 4.9 19.1 9.4 9.5 19H5v-4.5L14.6 4.9ZM12.4 7.1l4.5 4.5' },
  video: {
    d: 'M4.6 8c0-1 .8-1.8 1.8-1.8h7c1 0 1.8.8 1.8 1.8v8c0 1-.8 1.8-1.8 1.8h-7A1.8 1.8 0 0 1 4.6 16V8ZM15.2 11l4.2-2.6v7.2L15.2 13v-2Z',
  },
  aplus: { d: 'M4.6 5.6h14.8v5.2H4.6zM4.6 13h6.6v5.4H4.6zM13.4 13h6v2.2h-6zM13.4 16.6h6v1.8h-6z' },
  'ai-image': {
    d: 'M4.6 7.2c0-1.2 1-2.2 2.2-2.2h10.4c1.2 0 2.2 1 2.2 2.2v9.6c0 1.2-1 2.2-2.2 2.2H6.8a2.2 2.2 0 0 1-2.2-2.2V7.2Z',
    extra:
      '<path d="m9.4 8.2.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9.9-2ZM15 12.4l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z" fill="COLOR"/>',
  },
  model: {
    d: 'M12 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM8.4 11h7.2l1.2 4.2-2.4.6.6 3.7H9l.6-3.7-2.4-.6L8.4 11Z',
  },
  logo: {
    d: 'M12 4.5 19 8v5.5c0 3.2-2.9 5.3-7 6-4.1-.7-7-2.8-7-6V8l7-3.5Z',
    extra: '<path d="M9.4 12.2 11.4 14.2l3.6-3.8" fill="none" stroke="COLOR" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  replica: { d: 'M4.6 4.6h9v9h-9zM10.4 10.4h9v9h-9z' },
  goods: { d: 'M5.2 8.4h13.6l-1 9.4c-.06.6-.56 1-1.16 1H7.36c-.6 0-1.1-.4-1.16-1l-1-9.4ZM8.8 8.4V6.8a3.2 3.2 0 0 1 6.4 0v1.6' },
  resize: { d: 'M4.6 4.6h8v8h-8zM12.6 12.6h6.8v6.8h-6.8M16 8h3.4v3.4M8 16v3.4h3.4' },
  ppt: { d: 'M4.6 5.6h14.8v9.2H4.6zM12 14.8v4.6M8.4 19.4h7.2' },
  text: { d: 'M6 6.6h12M12 6.6v11.8M9 18.4h6' },
  collage: { d: 'M4.6 4.6h6.4v6.4H4.6zM13 4.6h6.4v10.6H13zM4.6 13h6.4v6.4H4.6z' },
  repaint: {
    d: 'M4.6 4.6h14.8v8.4H4.6z',
    extra: '<path d="M8 16.4c0-1.3 1.1-2.4 2.4-2.4h3.2c1.3 0 2.4 1.1 2.4 2.4v3H8v-3Z" fill="none" stroke="COLOR" stroke-width="1.8" stroke-dasharray="2.6 2"/>',
  },
  portrait: {
    d: 'M4.6 6.4c0-1 .8-1.8 1.8-1.8h11.2c1 0 1.8.8 1.8 1.8v11.2c0 1-.8 1.8-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V6.4Z',
    extra:
      '<circle cx="12" cy="10.4" r="2.4" fill="none" stroke="COLOR" stroke-width="1.7"/><path d="M7.6 18.4c0-2.4 2-4 4.4-4s4.4 1.6 4.4 4" fill="none" stroke="COLOR" stroke-width="1.7" stroke-linecap="round"/>',
  },
  recolor: {
    d: 'M12 4.5c4.1 0 7.5 3.1 7.5 7 0 2.6-2 4-4.2 4h-1.6c-1 0-1.7.8-1.7 1.7 0 .9-.7 1.8-1.8 1.8-4 0-5.7-3.5-5.7-7.5 0-3.9 3.4-7 7.5-7Z',
    extra: '<circle cx="9.4" cy="10" r="1.2" fill="COLOR"/><circle cx="13.6" cy="8.6" r="1.2" fill="COLOR"/>',
  },
  mosaic: { d: 'M4.6 4.6h4.6v4.6H4.6zM14.8 4.6h4.6v4.6h-4.6zM9.2 9.2h5.6v5.6H9.2zM4.6 14.8h4.6v4.6H4.6zM14.8 14.8h4.6v4.6h-4.6z' },
  watermark: {
    d: 'M4.6 6.4c0-1 .8-1.8 1.8-1.8h11.2c1 0 1.8.8 1.8 1.8v11.2c0 1-.8 1.8-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V6.4Z',
    extra: '<path d="M8.4 15.6 15.6 8.4M12.6 15.6l3-3" fill="none" stroke="COLOR" stroke-width="1.7" stroke-linecap="round"/>',
  },
  article: { d: 'M5.6 5.6h12.8v12.8H5.6zM8.4 9.4h7.2M8.4 12.4h7.2M8.4 15.4h4.4' },
  dedup: { d: 'M4.6 7.4h9v9h-9zM10.4 4.6h9v9M6 19.4h9' },
  qrcode: { d: 'M4.6 4.6h5.6v5.6H4.6zM13.8 4.6h5.6v5.6h-5.6zM4.6 13.8h5.6v5.6H4.6zM13.8 13.8h2.2v2.2h-2.2zM17.2 17.2h2.2v2.2h-2.2z' },
  marker: {
    d: 'M14.2 4.6a2 2 0 0 1 2.8 0l2.4 2.4a2 2 0 0 1 0 2.8L10.6 18.6H6.2l-1-3.6L14.2 4.6Z',
    extra:
      '<path d="M12.4 6.6l5 5M4.6 20.4h6.8" fill="none" stroke="COLOR" stroke-width="1.8" stroke-linecap="round"/>',
  },
  magnifier: {
    d: 'M10.4 3.8a6.6 6.6 0 1 1 0 13.2 6.6 6.6 0 0 1 0-13.2ZM15.4 15.4 20.4 20.4',
    extra:
      '<path d="M7.6 10.4h5.6M10.4 7.6v5.6" fill="none" stroke="COLOR" stroke-width="1.6" stroke-linecap="round"/>',
  },
}

/** 取图标 data URI；color 支持任意 CSS 颜色 */
export function icon(name: string, color = '#111111'): string {
  const def = ICONS[name]
  if (!def) return ''
  const body = def.fill
    ? `<path d="${def.d}" fill="${color}"/>`
    : `<path d="${def.d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  const extra = (def.extra || '').replace(/COLOR/g, color)
  return svgToDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24">${body}${extra}</svg>`,
  )
}

export function hasIcon(name: string): boolean {
  return Boolean(ICONS[name])
}
