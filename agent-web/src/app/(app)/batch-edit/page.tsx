"use client";

import { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { LayoutGrid, Download, Plus, X, Loader2, Scissors, Maximize2, Sparkles, RotateCcw, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI, generationAPI } from "@/lib/api";
import { usePageTitle } from "@/hooks/use-page-title";

interface BatchImage {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "processing" | "completed" | "failed";
  resultUrl?: string;
  genId?: number;
  error?: string;
}

const OPERATIONS = [
  { label: "批量抠图", value: "cutout", icon: Scissors, desc: "去除所有图片背景", color: "emerald" },
  { label: "批量变清晰", value: "upscale", icon: Sparkles, desc: "AI 增强所有图片画质", color: "amber" },
  { label: "批量改尺寸", value: "resize", icon: Maximize2, desc: "统一调整所有图片尺寸", color: "indigo" },
];

const RESIZE_PRESETS = [
  { label: "800x800", w: 800, h: 800 },
  { label: "1080x1080", w: 1080, h: 1080 },
  { label: "1080x1920", w: 1080, h: 1920 },
  { label: "800x1200", w: 800, h: 1200 },
];

export default function BatchEditPage() {
  usePageTitle("图片批处理");
  const [images, setImages] = useState<BatchImage[]>([]);
  const [operation, setOperation] = useState(OPERATIONS[0]);
  const [processing, setProcessing] = useState(false);
  const [resizeTarget, setResizeTarget] = useState(RESIZE_PRESETS[0]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addImages = useCallback((files: FileList) => {
    const newImages: BatchImage[] = [];
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      newImages.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        status: "pending",
      });
    });
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const handleReset = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
    setProcessing(false);
  };

  // Process resize locally (no backend needed)
  const processResizeLocal = useCallback(
    async (img: BatchImage): Promise<string> => {
      return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = resizeTarget.w;
          canvas.height = resizeTarget.h;
          const ctx = canvas.getContext("2d")!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(image, 0, 0, resizeTarget.w, resizeTarget.h);
          canvas.toBlob((blob) => {
            resolve(blob ? URL.createObjectURL(blob) : "");
          }, "image/png");
        };
        image.src = img.previewUrl;
      });
    },
    [resizeTarget]
  );

  // Process a single image via API
  const processOneApi = useCallback(
    async (img: BatchImage): Promise<{ resultUrl?: string; genId?: number }> => {
      const fd = new FormData();
      fd.append("image", img.file);
      fd.append("resolution", "1K");

      let res;
      if (operation.value === "cutout") {
        res = await imageAPI.cutout(fd);
      } else {
        fd.append("scale", "2");
        res = await imageAPI.upscale(fd);
      }
      const gen = res.data?.data;
      if (gen?.result_url) return { resultUrl: gen.result_url };
      if (gen?.id) return { genId: gen.id };
      return {};
    },
    [operation]
  );

  // Poll pending generations
  const pollPending = useCallback(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      setImages((prev) => {
        const processingItems = prev.filter((i) => i.status === "processing" && i.genId);
        if (processingItems.length === 0) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setProcessing(false);
          return prev;
        }
        return prev;
      });

      // Check each processing item
      const currentImages = [...images];
      let updated = false;
      for (const img of currentImages) {
        if (img.status !== "processing" || !img.genId) continue;
        try {
          const res = await generationAPI.get(img.genId);
          const gen = res.data?.data;
          if (gen?.status === "completed" && gen.result_url) {
            img.status = "completed";
            img.resultUrl = gen.result_url;
            updated = true;
          } else if (gen?.status === "failed") {
            img.status = "failed";
            img.error = gen.error_msg || "处理失败";
            updated = true;
          }
        } catch {
          // ignore transient errors
        }
      }
      if (updated) setImages([...currentImages]);
    }, 3000);
  }, [images]);

  const handleProcess = useCallback(async () => {
    if (images.length === 0) return;
    setProcessing(true);

    if (operation.value === "resize") {
      // Process locally
      const updated = [...images];
      for (const img of updated) {
        img.status = "processing";
      }
      setImages([...updated]);

      for (const img of updated) {
        try {
          const url = await processResizeLocal(img);
          img.status = "completed";
          img.resultUrl = url;
        } catch {
          img.status = "failed";
          img.error = "处理失败";
        }
      }
      setImages([...updated]);
      setProcessing(false);
    } else {
      // Process via API
      const updated = [...images];
      for (const img of updated) {
        img.status = "processing";
        try {
          const result = await processOneApi(img);
          if (result.resultUrl) {
            img.status = "completed";
            img.resultUrl = result.resultUrl;
          } else if (result.genId) {
            img.genId = result.genId;
          } else {
            img.status = "failed";
            img.error = "无结果";
          }
        } catch (e: any) {
          img.status = "failed";
          img.error = e?.response?.data?.message || "请求失败";
        }
      }
      setImages([...updated]);

      // Start polling for any pending items
      const hasPending = updated.some((i) => i.status === "processing" && i.genId);
      if (hasPending) {
        pollPending();
      } else {
        setProcessing(false);
      }
    }
  }, [images, operation, processResizeLocal, processOneApi, pollPending]);

  const completedCount = images.filter((i) => i.status === "completed").length;
  const failedCount = images.filter((i) => i.status === "failed").length;

  // Download all completed images
  const handleDownloadAll = useCallback(() => {
    images.forEach((img, idx) => {
      if (img.resultUrl) {
        const a = document.createElement("a");
        a.href = img.resultUrl;
        a.download = `batch-${operation.value}-${idx + 1}.png`;
        a.click();
      }
    });
  }, [images, operation]);

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
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-neutral-600 flex items-center justify-center shadow-md shadow-neutral-300/50">
            <LayoutGrid size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">图片批处理</h1>
            <p className="text-xs text-neutral-400">一站式批量修图，高效处理</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {images.length > 0 && (
            <>
              <span className="text-xs text-neutral-400">
                {images.length} 张 · 完成 {completedCount}{failedCount > 0 && ` · 失败 ${failedCount}`}
              </span>
              <button onClick={handleReset} className="px-3 py-1.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors flex items-center gap-1.5">
                <RotateCcw size={14} /> 清空
              </button>
              <button
                onClick={handleProcess}
                disabled={processing || images.length === 0}
                className="px-4 py-1.5 rounded-lg bg-neutral-800 text-white text-sm font-medium hover:bg-neutral-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {processing ? <><Loader2 size={14} className="animate-spin" /> 处理中...</> : "开始处理"}
              </button>
              {completedCount > 0 && (
                <button
                  onClick={handleDownloadAll}
                  className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors flex items-center gap-1.5"
                >
                  <Download size={14} /> 下载全部
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden overflow-y-auto md:overflow-y-hidden">
        {/* Main area */}
        <div className="flex-1 flex flex-col bg-neutral-50 dark:bg-neutral-950">
          {images.length > 0 ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {images.map((img) => (
                  <div key={img.id} className="relative rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm group">
                    <div className="aspect-square">
                      <img
                        src={img.resultUrl || img.previewUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {/* Status overlay */}
                    {img.status === "processing" && (
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                        <Loader2 size={20} className="text-white animate-spin" />
                      </div>
                    )}
                    {img.status === "completed" && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                    {img.status === "failed" && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center" title={img.error}>
                        <AlertCircle size={12} className="text-white" />
                      </div>
                    )}
                    {/* Remove button */}
                    <button
                      onClick={() => removeImage(img.id)}
                      className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {/* Add more button */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="aspect-square rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 flex flex-col items-center justify-center text-neutral-400 hover:text-neutral-500 hover:border-neutral-400 transition-colors"
                >
                  <Plus size={24} />
                  <span className="text-xs mt-1">添加更多</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <div className="w-20 h-20 rounded-3xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mx-auto mb-6">
                  <LayoutGrid size={32} className="text-neutral-400" />
                </div>
                <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">图片批处理</h2>
                <p className="text-neutral-500 mb-6">批量上传图片，一键处理</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-6 py-3 rounded-xl bg-neutral-800 text-white font-medium hover:bg-neutral-700 transition-colors flex items-center gap-2 mx-auto"
                >
                  <Plus size={16} /> 选择图片
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        {images.length > 0 && (
          <motion.div
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="w-full md:w-[260px] border-t md:border-t-0 md:border-l border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 md:overflow-y-auto p-4 sm:p-5 space-y-6 shrink-0"
          >
            {/* Operation picker */}
            <div>
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">处理方式</h3>
              <div className="space-y-2">
                {OPERATIONS.map((op) => {
                  const Icon = op.icon;
                  return (
                    <button
                      key={op.value}
                      onClick={() => setOperation(op)}
                      className={cn(
                        "w-full px-3 py-2.5 rounded-xl border transition-all text-left flex items-center gap-3",
                        operation.value === op.value
                          ? "bg-neutral-50 border-neutral-300 dark:bg-neutral-800 dark:border-neutral-600"
                          : "border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                      )}
                    >
                      <Icon size={16} className={cn(
                        operation.value === op.value ? "text-neutral-800 dark:text-neutral-200" : "text-neutral-400"
                      )} />
                      <div>
                        <p className={cn("text-xs font-medium", operation.value === op.value ? "text-neutral-800 dark:text-neutral-200" : "text-neutral-600")}>{op.label}</p>
                        <p className="text-[10px] text-neutral-400">{op.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Resize options */}
            {operation.value === "resize" && (
              <div>
                <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">目标尺寸</h3>
                <div className="flex flex-wrap gap-1.5">
                  {RESIZE_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => setResizeTarget(p)}
                      className={cn(
                        "px-2.5 py-1.5 rounded-lg text-xs border transition-all",
                        resizeTarget.label === p.label
                          ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-medium"
                          : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Progress bar */}
            {processing && (
              <div>
                <div className="flex justify-between text-xs text-neutral-500 mb-1">
                  <span>处理进度</span>
                  <span>{completedCount + failedCount} / {images.length}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${((completedCount + failedCount) / images.length) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => e.target.files && addImages(e.target.files)}
      />
    </div>
  );
}
