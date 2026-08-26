"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Grid3X3, X } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE_LONG_SIDE = 1792;

function calcOutputSize(w: number, h: number): string {
  if (w <= 0 || h <= 0) return "";
  const max = Math.max(w, h);
  const scale = BASE_LONG_SIDE / max;
  const pw = Math.round(w * scale);
  const ph = Math.round(h * scale);
  // Round to nearest 64 for model compatibility
  const rw = Math.round(pw / 64) * 64;
  const rh = Math.round(ph / 64) * 64;
  return `${rw}×${rh}`;
}

interface Props {
  onConfirm: (ratio: string) => void;
  className?: string;
  isActive?: boolean;
}

export default function CustomRatioPopover({ onConfirm, className, isActive }: Props) {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(1);
  const [right, setRight] = useState(1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const preview = calcOutputSize(left, right);
  const valid = left >= 1 && left <= 99 && right >= 1 && right <= 99;

  const handleConfirm = () => {
    if (!valid) return;
    onConfirm(`${left}:${right}`);
    setOpen(false);
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "p-1.5 rounded-lg text-[11px] transition-all border border-dashed",
          isActive
            ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 border-transparent shadow-sm"
            : "bg-neutral-50 dark:bg-neutral-800 text-neutral-400 border-neutral-300 dark:border-neutral-600 hover:border-neutral-400 hover:text-neutral-600"
        )}
        title="自定义比例"
      >
        <Grid3X3 size={14} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
              <span className="text-[12px] font-medium text-neutral-700 dark:text-neutral-300">自定义比例</span>
              <button onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400">
                <X size={12} />
              </button>
            </div>
            {/* Inputs */}
            <div className="px-3 pb-2">
              <div className="flex items-center gap-2 justify-center">
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={left}
                  onChange={(e) => setLeft(Math.min(99, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-16 px-2 py-1.5 rounded-lg text-center text-sm font-medium bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 outline-none focus:border-neutral-400 text-neutral-800 dark:text-neutral-200"
                  onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
                />
                <span className="text-sm font-bold text-neutral-400">:</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={right}
                  onChange={(e) => setRight(Math.min(99, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-16 px-2 py-1.5 rounded-lg text-center text-sm font-medium bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 outline-none focus:border-neutral-400 text-neutral-800 dark:text-neutral-200"
                  onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
                />
              </div>
              {/* Preview */}
              {valid && preview && (
                <p className="text-center text-[11px] text-neutral-400 mt-1.5">预计输出 {preview}</p>
              )}
            </div>
            {/* Actions */}
            <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/50">
              <button onClick={() => setOpen(false)} className="px-3 py-1 rounded-lg text-[12px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">取消</button>
              <button onClick={handleConfirm} disabled={!valid}
                className={cn("px-3 py-1 rounded-lg text-[12px] font-medium transition-colors", valid ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-700" : "bg-neutral-200 text-neutral-400 cursor-not-allowed")}>
                确认
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
