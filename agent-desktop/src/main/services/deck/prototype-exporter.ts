import { CANVAS_W, CANVAS_H } from './html-ir'

// 可点击原型(能力9): 把整套 deck 的逐页 HTML 打包成单个自包含 HTML 文件。
// 每页内联(图片已是 data: / 内联), 无外部依赖 → 可离线双击打开、可分发。
// 导航: 左右键/点击翻页 + 底部缩略图跳转 + 可选热区(slide HTML 内带 data-goto 的元素跳到指定页)。
// 纯字符串拼装, 无 Electron 依赖, 可单测。

export interface PrototypeSlide {
  /** 该页完整 standalone HTML(renderSlideHtml 产物) */
  html: string
  title?: string
}

export interface PrototypeOptions {
  deckTitle?: string
}

// 把每页 standalone HTML 塞进 srcdoc(转义引号); iframe 隔离各页样式/脚本, 规避全局污染。
function frameFor(html: string, idx: number): string {
  const srcdoc = html.replace(/"/g, '&quot;')
  return (
    `<iframe class="page" data-page="${idx}" title="slide-${idx + 1}" ` +
    `sandbox="allow-same-origin allow-scripts" srcdoc="${srcdoc}"></iframe>`
  )
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 构建自包含可点击原型 HTML。
 * 热区约定: 任意 slide 元素带 data-goto="N"(1-based 页码)时, 点击跳到该页(由壳层捕获 iframe 内点击实现)。
 */
export function buildPrototypeHtml(slides: PrototypeSlide[], opts: PrototypeOptions = {}): string {
  const title = opts.deckTitle || 'Deck 原型'
  const n = slides.length
  const frames = slides.map((s, i) => frameFor(s.html, i)).join('\n')
  const thumbs = slides
    .map(
      (s, i) =>
        `<button class="thumb" data-thumb="${i}" title="${esc(s.title || '第 ' + (i + 1) + ' 页')}">${i + 1}</button>`
    )
    .join('')

  // 壳层样式: 居中画布等比缩放, 仅阴影无遮罩(对齐设计铁律)。无 emoji, 简洁专业。
  const shellCss = `
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:100%;height:100%;background:#1a1c20;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;overflow:hidden;}
#stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
#canvas{position:relative;width:${CANVAS_W}px;height:${CANVAS_H}px;transform-origin:center center;box-shadow:0 12px 48px rgba(0,0,0,.5);background:#fff;}
.page{position:absolute;inset:0;width:${CANVAS_W}px;height:${CANVAS_H}px;border:0;display:none;}
.page.active{display:block;}
#bar{position:absolute;left:0;right:0;bottom:0;height:56px;display:flex;align-items:center;gap:12px;padding:0 16px;background:rgba(20,22,26,.92);color:#e8eaed;font-size:13px;}
#bar .nav{padding:6px 14px;border:1px solid #3a3e45;border-radius:8px;background:#23262c;color:#e8eaed;cursor:pointer;}
#bar .nav:hover{background:#2c2f36;}
#bar .nav:disabled{opacity:.4;cursor:default;}
#counter{min-width:64px;text-align:center;}
#thumbs{flex:1;display:flex;gap:6px;overflow-x:auto;align-items:center;}
.thumb{flex:0 0 auto;width:30px;height:30px;border:1px solid #3a3e45;border-radius:6px;background:#23262c;color:#aeb4bd;cursor:pointer;font-size:12px;}
.thumb.active{background:#3b82f6;color:#fff;border-color:#3b82f6;}
#title{font-weight:600;white-space:nowrap;}
`.trim()

  const shellScript = `
(function(){
  var n = ${n};
  var cur = 0;
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var thumbs = Array.prototype.slice.call(document.querySelectorAll('.thumb'));
  var prev = document.getElementById('prev');
  var next = document.getElementById('next');
  var counter = document.getElementById('counter');
  function fit(){
    var stage = document.getElementById('stage');
    var pad = 40, barH = 56;
    var sw = stage.clientWidth - pad, sh = stage.clientHeight - barH - pad;
    var scale = Math.min(sw / ${CANVAS_W}, sh / ${CANVAS_H});
    document.getElementById('canvas').style.transform = 'scale(' + scale + ')';
  }
  function show(i){
    cur = Math.max(0, Math.min(n - 1, i));
    pages.forEach(function(p, k){ p.classList.toggle('active', k === cur); });
    thumbs.forEach(function(t, k){ t.classList.toggle('active', k === cur); });
    counter.textContent = (cur + 1) + ' / ' + n;
    prev.disabled = cur === 0; next.disabled = cur === n - 1;
  }
  prev.addEventListener('click', function(){ show(cur - 1); });
  next.addEventListener('click', function(){ show(cur + 1); });
  thumbs.forEach(function(t){ t.addEventListener('click', function(){ show(parseInt(t.getAttribute('data-thumb'), 10)); }); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { show(cur + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { show(cur - 1); e.preventDefault(); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(n - 1);
  });
  // 热区跳转: iframe 内带 data-goto 的元素点击 → 跳到目标页(同源 sandbox 可读取)
  pages.forEach(function(frame){
    frame.addEventListener('load', function(){
      try {
        var doc = frame.contentDocument;
        if (!doc) return;
        doc.addEventListener('click', function(ev){
          var el = ev.target;
          while (el && el !== doc.body) {
            var g = el.getAttribute && el.getAttribute('data-goto');
            if (g) { show(parseInt(g, 10) - 1); ev.preventDefault(); return; }
            el = el.parentNode;
          }
        });
      } catch (err) { /* 跨源等异常忽略 */ }
    });
  });
  window.addEventListener('resize', fit);
  fit(); show(0);
})();
`.trim()

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${shellCss}</style></head>
<body>
<div id="stage"><div id="canvas">
${frames}
</div></div>
<div id="bar">
  <span id="title">${esc(title)}</span>
  <button id="prev" class="nav">上一页</button>
  <span id="counter">1 / ${n}</span>
  <button id="next" class="nav">下一页</button>
  <div id="thumbs">${thumbs}</div>
</div>
<script>${shellScript}</script>
</body></html>`
}
