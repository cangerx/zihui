"use client";

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ShoppingBag, Loader2, Sparkles, Download, Minus, Plus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI, generationAPI } from "@/lib/api";
import ImageUploader from "@/components/ui/image-uploader";
import { downloadImage } from "@/lib/download";
import { usePageTitle } from "@/hooks/use-page-title";
import { useOptimizePrompt } from "@/hooks/use-optimize-prompt";

const SCENES = [
  { name: "白底", preview: "bg-white border border-neutral-100" },
  { name: "场景", preview: "bg-amber-50 dark:bg-amber-950/30" },
  { name: "户外", preview: "bg-green-50 dark:bg-green-950/30" },
  { name: "室内", preview: "bg-blue-50 dark:bg-blue-950/30" },
  { name: "节日", preview: "bg-red-50 dark:bg-red-950/30" },
  { name: "简约", preview: "bg-neutral-50 dark:bg-neutral-900/50" },
];

const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const RATIO_LABELS: Record<string, string> = {
  "1:1": "方图", "3:4": "竖图", "4:3": "横图", "9:16": "长竖图", "16:9": "宽横图",
};

export default function ProductPhotoPage() {
  return (
    <Suspense fallback={null}>
      <ProductPhotoContent />
    </Suspense>
  );
}

function ProductPhotoContent() {
  usePageTitle("AI 商品图");

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [activeScene, setActiveScene] = useState("白底");
  const [activeRatio, setActiveRatio] = useState("1:1");
  const [generating, setGenerating] = useState(false);
  const [count, setCount] = useState(1);
  const [results, setResults] = useState<any[]>([]);
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState(searchParams.get("prompt") || "");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { optimizing: promptOptimizing, optimize: optimizePrompt } = useOptimizePrompt();

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const pollGeneration = useCallback((genId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await generationAPI.get(genId);
        const gen = res.data?.data;
        if (gen?.status === "completed" || gen?.status === "failed") {
          setResults((prev) => prev.map((r) => (r.id === genId ? gen : r)));
          setGenerating(false);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    }, 3000);
  }, []);

  const doGenerate = async () => {
    if (!uploadedFile || generating) return;
    setGenerating(true);
    setResults([]);
    try {
      const fd = new FormData();
      fd.append("image", uploadedFile);
      fd.append("scene", activeScene);
      fd.append("ratio", activeRatio);
      if (prompt) fd.append("prompt", prompt);
      const res = await imageAPI.productPhoto(fd);
      const gen = res.data?.data;
      setResults([gen]);
      if (gen?.id && gen?.status !== "completed") {
        pollGeneration(gen.id);
      } else {
        setGenerating(false);
      }
    } catch (e: any) {
      console.error(e);
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-full">
      <motion.div
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }}
        className="w-full md:w-[340px] border-b md:border-b-0 md:border-r border-neutral-100 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm flex flex-col shrink-0 max-h-[50vh] md:max-h-none"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-100/60 dark:border-neutral-800/60">
          <div className="w-9 h-9 rounded-xl bg-blue-500 flex items-center justify-center shadow-md shadow-blue-200/40">
            <ShoppingBag size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900">AI 商品图</h1>
            <p className="text-xs text-neutral-400">上传商品，一键生成场景图</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Upload */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">上传商品图</label>
            <ImageUploader
              onFileSelect={(file: File, url: string) => { setUploadedFile(file); setPreviewUrl(url); }}
              previewUrl={previewUrl}
              onClear={() => { setUploadedFile(null); setPreviewUrl(""); }}
              accentColor="blue"
              hint="点击或拖拽上传"
              subHint="支持 JPG/PNG/WebP"
            />
          </div>

          {/* Scene */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">场景</label>
            <div className="grid grid-cols-3 gap-2">
              {SCENES.map((scene) => (
                <button
                  key={scene.name}
                  onClick={() => setActiveScene(scene.name)}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2 rounded-xl border transition-all",
                    activeScene === scene.name
                      ? "border-blue-500 bg-blue-50/50 shadow-sm"
                      : "border-neutral-200/60 hover:border-neutral-300"
                  )}
                >
                  <div className={cn("w-full aspect-square rounded-lg", scene.preview)} />
                  <span className="text-[11px] text-neutral-600">{scene.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Ratio */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">比例</label>
            <div className="flex gap-1.5">
              {RATIOS.map((r) => (
                <button
                  key={r}
                  onClick={() => setActiveRatio(r)}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-xs transition-all text-center",
                    activeRatio === r
                      ? "bg-neutral-900 text-white shadow-sm"
                      : "bg-neutral-50 text-neutral-500 hover:bg-neutral-100"
                  )}
                >
                  {RATIO_LABELS[r] || r}
                </button>
              ))}
            </div>
          </div>

          {/* Count */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">数量</label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCount(Math.max(1, count - 1))}
                className="w-8 h-8 rounded-lg bg-neutral-50 flex items-center justify-center hover:bg-neutral-100 transition-colors"
              >
                <Minus size={14} className="text-neutral-500" />
              </button>
              <span className="text-sm font-semibold w-6 text-center text-neutral-900">{count}</span>
              <button
                onClick={() => setCount(Math.min(4, count + 1))}
                className="w-8 h-8 rounded-lg bg-neutral-50 flex items-center justify-center hover:bg-neutral-100 transition-colors"
              >
                <Plus size={14} className="text-neutral-500" />
              </button>
            </div>
          </div>

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider">描述 (可选)</label>
              <button
                onClick={() => optimizePrompt(prompt, setPrompt)}
                disabled={promptOptimizing || !prompt.trim()}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-colors",
                  promptOptimizing || !prompt.trim() ? "text-neutral-300 cursor-not-allowed" : "text-neutral-500 hover:bg-neutral-100/80"
                )}
              >
                {promptOptimizing ? <Loader2 size={11} className="text-amber-400 animate-spin" /> : <Zap size={11} className="text-amber-400" />} 优化提示词
              </button>
            </div>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述商品卖点或想要的效果，如：高端护肤品，简约大气的白色背景..."
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200/60 bg-neutral-50/50 text-sm outline-none focus:border-blue-300 focus:bg-white focus:shadow-sm resize-none transition-all"
            />
          </div>
        </div>

        <div className="p-4 border-t border-neutral-100/60 dark:border-neutral-800/60">
          <button
            disabled={!uploadedFile || generating}
            onClick={doGenerate}
            className="w-full py-2.5 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 hover:shadow-lg hover:shadow-blue-200/50 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            {generating ? (
              <><Loader2 size={16} className="animate-spin" /> 生成中...</>
            ) : (
              <><Sparkles size={16} /> 生成商品图</>
            )}
          </button>
        </div>
      </motion.div>

      {/* Right: Result grid */}
      <div className="flex-1 p-6 overflow-y-auto bg-[#fafafa] dark:bg-[#0A0A0A]">
        {results.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {results.map((r: any, i: number) => (
              <motion.div
                key={r?.id || i}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.08, duration: 0.3 }}
                className="group relative rounded-2xl overflow-hidden border border-neutral-200/60 bg-white shadow-sm hover:shadow-lg transition-shadow"
              >
                {r?.result_url ? (
                  <img src={r.result_url} alt="" className="w-full aspect-square object-cover" />
                ) : (
                  <div className="aspect-square flex items-center justify-center">
                    <div className="text-center">
                      <Loader2 size={20} className="mx-auto text-blue-400 animate-spin mb-2" />
                      <p className="text-xs text-neutral-400">
                        {r?.status === "failed" ? `失败: ${r?.error_msg || "未知错误"}` : "生成中..."}
                      </p>
                    </div>
                  </div>
                )}
                {r?.result_url && (
                  <button
                    onClick={() => downloadImage(r.result_url, `product-${i + 1}.png`)}
                    className="absolute bottom-3 right-3 p-2 rounded-xl bg-black/50 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Download size={14} />
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <ShoppingBag size={40} className="mx-auto text-neutral-200 mb-3" />
              <p className="text-sm text-neutral-400">上传商品图后点击生成</p>
              <p className="text-xs text-neutral-300 mt-1">AI 将为你生成专业商品场景图</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
