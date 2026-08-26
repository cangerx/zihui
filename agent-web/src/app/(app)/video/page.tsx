"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { motion } from "framer-motion";
import { Video, Type, Image as ImageIcon, Loader2, Sparkles, Download, Clock, Zap } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { videoAPI } from "@/lib/api";
import ImageUploader from "@/components/ui/image-uploader";
import { downloadImage } from "@/lib/download";
import { useModulesStore } from "@/store/modules";
import { usePageTitle } from "@/hooks/use-page-title";
import { useOptimizePrompt } from "@/hooks/use-optimize-prompt";

type Mode = "text" | "image";

const DURATIONS = ["4 秒", "8 秒"];
const RATIOS = ["16:9", "9:16", "1:1"];

export default function VideoPage() {
  return (
    <Suspense fallback={null}>
      <VideoContent />
    </Suspense>
  );
}

function VideoContent() {
  usePageTitle("AI 视频");
  const [mode, setMode] = useState<Mode>("text");
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState(searchParams.get("prompt") || "");
  const autoTriggered = useRef(false);
  const [duration, setDuration] = useState("4 秒");
  const [ratio, setRatio] = useState("16:9");
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const { optimizing: promptOptimizing, optimize: optimizePrompt } = useOptimizePrompt();
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const { isEnabled, loaded, fetchModules } = useModulesStore();

  useEffect(() => {
    if (!loaded) fetchModules();
  }, [loaded, fetchModules]);

  const handleGenerate = async () => {
    if (!prompt.trim() && mode === "text") return;
    if (!uploadedFile && mode === "image") return;
    setGenerating(true);
    setResultUrl("");
    try {
      if (mode === "image" && uploadedFile) {
        const fd = new FormData();
        fd.append("image", uploadedFile);
        fd.append("prompt", prompt);
        fd.append("duration", duration);
        fd.append("ratio", ratio);
        const res = await videoAPI.generateFromImage(fd);
        if (res.data?.data?.result_url) setResultUrl(res.data.data.result_url);
      } else {
        const res = await videoAPI.generate({ prompt, mode, duration, ratio });
        if (res.data?.data?.result_url) setResultUrl(res.data.data.result_url);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  // Auto-generate when arriving with auto=1
  useEffect(() => {
    const auto = searchParams.get("auto");
    if (auto === "1" && prompt.trim() && mode === "text" && !autoTriggered.current && !generating) {
      autoTriggered.current = true;
      handleGenerate();
    }
  }, [prompt, mode]);

  const canGenerate = mode === "text" ? prompt.trim().length > 0 : !!uploadedFile;

  if (loaded && !isEnabled("video")) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-[#fafafa]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-md px-6"
        >
          <motion.div
            animate={{ rotate: [0, 10, -10, 0] }}
            transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
            className="w-20 h-20 rounded-3xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-6 shadow-sm"
          >
            <Clock size={32} className="text-red-400" />
          </motion.div>
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">AI 视频</h1>
          <p className="text-neutral-500 mb-1">功能正在开发中，敬请期待</p>
          <p className="text-sm text-neutral-400">我们正在全力打造更优质的视频生成体验</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Left controls */}
      <motion.div
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }}
        className="w-full md:w-[360px] border-b md:border-b-0 md:border-r border-neutral-100 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm flex flex-col shrink-0 max-h-[50vh] md:max-h-none"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-100/60 dark:border-neutral-800/60">
          <motion.div
            whileHover={{ scale: 1.1, rotate: 5 }}
            className="w-9 h-9 rounded-xl bg-red-500 flex items-center justify-center shadow-md shadow-red-200/50"
          >
            <Video size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900">AI 视频</h1>
            <p className="text-xs text-neutral-400">图片或文字生成短视频</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Mode picker */}
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">生成模式</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setMode("text")}
                className={cn(
                  "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                  mode === "text" ? "border-red-500 bg-red-50/50" : "border-neutral-200/60 hover:border-neutral-300"
                )}
              >
                <Type size={20} className={mode === "text" ? "text-red-600" : "text-neutral-400"} />
                <span className="text-xs font-medium text-neutral-900">文字生成</span>
              </button>
              <button
                onClick={() => setMode("image")}
                className={cn(
                  "flex flex-col items-center gap-2 p-4 rounded-xl border transition-all",
                  mode === "image" ? "border-red-500 bg-red-50/50" : "border-neutral-200/60 hover:border-neutral-300"
                )}
              >
                <ImageIcon size={20} className={mode === "image" ? "text-red-600" : "text-neutral-400"} />
                <span className="text-xs font-medium text-neutral-900">图片生成</span>
              </button>
            </div>
          </div>

          {/* Image upload for image mode */}
          {mode === "image" && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">上传图片</label>
              <ImageUploader
                onFileSelect={(file, url) => { setUploadedFile(file); setPreviewUrl(url); }}
                previewUrl={previewUrl}
                onClear={() => { setUploadedFile(null); setPreviewUrl(""); }}
                accentColor="neutral"
                hint="上传静态图片"
                subHint="让它动起来"
              />
            </div>
          )}

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-neutral-700">
                {mode === "text" ? "描述词" : "动作描述 (可选)"}
              </label>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => optimizePrompt(prompt, setPrompt)}
                disabled={promptOptimizing || !prompt.trim()}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-colors",
                  promptOptimizing || !prompt.trim() ? "text-neutral-300 cursor-not-allowed" : "text-neutral-500 hover:bg-neutral-100/80"
                )}
              >
                {promptOptimizing ? <Loader2 size={11} className="text-amber-400 animate-spin" /> : <Zap size={11} className="text-amber-400" />} 优化提示词
              </motion.button>
            </div>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={mode === "text" ? "描述你想生成的视频场景..." : "描述图片中的动作，如：缓缓转头微笑..."}
              className="w-full px-3 py-2 rounded-xl border border-neutral-200/60 bg-white/60 text-sm outline-none focus:border-neutral-300 focus:shadow-sm resize-none transition-all"
            />
          </div>

          {/* Duration & Ratio */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-neutral-700 mb-2">时长</label>
              <div className="flex gap-1.5">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs transition-colors",
                      duration === d ? "bg-neutral-900 text-white" : "bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-neutral-700 mb-2">比例</label>
              <div className="flex gap-1.5">
                {RATIOS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRatio(r)}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs transition-colors",
                      ratio === r ? "bg-neutral-900 text-white" : "bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-neutral-200/60">
          <button
            disabled={!canGenerate || generating}
            onClick={handleGenerate}
            className="w-full py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-40 transition-colors flex items-center justify-center gap-2 shadow-md"
          >
            {generating ? (
              <><Loader2 size={16} className="animate-spin" /> 生成中...</>
            ) : (
              <><Sparkles size={16} /> 生成视频</>
            )}
          </button>
        </div>
      </motion.div>

      {/* Right: Preview */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="flex-1 flex items-center justify-center p-6 bg-[#fafafa]"
      >
        {resultUrl ? (
          <div className="text-center">
            <video
              src={resultUrl}
              controls
              autoPlay
              loop
              className="max-w-2xl max-h-[70vh] rounded-2xl shadow-lg border border-neutral-200/60"
            />
            <button
              onClick={() => downloadImage(resultUrl, "video.mp4")}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-neutral-200/60 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              <Download size={14} /> 下载视频
            </button>
          </div>
        ) : (
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
              <Video size={28} className="text-red-300" />
            </div>
            <h2 className="text-base font-semibold text-neutral-900 mb-1">AI 视频生成</h2>
            <p className="text-sm text-neutral-400">
              {mode === "text" ? "输入描述词，生成短视频" : "上传图片，让它动起来"}
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
