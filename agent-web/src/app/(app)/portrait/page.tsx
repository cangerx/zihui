"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { UserCircle, Download, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI, uploadAPI } from "@/lib/api";
import ImageUploader from "@/components/ui/image-uploader";
import ResolutionPicker from "@/components/ui/resolution-picker";
import { downloadImage } from "@/lib/download";
import { usePollGeneration } from "@/hooks/use-poll-generation";
import { usePageTitle } from "@/hooks/use-page-title";

const STYLES = [
  { label: "商务正装", value: "business-formal", bg: "bg-slate-100 dark:bg-slate-900/30", desc: "职业西装形象" },
  { label: "商务休闲", value: "business-casual", bg: "bg-blue-100 dark:bg-blue-900/30", desc: "轻商务风格" },
  { label: "文艺写真", value: "artistic", bg: "bg-amber-100 dark:bg-amber-900/30", desc: "温暖文艺风格" },
  { label: "时尚杂志", value: "fashion", bg: "bg-pink-100 dark:bg-pink-900/30", desc: "时尚杂志封面" },
  { label: "古典国风", value: "chinese-classic", bg: "bg-red-100 dark:bg-red-900/30", desc: "中国风古装" },
  { label: "校园青春", value: "campus", bg: "bg-green-100 dark:bg-green-900/30", desc: "校园风格" },
  { label: "赛博科技", value: "cyberpunk", bg: "bg-violet-100 dark:bg-violet-900/30", desc: "赛博朋克风" },
  { label: "简约证件", value: "simple-id", bg: "bg-neutral-100 dark:bg-neutral-800", desc: "简约证件照" },
];

export default function PortraitPage() {
  usePageTitle("形象照");
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [resolution, setResolution] = useState("1K");
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0]);
  const { result: pollResult, polling, error: pollError, startPolling, reset: resetPoll } = usePollGeneration();

  const finalResultUrl = pollResult?.status === "completed" ? pollResult.result_url || "" : resultUrl;
  const isProcessing = processing || polling;
  const errorMsg = pollError || (pollResult?.status === "failed" ? pollResult.error_msg : null);

  const handleFileSelect = (file: File, url: string) => {
    setUploadedFile(file);
    setPreviewUrl(url);
    setResultUrl("");
    resetPoll();
  };

  const STYLE_PROMPTS: Record<string, string> = {
    "business-formal": "Professional business portrait photo, person wearing formal suit, clean studio lighting, corporate headshot, neutral background, high quality",
    "business-casual": "Business casual portrait, smart casual outfit, soft natural lighting, modern office background, professional yet approachable",
    "artistic": "Artistic portrait photo, warm golden hour lighting, bokeh background, cinematic composition, soft warm tones, fine art photography",
    "fashion": "High fashion magazine cover portrait, dramatic studio lighting, stylish outfit, editorial pose, vibrant colors, Vogue style",
    "chinese-classic": "Chinese traditional portrait, elegant hanfu costume, classical Chinese painting style background, soft lighting, cultural aesthetic",
    "campus": "Youthful campus portrait, casual student outfit, sunny outdoor setting, green campus background, fresh and energetic vibe",
    "cyberpunk": "Cyberpunk style portrait, neon lights, futuristic outfit, tech-noir aesthetic, glowing accents, dark urban background",
    "simple-id": "Clean simple ID portrait photo, plain white background, formal attire, even studio lighting, passport photo style",
  };

  const handleGenerate = async () => {
    if (!uploadedFile) return;
    setProcessing(true);
    setResultUrl("");
    try {
      // Upload reference image first
      const uploadRes = await uploadAPI.upload(uploadedFile);
      const imageUrl = uploadRes.data?.data?.url || uploadRes.data?.url;
      if (!imageUrl) { setProcessing(false); return; }

      const prompt = STYLE_PROMPTS[selectedStyle.value] || `Professional portrait photo in ${selectedStyle.label} style, high quality, studio lighting`;
      const res = await imageAPI.generate({
        prompt,
        resolution,
        image_urls: [imageUrl],
      });
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
    resetPoll();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="flex items-center justify-between px-6 py-3 border-b border-neutral-100 dark:border-neutral-800 glass shrink-0"
      >
        <div className="flex items-center gap-3">
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-rose-500 flex items-center justify-center shadow-md shadow-rose-200/50">
            <UserCircle size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">形象照</h1>
            <p className="text-xs text-neutral-400">AI 换装变装，一键生成多风格形象照</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ResolutionPicker value={resolution} onChange={setResolution} />
          {finalResultUrl ? (
            <>
              <button onClick={handleReset} className="px-3 py-1.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors flex items-center gap-1.5">
                <RotateCcw size={14} /> 重新上传
              </button>
              <button
                onClick={() => downloadImage(finalResultUrl, `portrait-${selectedStyle.value}-${resolution}.png`)}
                className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors flex items-center gap-1.5"
              >
                <Download size={14} /> 下载
              </button>
            </>
          ) : previewUrl ? (
            <button
              onClick={handleGenerate}
              disabled={isProcessing}
              className="px-4 py-1.5 rounded-lg bg-rose-500 text-white text-sm font-medium hover:bg-rose-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {isProcessing ? <><Loader2 size={14} className="animate-spin" /> 处理中...</> : <><UserCircle size={14} /> 生成形象照</>}
            </button>
          ) : null}
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {previewUrl ? (
          <>
            {/* Preview */}
            <div className="flex-1 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6">
              <div className="relative">
                <img
                  src={finalResultUrl || previewUrl}
                  alt=""
                  className="max-w-md max-h-[65vh] rounded-xl shadow-lg"
                />
                {isProcessing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl">
                    <div className="bg-white/90 backdrop-blur-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin text-rose-500" />
                      <span className="text-sm text-neutral-700">AI 生成中...</span>
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
            </div>

            {/* Right panel — style picker */}
            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="w-[280px] border-l border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-y-auto p-5 space-y-4 shrink-0"
            >
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">选择风格</h3>
              <div className="grid grid-cols-2 gap-2">
                {STYLES.map((style) => (
                  <button
                    key={style.value}
                    onClick={() => setSelectedStyle(style)}
                    className={cn(
                      "rounded-xl overflow-hidden border transition-all text-left",
                      selectedStyle.value === style.value
                        ? "border-rose-400 ring-2 ring-rose-200 dark:ring-rose-800"
                        : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-300"
                    )}
                  >
                    <div className={`aspect-[3/2] ${style.bg} flex items-center justify-center`}>
                      <UserCircle size={24} className="text-neutral-400/40" />
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">{style.label}</p>
                      <p className="text-[10px] text-neutral-400">{style.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <ImageUploader
              onFileSelect={handleFileSelect}
              accentColor="rose"
              hint="上传人像照片"
              subHint="AI 一键生成多风格形象照"
              className="max-w-md w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
