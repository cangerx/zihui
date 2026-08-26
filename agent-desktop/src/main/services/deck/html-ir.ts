import type { SlideTemplate, SlideData, ThemeTokens } from './types'
import { themeToCssVars } from './theme'

// 画布物理尺寸：1280x720 (16:9), 对齐 pptxgenjs LAYOUT_WIDE(13.333x7.5in @96dpi)。
export const CANVAS_W = 1280
export const CANVAS_H = 720

const BASE_CSS = `
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;background:var(--bg);
  -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;}
`.trim()

// 通用入场动画运行时(对齐 huashu Stage 时钟 __seek): 不改任何模板, 在壳层为所有 [data-ir] 元素
// 按出现顺序错峰做"淡入 + 轻微上移"。视频导出时 renderFrames 逐帧调 window.__seek(t) 驱动 → 真动画(非静态翻页)。
// __seek(t): t 为秒。t>=总时长时定格在终态。静态预览(不调 __seek)时 onload 直接播放到终态。
const ANIM_RUNTIME = `
(function(){
  var els = Array.prototype.slice.call(document.querySelectorAll('[data-ir]'));
  var STAGGER = 0.12, DUR = 0.5; // 每元素间隔 / 单元素时长(秒)
  window.__animDuration = (els.length>0 ? (els.length-1)*STAGGER : 0) + DUR + 0.3;
  els.forEach(function(el, i){ el.style.willChange='opacity,transform'; });
  var ease = function(x){ return 1 - Math.pow(1-x, 3); }; // easeOutCubic
  window.__seek = function(t){
    els.forEach(function(el, i){
      var start = i*STAGGER;
      var p = Math.max(0, Math.min(1, (t - start)/DUR));
      var e = ease(p);
      el.style.opacity = String(e);
      el.style.transform = 'translateY(' + ((1-e)*18).toFixed(2) + 'px)';
    });
  };
  // 默认定格终态: 静态渲染(预览/PNG/PDF/PPTX抽取)看到完整页面, 不受动画影响。
  // 视频导出时 renderFrames 会从 t=0 起逐帧调 __seek 覆盖, 自然播出入场动画(幂等, 无需额外标志)。
  window.__seek(window.__animDuration);
})();
`.trim()

/**
 * 把一页(模板 + 数据 + 主题)渲染为独立 standalone HTML 页面。
 * 每页一个独立文档(规避 shadow DOM / @page 分页坑, 见 spec 6.1)。
 * 离屏渲染器 loadURL/srcdoc 后等 window.__deckReady + fonts.ready 再量度。
 * 注入入场动画运行时(window.__seek): 静态渲染定格终态(不影响布局/导出), 视频逐帧驱动出真动画。
 */
export function renderSlideHtml(tpl: SlideTemplate, data: SlideData, theme: ThemeTokens): string {
  const body = tpl.render(data, theme)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<style>:root{ ${themeToCssVars(theme)} }
${BASE_CSS}</style></head>
<body>
${body}
<script>${ANIM_RUNTIME}</script>
<script>window.__deckReady = true;</script>
</body></html>`
}

/** 多页拼接的预览索引(仅用于 renderer iframe 预览; 导出时每页独立渲染)。 */
export function renderDeckIndexHtml(pagesHtml: string[]): string {
  const frames = pagesHtml
    .map(
      (h, i) =>
        `<iframe title="slide-${i + 1}" srcdoc="${h.replace(/"/g, '&quot;')}" ` +
        `style="width:${CANVAS_W}px;height:${CANVAS_H}px;border:0;display:block;margin:0 auto 24px;box-shadow:0 8px 30px rgba(0,0,0,.12);"></iframe>`
    )
    .join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>body{margin:0;padding:32px;background:#ece9e3;}</style></head>
<body>${frames}</body></html>`
}
