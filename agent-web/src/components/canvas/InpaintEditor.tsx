"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Paintbrush, Undo2, Eraser, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const BRUSH_SIZES = [
  { label: "S", size: 10 },
  { label: "M", size: 24 },
  { label: "L", size: 48 },
  { label: "XL", size: 80 },
];

export interface InpaintEditorProps {
  src: string;
  onSubmit: (maskBlob: Blob, prompt: string) => void;
  onClose: () => void;
  loading?: boolean;
}

export default function InpaintEditor({ src, onSubmit, onClose, loading }: InpaintEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [brushSize, setBrushSize] = useState(24);
  const [prompt, setPrompt] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [hasPainted, setHasPainted] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const historyIdxRef = useRef(-1);

  const handleImgLoad = useCallback(() => {
    setImgLoaded(true);
  }, []);

  // Initialize canvas AFTER it is rendered in the DOM (imgLoaded triggers render)
  useEffect(() => {
    if (!imgLoaded) return;
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      historyRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
      historyIdxRef.current = 0;
    }
  }, [imgLoaded]);

  const pushHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(data);
    if (historyRef.current.length > 30) historyRef.current.shift();
    historyIdxRef.current = historyRef.current.length - 1;
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.putImageData(historyRef.current[historyIdxRef.current], 0, 0);
    if (historyIdxRef.current === 0) setHasPainted(false);
  }, []);

  const clearMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pushHistory();
      setHasPainted(false);
    }
  }, [pushHistory]);

  const getPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const getScaledBrush = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return brushSize;
    return brushSize * (canvas.width / canvas.getBoundingClientRect().width);
  }, [brushSize]);

  const drawStroke = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = getScaledBrush();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.lineWidth = r * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }, [getScaledBrush]);

  const drawDot = useCallback((pos: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = getScaledBrush();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fill();
  }, [getScaledBrush]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    setDrawing(true);
    setHasPainted(true);
    const pos = getPos(e);
    lastPosRef.current = pos;
    drawDot(pos);
  }, [getPos, drawDot]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (!drawing) return;
    e.preventDefault();
    const pos = getPos(e);
    if (lastPosRef.current) {
      drawStroke(lastPosRef.current, pos);
    }
    lastPosRef.current = pos;
  }, [drawing, getPos, drawStroke]);

  const handlePointerUp = useCallback(() => {
    if (drawing) {
      setDrawing(false);
      lastPosRef.current = null;
      pushHistory();
    }
  }, [drawing, pushHistory]);

  const generateMask = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas) return reject("No canvas");

      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const maskCtx = maskCanvas.getContext("2d");
      if (!maskCtx) return reject("No context");

      maskCtx.fillStyle = "#000000";
      maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

      const ctx = canvas.getContext("2d");
      if (!ctx) return reject("No context");
      const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

      for (let i = 0; i < srcData.data.length; i += 4) {
        if (srcData.data[i + 3] > 10) {
          maskData.data[i] = 255;
          maskData.data[i + 1] = 255;
          maskData.data[i + 2] = 255;
          maskData.data[i + 3] = 255;
        }
      }

      maskCtx.putImageData(maskData, 0, 0);
      maskCanvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject("Failed to create blob");
      }, "image/png");
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (loading || !hasPainted) return;
    try {
      const maskBlob = await generateMask();
      onSubmit(maskBlob, prompt || "Edit the masked area based on the surrounding content");
    } catch (e) {
      console.error("Failed to generate mask:", e);
    }
  }, [loading, hasPainted, generateMask, onSubmit, prompt]);

  // ESC to close, ⌘Z to undo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "z") { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, undo]);

  // Cursor size in display pixels
  const cursorDisplaySize = brushSize * 2;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex flex-col bg-black/80 backdrop-blur-sm"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900/90 border-b border-neutral-700/60">
        <div className="flex items-center gap-3">
          <Paintbrush size={16} className="text-violet-400" />
          <span className="text-sm font-medium text-white">涂抹编辑</span>
          <span className="text-xs text-neutral-400">在图片上涂抹需要修改的区域</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-neutral-800 rounded-lg px-1.5 py-0.5">
            <span className="text-[10px] text-neutral-500 mr-1">画笔</span>
            {BRUSH_SIZES.map((b) => (
              <button
                key={b.size}
                onClick={() => setBrushSize(b.size)}
                className={cn(
                  "w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-medium transition-colors",
                  brushSize === b.size
                    ? "bg-violet-500 text-white"
                    : "text-neutral-400 hover:bg-neutral-700"
                )}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="w-px h-5 bg-neutral-700" />
          <button onClick={undo} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors" title="撤销 (⌘Z)">
            <Undo2 size={14} />
          </button>
          <button onClick={clearMask} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors" title="清除涂抹">
            <Eraser size={14} />
          </button>
          <div className="w-px h-5 bg-neutral-700" />
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
        <div className="relative max-w-full max-h-full">
          <img
            ref={imgRef}
            src={src}
            alt=""
            className="block max-w-[80vw] max-h-[65vh] object-contain rounded-lg select-none"
            onLoad={handleImgLoad}
            draggable={false}
          />
          {imgLoaded && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full rounded-lg touch-none"
              style={{ cursor: "none" }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => { handlePointerUp(); setCursorPos(null); }}
            />
          )}
          {/* Brush cursor preview */}
          {cursorPos && imgLoaded && (
            <div
              className="pointer-events-none absolute border-2 border-white/80 rounded-full"
              style={{
                width: cursorDisplaySize,
                height: cursorDisplaySize,
                left: cursorPos.x - cursorDisplaySize / 2,
                top: cursorPos.y - cursorDisplaySize / 2,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.3)",
              }}
            />
          )}
        </div>
      </div>

      {/* Bottom prompt bar */}
      <div className="px-4 py-3 bg-neutral-900/90 border-t border-neutral-700/60">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述修改内容（可选，如：将涂抹区域替换为蓝天）"
            className="flex-1 bg-neutral-800 border border-neutral-700/60 rounded-lg px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-violet-500/60"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSubmit(); }}
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !hasPainted}
            className="px-4 py-2 rounded-lg bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {loading ? <><Loader2 size={14} className="animate-spin" /> 处理中...</> : <><Send size={14} /> 应用</>}
          </button>
        </div>
        {!hasPainted && (
          <p className="text-center text-[10px] text-neutral-500 mt-1.5">请先在图片上涂抹需要修改的区域</p>
        )}
      </div>
    </motion.div>
  );
}
