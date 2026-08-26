"use client";

import { memo, useState, useRef, useEffect } from "react";
import { type NodeProps, NodeToolbar, NodeResizer, Position } from "@xyflow/react";
import { Loader2, Download, RotateCcw, Pencil, Trash2, Paintbrush, Scaling, Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadImage } from "@/lib/download";
import { useCanvasCallbacks } from "./CanvasContext";

export interface ImageNodeData {
  [key: string]: unknown;
  src: string;
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
  prompt?: string;
  genId?: number;
  displayWidth: number;
  displayHeight: number;
}

const btnCls = "p-1.5 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors";

function ImageNodeComponent({ id, data, selected }: NodeProps & { data: ImageNodeData }) {
  const { src, status, error, prompt, displayWidth, displayHeight } = data;
  const { onReGenerate, onEdit, onDelete, onRetry, onInpaint, onResize } = useCanvasCallbacks();
  const [imgLoaded, setImgLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const prevStatusRef = useRef(status);
  const [justCompleted, setJustCompleted] = useState(false);
  const [justFailed, setJustFailed] = useState(false);
  const progressRef = useRef(0);
  const [progress, setProgress] = useState(0);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Entrance animation
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Detect status transitions for animations
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if ((prev === "pending" || prev === "processing") && status === "completed") {
      setJustCompleted(true);
      const t = setTimeout(() => setJustCompleted(false), 1200);
      return () => clearTimeout(t);
    }
    if ((prev === "pending" || prev === "processing") && status === "failed") {
      setJustFailed(true);
      const t = setTimeout(() => setJustFailed(false), 800);
      return () => clearTimeout(t);
    }
  }, [status]);

  // Simulated progress bar for pending/processing
  useEffect(() => {
    if (status === "pending" || status === "processing") {
      progressRef.current = 0;
      setProgress(0);
      progressTimer.current = setInterval(() => {
        progressRef.current += Math.random() * 8 + 2;
        if (progressRef.current > 92) progressRef.current = 92;
        setProgress(progressRef.current);
      }, 600);
      return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
    }
    if (status === "completed" || status === "failed") {
      setProgress(100);
      const t = setTimeout(() => setProgress(0), 500);
      return () => clearTimeout(t);
    }
  }, [status]);

  return (
    <>
      <NodeToolbar isVisible={selected && status === "completed"} position={Position.Top} align="center" offset={8}>
        <div className="flex items-center gap-0.5 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm rounded-xl shadow-lg border border-neutral-200/60 dark:border-neutral-700/60 p-0.5">
          <button onClick={() => src && downloadImage(src, `generate-${id}.png`)} className={btnCls} title="下载">
            <Download size={13} />
          </button>
          <button onClick={() => onRetry?.(id)} className={btnCls} title="重新生成">
            <RotateCcw size={13} />
          </button>
          <button onClick={() => onEdit?.(prompt || "")} className={btnCls} title="编辑提示词">
            <Pencil size={13} />
          </button>
          {onInpaint && (
            <button onClick={() => src && onInpaint(id, src)} className={btnCls} title="涂抹编辑">
              <Paintbrush size={13} />
            </button>
          )}
          {onResize && (
            <button onClick={() => src && onResize(id, src)} className={btnCls} title="调整尺寸">
              <Scaling size={13} />
            </button>
          )}
          <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />
          <button
            onClick={() => onDelete?.(id)}
            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </NodeToolbar>

      {selected && status === "completed" && (
        <NodeResizer
          minWidth={100}
          minHeight={80}
          isVisible={selected}
          lineClassName="!border-violet-400"
          handleClassName="!w-2.5 !h-2.5 !bg-violet-500 !border-white !border-2 !rounded-md"
          keepAspectRatio
        />
      )}

      <div
        style={{
          width: displayWidth,
          transform: mounted ? "scale(1) translateY(0)" : "scale(0.85) translateY(12px)",
          opacity: mounted ? 1 : 0,
          transition: "transform 0.4s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease-out",
        }}
        className={cn(
          "rounded-xl overflow-hidden bg-white dark:bg-neutral-900 shadow-md select-none",
          "transition-shadow duration-300",
          selected && "ring-2 ring-violet-500 shadow-lg shadow-violet-200/30",
          justCompleted && "ring-2 ring-green-400 shadow-lg shadow-green-200/40",
          justFailed && "animate-[node-shake_0.5s_ease-in-out]",
        )}
      >
        {/* Progress bar for pending/processing */}
        {(status === "pending" || status === "processing") && (
          <div className="absolute top-0 left-0 right-0 h-0.5 z-10 bg-violet-100/50 overflow-hidden rounded-t-xl">
            <div
              className="h-full bg-violet-500 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {status === "completed" && src ? (
          <div className="relative overflow-hidden">
            {!imgLoaded && (
              <div
                className="absolute inset-0 rounded-t-xl overflow-hidden"
                style={{ height: displayHeight }}
              >
                <div className="absolute inset-0 bg-neutral-100 dark:bg-neutral-800" />
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-neutral-600/30 animate-[shimmer_1.5s_infinite]" />
              </div>
            )}
            <img
              src={src}
              alt={prompt || ""}
              className={cn(
                "w-full object-contain pointer-events-none",
                "transition-all duration-700 ease-out",
                imgLoaded ? "opacity-100 scale-100" : "opacity-0 scale-[1.02]"
              )}
              draggable={false}
              onLoad={() => setImgLoaded(true)}
            />
            {/* Completion flash overlay */}
            {justCompleted && (
              <div className="absolute inset-0 pointer-events-none animate-[flash_0.8s_ease-out_forwards]">
                <div className="absolute inset-0 bg-white/30" />
              </div>
            )}
          </div>
        ) : status === "failed" ? (
          <div
            className="flex items-center justify-center bg-red-50/60 dark:bg-red-900/15 relative overflow-hidden"
            style={{ height: displayHeight }}
          >
            <div className="text-center px-4 relative z-10">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-2 animate-[pop_0.4s_cubic-bezier(0.34,1.56,0.64,1)]">
                <AlertTriangle size={18} className="text-red-400" />
              </div>
              <p className="text-xs text-red-500 font-semibold mb-1">生成失败</p>
              <p className="text-[10px] text-red-400/80 line-clamp-2 max-w-[200px]">{error || "未知错误"}</p>
              <button
                onClick={() => onRetry?.(id)}
                className="mt-2.5 inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 dark:bg-violet-900/30 dark:hover:bg-violet-900/50 dark:text-violet-400 transition-colors"
              >
                <RotateCcw size={10} /> 重试
              </button>
            </div>
            {/* Animated background pattern */}
            <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "radial-gradient(circle, #ef4444 1px, transparent 1px)", backgroundSize: "16px 16px" }} />
          </div>
        ) : (
          <div
            className="flex items-center justify-center relative overflow-hidden"
            style={{ height: displayHeight }}
          >
            {/* Animated gradient background */}
            <div className="absolute inset-0 bg-violet-50/60 dark:bg-violet-950/20" />

            {/* Floating particles */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-1 h-1 rounded-full bg-violet-300/40"
                  style={{
                    left: `${20 + i * 20}%`,
                    animation: `float-particle ${2 + i * 0.5}s ease-in-out infinite alternate`,
                    animationDelay: `${i * 0.3}s`,
                  }}
                />
              ))}
            </div>

            <div className="text-center relative z-10">
              <div className="relative w-12 h-12 mx-auto mb-3">
                {/* Outer ring */}
                <svg className="absolute inset-0 w-12 h-12 animate-spin" style={{ animationDuration: "3s" }} viewBox="0 0 48 48">
                  <circle cx="24" cy="24" r="20" fill="none" stroke="url(#grad)" strokeWidth="2" strokeDasharray="80 40" strokeLinecap="round" />
                  <defs><linearGradient id="grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#8b5cf6" /><stop offset="100%" stopColor="#c084fc" stopOpacity="0.2" /></linearGradient></defs>
                </svg>
                {/* Center icon */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <Sparkles size={18} className="text-violet-500 animate-pulse" />
                </div>
              </div>
              <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">AI 生成中</p>
              <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-0.5 tabular-nums">{Math.round(progress)}%</p>
            </div>
          </div>
        )}
        {prompt && (
          <div className="px-2.5 py-1.5 border-t border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900">
            <p className="text-[10px] text-neutral-400 truncate">{prompt}</p>
          </div>
        )}
      </div>

      {/* Inline keyframe styles */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes flash {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes node-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-4px); }
          30% { transform: translateX(4px); }
          45% { transform: translateX(-3px); }
          60% { transform: translateX(3px); }
          75% { transform: translateX(-1px); }
        }
        @keyframes pop {
          0% { transform: scale(0); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes bg-shift {
          0% { opacity: 0.7; }
          100% { opacity: 1; }
        }
        @keyframes float-particle {
          0% { transform: translateY(100%) scale(0.5); opacity: 0; }
          50% { opacity: 0.7; }
          100% { transform: translateY(-100%) scale(1); opacity: 0; }
        }
      `}</style>
    </>
  );
}

export default memo(ImageNodeComponent);
