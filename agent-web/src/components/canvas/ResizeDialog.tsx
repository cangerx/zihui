"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { X, Lock, Unlock, Loader2, Scaling, RotateCcw } from "lucide-react";

const PRESETS = [
  { label: "1:1", w: 1024, h: 1024 },
  { label: "4:3", w: 1024, h: 768 },
  { label: "3:4", w: 768, h: 1024 },
  { label: "16:9", w: 1024, h: 576 },
  { label: "9:16", w: 576, h: 1024 },
];

function snapTo16(v: number) { return Math.round(v / 16) * 16 || 16; }

export interface ResizeDialogProps {
  src: string;
  originalWidth: number;
  originalHeight: number;
  onSubmit: (width: number, height: number) => void;
  onClose: () => void;
  loading?: boolean;
}

export default function ResizeDialog({
  src,
  originalWidth,
  originalHeight,
  onSubmit,
  onClose,
  loading,
}: ResizeDialogProps) {
  const [width, setWidth] = useState(snapTo16(originalWidth));
  const [height, setHeight] = useState(snapTo16(originalHeight));
  const [lockRatio, setLockRatio] = useState(true);
  const aspectRatio = originalWidth / originalHeight;

  const handleWidthChange = useCallback((w: number) => {
    const snapped = snapTo16(Math.max(64, w));
    setWidth(snapped);
    if (lockRatio) setHeight(snapTo16(snapped / aspectRatio));
  }, [lockRatio, aspectRatio]);

  const handleHeightChange = useCallback((h: number) => {
    const snapped = snapTo16(Math.max(64, h));
    setHeight(snapped);
    if (lockRatio) setWidth(snapTo16(snapped * aspectRatio));
  }, [lockRatio, aspectRatio]);

  const applyPreset = useCallback((w: number, h: number) => {
    setWidth(snapTo16(w));
    setHeight(snapTo16(h));
  }, []);

  const resetToOriginal = useCallback(() => {
    setWidth(snapTo16(originalWidth));
    setHeight(snapTo16(originalHeight));
  }, [originalWidth, originalHeight]);

  const estimatedSizeKB = useMemo(() => {
    return Math.round((width * height * 4) / 1024);
  }, [width, height]);

  const isOriginal = width === snapTo16(originalWidth) && height === snapTo16(originalHeight);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[440px] max-w-[90vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <Scaling size={16} className="text-violet-500" />
            <span className="text-sm font-semibold text-neutral-900 dark:text-white">调整尺寸</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
            <X size={16} className="text-neutral-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex justify-center">
            <img src={src} alt="" className="max-h-32 rounded-lg shadow-sm object-contain" />
          </div>

          <p className="text-center text-xs text-neutral-400">
            原始尺寸: {originalWidth} × {originalHeight} px
          </p>

          <div className="flex items-center gap-3 justify-center">
            <div className="space-y-1">
              <label className="block text-[10px] text-neutral-400 text-center">宽度</label>
              <input
                type="number"
                value={width}
                onChange={(e) => handleWidthChange(parseInt(e.target.value) || 64)}
                onBlur={() => setWidth(snapTo16(width))}
                step={16}
                className="w-24 px-2.5 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60 text-sm text-center text-neutral-900 dark:text-white focus:outline-none focus:border-violet-400"
              />
            </div>
            <button
              onClick={() => setLockRatio(!lockRatio)}
              className="mt-4 p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
              title={lockRatio ? "解锁比例" : "锁定比例"}
            >
              {lockRatio ? <Lock size={14} className="text-violet-500" /> : <Unlock size={14} className="text-neutral-400" />}
            </button>
            <div className="space-y-1">
              <label className="block text-[10px] text-neutral-400 text-center">高度</label>
              <input
                type="number"
                value={height}
                onChange={(e) => handleHeightChange(parseInt(e.target.value) || 64)}
                onBlur={() => setHeight(snapTo16(height))}
                step={16}
                className="w-24 px-2.5 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60 text-sm text-center text-neutral-900 dark:text-white focus:outline-none focus:border-violet-400"
              />
            </div>
          </div>

          <div className="flex items-center justify-center gap-2">
            <p className="text-[10px] text-neutral-400">
              {width % 16 !== 0 || height % 16 !== 0 ? (
                <span className="text-amber-500">尺寸将自动对齐到 16 的倍数</span>
              ) : (
                <span>预估大小: ~{estimatedSizeKB > 1024 ? `${(estimatedSizeKB / 1024).toFixed(1)} MB` : `${estimatedSizeKB} KB`}</span>
              )}
            </p>
          </div>

          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.w, p.h)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  width === snapTo16(p.w) && height === snapTo16(p.h)
                    ? "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
                    : "bg-neutral-50 text-neutral-500 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
                }`}
              >
                {p.label}
              </button>
            ))}
            {!isOriginal && (
              <button
                onClick={resetToOriginal}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-neutral-50 text-neutral-500 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 transition-colors flex items-center gap-1"
              >
                <RotateCcw size={10} /> 原始
              </button>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onSubmit(snapTo16(width), snapTo16(height))}
            disabled={loading || isOriginal}
            className="px-4 py-1.5 rounded-lg bg-violet-500 text-white text-xs font-medium hover:bg-violet-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {loading ? <><Loader2 size={13} className="animate-spin" /> 处理中...</> : "应用"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
