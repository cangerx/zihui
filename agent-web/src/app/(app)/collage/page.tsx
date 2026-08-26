"use client";

import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Combine, Download, Plus, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";

interface CollageImage {
  id: string;
  file: File;
  url: string;
}

const LAYOUTS = [
  { label: "2格横", cols: 2, rows: 1, slots: 2 },
  { label: "2格竖", cols: 1, rows: 2, slots: 2 },
  { label: "3格", cols: 3, rows: 1, slots: 3 },
  { label: "4格", cols: 2, rows: 2, slots: 4 },
  { label: "6格", cols: 3, rows: 2, slots: 6 },
  { label: "9格", cols: 3, rows: 3, slots: 9 },
];

const GAP_OPTIONS = [0, 4, 8, 12, 16];
const RADIUS_OPTIONS = [0, 4, 8, 12, 16];
const BG_COLORS = ["#ffffff", "#000000", "#f5f5f5", "#1a1a1a", "#fef3c7", "#dbeafe", "#fce7f3", "#d1fae5"];

export default function CollagePage() {
  usePageTitle("拼图");
  const [images, setImages] = useState<CollageImage[]>([]);
  const [layout, setLayout] = useState(LAYOUTS[3]);
  const [gap, setGap] = useState(8);
  const [radius, setRadius] = useState(8);
  const [bgColor, setBgColor] = useState("#ffffff");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const addImages = useCallback((files: FileList) => {
    const newImages: CollageImage[] = [];
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      newImages.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        url: URL.createObjectURL(file),
      });
    });
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.url);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const handleReset = () => {
    images.forEach((img) => URL.revokeObjectURL(img.url));
    setImages([]);
  };

  const handleExport = useCallback(async () => {
    const size = 1200;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    const { cols, rows } = layout;
    const totalGap = gap * (cols + 1);
    const totalGapV = gap * (rows + 1);
    const cellW = (size - totalGap) / cols;
    const cellH = (size - totalGapV) / rows;

    const loadImage = (url: string): Promise<HTMLImageElement> =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.src = url;
      });

    for (let i = 0; i < layout.slots; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gap + col * (cellW + gap);
      const y = gap + row * (cellH + gap);

      if (i < images.length) {
        const img = await loadImage(images[i].url);
        // Cover fit
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const cellRatio = cellW / cellH;
        let sw = img.naturalWidth;
        let sh = img.naturalHeight;
        let sx = 0;
        let sy = 0;
        if (imgRatio > cellRatio) {
          sw = img.naturalHeight * cellRatio;
          sx = (img.naturalWidth - sw) / 2;
        } else {
          sh = img.naturalWidth / cellRatio;
          sy = (img.naturalHeight - sh) / 2;
        }

        // Clip with rounded rect
        ctx.save();
        roundRect(ctx, x, y, cellW, cellH, radius);
        ctx.clip();
        ctx.drawImage(img, sx, sy, sw, sh, x, y, cellW, cellH);
        ctx.restore();
      } else {
        ctx.save();
        roundRect(ctx, x, y, cellW, cellH, radius);
        ctx.clip();
        ctx.fillStyle = "#e5e7eb";
        ctx.fillRect(x, y, cellW, cellH);
        ctx.restore();
      }
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `collage-${cols}x${rows}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [images, layout, gap, radius, bgColor]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-neutral-100 dark:border-neutral-800 glass shrink-0"
      >
        <div className="flex items-center gap-3">
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-violet-500 flex items-center justify-center shadow-md shadow-violet-200/50">
            <Combine size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">拼图</h1>
            <p className="text-xs text-neutral-400">1 秒拼出高级感</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {images.length > 0 && (
            <button onClick={handleReset} className="px-3 py-1.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors flex items-center gap-1.5">
              <RotateCcw size={14} /> 清空
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={images.length === 0}
            className="px-4 py-1.5 rounded-lg bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            <Download size={14} /> 导出拼图
          </button>
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden overflow-y-auto md:overflow-y-hidden">
        {/* Preview area */}
        <div className="flex-1 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4 sm:p-6">
          <div
            className="shadow-lg rounded-xl overflow-hidden"
            style={{ backgroundColor: bgColor, maxWidth: 480, width: "100%", aspectRatio: "1/1" }}
          >
            <div
              className="w-full h-full grid"
              style={{
                gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
                gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
                gap: `${gap}px`,
                padding: `${gap}px`,
              }}
            >
              {Array.from({ length: layout.slots }).map((_, i) => (
                <div
                  key={i}
                  className="relative overflow-hidden bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center"
                  style={{ borderRadius: `${radius}px` }}
                >
                  {images[i] ? (
                    <>
                      <img
                        src={images[i].url}
                        alt=""
                        className="w-full h-full object-cover"
                        style={{ borderRadius: `${radius}px` }}
                      />
                      <button
                        onClick={() => removeImage(images[i].id)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-full flex flex-col items-center justify-center text-neutral-400 hover:text-neutral-500 transition-colors"
                    >
                      <Plus size={20} />
                      <span className="text-[10px] mt-1">添加图片</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <motion.div
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full md:w-[260px] border-t md:border-t-0 md:border-l border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 md:overflow-y-auto p-4 sm:p-5 space-y-6 shrink-0"
        >
          {/* Add images button */}
          <div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2 rounded-lg border-2 border-dashed border-violet-300 text-violet-600 text-sm font-medium hover:bg-violet-50 transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> 添加图片
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addImages(e.target.files)}
            />
            {images.length > 0 && (
              <p className="text-xs text-neutral-400 mt-2 text-center">已添加 {images.length} 张</p>
            )}
          </div>

          {/* Layout */}
          <div>
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">布局</h3>
            <div className="grid grid-cols-3 gap-2">
              {LAYOUTS.map((l) => (
                <button
                  key={l.label}
                  onClick={() => setLayout(l)}
                  className={cn(
                    "py-2 rounded-lg text-xs border transition-all text-center",
                    layout.label === l.label
                      ? "bg-violet-50 border-violet-300 text-violet-700 font-medium dark:bg-violet-900/30 dark:border-violet-700 dark:text-violet-400"
                      : "border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-50"
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Gap */}
          <div>
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">间距</h3>
            <div className="flex gap-1.5">
              {GAP_OPTIONS.map((g) => (
                <button
                  key={g}
                  onClick={() => setGap(g)}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-xs border transition-all text-center",
                    gap === g
                      ? "bg-violet-50 border-violet-300 text-violet-700 font-medium"
                      : "border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-50"
                  )}
                >
                  {g}px
                </button>
              ))}
            </div>
          </div>

          {/* Radius */}
          <div>
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">圆角</h3>
            <div className="flex gap-1.5">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRadius(r)}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-xs border transition-all text-center",
                    radius === r
                      ? "bg-violet-50 border-violet-300 text-violet-700 font-medium"
                      : "border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-50"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Background */}
          <div>
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">背景颜色</h3>
            <div className="flex flex-wrap gap-2">
              {BG_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setBgColor(c)}
                  className={cn(
                    "w-8 h-8 rounded-lg border transition-all",
                    bgColor === c ? "ring-2 ring-violet-500 ring-offset-2" : "hover:ring-1 hover:ring-neutral-300"
                  )}
                  style={{ backgroundColor: c, borderColor: c === "#ffffff" ? "#e5e7eb" : "transparent" }}
                />
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
