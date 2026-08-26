"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Sparkles,
  Loader2,
  Eye,
  LayoutTemplate,
  Palette,
  Camera,
  User,
  Image as ImageIcon,
  PenTool,
  Box,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { promptTemplateAPI } from "@/lib/api";
import LazyImage from "@/components/ui/lazy-image";
import TemplateDetailModal, { type TemplateItem, parseVariables } from "@/components/template-detail-modal";
import { usePageTitle } from "@/hooks/use-page-title";

/* ═══════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════ */
const CATEGORIES = [
  { label: "全部", icon: Layers },
  { label: "Logo", icon: PenTool },
  { label: "商品图", icon: ImageIcon },
  { label: "人像", icon: User },
  { label: "海报", icon: LayoutTemplate },
  { label: "插画", icon: Palette },
  { label: "创意", icon: Sparkles },
  { label: "摄影", icon: Camera },
  { label: "3D", icon: Box },
];

const PLACEHOLDER_COLORS = [
  "bg-violet-200 dark:bg-violet-900/40", "bg-orange-200 dark:bg-orange-900/40",
  "bg-cyan-200 dark:bg-cyan-900/40", "bg-emerald-200 dark:bg-emerald-900/40",
  "bg-rose-200 dark:bg-rose-900/40", "bg-indigo-200 dark:bg-indigo-900/40",
  "bg-lime-200 dark:bg-lime-900/40", "bg-fuchsia-200 dark:bg-fuchsia-900/40",
];

const formatNum = (n: number) => {
  if (n >= 10000) return (n / 10000).toFixed(1) + "w";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
};

/* ═══════════════════════════════════════════════════════
   Templates Page — 模板中心
   ═══════════════════════════════════════════════════════ */
export default function TemplatesPage() {
  usePageTitle("模板中心");

  /* ── State ── */
  const [category, setCategory] = useState("全部");
  const [searchQuery, setSearchQuery] = useState("");
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<TemplateItem | null>(null);

  /* ── Fetch ── */
  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const cat = category === "全部" ? undefined : category;
      const res = await promptTemplateAPI.list(cat);
      setItems(res.data?.data ?? []);
    } catch {} finally { setLoading(false); }
  }, [category]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  /* ── Search filter (client-side) ── */
  const filtered = searchQuery
    ? items.filter((t) =>
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.tags?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : items;

  return (
    <div className="h-full flex flex-col bg-[#fafafa] dark:bg-[#0A0A0A]">

      {/* ═══════ HERO ═══════ */}
      <div className="relative overflow-hidden bg-violet-50/60 dark:bg-violet-950/20">

        <div className="relative px-6 py-8 md:py-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-3xl"
          >
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500 flex items-center justify-center shadow-lg shadow-violet-200/50 dark:shadow-violet-900/30">
                <LayoutTemplate size={18} className="text-white" />
              </div>
              <h1 className="text-xl md:text-2xl font-bold text-neutral-900 dark:text-neutral-50">
                创意模板
              </h1>
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed max-w-md mb-5">
              精选提示词模板，填写变量即可快速生成专业级作品
            </p>

            {/* Search bar */}
            <div className="relative max-w-md">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索模板名称、标签..."
                className="w-full pl-11 pr-4 py-3 rounded-2xl border border-white/60 dark:border-neutral-700/60 bg-white/70 dark:bg-neutral-800/70 backdrop-blur-lg text-sm outline-none focus:border-violet-300 dark:focus:border-violet-600 focus:bg-white dark:focus:bg-neutral-800 focus:shadow-lg focus:shadow-violet-100/30 dark:focus:shadow-violet-900/20 transition-all placeholder:text-neutral-400"
              />
            </div>
          </motion.div>
        </div>
      </div>

      {/* ═══════ CATEGORY BAR ═══════ */}
      <div className="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-lg border-b border-neutral-100 dark:border-neutral-800 px-5 py-3 sticky top-0 z-10">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const active = category === cat.label;
            return (
              <motion.button
                key={cat.label}
                whileTap={{ scale: 0.95 }}
                onClick={() => setCategory(cat.label)}
                className={cn(
                  "relative flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0",
                  active
                    ? "text-white shadow-md"
                    : "bg-neutral-100/80 dark:bg-neutral-800/80 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/80 dark:hover:bg-neutral-700/80 hover:text-neutral-700 dark:hover:text-neutral-300"
                )}
              >
                {active && (
                  <motion.div
                    layoutId="tpl-cat-bg"
                    className="absolute inset-0 rounded-full bg-neutral-900 dark:bg-neutral-100"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <Icon size={13} className="relative z-10" />
                <span className="relative z-10">{cat.label}</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ═══════ TEMPLATE GRID ═══════ */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-neutral-400" />
              <span className="text-xs text-neutral-400">加载中...</span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-neutral-400">
            <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <LayoutTemplate size={28} className="text-neutral-300 dark:text-neutral-600" />
            </div>
            <p className="text-sm font-medium">暂无匹配模板</p>
            <p className="text-xs mt-1 text-neutral-300 dark:text-neutral-600">换个分类或关键词试试</p>
          </div>
        ) : (
          <div className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-neutral-400 font-medium">共 {filtered.length} 个模板</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4">
              {filtered.map((tpl, i) => {
                const vars = parseVariables(tpl.variables);
                return (
                  <motion.div
                    key={tpl.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: Math.min(i * 0.04, 0.5), ease: [0.22, 1, 0.36, 1] }}
                    whileHover={{ y: -5 }}
                    className="group relative rounded-2xl overflow-hidden bg-white dark:bg-neutral-900 cursor-pointer transition-all duration-300 border border-neutral-100 dark:border-neutral-800 hover:shadow-xl hover:shadow-neutral-200/60 dark:hover:shadow-neutral-900/30 hover:border-neutral-200 dark:hover:border-neutral-700"
                    onClick={() => setSelected(tpl)}
                  >
                    {/* Image */}
                    <div className="relative overflow-hidden">
                      {tpl.image_url ? (
                        <LazyImage
                          src={tpl.image_url}
                          thumbSrc={tpl.thumb_url}
                          alt={tpl.title}
                          className="w-full aspect-[3/4] group-hover:scale-[1.05] transition-transform duration-700 ease-out"
                        />
                      ) : (
                        <div className={cn("w-full aspect-[3/4] flex items-center justify-center", PLACEHOLDER_COLORS[tpl.id % PLACEHOLDER_COLORS.length])}>
                          <Sparkles size={32} className="text-white/40" />
                        </div>
                      )}

                      {/* Hover overlay with CTA */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 opacity-0 group-hover:opacity-100 transition-all duration-300 flex flex-col justify-end p-3">
                        <motion.div
                          initial={false}
                          className="opacity-0 group-hover:opacity-100 translate-y-3 group-hover:translate-y-0 transition-all duration-300 delay-75"
                        >
                          <button className="w-full py-2 rounded-xl bg-white/90 dark:bg-neutral-800/90 backdrop-blur-sm text-xs font-bold text-neutral-900 dark:text-neutral-100 hover:bg-white dark:hover:bg-neutral-800 transition-colors shadow-lg flex items-center justify-center gap-1.5">
                            <Sparkles size={12} /> 立即使用
                          </button>
                        </motion.div>
                        <div className="flex items-center gap-2.5 mt-2">
                          {tpl.usage_count > 0 && (
                            <span className="flex items-center gap-1 text-[10px] text-white/80 font-medium">
                              <Eye size={10} /> {formatNum(tpl.usage_count)}
                            </span>
                          )}
                          {vars.length > 0 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/15 backdrop-blur-sm text-white/80 font-medium">
                              {vars.length} 个变量
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-3">
                      <h3 className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-200 truncate">{tpl.title}</h3>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 font-medium">
                          {tpl.category}
                        </span>
                        {tpl.tags && tpl.tags.split(",").slice(0, 1).map((tag) => (
                          <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500">
                            {tag.trim()}
                          </span>
                        ))}
                      </div>
                      {tpl.description && (
                        <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1.5 line-clamp-1">{tpl.description}</p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ═══════ DETAIL MODAL ═══════ */}
      <AnimatePresence>
        {selected && (
          <TemplateDetailModal tpl={selected} onClose={() => setSelected(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
