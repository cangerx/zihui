"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import {
  PenTool,
  Upload,
  Download,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  SlidersHorizontal,
  Undo2,
  Redo2,
  RotateCcw as ResetIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";

const LEFT_TOOLS = [
  { icon: RotateCw, name: "旋转" },
  { icon: FlipHorizontal, name: "翻转" },
  { icon: SlidersHorizontal, name: "调整" },
];

interface EditState {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
}

const DEFAULT_STATE: EditState = {
  rotation: 0,
  flipH: false,
  flipV: false,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  blur: 0,
};

export default function EditorPage() {
  usePageTitle("图片编辑");
  const [previewUrl, setPreviewUrl] = useState("");
  const [activeTool, setActiveTool] = useState("调整");
  const [editState, setEditState] = useState<EditState>({ ...DEFAULT_STATE });
  const [history, setHistory] = useState<EditState[]>([{ ...DEFAULT_STATE }]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const pushState = useCallback((s: EditState) => {
    setHistory((prev) => [...prev.slice(0, historyIdx + 1), s]);
    setHistoryIdx((prev) => prev + 1);
    setEditState(s);
  }, [historyIdx]);

  const undo = useCallback(() => {
    if (historyIdx > 0) {
      setHistoryIdx((i) => i - 1);
      setEditState(history[historyIdx - 1]);
    }
  }, [historyIdx, history]);

  const redo = useCallback(() => {
    if (historyIdx < history.length - 1) {
      setHistoryIdx((i) => i + 1);
      setEditState(history[historyIdx + 1]);
    }
  }, [historyIdx, history]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      const img = new Image();
      img.onload = () => { imgRef.current = img; };
      img.src = url;
      setEditState({ ...DEFAULT_STATE });
      setHistory([{ ...DEFAULT_STATE }]);
      setHistoryIdx(0);
    }
  };

  const handleReset = () => {
    pushState({ ...DEFAULT_STATE });
  };

  const rotate = (deg: number) => {
    pushState({ ...editState, rotation: (editState.rotation + deg + 360) % 360 });
  };

  const flip = (axis: "h" | "v") => {
    if (axis === "h") pushState({ ...editState, flipH: !editState.flipH });
    else pushState({ ...editState, flipV: !editState.flipV });
  };

  const updateAdjust = (key: keyof EditState, value: number) => {
    setEditState((prev) => ({ ...prev, [key]: value }));
  };

  const commitAdjust = () => {
    pushState(editState);
  };

  const cssFilter = `brightness(${editState.brightness}%) contrast(${editState.contrast}%) saturate(${editState.saturation}%) blur(${editState.blur}px)`;
  const cssTransform = `rotate(${editState.rotation}deg) scaleX(${editState.flipH ? -1 : 1}) scaleY(${editState.flipV ? -1 : 1})`;

  const handleDownload = useCallback(() => {
    if (!imgRef.current) return;
    const img = imgRef.current;
    const rad = (editState.rotation * Math.PI) / 180;
    const isPortrait = editState.rotation % 180 !== 0;
    const w = isPortrait ? img.naturalHeight : img.naturalWidth;
    const h = isPortrait ? img.naturalWidth : img.naturalHeight;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.filter = `brightness(${editState.brightness}%) contrast(${editState.contrast}%) saturate(${editState.saturation}%) blur(${editState.blur}px)`;
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rad);
    ctx.scale(editState.flipH ? -1 : 1, editState.flipV ? -1 : 1);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `edited-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [editState]);

  const ADJUSTMENTS = [
    { key: "brightness" as const, label: "亮度", min: 0, max: 200, unit: "%" },
    { key: "contrast" as const, label: "对比度", min: 0, max: 200, unit: "%" },
    { key: "saturation" as const, label: "饱和度", min: 0, max: 200, unit: "%" },
    { key: "blur" as const, label: "模糊", min: 0, max: 20, unit: "px" },
  ];

  return (
    <div className="h-full flex flex-col">
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="flex items-center justify-between px-6 py-3 border-b border-neutral-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm shrink-0"
      >
        <div className="flex items-center gap-3">
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-pink-500 flex items-center justify-center shadow-md shadow-pink-200/50">
            <PenTool size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">图片编辑</h1>
            <p className="text-xs text-neutral-400">旋转、翻转、调整亮度对比度</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {previewUrl && (
            <>
              <button onClick={undo} disabled={historyIdx <= 0}
                className="p-2 rounded-lg border border-neutral-200/60 text-neutral-500 hover:bg-neutral-50 disabled:opacity-30 transition-colors" title="撤销">
                <Undo2 size={14} />
              </button>
              <button onClick={redo} disabled={historyIdx >= history.length - 1}
                className="p-2 rounded-lg border border-neutral-200/60 text-neutral-500 hover:bg-neutral-50 disabled:opacity-30 transition-colors" title="重做">
                <Redo2 size={14} />
              </button>
              <button onClick={handleReset}
                className="px-3 py-1.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors flex items-center gap-1.5">
                <ResetIcon size={14} /> 重置
              </button>
              <button onClick={handleDownload}
                className="px-3 py-1.5 rounded-lg bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 transition-colors flex items-center gap-1.5">
                <Download size={14} /> 导出
              </button>
            </>
          )}
        </div>
      </motion.div>

      {previewUrl ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left toolbar */}
          <div className="w-16 border-r border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 flex flex-col items-center py-3 gap-1 shrink-0">
            {LEFT_TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.name}
                  onClick={() => setActiveTool(tool.name)}
                  className={cn(
                    "w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors",
                    activeTool === tool.name ? "bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400" : "text-neutral-400 hover:bg-neutral-50 hover:text-neutral-600 dark:hover:bg-neutral-800"
                  )}
                >
                  <Icon size={18} />
                  <span className="text-[10px]">{tool.name}</span>
                </button>
              );
            })}
          </div>

          {/* Canvas */}
          <div className="flex-1 flex items-center justify-center bg-neutral-100 dark:bg-neutral-950 p-6 overflow-hidden">
            <img
              src={previewUrl}
              alt="editing"
              style={{ filter: cssFilter, transform: cssTransform, transition: "filter 0.15s ease, transform 0.3s ease" }}
              className="max-w-full max-h-full rounded-lg shadow-lg object-contain"
            />
          </div>

          {/* Right panel */}
          <div className="w-[240px] border-l border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 p-4 shrink-0 overflow-y-auto">
            <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-3">{activeTool}</h3>
            <div className="space-y-4">
              {activeTool === "旋转" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => rotate(-90)}
                      className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-pink-50 hover:text-pink-600 hover:border-pink-200 transition-colors">
                      <RotateCcw size={14} /> 左转 90°
                    </button>
                    <button onClick={() => rotate(90)}
                      className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-pink-50 hover:text-pink-600 hover:border-pink-200 transition-colors">
                      <RotateCw size={14} /> 右转 90°
                    </button>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-neutral-600">自由旋转</span>
                      <span className="text-neutral-400">{editState.rotation}°</span>
                    </div>
                    <input
                      type="range" min="0" max="359" value={editState.rotation}
                      onChange={(e) => updateAdjust("rotation", +e.target.value)}
                      onMouseUp={commitAdjust} onTouchEnd={commitAdjust}
                      className="w-full accent-pink-500"
                    />
                  </div>
                </div>
              )}

              {activeTool === "翻转" && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => flip("h")}
                    className={cn("flex items-center justify-center gap-1.5 py-3 rounded-lg border text-sm transition-colors",
                      editState.flipH ? "border-pink-300 bg-pink-50 text-pink-600" : "border-neutral-200/60 text-neutral-600 hover:bg-neutral-50")}>
                    <FlipHorizontal size={16} /> 水平翻转
                  </button>
                  <button onClick={() => flip("v")}
                    className={cn("flex items-center justify-center gap-1.5 py-3 rounded-lg border text-sm transition-colors",
                      editState.flipV ? "border-pink-300 bg-pink-50 text-pink-600" : "border-neutral-200/60 text-neutral-600 hover:bg-neutral-50")}>
                    <FlipVertical size={16} /> 垂直翻转
                  </button>
                </div>
              )}

              {activeTool === "调整" && (
                <>
                  {ADJUSTMENTS.map((adj) => (
                    <div key={adj.key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-neutral-600">{adj.label}</span>
                        <span className="text-neutral-400">{editState[adj.key]}{adj.unit}</span>
                      </div>
                      <input
                        type="range" min={adj.min} max={adj.max} value={editState[adj.key]}
                        onChange={(e) => updateAdjust(adj.key, +e.target.value)}
                        onMouseUp={commitAdjust} onTouchEnd={commitAdjust}
                        className="w-full accent-pink-500"
                      />
                    </div>
                  ))}
                  <button onClick={handleReset}
                    className="w-full mt-2 py-2 rounded-lg border border-neutral-200/60 text-xs text-neutral-500 hover:bg-neutral-50 transition-colors">
                    重置所有调整
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <label className="flex flex-col items-center gap-4 p-16 rounded-2xl border-2 border-dashed border-neutral-200 hover:border-pink-300 bg-white dark:bg-neutral-900 cursor-pointer transition-colors">
            <motion.div whileHover={{ scale: 1.05 }} className="w-16 h-16 rounded-2xl bg-pink-50 flex items-center justify-center">
              <Upload size={28} className="text-pink-400" />
            </motion.div>
            <div className="text-center">
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">上传图片开始编辑</p>
              <p className="text-xs text-neutral-400 mt-1">旋转、翻转、调色、导出</p>
            </div>
            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
          </label>
        </div>
      )}
    </div>
  );
}
