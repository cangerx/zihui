"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Download, Loader2, AlertCircle, RotateCcw, Eye, Layers, ChevronDown, RefreshCw, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI, modelAPI, generationAPI } from "@/lib/api";
import ImageUploader from "@/components/ui/image-uploader";
import ResolutionPicker from "@/components/ui/resolution-picker";
import BeforeAfterCompare from "@/components/ui/before-after-compare";
import { downloadImage } from "@/lib/download";
import { usePollGeneration } from "@/hooks/use-poll-generation";
import { usePageTitle } from "@/hooks/use-page-title";

const RES_MAP: Record<string, number> = { "1K": 1024, "2K": 2048, "4K": 3840 };
const STAGE_TIMINGS: Record<string, number[]> = {
  "1K": [3, 8, 25],
  "2K": [3, 10, 50],
  "4K": [5, 15, 100],
};

interface ImageModel {
  name: string;
  display_name: string;
  badge?: string;
  price_per_call: number;
  description?: string;
  config?: Record<string, { values: string[]; default: string }>;
}

interface HistoryItem {
  id: number;
  thumb_url?: string;
  result_url?: string;
  prompt?: string;
  status: string;
  created_at: string;
}

type ViewMode = "result" | "compare";
type ProcessStage = "upload" | "analyze" | "enhance" | "done";

const STAGE_LABELS: Record<ProcessStage, string> = {
  upload: "上传图片...",
  analyze: "AI 分析图片内容...",
  enhance: "超分辨率增强中...",
  done: "完成",
};

export default function UpscalePage() {
  usePageTitle("变清晰");
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resolution, setResolution] = useState("1K");
  const [viewMode, setViewMode] = useState<ViewMode>("result");
  const [imgDim, setImgDim] = useState<{ w: number; h: number } | null>(null);
  const [models, setModels] = useState<ImageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("gpt-image-2");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [stage, setStage] = useState<ProcessStage>("upload");
  const [elapsed, setElapsed] = useState(0);
  const [dragOverReplace, setDragOverReplace] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { result: pollResult, polling, error: pollError, startPolling, reset: resetPoll } = usePollGeneration();

  const finalResultUrl = pollResult?.status === "completed" ? pollResult.result_url || "" : resultUrl;
  const isProcessing = processing || polling;
  const errorMsg = pollError || (pollResult?.status === "failed" ? pollResult.error_msg : null);

  // Stage progression based on elapsed time
  useEffect(() => {
    if (!isProcessing) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (finalResultUrl) setStage("done");
      return;
    }
    startTimeRef.current = Date.now();
    setElapsed(0);
    setStage("upload");
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsed(s);
      const timings = STAGE_TIMINGS[resolution] || STAGE_TIMINGS["1K"];
      if (s >= timings[1]) setStage("enhance");
      else if (s >= timings[0]) setStage("analyze");
      else setStage("upload");
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isProcessing]);

  useEffect(() => {
    if (finalResultUrl) {
      setStage("done");
      if (timerRef.current) clearInterval(timerRef.current);
      // Refresh history
      loadHistory();
    }
  }, [finalResultUrl]);

  // Load models
  useEffect(() => {
    modelAPI.imageModels().then((res) => {
      const list: ImageModel[] = res.data?.data ?? [];
      setModels(list);
      if (list.length > 0 && !list.find((m) => m.name === selectedModel)) {
        setSelectedModel(list[0].name);
      }
    });
  }, []);

  // Load history
  const loadHistory = useCallback(() => {
    generationAPI.list({ type: "upscale", page_size: 10, status: "completed" }).then((res) => {
      setHistory(res.data?.data?.list || res.data?.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Validate resolution against model
  useEffect(() => {
    const m = models.find((mod) => mod.name === selectedModel);
    const supported = m?.config?.resolutions?.values;
    if (supported?.length && !supported.includes(resolution)) {
      setResolution(m?.config?.resolutions?.default || supported[supported.length - 1]);
    }
  }, [selectedModel, models]);

  const handleFileSelect = useCallback((file: File, url: string) => {
    setUploadedFile(file);
    setPreviewUrl(url);
    setResultUrl("");
    setViewMode("result");
    resetPoll();
    const img = new Image();
    img.onload = () => setImgDim({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
  }, [resetPoll]);

  // Paste from clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files || []).find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        handleFileSelect(file, URL.createObjectURL(file));
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handleFileSelect]);

  const handleUpscale = async () => {
    if (!uploadedFile) return;
    setProcessing(true);
    setResultUrl("");
    resetPoll();
    try {
      const fd = new FormData();
      fd.append("image", uploadedFile);
      fd.append("resolution", resolution);
      fd.append("model", selectedModel);
      const res = await imageAPI.upscale(fd);
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
    } catch {
      setProcessing(false);
    }
  };

  const handleRetry = () => {
    resetPoll();
    handleUpscale();
  };

  const handleReset = () => {
    setPreviewUrl("");
    setResultUrl("");
    setUploadedFile(null);
    setImgDim(null);
    setViewMode("result");
    resetPoll();
  };

  // Drag-to-replace
  const handleReplaceDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverReplace(false);
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) {
      handleFileSelect(file, URL.createObjectURL(file));
    }
  };

  // Load history item
  const handleHistoryClick = (item: HistoryItem) => {
    if (item.result_url) {
      setResultUrl(item.result_url);
      setPreviewUrl(item.thumb_url || item.result_url);
      setViewMode("result");
    }
  };

  useEffect(() => {
    if (finalResultUrl) setViewMode("compare");
  }, [finalResultUrl]);

  const resBase = RES_MAP[resolution] || 1024;
  const getOutputDim = () => {
    if (!imgDim) return null;
    const longer = Math.max(imgDim.w, imgDim.h);
    const ratio = Math.max(2, resBase / longer); // At least 2x upscale
    const w = Math.round(imgDim.w * ratio);
    const h = Math.round(imgDim.h * ratio);
    const actualScale = +ratio.toFixed(1);
    return { w, h, actualScale };
  };
  const outputDim = getOutputDim();
  const currentModel = models.find((m) => m.name === selectedModel);
  const estimatedTime = (STAGE_TIMINGS[resolution] || STAGE_TIMINGS["1K"])[2];

  return (
    <div className="h-full flex flex-col">
      {/* Desktop Header */}
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="hidden sm:flex items-center justify-between gap-2 px-6 py-3 border-b border-neutral-100 dark:border-neutral-800 glass shrink-0"
      >
        <div className="flex items-center gap-3">
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shadow-md shadow-amber-200/50">
            <Sparkles size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">变清晰</h1>
            <p className="text-xs text-neutral-400">AI 智能增强画质，最高 8 倍无损放大</p>
          </div>
        </div>

        {previewUrl && (
          <div className="flex items-center gap-2">
            {/* Model Picker */}
            <div className="relative">
              <button
                onClick={() => setShowModelPicker(!showModelPicker)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-neutral-50/50 dark:bg-neutral-800/50 hover:bg-white dark:hover:bg-neutral-800 transition-all text-xs"
              >
                <span className="text-neutral-700 dark:text-neutral-200 font-medium truncate max-w-[100px]">
                  {currentModel?.display_name || selectedModel}
                </span>
                <ChevronDown size={12} className={cn("text-neutral-400 transition-transform", showModelPicker && "rotate-180")} />
              </button>
              {showModelPicker && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowModelPicker(false)} />
                  <div className="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-xl max-h-[300px] overflow-y-auto min-w-[200px]">
                    {models.map((m) => (
                      <button
                        key={m.name}
                        onClick={() => { setSelectedModel(m.name); setShowModelPicker(false); }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors flex items-center justify-between",
                          m.name === selectedModel && "bg-amber-50 dark:bg-amber-900/20"
                        )}
                      >
                        <span className="font-medium text-neutral-700 dark:text-neutral-200">{m.display_name}</span>
                        {m.badge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{m.badge}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Resolution */}
            <ResolutionPicker
              value={resolution}
              onChange={setResolution}
              options={currentModel?.config?.resolutions?.values}
            />

            {/* View toggle */}
            {finalResultUrl && (
              <div className="flex items-center rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 overflow-hidden">
                <button onClick={() => setViewMode("result")} className={cn("px-2 py-1.5 text-xs transition-colors", viewMode === "result" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "text-neutral-500 hover:bg-neutral-50")}>
                  <Eye size={13} />
                </button>
                <button onClick={() => setViewMode("compare")} className={cn("px-2 py-1.5 text-xs transition-colors", viewMode === "compare" ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "text-neutral-500 hover:bg-neutral-50")}>
                  <Layers size={13} />
                </button>
              </div>
            )}

            {/* Actions */}
            {finalResultUrl && (
              <button onClick={() => downloadImage(finalResultUrl, `upscale-${resolution}`)} className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                <Download size={15} />
              </button>
            )}
            <button
              onClick={isProcessing ? undefined : handleUpscale}
              disabled={isProcessing || !uploadedFile}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium transition-colors shadow-sm"
            >
              {isProcessing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              增强
            </button>
            <button onClick={handleReset} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" title="重新上传">
              <RotateCcw size={14} />
            </button>
          </div>
        )}
      </motion.div>

      {/* Mobile Header (minimal) */}
      <div className="sm:hidden flex items-center justify-between px-4 py-2 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500 flex items-center justify-center">
            <Sparkles size={13} className="text-white" />
          </div>
          <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">变清晰</h1>
        </div>
        {previewUrl && (
          <button onClick={handleReset} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100">
            <RotateCcw size={14} />
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-3 sm:p-6 gap-3 overflow-hidden">
        {previewUrl ? (
          <div
            className={cn(
              "flex flex-col items-center gap-3 w-full flex-1 min-h-0 transition-all",
              dragOverReplace && "ring-2 ring-blue-400 ring-offset-2 rounded-2xl"
            )}
            onDrop={handleReplaceDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOverReplace(true); }}
            onDragLeave={() => setDragOverReplace(false)}
          >
            {/* Dimension info */}
            {imgDim && outputDim && (
              <div className="flex items-center gap-2 text-xs text-neutral-500 shrink-0">
                <span className="px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800">
                  {imgDim.w} × {imgDim.h}
                </span>
                <span className="text-neutral-300">→</span>
                <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                  {outputDim.w} × {outputDim.h}
                </span>
                <span className="text-neutral-400 hidden sm:inline">(约 {outputDim.actualScale}x · {resolution})</span>
              </div>
            )}

            {/* Image display */}
            {finalResultUrl && viewMode === "compare" ? (
              <BeforeAfterCompare
                beforeSrc={previewUrl}
                afterSrc={finalResultUrl}
                beforeLabel="原图"
                afterLabel={`${resolution} 增强`}
                className="max-w-4xl w-full flex-1 min-h-0"
              />
            ) : finalResultUrl && viewMode === "result" ? (
              <div className="flex-1 min-h-0 flex items-center justify-center">
                <motion.img
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  src={finalResultUrl}
                  alt="增强结果"
                  className="max-w-full max-h-full object-contain rounded-xl shadow-lg"
                />
              </div>
            ) : (
              <div className="relative flex-1 min-h-0 flex items-center justify-center w-full">
                <img src={previewUrl} alt="" className={cn("max-w-full max-h-full object-contain rounded-xl shadow-lg transition-all", isProcessing && "brightness-75")} />

                {/* Multi-stage progress overlay */}
                {isProcessing && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md px-6 py-4 rounded-2xl shadow-2xl flex flex-col items-center gap-3 min-w-[220px]"
                    >
                      <div className="w-full h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full"
                          initial={{ width: "0%" }}
                          animate={{ width: `${Math.min(95, (elapsed / estimatedTime) * 100)}%` }}
                          transition={{ duration: 1, ease: "linear" }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin text-amber-500" />
                        <span className="text-sm text-neutral-700 dark:text-neutral-300 font-medium">{STAGE_LABELS[stage]}</span>
                      </div>
                      <span className="text-[11px] text-neutral-400">
                        {elapsed < estimatedTime ? `预计还需 ${estimatedTime - elapsed}s` : "即将完成..."}
                      </span>
                    </motion.div>
                  </div>
                )}

                {/* Error with retry */}
                {errorMsg && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-red-50 dark:bg-red-950/80 border border-red-200 dark:border-red-800 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg"
                    >
                      <AlertCircle size={16} className="text-red-500 shrink-0" />
                      <span className="text-xs text-red-600 dark:text-red-400 max-w-[200px] line-clamp-2">{errorMsg}</span>
                      <button
                        onClick={handleRetry}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-medium flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw size={12} /> 重试
                      </button>
                    </motion.div>
                  </div>
                )}

                {/* Initial hint */}
                {!isProcessing && !errorMsg && !finalResultUrl && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-black/30 backdrop-blur-sm px-4 py-2 rounded-xl">
                      <p className="text-sm text-white font-medium">点击增强按钮开始</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Paste hint (desktop) */}
            {!isProcessing && !finalResultUrl && (
              <p className="hidden sm:block text-[11px] text-neutral-300 dark:text-neutral-600 shrink-0">
                支持拖拽替换图片 · Ctrl+V 粘贴
              </p>
            )}
          </div>
        ) : (
          <ImageUploader
            onFileSelect={handleFileSelect}
            accentColor="amber"
            maxSizeMB={20}
            hint="上传图片，AI 智能增强画质"
            subHint="告别模糊，最高 8 倍无损放大 · 支持粘贴"
            className="max-w-md w-full"
          />
        )}
      </div>

      {/* History strip */}
      {history.length > 0 && (
        <div className="shrink-0 border-t border-neutral-100 dark:border-neutral-800 px-4 py-2">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            <div className="flex items-center gap-1 text-[10px] text-neutral-400 shrink-0">
              <Clock size={10} />
              <span>最近</span>
            </div>
            {history.map((item) => (
              <button
                key={item.id}
                onClick={() => handleHistoryClick(item)}
                className="shrink-0 w-10 h-10 rounded-lg overflow-hidden border border-neutral-200/60 dark:border-neutral-700/60 hover:border-amber-400 hover:ring-1 hover:ring-amber-400/50 transition-all"
                title={item.prompt || "增强结果"}
              >
                <img
                  src={item.thumb_url || item.result_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile bottom toolbar */}
      {previewUrl && (
        <div className="sm:hidden shrink-0 border-t border-neutral-100 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md px-3 py-2 flex items-center justify-between gap-2">
          {/* Model + Resolution */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowModelPicker(true)}
              className="px-2 py-1.5 rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 truncate max-w-[80px]"
            >
              {currentModel?.display_name || selectedModel}
            </button>
            <ResolutionPicker
              value={resolution}
              onChange={setResolution}
              options={currentModel?.config?.resolutions?.values}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            {finalResultUrl && (
              <>
                <button onClick={() => setViewMode(viewMode === "compare" ? "result" : "compare")} className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100">
                  {viewMode === "compare" ? <Eye size={16} /> : <Layers size={16} />}
                </button>
                <button onClick={() => downloadImage(finalResultUrl, `upscale-${resolution}`)} className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100">
                  <Download size={16} />
                </button>
              </>
            )}
            <button
              onClick={isProcessing ? undefined : handleUpscale}
              disabled={isProcessing || !uploadedFile}
              className="flex items-center gap-1 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold transition-colors shadow-sm"
            >
              {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              增强
            </button>
          </div>
        </div>
      )}

      {/* Mobile model picker sheet */}
      <AnimatePresence>
        {showModelPicker && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 z-40 sm:hidden"
              onClick={() => setShowModelPicker(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-neutral-900 rounded-t-2xl shadow-2xl max-h-[60vh] overflow-y-auto sm:hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
                <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">选择模型</span>
                <button onClick={() => setShowModelPicker(false)} className="p-1 rounded-lg hover:bg-neutral-100">
                  <X size={16} className="text-neutral-400" />
                </button>
              </div>
              <div className="p-2">
                {models.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => { setSelectedModel(m.name); setShowModelPicker(false); }}
                    className={cn(
                      "w-full text-left px-4 py-3 rounded-xl text-sm transition-colors flex items-center justify-between",
                      m.name === selectedModel ? "bg-amber-50 dark:bg-amber-900/20" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    )}
                  >
                    <div>
                      <span className="font-medium text-neutral-800 dark:text-neutral-200">{m.display_name}</span>
                      {m.description && <p className="text-[11px] text-neutral-400 mt-0.5">{m.description}</p>}
                    </div>
                    {m.badge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{m.badge}</span>}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
