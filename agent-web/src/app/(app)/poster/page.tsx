"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Image as ImageIcon, Sparkles, Loader2, Download, Minus, Plus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI, modelAPI, generationAPI } from "@/lib/api";
import { downloadImage } from "@/lib/download";
import { usePageTitle } from "@/hooks/use-page-title";
import { useOptimizePrompt } from "@/hooks/use-optimize-prompt";

interface ImageModelConfig {
  resolutions?: { values: string[]; default: string };
  ratios?: { values: string[]; default: string };
  qualities?: { values: string[]; default: string };
  max_count?: { values: string[]; default: string };
  formats?: { values: string[]; default: string };
  backgrounds?: { values: string[]; default: string };
}
interface ImageModel {
  name: string;
  display_name: string;
  provider: string;
  badge: string;
  versions?: { name: string; model: string; tag?: string }[] | null;
  config: ImageModelConfig;
}

const RATIO_LABELS: Record<string, string> = {
  auto: "自适应", "1:1": "方图 1:1", "2:3": "竖图 2:3", "3:4": "竖图 3:4",
  "4:5": "竖图 4:5", "9:16": "竖图 9:16", "3:2": "横图 3:2", "4:3": "横图 4:3",
  "5:4": "横图 5:4", "16:9": "横图 16:9", "21:9": "横图 21:9",
};
const RESOLUTION_LABELS: Record<string, string> = { "1K": "标清 1K", "2K": "高清 2K", "4K": "超清 4K" };

const CATEGORIES = ["全部", "电商促销", "社交媒体", "节日", "美食", "教育", "科技", "地产"];

export default function PosterPage() {
  return (
    <Suspense fallback={null}>
      <PosterContent />
    </Suspense>
  );
}

function PosterContent() {
  usePageTitle("AI 海报");
  const [models, setModels] = useState<ImageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [resolution, setResolution] = useState("1K");
  const [ratio, setRatio] = useState("1:1");
  const [quality, setQuality] = useState("");
  const [count, setCount] = useState(1);
  const searchParams = useSearchParams();
  const [prompt, setPrompt] = useState(searchParams.get("prompt") || "");
  const [category, setCategory] = useState("全部");
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { optimizing: promptOptimizing, optimize: optimizePrompt } = useOptimizePrompt();
  const autoTriggered = useRef(false);

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

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    modelAPI.imageModels().then((res) => {
      const data: ImageModel[] = res.data?.data ?? [];
      setModels(data);
      if (data.length > 0) {
        setSelectedModel(data[0].name);
        applyDefaults(data[0]);
      }
    }).catch(() => {});
  }, []);

  const doGenerate = async (p: string, model: string) => {
    if (!p.trim()) return;
    setGenerating(true);
    try {
      const res = await imageAPI.poster({
        prompt: p,
        category,
        model,
        resolution,
        size: ratio,
        quality: quality || undefined,
      });
      const gen = res.data?.data;
      const arr = Array.isArray(gen) ? gen : [gen];
      setResults(arr);
      const pending = arr.find((r: any) => r?.id && r?.status !== "completed");
      if (pending) {
        pollGeneration(pending.id);
      } else {
        setGenerating(false);
      }
    } catch (e) { console.error(e); setGenerating(false); }
  };

  // Auto-fill prompt from URL query param & auto-generate
  useEffect(() => {
    const urlPrompt = searchParams.get("prompt");
    if (urlPrompt && !prompt) setPrompt(urlPrompt);
  }, [searchParams]);

  useEffect(() => {
    const auto = searchParams.get("auto");
    if (auto === "1" && prompt.trim() && selectedModel && !autoTriggered.current && !generating) {
      autoTriggered.current = true;
      doGenerate(prompt, selectedModel);
    }
  }, [prompt, selectedModel]);

  function applyDefaults(m: ImageModel) {
    const cfg = m.config;
    if (cfg.resolutions) setResolution(cfg.resolutions.default || cfg.resolutions.values[0] || "1K");
    if (cfg.ratios) setRatio(cfg.ratios.default || cfg.ratios.values[0] || "1:1");
    if (cfg.qualities) setQuality(cfg.qualities.default || cfg.qualities.values[0] || "");
    else setQuality("");
    const mc = parseInt(cfg.max_count?.default || "1", 10);
    setCount(Math.min(count, mc) || 1);
  }

  function selectModel(name: string) {
    setSelectedModel(name);
    setSelectedVersion("");
    const m = models.find((x) => x.name === name);
    if (m) applyDefaults(m);
  }

  function selectVersion(v: { name: string; model: string }) {
    setSelectedVersion(v.name);
    const m = models.find((x) => x.name === v.model);
    if (m) {
      setSelectedModel(m.name);
      applyDefaults(m);
    }
  }

  const currentModel = models.find((m) => m.name === selectedModel);
  const cfg = currentModel?.config;
  const maxCount = parseInt(cfg?.max_count?.default || "4", 10);

  return (
    <div className="flex flex-col md:flex-row h-full">
      <motion.div
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }}
        className="w-full md:w-[360px] border-b md:border-b-0 md:border-r border-neutral-100 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm flex flex-col shrink-0 max-h-[50vh] md:max-h-none"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-100/60 dark:border-neutral-800/60">
          <motion.div
            whileHover={{ scale: 1.1, rotate: 5 }}
            whileTap={{ scale: 0.95 }}
            className="w-9 h-9 rounded-xl bg-purple-500 flex items-center justify-center shadow-md shadow-purple-200/40"
          >
            <ImageIcon size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900">AI 海报</h1>
            <p className="text-xs text-neutral-400">描述需求，一键生成海报</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Model Selection */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">模型选择</label>
            <div className="flex flex-wrap gap-2">
              {models.map((m) => (
                <motion.button
                  key={m.name}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => selectModel(m.name)}
                  className={cn(
                    "relative px-3 py-1.5 rounded-lg text-xs border transition-all",
                    selectedModel === m.name
                      ? "border-purple-500 bg-purple-50 text-purple-700 font-medium shadow-sm"
                      : "border-neutral-200/60 text-neutral-600 hover:border-neutral-300"
                  )}
                >
                  {m.display_name}
                  {m.badge && (
                    <span className={cn(
                      "absolute -top-2 -right-2 text-[10px] px-1 rounded-full font-bold",
                      m.badge === "New" ? "bg-red-500 text-white" : "bg-amber-500 text-white"
                    )}>{m.badge}</span>
                  )}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Version Selection */}
          <AnimatePresence>
          {currentModel?.versions && currentModel.versions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">版本选择</label>
              <div className="flex gap-2">
                {currentModel.versions.map((v) => (
                  <motion.button
                    key={v.name}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => selectVersion(v)}
                    className={cn(
                      "relative px-4 py-1.5 rounded-lg text-xs border transition-all",
                      (selectedVersion === v.name || (!selectedVersion && v.model === selectedModel))
                        ? "border-purple-500 bg-purple-50 text-purple-700 font-medium shadow-sm"
                        : "border-neutral-200/60 text-neutral-600 hover:border-neutral-300"
                    )}
                  >
                    {v.name}
                    {v.tag && <span className="ml-1 text-[10px] bg-orange-100 text-orange-600 px-1 rounded-full">{v.tag}</span>}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
          </AnimatePresence>

          {/* Resolution */}
          {cfg?.resolutions && cfg.resolutions.values.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">分辨率</label>
              <div className="flex rounded-xl bg-neutral-100/80 p-0.5">
                {cfg.resolutions.values.map((r) => (
                  <button
                    key={r}
                    onClick={() => setResolution(r)}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs transition-all",
                      resolution === r
                        ? "bg-white text-neutral-900 shadow-sm font-medium"
                        : "text-neutral-400 hover:text-neutral-600"
                    )}
                  >
                    {RESOLUTION_LABELS[r] || r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Aspect Ratio */}
          {cfg?.ratios && cfg.ratios.values.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">出图尺寸</label>
              <div className="flex flex-wrap gap-1.5">
                {cfg.ratios.values.map((r) => (
                  <motion.button
                    key={r}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setRatio(r)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs transition-all",
                      ratio === r
                        ? "bg-neutral-900 text-white shadow-sm"
                        : "bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
                    )}
                  >
                    {RATIO_LABELS[r] || r}
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* Quality */}
          {cfg?.qualities && cfg.qualities.values.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">图像质量</label>
              <div className="flex rounded-xl bg-neutral-100/80 p-0.5">
                {cfg.qualities.values.map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs transition-all",
                      quality === q
                        ? "bg-white text-neutral-900 shadow-sm font-medium"
                        : "text-neutral-400 hover:text-neutral-600"
                    )}
                  >
                    {q === 'low' ? '低画质' : q === 'medium' || q === 'standard' ? '标准' : q === 'high' || q === 'hd' ? '高清' : q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Count */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">出图数量</label>
            <div className="flex items-center gap-3">
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setCount(Math.max(1, count - 1))}
                className="w-8 h-8 rounded-lg bg-neutral-50 flex items-center justify-center hover:bg-neutral-100 transition-colors"
              >
                <Minus size={14} className="text-neutral-500" />
              </motion.button>
              <motion.span
                key={count}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-sm font-semibold w-6 text-center text-neutral-900"
              >
                {count}
              </motion.span>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setCount(Math.min(maxCount, count + 1))}
                className="w-8 h-8 rounded-lg bg-neutral-50 flex items-center justify-center hover:bg-neutral-100 transition-colors"
              >
                <Plus size={14} className="text-neutral-500" />
              </motion.button>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">分类</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <motion.button
                  key={c}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs transition-all",
                    category === c ? "bg-purple-500 text-white shadow-sm" : "bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
                  )}
                >
                  {c}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider">海报描述</label>
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
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="描述你要生成的海报内容，如：双十一电商促销活动，红色主题，大字标题50%off..."
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200/60 dark:border-neutral-700/60 bg-neutral-50/50 dark:bg-neutral-800/50 text-sm outline-none focus:border-purple-300 focus:bg-white dark:focus:bg-neutral-800 focus:shadow-sm resize-none transition-all"
            />
          </div>
        </div>

        <div className="p-5 border-t border-neutral-100/60 dark:border-neutral-800/60">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            disabled={!prompt.trim() || generating}
            onClick={() => doGenerate(prompt, selectedModel)}
            className="w-full py-2.5 rounded-xl bg-purple-500 text-white text-sm font-medium hover:bg-purple-600 hover:shadow-lg hover:shadow-purple-200/50 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            {generating ? (
              <><Loader2 size={16} className="animate-spin" /> 生成中...</>
            ) : (
              <><Sparkles size={16} /> 生成海报</>
            )}
          </motion.button>
        </div>
      </motion.div>

      {/* Right: Preview */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="flex-1 p-6 overflow-y-auto bg-[#fafafa] dark:bg-[#0A0A0A]"
      >
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {results.length > 0
            ? results.map((r: any, i: number) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.08, duration: 0.3 }}
                  className="group relative aspect-[9/16] rounded-2xl overflow-hidden border border-neutral-200/60 bg-white shadow-sm hover:shadow-lg transition-shadow"
                >
                  {r?.result_url ? (
                    <img src={r.result_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="text-center">
                        <Loader2 size={20} className="mx-auto text-purple-400 animate-spin mb-2" />
                        <p className="text-xs text-neutral-400">{r?.status === 'pending' ? '生成中...' : '完成'}</p>
                      </div>
                    </div>
                  )}
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => r?.result_url && downloadImage(r.result_url, `poster-${i + 1}.png`)}
                    className="absolute bottom-3 right-3 p-2 rounded-xl bg-black/50 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Download size={14} />
                  </motion.button>
                </motion.div>
              ))
            : [1, 2, 3, 4, 5, 6].map((i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="aspect-[9/16] rounded-2xl bg-white/80 border border-dashed border-neutral-200 flex items-center justify-center"
                >
                  <div className="text-center">
                    <ImageIcon size={24} className="mx-auto text-neutral-200 mb-1.5" />
                    <p className="text-[11px] text-neutral-300">海报 {i}</p>
                  </div>
                </motion.div>
              ))}
        </div>
      </motion.div>
    </div>
  );
}
