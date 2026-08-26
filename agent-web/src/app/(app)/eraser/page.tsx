"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Eraser, Download, Undo2, Redo2, Loader2, AlertCircle, RotateCcw, Eye, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI } from "@/lib/api";
import ImageUploader from "@/components/ui/image-uploader";
import ResolutionPicker from "@/components/ui/resolution-picker";
import BeforeAfterCompare from "@/components/ui/before-after-compare";
import { downloadImage } from "@/lib/download";
import { usePollGeneration } from "@/hooks/use-poll-generation";
import { usePageTitle } from "@/hooks/use-page-title";

const BRUSH_SIZES = [
  { size: 10, label: "S" },
  { size: 20, label: "M" },
  { size: 40, label: "L" },
  { size: 60, label: "XL" },
];

type ViewMode = "paint" | "compare";

export default function EraserPage() {
  usePageTitle("AI 消除");
  const [previewUrl, setPreviewUrl] = useState("");
  const [brushSize, setBrushSize] = useState(20);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resolution, setResolution] = useState("1K");
  const [prompt, setPrompt] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("paint");
  const [hasMask, setHasMask] = useState(false);
  const { result: pollResult, polling, error: pollError, startPolling, reset: resetPoll } = usePollGeneration();

  const finalResultUrl = pollResult?.status === "completed" ? pollResult.result_url || "" : resultUrl;
  const isProcessing = processing || polling;
  const errorMsg = pollError || (pollResult?.status === "failed" ? pollResult.error_msg : null);

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const historyRef = useRef<ImageData[]>([]);
  const historyIdxRef = useRef(-1);
  const canvasSizeRef = useRef({ w: 0, h: 0 });

  const initCanvas = useCallback((url: string) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Fit to container (max 800px wide, keeping aspect)
      const maxW = 800;
      const maxH = 600;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxW) { h = (h * maxW) / w; w = maxW; }
      if (h > maxH) { w = (w * maxH) / h; h = maxH; }
      w = Math.round(w);
      h = Math.round(h);

      canvas.width = w;
      canvas.height = h;
      canvasSizeRef.current = { w, h };

      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      // Save initial blank state
      historyRef.current = [ctx.getImageData(0, 0, w, h)];
      historyIdxRef.current = 0;
      setHasMask(false);
    };
    img.src = url;
  }, []);

  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Trim future history
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(data);
    historyIdxRef.current = historyRef.current.length - 1;
    // Check if any pixel is painted
    const hasAny = data.data.some((v, i) => i % 4 === 3 && v > 0);
    setHasMask(hasAny);
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(historyRef.current[historyIdxRef.current], 0, 0);
    const data = historyRef.current[historyIdxRef.current];
    setHasMask(data.data.some((v, i) => i % 4 === 3 && v > 0));
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(historyRef.current[historyIdxRef.current], 0, 0);
    const data = historyRef.current[historyIdxRef.current];
    setHasMask(data.data.some((v, i) => i % 4 === 3 && v > 0));
  }, []);

  const getCanvasPos = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  const drawDot = useCallback(
    (x: number, y: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(255, 100, 0, 0.5)";
      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [brushSize]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (finalResultUrl) return;
      drawing.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const { x, y } = getCanvasPos(e);
      drawDot(x, y);
    },
    [getCanvasPos, drawDot, finalResultUrl]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawing.current) return;
      const { x, y } = getCanvasPos(e);
      drawDot(x, y);
    },
    [getCanvasPos, drawDot]
  );

  const onPointerUp = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    saveHistory();
  }, [saveHistory]);

  // Generate mask as Blob (white on black)
  const generateMaskBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) { resolve(null); return; }
      const src = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);

      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const mctx = maskCanvas.getContext("2d")!;
      const maskData = mctx.createImageData(canvas.width, canvas.height);

      for (let i = 0; i < src.data.length; i += 4) {
        const painted = src.data[i + 3] > 0;
        maskData.data[i] = painted ? 255 : 0;
        maskData.data[i + 1] = painted ? 255 : 0;
        maskData.data[i + 2] = painted ? 255 : 0;
        maskData.data[i + 3] = 255;
      }
      mctx.putImageData(maskData, 0, 0);
      maskCanvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }, []);

  const handleFileSelect = (file: File, url: string) => {
    setUploadedFile(file);
    setPreviewUrl(url);
    setResultUrl("");
    setViewMode("paint");
    resetPoll();
    initCanvas(url);
  };

  const handleErase = async () => {
    if (!uploadedFile) return;
    setProcessing(true);
    setResultUrl("");
    try {
      const fd = new FormData();
      fd.append("image", uploadedFile);
      fd.append("resolution", resolution);
      if (prompt) fd.append("prompt", prompt);

      const maskBlob = await generateMaskBlob();
      if (maskBlob) fd.append("mask", maskBlob, "mask.png");

      const res = await imageAPI.eraser(fd);
      const gen = res.data?.data;
      if (gen?.result_url) {
        setResultUrl(gen.result_url);
        setProcessing(false);
      } else if (gen?.id) {
        setProcessing(false);
        startPolling(gen.id);
      } else {
        setProcessing(false);
      }
    } catch (e: any) {
      console.error(e);
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setPreviewUrl("");
    setResultUrl("");
    setUploadedFile(null);
    setPrompt("");
    setViewMode("paint");
    setHasMask(false);
    resetPoll();
    historyRef.current = [];
    historyIdxRef.current = -1;
  };

  // Switch to compare mode when result arrives
  useEffect(() => {
    if (finalResultUrl) setViewMode("compare");
  }, [finalResultUrl]);

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
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shadow-md shadow-orange-200/50">
            <Eraser size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">AI 消除</h1>
            <p className="text-xs text-neutral-400">涂抹不需要的区域，AI 智能填充</p>
          </div>
        </div>

        {previewUrl && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Brush size (only in paint mode) */}
            {viewMode === "paint" && !finalResultUrl && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-neutral-50 border border-neutral-200/60">
                <span className="text-[10px] text-neutral-400 mr-0.5">画笔</span>
                {BRUSH_SIZES.map((b) => (
                  <button
                    key={b.size}
                    onClick={() => setBrushSize(b.size)}
                    className={cn(
                      "w-7 h-7 rounded flex items-center justify-center transition-colors text-[10px] font-medium",
                      brushSize === b.size ? "bg-orange-500 text-white" : "hover:bg-neutral-100 text-neutral-500"
                    )}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}

            {viewMode === "paint" && !finalResultUrl && (
              <div className="flex gap-0.5">
                <button onClick={undo} className="p-1.5 rounded-lg hover:bg-neutral-100 transition-colors" title="撤销">
                  <Undo2 size={15} className="text-neutral-500" />
                </button>
                <button onClick={redo} className="p-1.5 rounded-lg hover:bg-neutral-100 transition-colors" title="重做">
                  <Redo2 size={15} className="text-neutral-500" />
                </button>
              </div>
            )}

            <ResolutionPicker value={resolution} onChange={setResolution} />

            {finalResultUrl && (
              <div className="flex gap-0.5 px-1 py-0.5 rounded-lg bg-neutral-50 border border-neutral-200/60">
                <button
                  onClick={() => setViewMode("paint")}
                  className={cn("p-1.5 rounded transition-colors", viewMode === "paint" ? "bg-white shadow-sm text-orange-600" : "text-neutral-400 hover:text-neutral-600")}
                  title="结果"
                >
                  <Layers size={14} />
                </button>
                <button
                  onClick={() => setViewMode("compare")}
                  className={cn("p-1.5 rounded transition-colors", viewMode === "compare" ? "bg-white shadow-sm text-orange-600" : "text-neutral-400 hover:text-neutral-600")}
                  title="对比"
                >
                  <Eye size={14} />
                </button>
              </div>
            )}

            {finalResultUrl ? (
              <button onClick={handleReset} className="px-3 py-1.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors flex items-center gap-1.5">
                <RotateCcw size={14} /> 重新上传
              </button>
            ) : (
              <button
                onClick={handleErase}
                disabled={isProcessing || !hasMask}
                className="px-4 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {isProcessing ? <><Loader2 size={14} className="animate-spin" /> 处理中...</> : <><Eraser size={14} /> 消除</>}
              </button>
            )}
            <button
              onClick={() => finalResultUrl && downloadImage(finalResultUrl, `eraser-${resolution}.png`)}
              disabled={!finalResultUrl}
              className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors flex items-center gap-1.5"
            >
              <Download size={14} /> 下载
            </button>
          </div>
        )}
      </motion.div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {previewUrl ? (
          <div className="flex-1 flex flex-col">
            {/* Prompt bar */}
            {!finalResultUrl && (
              <div className="px-4 sm:px-6 py-2 border-b border-neutral-100 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/50">
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述消除后用什么填充（可选，如：自然背景、纯色等）"
                  className="w-full text-sm bg-transparent outline-none text-neutral-700 dark:text-neutral-300 placeholder:text-neutral-400"
                />
              </div>
            )}

            <div className="flex-1 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4 sm:p-6">
              {finalResultUrl && viewMode === "compare" ? (
                <BeforeAfterCompare
                  beforeSrc={previewUrl}
                  afterSrc={finalResultUrl}
                  beforeLabel="原图"
                  afterLabel="消除结果"
                  className="max-w-2xl w-full"
                />
              ) : finalResultUrl && viewMode === "paint" ? (
                <motion.img
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  src={finalResultUrl}
                  alt="消除结果"
                  className="max-w-2xl max-h-[70vh] rounded-xl shadow-lg"
                />
              ) : (
                <div className="relative">
                  {/* Background image */}
                  <img
                    src={previewUrl}
                    alt=""
                    className="rounded-xl shadow-lg block"
                    style={{ width: canvasSizeRef.current.w || "auto", height: canvasSizeRef.current.h || "auto" }}
                  />
                  {/* Mask overlay canvas */}
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 rounded-xl"
                    style={{ cursor: "crosshair", width: "100%", height: "100%" }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  />
                  {!hasMask && !isProcessing && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="bg-black/30 backdrop-blur-sm px-4 py-2 rounded-xl">
                        <p className="text-sm text-white font-medium">用画笔涂抹需要消除的区域</p>
                      </div>
                    </div>
                  )}
                  {isProcessing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl">
                      <div className="bg-white/90 backdrop-blur-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin text-orange-500" />
                        <span className="text-sm text-neutral-700">AI 处理中...</span>
                      </div>
                    </div>
                  )}
                  {errorMsg && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-50 border border-red-200 px-4 py-2 rounded-xl flex items-center gap-2">
                      <AlertCircle size={14} className="text-red-500" />
                      <span className="text-xs text-red-600">{errorMsg}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <ImageUploader
              onFileSelect={handleFileSelect}
              accentColor="orange"
              hint="上传图片，涂抹不需要的内容"
              subHint="AI 将智能填充被消除的区域"
              className="max-w-md w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
