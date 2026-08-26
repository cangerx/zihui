"use client";

import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { Maximize2, Download, Lock, Unlock, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import ImageUploader from "@/components/ui/image-uploader";
import { usePageTitle } from "@/hooks/use-page-title";

const PRESETS = [
  { label: "自定义", w: 0, h: 0 },
  { label: "微信头像", w: 640, h: 640 },
  { label: "朋友圈", w: 1080, h: 1080 },
  { label: "小红书封面", w: 1242, h: 1660 },
  { label: "抖音封面", w: 1080, h: 1920 },
  { label: "淘宝主图", w: 800, h: 800 },
  { label: "京东主图", w: 800, h: 800 },
  { label: "电商详情", w: 790, h: 1200 },
  { label: "公众号封面", w: 900, h: 383 },
  { label: "A4 打印", w: 2480, h: 3508 },
  { label: "壁纸 1080p", w: 1920, h: 1080 },
  { label: "壁纸 4K", w: 3840, h: 2160 },
];

export default function ResizePage() {
  usePageTitle("无损改尺寸");
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [origW, setOrigW] = useState(0);
  const [origH, setOrigH] = useState(0);
  const [targetW, setTargetW] = useState(0);
  const [targetH, setTargetH] = useState(0);
  const [lockRatio, setLockRatio] = useState(true);
  const [activePreset, setActivePreset] = useState("自定义");
  const imgRef = useRef<HTMLImageElement | null>(null);

  const handleFileSelect = (file: File, url: string) => {
    setUploadedFile(file);
    setPreviewUrl(url);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setOrigW(img.naturalWidth);
      setOrigH(img.naturalHeight);
      setTargetW(img.naturalWidth);
      setTargetH(img.naturalHeight);
      setActivePreset("自定义");
    };
    img.src = url;
  };

  const handleWidthChange = useCallback(
    (w: number) => {
      setTargetW(w);
      if (lockRatio && origW > 0) {
        setTargetH(Math.round((w / origW) * origH));
      }
      setActivePreset("自定义");
    },
    [lockRatio, origW, origH]
  );

  const handleHeightChange = useCallback(
    (h: number) => {
      setTargetH(h);
      if (lockRatio && origH > 0) {
        setTargetW(Math.round((h / origH) * origW));
      }
      setActivePreset("自定义");
    },
    [lockRatio, origW, origH]
  );

  const handlePreset = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      setActivePreset(preset.label);
      if (preset.w === 0) {
        setTargetW(origW);
        setTargetH(origH);
      } else {
        setTargetW(preset.w);
        setTargetH(preset.h);
      }
    },
    [origW, origH]
  );

  const handleDownload = useCallback(() => {
    if (!imgRef.current || targetW <= 0 || targetH <= 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgRef.current, 0, 0, targetW, targetH);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resize-${targetW}x${targetH}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [targetW, targetH]);

  const handleReset = () => {
    setPreviewUrl("");
    setUploadedFile(null);
    setOrigW(0);
    setOrigH(0);
    setTargetW(0);
    setTargetH(0);
    setActivePreset("自定义");
  };

  const scalePercent = origW > 0 ? Math.round((targetW / origW) * 100) : 100;

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
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-indigo-500 flex items-center justify-center shadow-md shadow-indigo-200/50">
            <Maximize2 size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">无损改尺寸</h1>
            <p className="text-xs text-neutral-400">缩放图片，清晰不失真</p>
          </div>
        </div>

        {previewUrl && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={handleReset} className="px-3 py-1.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors flex items-center gap-1.5">
              <RotateCcw size={14} /> 重新上传
            </button>
            <button
              onClick={handleDownload}
              disabled={targetW <= 0 || targetH <= 0}
              className="px-4 py-1.5 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <Download size={14} /> 下载 {targetW}x{targetH}
            </button>
          </div>
        )}
      </motion.div>

      {/* Content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden overflow-y-auto md:overflow-y-hidden">
        {previewUrl ? (
          <>
            {/* Image preview */}
            <div className="flex-1 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4 sm:p-6">
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                  <span className="px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800">
                    原图 {origW} x {origH}
                  </span>
                  <span className="text-neutral-300">→</span>
                  <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 font-medium">
                    {targetW} x {targetH} ({scalePercent}%)
                  </span>
                </div>
                <img
                  src={previewUrl}
                  alt=""
                  className="max-w-xl max-h-[65vh] rounded-xl shadow-lg"
                />
              </div>
            </div>

            {/* Right panel */}
            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="w-full md:w-[280px] border-t md:border-t-0 md:border-l border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 md:overflow-y-auto p-4 sm:p-5 space-y-6 shrink-0"
            >
              {/* Size inputs */}
              <div>
                <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">目标尺寸</h3>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-neutral-400 mb-1 block">宽 (px)</label>
                    <input
                      type="number"
                      value={targetW || ""}
                      onChange={(e) => handleWidthChange(parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm outline-none focus:border-indigo-400 transition-colors"
                    />
                  </div>
                  <button
                    onClick={() => setLockRatio(!lockRatio)}
                    className={cn(
                      "mt-4 p-2 rounded-lg transition-colors",
                      lockRatio ? "bg-indigo-50 text-indigo-600" : "bg-neutral-100 text-neutral-400"
                    )}
                    title={lockRatio ? "已锁定比例" : "未锁定比例"}
                  >
                    {lockRatio ? <Lock size={14} /> : <Unlock size={14} />}
                  </button>
                  <div className="flex-1">
                    <label className="text-[10px] text-neutral-400 mb-1 block">高 (px)</label>
                    <input
                      type="number"
                      value={targetH || ""}
                      onChange={(e) => handleHeightChange(parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm outline-none focus:border-indigo-400 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Presets */}
              <div>
                <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">常用尺寸</h3>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => handlePreset(p)}
                      className={cn(
                        "px-2.5 py-1.5 rounded-lg text-xs border transition-all",
                        activePreset === p.label
                          ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-400"
                          : "border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                      )}
                    >
                      {p.label}
                      {p.w > 0 && <span className="text-[10px] text-neutral-400 ml-1">{p.w}x{p.h}</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick scale */}
              <div>
                <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">快速缩放</h3>
                <div className="flex gap-1.5">
                  {[25, 50, 75, 100, 150, 200].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => {
                        const w = Math.round((origW * pct) / 100);
                        const h = Math.round((origH * pct) / 100);
                        setTargetW(w);
                        setTargetH(h);
                        setActivePreset("自定义");
                      }}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg text-xs border transition-all text-center",
                        scalePercent === pct
                          ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium"
                          : "border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-50"
                      )}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <ImageUploader
              onFileSelect={handleFileSelect}
              accentColor="indigo"
              hint="上传图片，无损改尺寸"
              subHint="支持自定义尺寸和社交媒体预设"
              className="max-w-md w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
