"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Clock, Loader2, User, Image as ImageIcon, AlertCircle, Pencil, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { generationAPI } from "@/lib/api";
import LazyImage from "@/components/ui/lazy-image";
import { useAuthStore } from "@/store/auth";
import { useLoginModalStore } from "@/store/login-modal";
import { usePageTitle } from "@/hooks/use-page-title";
import Link from "next/link";

const TYPE_LABELS: Record<string, string> = {
  image: "文生图",
  product_photo: "商品图",
  poster: "海报",
  cutout: "抠图",
  eraser: "消除",
  expand: "扩图",
  upscale: "超分",
};

interface Generation {
  id: number;
  type: string;
  model: string;
  prompt: string;
  params?: { size?: string; ratio?: string; resolution?: string; quality?: string; n?: number };
  result_url: string;
  thumb_url?: string;
  status: string;
  error_msg?: string;
  created_at: string;
}

export default function RecentPage() {
  usePageTitle("最近打开");
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecent = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await generationAPI.list({ page: 1, page_size: 30 });
      setItems(res.data?.data ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-[#fafafa]">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mx-auto mb-4">
            <User size={24} className="text-neutral-400" />
          </div>
          <h3 className="text-sm font-medium text-neutral-600 mb-1">请先登录</h3>
          <p className="text-xs text-neutral-400 max-w-xs mb-4">登录后可查看最近打开的项目</p>
          <button
            onClick={() => useLoginModalStore.getState().openLoginModal()}
            className="px-6 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors shadow-md"
          >
            去登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#fafafa] dark:bg-[#0A0A0A]">
      <div className="px-4 sm:px-6 pt-5 pb-3 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-100/60 dark:border-neutral-800/60">
        <div className="flex items-center gap-2.5">
          <Clock size={18} className="text-neutral-500" />
          <h1 className="text-base font-semibold text-neutral-900">最近打开</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="text-neutral-300 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Clock size={36} className="text-neutral-200 mb-3" />
            <p className="text-sm text-neutral-400">暂无最近记录</p>
            <p className="text-xs text-neutral-300 mt-1">使用 AI 工具创作后会自动记录在这里</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2.5">
            {items.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <div className="group relative rounded-xl overflow-hidden bg-white dark:bg-neutral-900 border border-neutral-200/60 dark:border-neutral-800/60 shadow-sm hover:shadow-md transition-all">
                  {item.status === "failed" ? (
                    <div className="w-full aspect-[4/5] bg-red-50 dark:bg-red-900/10 flex flex-col items-center justify-center gap-1">
                      <AlertCircle size={20} className="text-red-300" />
                      <p className="text-[10px] text-red-400">生成失败</p>
                    </div>
                  ) : item.result_url ? (
                    <LazyImage src={item.result_url} thumbSrc={item.thumb_url} alt="" className="w-full aspect-[4/5]" />
                  ) : (
                    <div className="w-full aspect-[4/5] bg-neutral-50 dark:bg-neutral-800 flex items-center justify-center">
                      <Loader2 size={20} className="text-blue-300 animate-spin" />
                    </div>
                  )}
                  {item.status === "completed" && (
                    <>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link
                          href={`/generate?prompt=${encodeURIComponent(item.prompt || "")}&image=${encodeURIComponent(item.result_url || "")}`}
                          className="p-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors"
                          title="编辑"
                        >
                          <Pencil size={12} />
                        </Link>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-[10px] text-white/90 line-clamp-1">{item.prompt || "—"}</p>
                        <div className="flex items-center flex-wrap gap-1 mt-0.5">
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/20 text-white/80">
                            {TYPE_LABELS[item.type] || item.type}
                          </span>
                          {item.model && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/20 text-white/80">
                              {item.model}
                            </span>
                          )}
                          {item.params?.resolution && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/30 text-white/90">
                              {item.params.resolution}
                            </span>
                          )}
                          {item.params?.ratio && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/30 text-white/90">
                              {item.params.ratio}
                            </span>
                          )}
                          {item.params?.size && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/30 text-white/90">
                              {item.params.size}
                            </span>
                          )}
                          <span className="text-[9px] text-white/60">
                            {new Date(item.created_at).toLocaleDateString("zh-CN")}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
