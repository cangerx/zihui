import pptxgen from 'pptxgenjs'
import { existsSync } from 'fs'
import type { ExtractedSlide, ExtractedElement } from './types'

// 可编辑 PPTX 导出 = "受控模板合规 DOM → 离屏抽取度量 → pptxgenjs 确定性重建"。
// 本文件含两半：
//   1) buildPptxFromExtracted: 纯 Node, 把抽取度量装配成真·可编辑 .pptx (可单测)。
//   2) EXTRACT_SCRIPT: 浏览器侧脚本字符串, 由 offscreen-renderer 经 executeJavaScript 注入,
//      读 getComputedStyle/getBoundingClientRect 产出 ExtractedElement[] (需 DOM, 不在 Node 单测)。

type Pptx = InstanceType<typeof pptxgen>
type Slide = ReturnType<Pptx['addSlide']>
type ShapeName = Parameters<Slide['addShape']>[0]

const PX_PER_IN = 96
const PT_PER_PX = 0.75
const inch = (px: number): number => px / PX_PER_IN
const ptOf = (px: number): number => px * PT_PER_PX

/** 把抽取的逐页度量装配成可编辑 .pptx (LAYOUT_WIDE 13.333x7.5in)。 */
export async function buildPptxFromExtracted(slides: ExtractedSlide[]): Promise<Buffer> {
  const pptx = new pptxgen()
  pptx.defineLayout({ name: 'DECK', width: 13.333, height: 7.5 })
  pptx.layout = 'DECK'
  const rect: ShapeName = pptx.ShapeType.rect
  for (const slide of slides) {
    const s = pptx.addSlide()
    // 整页背景色(来自受控模板 [data-ir-root] 的 computed background)。
    if (slide.background) s.background = { color: slide.background }
    for (const el of slide.elements) addElement(s, el, rect)
  }
  const out = await pptx.write({ outputType: 'nodebuffer' })
  return out as Buffer
}

// 阴影 → pptxgenjs shadow 选项(移植 huashu, 偏移 pt→pt 直传)
function shadowOpt(sh: ExtractedElement['shadow']): any {
  if (!sh) return undefined
  return { type: sh.type, angle: sh.angle, blur: sh.blur, color: sh.color, offset: sh.offset, opacity: sh.opacity }
}

function addElement(s: Slide, el: ExtractedElement, rect: ShapeName): void {
  const x = inch(el.x)
  const y = inch(el.y)
  const w = inch(el.w)
  const h = inch(el.h)
  const rotate = el.rotation // pptxgenjs rotate 取 0-359 度

  if (el.role === 'image' && el.imagePath) {
    const p = el.imagePath
    if (p.startsWith('data:')) {
      s.addImage({ data: p, x, y, w, h, rotate })
      return
    }
    // local-file://img?p=<编码绝对路径>: deck 配图(Pixabay/生图/自绘SVG)的本地协议 url。
    // EXTRACT_SCRIPT 抽到的是原始 src 字符串, 需在 Node 侧还原真实文件路径才能嵌入 PPTX(否则退化灰块)。
    if (p.startsWith('local-file://')) {
      try {
        const fsPath = new URL(p).searchParams.get('p') || ''
        if (fsPath && existsSync(fsPath)) {
          s.addImage({ path: fsPath, x, y, w, h, rotate })
          return
        }
      } catch {
        /* url 解析失败 → 落到下方占位 */
      }
    }
    if (existsSync(p)) {
      s.addImage({ path: p, x, y, w, h, rotate })
      return
    }
    // 无效/占位图片路径: 退化为浅色占位形状, 不中断整套导出(健壮性)
    s.addShape(rect, { x, y, w, h, fill: { color: 'F2F2F2' }, line: { color: 'E0E0E0', width: 1 } })
    return
  }

  if (el.role === 'text' && (el.text || (el.runs && el.runs.length))) {
    // 共享的文本框级选项(对齐/行距/背景/边框/旋转/阴影/合并框 padding→margin)
    const frameOpts: any = {
      x,
      y,
      w,
      h,
      align: el.align ?? 'left',
      valign: 'top',
      lineSpacingMultiple: el.lineSpacingPct ? el.lineSpacingPct / 100 : undefined,
      fill: el.fill ? { color: el.fill } : undefined,
      line: el.lineColor ? { color: el.lineColor, width: el.lineWidthPt ?? 1 } : undefined,
      rectRadius: el.radiusPx ? inch(el.radiusPx) : undefined,
      rotate,
      shadow: shadowOpt(el.shadow),
      // ★ D16 字体回落最优解: 溢出自动收缩(OOXML normAutofit)。
      fit: 'shrink',
      wrap: true,
      margin: el.marginPt ?? 0
    }
    if (el.runs && el.runs.length) {
      // 多 run(内联混排 / data-pptx-merge 合并段): 一个文本框内多段 run, 真·可整段编辑
      const runs = el.runs.map((r) => ({
        text: r.text,
        options: {
          fontSize: r.fontSizePx ? ptOf(r.fontSizePx) : el.fontSizePx ? ptOf(el.fontSizePx) : 18,
          fontFace: r.fontFamily ?? el.fontFamily,
          bold: r.bold ?? false,
          italic: r.italic ?? false,
          underline: r.underline ? { style: 'sng' } : undefined,
          color: r.color ?? el.color ?? '000000',
          breakLine: r.breakLine ?? false
        }
      }))
      s.addText(runs as any, frameOpts)
      return
    }
    // 单 run
    s.addText(el.text!, {
      ...frameOpts,
      fontSize: el.fontSizePx ? ptOf(el.fontSizePx) : 18,
      fontFace: el.fontFamily,
      bold: el.bold ?? false,
      italic: el.italic ?? false,
      underline: el.underline ? { style: 'sng' } : undefined,
      color: el.color ?? '000000'
    })
    return
  }

  // shape: 纯色卡片/边框/圆角/阴影(背景与装饰走形状, 不承载文本)。
  s.addShape(rect, {
    x,
    y,
    w,
    h,
    fill: el.fill ? { color: el.fill } : undefined,
    line: el.lineColor ? { color: el.lineColor, width: el.lineWidthPt ?? 1 } : undefined,
    rectRadius: el.radiusPx ? inch(el.radiusPx) : undefined,
    rotate,
    shadow: shadowOpt(el.shadow)
  })
}

/**
 * 浏览器侧抽取脚本(字符串)。由 offscreen-renderer 经 webContents.executeJavaScript 注入执行,
 * 返回 { background, elements: ExtractedElement[] }(对齐 ExtractedSlide)。
 * 完整移植 huashu html2pptx 的 extractSlideData 翻译算法:
 *  - 遍历 [data-ir]/[data-ir-placeholder], 读 computedStyle/getBoundingClientRect, 归类 text|shape|image;
 *  - [data-pptx-merge] 容器 → 合并所有 p/h* 为单个可编辑文本框(多 run + 段末 breakLine + 容器 padding→margin);
 *  - 文本含内联 <b>/<i>/<u>/<span> → parseInlineFormatting 拆多 run(粗斜/颜色/字号混排);
 *  - getRotation: transform rotate()/matrix() + writing-mode 竖排 → 旋转角 + 90/270 宽高互换;
 *  - parseBoxShadow: box-shadow → 外阴影(角度/模糊/偏移/不透明度), 拒 inset。
 */
export const EXTRACT_SCRIPT = `(() => {
  var PT_PER_PX = 0.75;
  var TEXT_TAGS = new Set(['P','H1','H2','H3','H4','H5','H6','LI','SPAN']);
  var toHex = function(c) {
    if (!c) return undefined;
    var m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/i);
    if (!m) return undefined;
    var h = function(n){ return Number(n).toString(16).padStart(2, '0'); };
    return (h(m[1]) + h(m[2]) + h(m[3])).toUpperCase();
  };
  var alphaOf = function(c) {
    if (!c) return undefined;
    var m = c.match(/rgba\\([^,]+,[^,]+,[^,]+,\\s*([\\d.]+)\\)/i);
    if (!m) return undefined;
    var a = parseFloat(m[1]);
    return (a >= 0 && a < 1) ? Math.round((1 - a) * 100) : undefined; // pptxgenjs transparency = 100-不透明%
  };
  // CSS text-transform → 文本变换(getComputedStyle 不会替换 textContent, 须导出端自己变换)
  var applyTransform = function(text, tt) {
    if (!tt || tt === 'none') return text;
    if (tt === 'uppercase') return text.toUpperCase();
    if (tt === 'lowercase') return text.toLowerCase();
    if (tt === 'capitalize') return text.replace(/\\b\\w/g, function(c){ return c.toUpperCase(); });
    return text;
  };
  var isTransparent = function(c){ return !c || c === 'transparent' || /rgba\\(\\s*0,\\s*0,\\s*0,\\s*0\\s*\\)/.test(c); };
  var ptPx = function(v){ return Math.round((parseFloat(v) || 0) * PT_PER_PX * 100) / 100; };

  // --- 旋转(transform rotate/matrix + writing-mode) ---
  var getRotation = function(transform, writingMode) {
    var angle = 0;
    if (writingMode === 'vertical-rl') angle = 90;
    else if (writingMode === 'vertical-lr') angle = 270;
    if (transform && transform !== 'none') {
      var rm = transform.match(/rotate\\((-?\\d+(?:\\.\\d+)?)deg\\)/);
      if (rm) angle += parseFloat(rm[1]);
      else {
        var mm = transform.match(/matrix\\(([^)]+)\\)/);
        if (mm) { var v = mm[1].split(',').map(parseFloat); angle += Math.round(Math.atan2(v[1], v[0]) * 180 / Math.PI); }
      }
    }
    angle = angle % 360; if (angle < 0) angle += 360;
    return angle === 0 ? undefined : angle;
  };

  // --- 阴影(box-shadow → 外阴影; 拒 inset) ---
  var parseShadow = function(boxShadow) {
    if (!boxShadow || boxShadow === 'none') return undefined;
    if (/inset/.test(boxShadow)) return undefined;
    var colorMatch = boxShadow.match(/rgba?\\([^)]+\\)/);
    var parts = boxShadow.match(/([-\\d.]+)(px|pt)/g);
    if (!parts || parts.length < 2) return undefined;
    var ox = parseFloat(parts[0]), oy = parseFloat(parts[1]);
    var blur = parts.length > 2 ? parseFloat(parts[2]) : 0;
    var ang = 0;
    if (ox !== 0 || oy !== 0) { ang = Math.atan2(oy, ox) * 180 / Math.PI; if (ang < 0) ang += 360; }
    var offset = Math.sqrt(ox*ox + oy*oy) * PT_PER_PX;
    var opacity = 0.5;
    if (colorMatch) { var om = colorMatch[0].match(/[\\d.]+\\)$/); if (om) opacity = parseFloat(om[0].replace(')', '')); }
    return { type: 'outer', angle: Math.round(ang), blur: blur * PT_PER_PX, color: colorMatch ? (toHex(colorMatch[0]) || '000000') : '000000', offset: offset, opacity: opacity };
  };

  // --- 内联混排 → 多 run(递归 <b>/<i>/<u>/<span>) ---
  var parseInline = function(element, baseOptions, runs) {
    var prevIsText = false;
    Array.prototype.forEach.call(element.childNodes, function(node) {
      var isText = node.nodeType === 3 || node.tagName === 'BR';
      if (isText) {
        var t = node.tagName === 'BR' ? '\\n' : (node.textContent || '').replace(/\\s+/g, ' ');
        var prev = runs[runs.length - 1];
        if (prevIsText && prev) prev.text += t;
        else runs.push(Object.assign({ text: t }, baseOptions));
      } else if (node.nodeType === 1 && (node.textContent || '').trim()) {
        var opt = Object.assign({}, baseOptions);
        var tag = node.tagName;
        if (tag === 'SPAN' || tag === 'B' || tag === 'STRONG' || tag === 'I' || tag === 'EM' || tag === 'U') {
          var c = getComputedStyle(node);
          if ((parseInt(c.fontWeight, 10) || 400) >= 600) opt.bold = true;
          if (c.fontStyle === 'italic') opt.italic = true;
          if (c.textDecorationLine && c.textDecorationLine.indexOf('underline') >= 0) opt.underline = true;
          if (c.color && !isTransparent(c.color)) opt.color = toHex(c.color);
          if (c.fontSize) opt.fontSizePx = parseFloat(c.fontSize);
          parseInline(node, opt, runs);
        }
      }
      prevIsText = isText;
    });
    if (runs.length > 0) { runs[0].text = runs[0].text.replace(/^\\s+/, ''); runs[runs.length-1].text = runs[runs.length-1].text.replace(/\\s+$/, ''); }
    return runs.filter(function(r){ return r.text.length > 0; });
  };
  // 元素有内联格式子标签才走多 run(否则单 run, 省开销)
  var hasInlineTags = function(el){ return !!el.querySelector('b,strong,i,em,u,span,br'); };

  var root = document.querySelector('[data-ir-root]') || document.body;
  var rb = root.getBoundingClientRect();
  var rootBgRaw = getComputedStyle(root).backgroundColor;
  var rootBg = isTransparent(rootBgRaw) ? undefined : toHex(rootBgRaw);
  var out = [];
  var processed = new Set();

  // 先处理 data-pptx-merge 容器(合并其 p/h* 为单个文本框), 并标记其后代已处理
  Array.prototype.forEach.call(document.querySelectorAll('[data-pptx-merge]'), function(el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    var cs = getComputedStyle(el);
    var texts = Array.prototype.slice.call(el.querySelectorAll('p,h1,h2,h3,h4,h5,h6'));
    if (texts.length === 0) return;
    texts.forEach(function(t){ processed.add(t); });
    processed.add(el);
    // 容器背景/边框 → 形状
    var fill = isTransparent(cs.backgroundColor) ? undefined : toHex(cs.backgroundColor);
    var hasBorder = parseFloat(cs.borderTopWidth) > 0 && !isTransparent(cs.borderTopColor);
    if (fill || hasBorder) {
      out.push({ role: 'shape', x: r.left-rb.left, y: r.top-rb.top, w: r.width, h: r.height,
        fill: fill, lineColor: hasBorder ? toHex(cs.borderTopColor) : undefined,
        lineWidthPt: hasBorder ? Math.max(1, Math.round(parseFloat(cs.borderTopWidth)*PT_PER_PX)) : undefined,
        radiusPx: parseFloat(cs.borderTopLeftRadius) || undefined, shadow: parseShadow(cs.boxShadow) });
    }
    // 每段 → 一个 run(段末 breakLine), 保留 per-段 字号/色/粗斜
    var first = getComputedStyle(texts[0]);
    var runs = [];
    texts.forEach(function(te, i) {
      var tc = getComputedStyle(te);
      runs.push({ text: applyTransform((te.textContent || '').trim(), tc.textTransform),
        fontSizePx: parseFloat(tc.fontSize) || undefined,
        color: toHex(tc.color),
        bold: (parseInt(tc.fontWeight,10) || 400) >= 600,
        italic: tc.fontStyle === 'italic',
        underline: !!tc.textDecorationLine && tc.textDecorationLine.indexOf('underline') >= 0,
        breakLine: i < texts.length - 1 });
    });
    out.push({ role: 'text', x: r.left-rb.left, y: r.top-rb.top, w: r.width, h: r.height,
      runs: runs,
      fontSizePx: parseFloat(first.fontSize) || 18,
      fontFamily: (first.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
      color: toHex(first.color),
      align: ['left','center','right'].indexOf(first.textAlign) >= 0 ? first.textAlign : 'left',
      lineSpacingPct: first.lineHeight && first.lineHeight.endsWith('px') && parseFloat(first.fontSize)
        ? Math.round((parseFloat(first.lineHeight)/parseFloat(first.fontSize))*100) : undefined,
      marginPt: [ptPx(cs.paddingLeft), ptPx(cs.paddingRight), ptPx(cs.paddingBottom), ptPx(cs.paddingTop)] });
  });

  var nodes = document.querySelectorAll('[data-ir],[data-ir-placeholder]');
  Array.prototype.forEach.call(nodes, function(el) {
    if (processed.has(el)) return;
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var rotation = getRotation(cs.transform, cs.writingMode);
    var base = { x: r.left - rb.left, y: r.top - rb.top, w: r.width, h: r.height };
    // 旋转: getBoundingClientRect 给的是【旋转后外包盒】尺寸, 但 PowerPoint 对【未旋转盒】应用旋转,
    // 须换回未旋转尺寸(对齐 huashu getPositionAndSize)。
    if (rotation === 90 || rotation === 270) {
      // 90/270: 宽高互换
      var cx = base.x + base.w/2, cy = base.y + base.h/2;
      base = { x: cx - base.h/2, y: cy - base.w/2, w: base.h, h: base.w };
    } else if (rotation) {
      // 任意角度: 用元素固有 offsetWidth/Height(未旋转尺寸), 以中心定位
      var ocx = base.x + base.w/2, ocy = base.y + base.h/2;
      var ow = el.offsetWidth || base.w, oh = el.offsetHeight || base.h;
      base = { x: ocx - ow/2, y: ocy - oh/2, w: ow, h: oh };
    }
    if (rotation) base.rotation = rotation;
    if (el.tagName === 'IMG') {
      out.push(Object.assign({ role: 'image', imagePath: el.getAttribute('src') || '' }, base));
      return;
    }
    var text = applyTransform((el.textContent || '').trim(), cs.textTransform);
    if (TEXT_TAGS.has(el.tagName) && text) {
      var rec = Object.assign({
        role: 'text', text: text,
        fontSizePx: parseFloat(cs.fontSize) || 18,
        fontFamily: (cs.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
        bold: (parseInt(cs.fontWeight, 10) || 400) >= 600,
        italic: cs.fontStyle === 'italic',
        underline: !!cs.textDecorationLine && cs.textDecorationLine.indexOf('underline') >= 0,
        color: toHex(cs.color),
        align: ['left','center','right'].indexOf(cs.textAlign) >= 0 ? cs.textAlign : 'left',
        lineSpacingPct: cs.lineHeight && cs.lineHeight.endsWith('px') && parseFloat(cs.fontSize)
          ? Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)) * 100) : undefined
      }, base);
      // 含内联格式子标签 → 拆多 run(粗斜/颜色/字号混排)
      if (hasInlineTags(el)) {
        var runs = parseInline(el, {}, []);
        if (runs.length > 1 || (runs.length === 1 && (runs[0].bold || runs[0].italic || runs[0].underline || runs[0].color || runs[0].fontSizePx))) {
          rec.runs = runs;
        }
      }
      out.push(rec);
      return;
    }
    var fill = isTransparent(cs.backgroundColor) ? undefined : toHex(cs.backgroundColor);
    var hasBorder = parseFloat(cs.borderTopWidth) > 0 && !isTransparent(cs.borderTopColor);
    var shadow = parseShadow(cs.boxShadow);
    if (fill || hasBorder || shadow || el.hasAttribute('data-ir-placeholder')) {
      out.push(Object.assign({
        role: 'shape', fill: fill,
        lineColor: hasBorder ? toHex(cs.borderTopColor) : undefined,
        lineWidthPt: hasBorder ? Math.max(1, Math.round(parseFloat(cs.borderTopWidth) * PT_PER_PX)) : undefined,
        radiusPx: parseFloat(cs.borderTopLeftRadius) || undefined,
        shadow: shadow
      }, base));
    }
  });
  return { background: rootBg, elements: out };
})()`
