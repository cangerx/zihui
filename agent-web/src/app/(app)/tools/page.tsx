"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Search, LayoutGrid as GridIcon } from "lucide-react";
import { useAppsStore, type AppInfo } from "@/store/apps";
import { getIcon } from "@/lib/icon-map";
import { usePageTitle } from "@/hooks/use-page-title";

const CATEGORY_LABELS: Record<string, string> = {
  ai_creation: "AI 创作",
  ecommerce: "AI 商拍",
  image_tool: "图像处理",
  ai_design: "AI 设计",
};

const CATEGORY_ORDER = ["ai_creation", "ecommerce", "image_tool", "ai_design"];

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } } };

function ToolCard({ app }: { app: AppInfo }) {
  const Icon = getIcon(app.icon);
  return (
    <motion.div variants={fadeUp} whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
      <Link
        href={app.route}
        className="group rounded-2xl overflow-hidden border border-neutral-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-900/80 hover:shadow-lg hover:border-neutral-200 dark:hover:border-neutral-700 transition-all block"
      >
        <div className={`aspect-[4/3] ${app.bg_color || "bg-neutral-50 dark:bg-neutral-900/50"} flex items-center justify-center relative overflow-hidden`}>
          <Icon size={28} className="text-neutral-400/30 group-hover:scale-110 transition-transform duration-300" />
          <div className="absolute bottom-2 left-2 p-1.5 rounded-lg glass-subtle">
            <Icon size={14} className="text-neutral-500" />
          </div>
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/[0.02] dark:group-hover:bg-white/[0.03] transition-colors duration-300" />
        </div>
        <div className="px-3 py-2.5">
          <h3 className="text-sm font-semibold text-neutral-900 mb-0.5">{app.name}</h3>
          <p className="text-xs text-neutral-400 truncate">{app.description}</p>
        </div>
      </Link>
    </motion.div>
  );
}

export default function ToolsPage() {
  usePageTitle("AI 工具");
  const [searchQuery, setSearchQuery] = useState("");
  const { apps, loaded, fetchApps, toolApps } = useAppsStore();

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  const grouped = useMemo(() => {
    const all = toolApps();
    const q = searchQuery.toLowerCase().trim();
    const filtered = q
      ? all.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
      : all;

    const groups: { category: string; label: string; apps: AppInfo[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const items = filtered.filter((a) => a.category === cat);
      if (items.length > 0) {
        groups.push({ category: cat, label: CATEGORY_LABELS[cat] || cat, apps: items });
      }
    }
    // uncategorized
    const known = new Set(CATEGORY_ORDER);
    const other = filtered.filter((a) => !known.has(a.category));
    if (other.length > 0) {
      groups.push({ category: "other", label: "其他", apps: other });
    }
    return groups;
  }, [apps, searchQuery, toolApps]);

  const isSearching = searchQuery.trim().length > 0;
  const hasResults = grouped.length > 0;

  return (
    <div className="h-full flex flex-col bg-[#fafafa] dark:bg-[#0A0A0A]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-neutral-100 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center">
              <GridIcon size={16} className="text-neutral-400" />
            </div>
            <h1 className="text-base font-semibold text-neutral-900">工具中心</h1>
          </div>
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索工具..."
              className="w-full pl-8 pr-4 py-2 rounded-xl border border-neutral-200/60 dark:border-neutral-700/60 bg-white/60 dark:bg-neutral-800/60 text-sm outline-none focus:border-neutral-300 dark:focus:border-neutral-600 focus:bg-white dark:focus:bg-neutral-800 focus:shadow-sm transition-all"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-10">
        {!loaded && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {loaded && grouped.map((group) => (
          <motion.section key={group.category} initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-40px" }} variants={stagger}>
            <motion.h2 variants={fadeUp} className="text-lg font-bold text-neutral-900 mb-4">{group.label}</motion.h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
              {group.apps.map((app) => (
                <ToolCard key={app.key} app={app} />
              ))}
            </div>
          </motion.section>
        ))}

        {/* No results */}
        {loaded && isSearching && !hasResults && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search size={32} className="text-neutral-200 mb-3" />
            <p className="text-sm text-neutral-500">未找到"{searchQuery}"相关工具</p>
            <p className="text-xs text-neutral-400 mt-1">试试其他关键词</p>
          </div>
        )}
      </div>
    </div>
  );
}
