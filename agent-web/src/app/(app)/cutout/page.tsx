"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Scissors, Download, Loader2, AlertCircle, RotateCcw, Eye, Layers } from "lucide-react";
import { imageAPI } from "@/lib/api";
import ImageUploader from "@/components/ui/image-uploader";
import ResolutionPicker from "@/components/ui/resolution-picker";
import BeforeAfterCompare from "@/components/ui/before-after-compare";
import { downloadImage } from "@/lib/download";
import { usePollGeneration } from "@/hooks/use-poll-generation";
import { cn } from "@/lib/utils";
import { usePageTitle } from "@/hooks/use-page-title";

const BG_COLORS = [
  { name: "透明", value: "transparent", style: "bg-[repeating-conic-gradient(#e5e7eb_0%_25%,white_0%_50%)] bg-[length:12px_12px]" },
  { name: "白色", value: "#ffffff", style: "bg-white border border-neutral-200" },
  { name: "黑色", value: "#000000", style: "bg-black" },
  { name: "灰色", value: "#6b7280", style: "bg-gray-500" },
  { name: "蓝色", value: "#3b82f6", style: "bg-blue-500" },
  { name: "绿色", value: "#22c55e", style: "bg-green-500" },
];

const AI_SCENES = [
  { name: "纯色渐变", gradient: "from-blue-200 via-purple-100 to-pink-200" },
  { name: "暖色渐变", gradient: "from-amber-100 via-orange-100 to-rose-100" },
  { name: "冷色渐变", gradient: "from-cyan-100 via-blue-100 to-indigo-100" },
  { name: "日落", gradient: "from-orange-200 via-pink-200 to-purple-200" },
  { name: "森林", gradient: "from-green-100 via-emerald-100 to-teal-100" },
  { name: "极简灰", gradient: "from-neutral-100 to-neutral-200" },
];

type ViewMode = "result" | "compare";

export default function CutoutPage() {
  usePageTitle("智能抠图");
  const [previewUrl, setPreviewUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [resolution, setResolution] = useState("1K");
  const [viewMode, setViewMode] = useState<ViewMode>("result");
  const { result: pollResult, polling, error: pollError, startPolling, reset: resetPoll } = usePollGeneration();

  const finalResultUrl = pollResult?.status === "completed" ? pollResult.result_url || "" : resultUrl;
  const isProcessing = processing || polling;
  const errorMsg = pollError || (pollResult?.status === "failed" ? pollResult.error_msg : null);

  const [selectedBg, setSelectedBg] = useState("transparent");
  const [selectedScene, setSelectedScene] = useState<string | null>(null);

  const handleFileSelect = (file: File, url: string) => {
    setUploadedFile(file);
    setPreviewUrl(url);
    setResultUrl("");
    setSelectedBg("transparent");
    setSelectedScene(null);
    setViewMode("result");
  };

  const handleCutout = async () => {
    if (!uploadedFile) return;
    setProcessing(true);
    setResultUrl("");
    try {
      const fd = new FormData();
      fd.append("image", uploadedFile);
      fd.append("resolution", resolution);
      const res = await imageAPI.cutout(fd);
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
    setSelectedBg("transparent");
    setSelectedScene(null);
    setViewMode("result");
    resetPoll();
  };

  const bgStyle = selectedScene
    ? `bg-gradient-to-br ${AI_SCENES.find((s) => s.name === selectedScene)?.gradient || ""}`
    : selectedBg === "transparent"
      ? "bg-[repeating-conic-gradient(#e5e7eb_0%_25%,white_0%_50%)] bg-[length:16px_16px]"
      : "";

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
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-200/50">
            <Scissors size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">智能抠图</h1>
            <p className="text-xs text-neutral-400">AI 一键去除背景，支持 1K~4K 输出</p>
          </div>
        </div>

        {previewUrl && (
          <div className="flex items-center gap-2 flex-wrap">
            <ResolutionPicker value={resolution} onChange={setResolution} />

            {finalResultUrl && (
              <div className="flex gap-0.5 px-1 py-0.5 rounded-lg bg-neutral-50 border border-neutral-200/60">
                <button
                  onClick={() => setViewMode("result")}
                  className={cn("p-1.5 rounded transition-colors", viewMode === "result" ? "bg-white shadow-sm text-emerald-600" : "text-neutral-400 hover:text-neutral-600")}
                  title="结果视图"
                >
                  <Layers size={14} />
                </button>
                <button
                  onClick={() => setViewMode("compare")}
                  className={cn("p-1.5 rounded transition-colors", viewMode === "compare" ? "bg-white shadow-sm text-emerald-600" : "text-neutral-400 hover:text-neutral-600")}
                  title="对比视图"
                >
                  <Eye size={14} />
                </button>
              </div>
            )}

            {finalResultUrl && (
              <button onClick={handleReset} className="px-3 py-1.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors flex items-center gap-1.5">
                <RotateCcw size={14} /> 重新上传
              </button>
            )}
            {!finalResultUrl && (
              <button
                onClick={handleCutout}
                disabled={isProcessing || !uploadedFile}
                className="px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                {isProcessing ? <><Loader2 size={14} className="animate-spin" /> 处理中...</> : <><Scissors size={14} /> 开始抠图</>}
              </button>
            )}
            <button
              onClick={() => finalResultUrl && downloadImage(finalResultUrl, `cutout-${resolution}.png`)}
              disabled={!finalResultUrl}
              className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors flex items-center gap-1.5"
            >
              <Download size={14} /> 下载
            </button>
          </div>
        )}
      </motion.div>

      {/* Content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {previewUrl ? (
          <>
            {/* Main area */}
            <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
              {finalResultUrl && viewMode === "compare" ? (
                <BeforeAfterCompare
                  beforeSrc={previewUrl}
                  afterSrc={finalResultUrl}
                  beforeLabel="原图"
                  afterLabel="抠图结果"
                  className="max-w-2xl w-full"
                />
              ) : (
                <div
                  className={cn("flex items-center justify-center rounded-2xl p-4 transition-colors duration-300", finalResultUrl ? bgStyle : "")}
                  style={finalResultUrl && !selectedScene && selectedBg !== "transparent" ? { backgroundColor: selectedBg } : {}}
                >
                  <div className="relative max-w-lg w-full">
                    {finalResultUrl ? (
                      <motion.img
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        src={finalResultUrl}
                        alt="抠图结果"
                        className="w-full rounded-xl shadow-xl"
                      />
                    ) : (
                      <>
                        <img src={previewUrl} alt="" className="w-full rounded-xl shadow-lg" />
                        {isProcessing && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl">
                            <div className="bg-white/90 backdrop-blur-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-2">
                              <Loader2 size={16} className="animate-spin text-emerald-500" />
                              <span className="text-sm text-neutral-700">AI 处理中...</span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {errorMsg && (
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-50 border border-red-200 px-4 py-2 rounded-xl flex items-center gap-2">
                        <AlertCircle size={14} className="text-red-500" />
                        <span className="text-xs text-red-600">{errorMsg}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right panel (when result ready & in result view) */}
            <AnimatePresence>
              {finalResultUrl && viewMode === "result" && (
                <motion.div
                  initial={{ x: 40, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: 40, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="w-full md:w-[260px] border-t md:border-t-0 md:border-l border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-y-auto p-4 sm:p-5 space-y-6 shrink-0"
                >
                  {/* Background colors */}
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">背景颜色</h3>
                    <div className="flex flex-wrap gap-2.5">
                      {BG_COLORS.map((bg) => (
                        <button
                          key={bg.value}
                          onClick={() => { setSelectedBg(bg.value); setSelectedScene(null); }}
                          className={cn(
                            "w-9 h-9 sm:w-8 sm:h-8 rounded-lg transition-all",
                            bg.style,
                            selectedBg === bg.value && !selectedScene
                              ? "ring-2 ring-emerald-500 ring-offset-2"
                              : "hover:ring-1 hover:ring-neutral-300"
                          )}
                          title={bg.name}
                        />
                      ))}
                    </div>
                  </div>

                  {/* AI Scene templates */}
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">渐变背景</h3>
                    <div className="grid grid-cols-6 md:grid-cols-3 gap-2">
                      {AI_SCENES.map((scene) => (
                        <button
                          key={scene.name}
                          onClick={() => { setSelectedScene(scene.name); setSelectedBg("transparent"); }}
                          className={cn(
                            "aspect-square rounded-lg bg-gradient-to-br transition-all text-[10px] text-neutral-600 flex items-end justify-center pb-1",
                            scene.gradient,
                            selectedScene === scene.name
                              ? "ring-2 ring-emerald-500 ring-offset-1"
                              : "hover:ring-1 hover:ring-neutral-300"
                          )}
                        >
                          {scene.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">智能抠图</h2>
              <p className="text-neutral-500">AI 一键去除背景，支持 1K~4K 高清输出</p>
            </div>
            <ImageUploader
              onFileSelect={handleFileSelect}
              accentColor="emerald"
              hint="上传图片"
              subHint="支持 JPG、PNG、WebP"
              className="max-w-md w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
