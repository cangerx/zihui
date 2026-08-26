"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Sparkles,
  Loader2,
  X,
  ZoomIn,
  ZoomOut,
  Heart,
  Eye,
  Star,
  ImageOff,
  Lightbulb,
  Copy,
  Check,
  Compass,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { inspirationAPI } from "@/lib/api";
import LazyImage from "@/components/ui/lazy-image";
import { usePageTitle } from "@/hooks/use-page-title";

/* ═══════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════ */
interface InspirationItem {
  id: number;
  title: string;
  description: string;
  image_url: string;
  thumb_url?: string;
  tag: string;
  author: string;
  author_avatar: string;
  likes: number;
  views: number;
  prompt: string;
  model_used: string;
  width: number;
  height: number;
  featured: boolean;
}

/* ═══════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════ */
const TAGS = [
  "全部", "电商", "美食", "人像", "建筑", "自然", "科技", "抽象", "插画", "3D", "海报", "摄影",
];

const PLACEHOLDER_COLORS = [
  "bg-orange-200 dark:bg-orange-900/40", "bg-violet-200 dark:bg-violet-900/40",
  "bg-amber-200 dark:bg-amber-900/40", "bg-emerald-200 dark:bg-emerald-900/40",
  "bg-rose-200 dark:bg-rose-900/40", "bg-sky-200 dark:bg-sky-900/40",
  "bg-lime-200 dark:bg-lime-900/40", "bg-fuchsia-200 dark:bg-fuchsia-900/40",
];

const formatNum = (n: number) => {
  if (n >= 10000) return (n / 10000).toFixed(1) + "w";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
};

/* ═══════════════════════════════════════════════════════
   Inspiration Gallery — 灵感广场
   ═══════════════════════════════════════════════════════ */
export default function InspirationPage() {
  usePageTitle("灵感广场");
  const router = useRouter();

  /* ── State ── */
  const [activeTag, setActiveTag] = useState("全部");
  const [items, setItems] = useState<InspirationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<InspirationItem | null>(null);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  /* ── Fetch ── */
  const fetchInspirations = useCallback(async (p: number, tag: string, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await inspirationAPI.list({
        page: p, page_size: 24,
        tag: tag === "全部" ? undefined : tag,
      });
      const data = res.data;
      if (append) setItems((prev) => [...prev, ...(data.data ?? [])]);
      else setItems(data.data ?? []);
      setTotal(data.total ?? 0);
    } catch { /* handled */ } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    fetchInspirations(1, activeTag);
  }, [activeTag, fetchInspirations]);

  const hasMore = items.length < total;

  /* ── Infinite scroll ── */
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
        setPage((p) => {
          const next = p + 1;
          fetchInspirations(next, activeTag, true);
          return next;
        });
      }
    }, { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadingMore, loading, activeTag, fetchInspirations]);

  const copyPrompt = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="h-full flex flex-col bg-[#fafafa] dark:bg-[#0A0A0A]">

      {/* ═══════ HERO ═══════ */}
      <div className="relative overflow-hidden bg-orange-50/60 dark:bg-orange-950/20">
        <div className="relative px-6 py-8 md:py-10 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shadow-lg shadow-orange-200/50 dark:shadow-orange-900/30">
                <Compass size={18} className="text-white" />
              </div>
              <h1 className="text-xl md:text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                发现灵感
              </h1>
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed max-w-md">
              探索 AI 创作的精彩作品，获取灵感并一键复用提示词
            </p>
          </motion.div>
        </div>
      </div>

      {/* ═══════ TAG BAR ═══════ */}
      <div className="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-100 dark:border-neutral-800 px-5 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {TAGS.map((tag) => (
            <motion.button
              key={tag}
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveTag(tag)}
              className={cn(
                "relative px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0",
                activeTag === tag
                  ? "text-white shadow-md"
                  : "bg-neutral-100/80 dark:bg-neutral-800/80 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/80 dark:hover:bg-neutral-700/80 hover:text-neutral-700 dark:hover:text-neutral-300"
              )}
            >
              {activeTag === tag && (
                <motion.div
                  layoutId="tag-active-bg"
                  className="absolute inset-0 rounded-full bg-neutral-900 dark:bg-neutral-100"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative z-10">{tag}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* ═══════ MASONRY GRID ═══════ */}
      <div className="flex-1 overflow-y-auto" ref={gridRef}>
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-neutral-400" />
              <span className="text-xs text-neutral-400">加载中...</span>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-neutral-400">
            <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <ImageOff size={28} className="text-neutral-300 dark:text-neutral-600" />
            </div>
            <p className="text-sm font-medium">暂无作品</p>
            <p className="text-xs mt-1 text-neutral-300">换个标签试试？</p>
          </div>
        ) : (
          <div className="p-4 md:p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
              {items.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: (i % 12) * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  className="group cursor-pointer"
                  onClick={() => { setSelected(item); setZoom(1); }}
                >
                  <div className={cn(
                    "relative rounded-2xl overflow-hidden border border-white/60 dark:border-neutral-800 shadow-sm hover:shadow-lg transition-all duration-300",
                    item.featured && "ring-1 ring-amber-200/60 dark:ring-amber-800/40"
                  )}>
                    {item.image_url ? (
                      <div className="aspect-[4/5] relative overflow-hidden bg-neutral-100 dark:bg-neutral-800">
                        <LazyImage
                          src={item.image_url} thumbSrc={item.thumb_url} alt={item.title}
                          className="w-full h-full group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300" />

                        {/* Featured badge */}
                        {item.featured && (
                          <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-full bg-amber-500 text-[10px] text-white font-bold flex items-center gap-1 shadow-lg shadow-amber-200/50">
                            <Star size={10} fill="white" /> 推荐
                          </div>
                        )}

                        {/* Stats + info on hover */}
                        <div className="absolute bottom-0 left-0 right-0 p-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <p className="text-[11px] text-white font-medium line-clamp-1">{item.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-white/70">{item.author || "匿名"}</span>
                            <span className="flex items-center gap-0.5 text-[10px] text-white/70 ml-auto">
                              <Heart size={9} /> {formatNum(item.likes)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={cn("aspect-[4/5] flex items-center justify-center", PLACEHOLDER_COLORS[item.id % PLACEHOLDER_COLORS.length])}>
                        <Lightbulb size={28} className="text-white/50" />
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="py-8 text-center">
              {loadingMore ? (
                <div className="inline-flex items-center gap-2 text-sm text-neutral-400">
                  <Loader2 size={16} className="animate-spin text-neutral-400" /> 加载更多...
                </div>
              ) : !hasMore && items.length > 0 ? (
                <p className="text-xs text-neutral-300 dark:text-neutral-600">— 已经到底了 —</p>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* ═══════ DETAIL MODAL ═══════ */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="relative bg-white dark:bg-neutral-900 shadow-2xl w-full h-full md:rounded-3xl md:max-w-4xl md:mx-4 md:max-h-[90vh] md:h-auto flex flex-col md:flex-row overflow-hidden"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              {/* Image side */}
              <div className="flex-1 bg-neutral-100 dark:bg-neutral-950 flex items-center justify-center p-4 md:p-6 relative min-h-[280px] overflow-hidden">
                {selected.image_url ? (
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    style={{ transform: `scale(${zoom})`, transition: "transform 0.25s cubic-bezier(0.22,1,0.36,1)" }}
                  >
                    <img
                      src={selected.image_url}
                      alt=""
                      className="max-w-full max-h-[70vh] object-contain rounded-xl shadow-lg"
                      draggable={false}
                    />
                  </motion.div>
                ) : (
                  <div className={cn("w-48 h-48 rounded-3xl flex items-center justify-center", PLACEHOLDER_COLORS[selected.id % PLACEHOLDER_COLORS.length])}>
                    <Lightbulb size={36} className="text-white/40" />
                  </div>
                )}
                {/* Zoom controls */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 dark:bg-neutral-800/90 backdrop-blur-lg rounded-xl shadow-lg px-3 py-1.5 border border-neutral-200/50 dark:border-neutral-700/50">
                  <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors">
                    <ZoomOut size={14} className="text-neutral-600 dark:text-neutral-400" />
                  </button>
                  <span className="text-[11px] text-neutral-500 min-w-[44px] text-center font-medium">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors">
                    <ZoomIn size={14} className="text-neutral-600 dark:text-neutral-400" />
                  </button>
                </div>
              </div>

              {/* Info side */}
              <div className="w-full md:w-[320px] border-t md:border-t-0 md:border-l border-neutral-100 dark:border-neutral-800 flex flex-col">
                {/* Author header */}
                <div className="flex items-center justify-between p-5 border-b border-neutral-100 dark:border-neutral-800">
                  <div className="flex items-center gap-2.5">
                    {selected.author_avatar ? (
                      <img src={selected.author_avatar} alt="" className="w-8 h-8 rounded-full object-cover ring-2 ring-neutral-100 dark:ring-neutral-800" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{selected.author || "匿名"}</p>
                      {selected.tag && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-900/30 text-orange-500 font-medium">{selected.tag}</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setSelected(null)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors">
                    <X size={16} className="text-neutral-400" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div>
                    <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50 mb-1.5">{selected.title}</h3>
                    {selected.description && (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">{selected.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                      <Eye size={13} /> {formatNum(selected.views)}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                      <Heart size={13} /> {formatNum(selected.likes)}
                    </span>
                    {selected.featured && (
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[11px] font-bold flex items-center gap-1">
                        <Star size={10} fill="currentColor" /> 推荐
                      </span>
                    )}
                  </div>

                  {selected.prompt && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">提示词</label>
                        <button
                          onClick={() => copyPrompt(selected.prompt)}
                          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                        >
                          {copied ? <><Check size={10} /> 已复制</> : <><Copy size={10} /> 复制</>}
                        </button>
                      </div>
                      <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed bg-neutral-50 dark:bg-neutral-800/50 rounded-xl p-3.5 border border-neutral-100 dark:border-neutral-800">
                        {selected.prompt}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="bg-neutral-50 dark:bg-neutral-800/50 rounded-xl p-3 border border-neutral-100 dark:border-neutral-800">
                      <label className="block text-[10px] text-neutral-400 mb-1 font-medium">模型</label>
                      <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{selected.model_used || "—"}</p>
                    </div>
                    <div className="bg-neutral-50 dark:bg-neutral-800/50 rounded-xl p-3 border border-neutral-100 dark:border-neutral-800">
                      <label className="block text-[10px] text-neutral-400 mb-1 font-medium">尺寸</label>
                      <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        {selected.width && selected.height ? `${selected.width}×${selected.height}` : "—"}
                      </p>
                    </div>
                  </div>
                </div>

                {selected.prompt && (
                  <div className="p-5 border-t border-neutral-100 dark:border-neutral-800">
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        const p = selected.prompt;
                        if (p) {
                          router.push(`/generate?prompt=${encodeURIComponent(p)}${selected.model_used ? `&model=${encodeURIComponent(selected.model_used)}` : ""}`);
                        }
                      }}
                      className="w-full py-3 rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-bold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors flex items-center justify-center gap-2"
                    >
                      <Sparkles size={14} /> 使用提示词生成
                    </motion.button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
