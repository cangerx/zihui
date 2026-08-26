"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Expand, Download, Loader2, AlertCircle, RotateCcw, Eye, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI } from "@/lib/api";
import ImageUploader from "@/components/ui/image-uploader";
import ResolutionPicker from "@/components/ui/resolution-picker";
import BeforeAfterCompare from "@/components/ui/before-after-compare";
import { downloadImage } from "@/lib/download";
import { usePollGeneration } from "@/hooks/use-poll-generation";
import { usePageTitle } from "@/hooks/use-page-title";

const DIRECTIONS = [
  { name: "四周", value: "all" },
  { name: "向左", value: "left" },
  { name: "向右", value: "right" },
  { name: "向上", value: "up" },
  { name: "向下", value: "down" },
];

const SCALES = ["1.5x", "2x", "3x"];

type ViewMode = "preview" | "compare";

export default function ExpandPage() {
  usePageTitle("AI 扩图");
  const [previewUrl, setPreviewUrl] = useState("");
  const [direction, setDirection] = useState("all");
  const [scale, setScale] = useState("2x");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resolution, setResolution] = useState("1K");
  const [prompt, setPrompt] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const { result: pollResult, polling, error: pollError, startPolling, reset: resetPoll } = usePollGeneration();

  const finalResultUrl = pollResult?.status === "completed" ? pollResult.result_url || "" : resultUrl;
  const isProcessing = processing || polling;
  const errorMsg = pollError || (pollResult?.status === "failed" ? pollResult.error_msg : null);

  const handleFileSelect = (file: File, url: string) => {
    setUploadedFile(file);
    setPreviewUrl(url);
    setResultUrl("");
    setViewMode("preview");
    resetPoll();
  };

  const handleExpand = async () => {
    if (!uploadedFile) return;
    setProcessing(true);
    setResultUrl("");
    try {
      const fd = new FormData();
      fd.append("image", uploadedFile);
      fd.append("direction", direction);
      fd.append("scale", scale);
      fd.append("resolution", resolution);
      if (prompt) fd.append("prompt", prompt);
      const res = await imageAPI.expand(fd);
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
    setViewMode("preview");
    resetPoll();
  };

  useEffect(() => {
    if (finalResultUrl) setViewMode("compare");
  }, [finalResultUrl]);

  // Direction-based padding for visual preview
  const expandPadding = useMemo(() => {
    const px = scale === "1.5x" ? 24 : scale === "2x" ? 40 : 56;
    switch (direction) {
      case "left": return { paddingLeft: px };
      case "right": return { paddingRight: px };
      case "up": return { paddingTop: px };
      case "down": return { paddingBottom: px };
      default: return { padding: px };
    }
  }, [direction, scale]);

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
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-cyan-500 flex items-center justify-center shadow-md shadow-cyan-200/50">
            <Expand size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">AI 扩图</h1>
            <p className="text-xs text-neutral-400">AI 延展画面，智能生成超出画面的内容</p>
          </div>
        </div>

        {previewUrl && (
          <div className="flex items-center gap-2 flex-wrap">
            {!finalResultUrl && (
              <>
                <div className="flex gap-1 px-1.5 py-1 rounded-lg bg-neutral-50 border border-neutral-200/60">
                  {DIRECTIONS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setDirection(d.value)}
                      className={cn(
                        "px-2 py-1 rounded text-xs transition-colors",
                        direction === d.value ? "bg-cyan-500 text-white font-medium" : "text-neutral-500 hover:bg-neutral-100"
                      )}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 px-1.5 py-1 rounded-lg bg-neutral-50 border border-neutral-200/60">
                  {SCALES.map((s) => (
                    <button
                      key={s}
                      onClick={() => setScale(s)}
                      className={cn(
                        "px-2 py-1 rounded text-xs transition-colors",
                        scale === s ? "bg-cyan-500 text-white font-medium" : "text-neutral-500 hover:bg-neutral-100"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}

            <ResolutionPicker value={resolution} onChange={setResolution} />

            {finalResultUrl && (
              <div className="flex gap-0.5 px-1 py-0.5 rounded-lg bg-neutral-50 border border-neutral-200/60">
                <button
                  onClick={() => setViewMode("preview")}
                  className={cn("p-1.5 rounded transition-colors", viewMode === "preview" ? "bg-white shadow-sm text-cyan-600" : "text-neutral-400 hover:text-neutral-600")}
                  title="结果"
                >
                  <Layers size={14} />
                </button>
                <button
                  onClick={() => setViewMode("compare")}
                  className={cn("p-1.5 rounded transition-colors", viewMode === "compare" ? "bg-white shadow-sm text-cyan-600" : "text-neutral-400 hover:text-neutral-600")}
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
                onClick={handleExpand}
                disabled={isProcessing}
                className="px-4 py-1.5 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {isProcessing ? <><Loader2 size={14} className="animate-spin" /> 处理中...</> : <><Expand size={14} /> 开始扩展</>}
              </button>
            )}
            <button
              onClick={() => finalResultUrl && downloadImage(finalResultUrl, `expand-${resolution}.png`)}
              disabled={!finalResultUrl}
              className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors flex items-center gap-1.5"
            >
              <Download size={14} /> 下载
            </button>
          </div>
        )}
      </motion.div>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {previewUrl && !finalResultUrl && (
          <div className="px-4 sm:px-6 py-2 border-b border-neutral-100 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/50">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述扩展区域的内容（可选，如：延伸的沙滩和海浪）"
              className="w-full text-sm bg-transparent outline-none text-neutral-700 dark:text-neutral-300 placeholder:text-neutral-400"
            />
          </div>
        )}

        <div className="flex-1 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4 sm:p-6">
          {previewUrl ? (
            finalResultUrl && viewMode === "compare" ? (
              <BeforeAfterCompare
                beforeSrc={previewUrl}
                afterSrc={finalResultUrl}
                beforeLabel="原图"
                afterLabel="扩展结果"
                className="max-w-2xl w-full"
              />
            ) : finalResultUrl && viewMode === "preview" ? (
              <motion.img
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                src={finalResultUrl}
                alt="扩展结果"
                className="max-w-2xl max-h-[70vh] rounded-xl shadow-lg"
              />
            ) : (
              <div className="relative">
                <div
                  className="border-2 border-dashed border-cyan-300/60 rounded-xl transition-all duration-300"
                  style={expandPadding}
                >
                  <img src={previewUrl} alt="" className="max-w-xl max-h-[55vh] rounded-lg shadow-lg" />
                </div>
                <p className="text-center text-xs text-neutral-400 mt-3">
                  虚线区域为 AI 扩展范围 · {direction === "all" ? "四周" : DIRECTIONS.find(d => d.value === direction)?.name} · {scale}
                </p>
                {isProcessing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-xl">
                    <div className="bg-white/90 backdrop-blur-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin text-cyan-500" />
                      <span className="text-sm text-neutral-700">AI 扩展中...</span>
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
            )
          ) : (
            <ImageUploader
              onFileSelect={handleFileSelect}
              accentColor="cyan"
              hint="上传图片，AI 延展画面"
              subHint="智能生成超出画面边界的内容"
              className="max-w-md w-full"
            />
          )}
        </div>
      </div>
    </div>
  );
}
