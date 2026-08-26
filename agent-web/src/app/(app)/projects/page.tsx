"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen,
  Search,
  Plus,
  Loader2,
  Image as ImageIcon,
  User,
  Download,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
  Trash2,
  RotateCcw,
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { generationAPI, inspirationAPI } from "@/lib/api";
import LazyImage from "@/components/ui/lazy-image";
import { downloadImage } from "@/lib/download";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAuthStore } from "@/store/auth";
import { useLoginModalStore } from "@/store/login-modal";
import Link from "next/link";

const TYPE_TABS = [
  { key: "", label: "全部" },
  { key: "image", label: "文生图" },
  { key: "product_photo", label: "商品图" },
  { key: "poster", label: "海报" },
  { key: "cutout", label: "抠图" },
  { key: "eraser", label: "消除" },
  { key: "expand", label: "扩图" },
  { key: "upscale", label: "超分" },
];

interface Generation {
  id: number;
  type: string;
  model: string;
  prompt: string;
  result_url: string;
  thumb_url?: string;
  status: string;
  error_msg: string;
  credits_cost: number;
  created_at: string;
  params: any;
}

export default function ProjectsPage() {
  usePageTitle("我的作品");
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [items, setItems] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Generation | null>(null);
  const [zoom, setZoom] = useState(1);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const pageSize = 24;

  const fetchItems = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await generationAPI.list({ page, page_size: pageSize, type: typeFilter || undefined });
      setItems(res.data?.data ?? []);
      setTotal(res.data?.total ?? 0);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [user, page, typeFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { setPage(1); }, [typeFilter]);

  const totalPages = Math.ceil(total / pageSize);
  const filtered = items.filter((x) => !searchQuery || (x.prompt && x.prompt.toLowerCase().includes(searchQuery.toLowerCase())));

  const openDetail = (item: Generation) => { setSelected(item); setZoom(1); setPublished(false); setImgSize(null); };

  const handlePublish = async () => {
    if (!selected || publishing) return;
    setPublishing(true);
    try { await inspirationAPI.publish({ generation_id: selected.id }); setPublished(true); }
    catch (e: any) {
      const msg = e?.response?.data?.error || e?.message;
      if (msg?.includes("已发布")) setPublished(true);
      else alert(`发布失败：${msg || "未知错误，请稍后重试"}`);
    }
    finally { setPublishing(false); }
  };

  const handleDelete = async (id: number) => {
    try { await generationAPI.delete(id); setItems((prev) => prev.filter((x) => x.id !== id)); setTotal((t) => t - 1); if (selected?.id === id) setSelected(null); } catch {}
  };

  const handleReGenerate = (item: Generation) => {
    if (item.prompt) { const q = encodeURIComponent(item.prompt); window.location.href = `/?prompt=${q}&auto=1`; }
  };

  const handleEdit = (item: Generation) => {
    const params = new URLSearchParams();
    if (item.prompt) params.set("prompt", item.prompt);
    if (item.result_url) params.set("image", item.result_url);
    router.push(`/generate?${params.toString()}`);
  };

  const typeLabel = (t: string) => TYPE_TABS.find((x) => x.key === t)?.label || t;

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-[#fafafa]">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mx-auto mb-4">
            <User size={24} className="text-neutral-400" />
          </div>
          <h3 className="text-sm font-medium text-neutral-600 mb-1">请先登录</h3>
          <p className="text-xs text-neutral-400 max-w-xs mb-4">登录后可查看你的 AI 作品</p>
          <button onClick={() => useLoginModalStore.getState().openLoginModal()} className="px-6 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors shadow-md">
            去登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#fafafa] dark:bg-[#0A0A0A]">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-5 pb-3 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-100/60 dark:border-neutral-800/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <FolderOpen size={18} className="text-neutral-500" />
            <h1 className="text-base font-semibold text-neutral-900">我的作品</h1>
            <span className="text-xs text-neutral-400">{total} 个</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-48 sm:flex-none">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="搜索作品..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-neutral-200/60 bg-white/60 text-xs outline-none focus:border-neutral-300 focus:bg-white transition-all" />
            </div>
            <Link href="/" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white bg-neutral-900 hover:bg-neutral-800 transition-colors shadow-sm">
              <Plus size={13} /> 创作
            </Link>
          </div>
        </div>
        <div className="flex gap-1">
          {TYPE_TABS.map((tab) => (
            <button key={tab.key} onClick={() => setTypeFilter(tab.key)}
              className={cn("px-3 py-1.5 rounded-lg text-xs transition-all", typeFilter === tab.key ? "bg-neutral-900 text-white shadow-sm" : "text-neutral-500 hover:bg-neutral-100")}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 size={24} className="text-neutral-300 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ImageIcon size={36} className="text-neutral-200 mb-3" />
            <p className="text-sm text-neutral-400">暂无作品</p>
            <p className="text-xs text-neutral-300 mt-1">使用 AI 工具创作后，作品将保存在这里</p>
            <Link href="/" className="mt-4 px-5 py-2 rounded-xl bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors flex items-center gap-1.5">
              <Plus size={13} /> 开始创作
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2.5">
              {filtered.map((item) => (
                <motion.div key={item.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                  className="group relative rounded-xl overflow-hidden bg-white border border-neutral-200/60 shadow-sm hover:shadow-md transition-all cursor-pointer"
                  onClick={() => openDetail(item)}>
                  {item.status === "failed" ? (
                    <div className="w-full aspect-[4/5] bg-red-50 flex flex-col items-center justify-center gap-2 relative">
                      <AlertCircle size={24} className="text-red-300" />
                      <p className="text-[11px] text-red-400 font-medium">生成失败</p>
                      <div className="absolute bottom-2 left-2 right-2 flex gap-1.5">
                        <button onClick={(e) => { e.stopPropagation(); handleReGenerate(item); }}
                          className="flex-1 py-1.5 rounded-lg bg-white/90 text-[10px] text-neutral-600 hover:bg-white flex items-center justify-center gap-1 shadow-sm">
                          <RotateCcw size={10} /> 重试
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                          className="py-1.5 px-2.5 rounded-lg bg-white/90 text-[10px] text-red-500 hover:bg-white flex items-center justify-center shadow-sm">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                  ) : item.status === "pending" || item.status === "processing" ? (
                    <div className="w-full aspect-[4/5] bg-neutral-50 flex flex-col items-center justify-center gap-2">
                      <Loader2 size={24} className="text-blue-400 animate-spin" />
                      <p className="text-[11px] text-neutral-400">生成中...</p>
                    </div>
                  ) : item.result_url ? (
                    <LazyImage src={item.result_url} thumbSrc={item.thumb_url} alt={item.prompt || ""} className="w-full aspect-[4/5]" />
                  ) : (
                    <div className="w-full aspect-[4/5] bg-neutral-50 flex items-center justify-center"><ImageIcon size={24} className="text-neutral-200" /></div>
                  )}
                  {item.status === "completed" && (
                    <>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                      <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-[10px] text-white/90 line-clamp-2">{item.prompt || "—"}</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/20 text-white/80">{typeLabel(item.type)}</span>
                          <span className="text-[9px] text-white/60">{item.model}</span>
                        </div>
                      </div>
                    </>
                  )}
                </motion.div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30 transition-colors">
                  <ChevronLeft size={16} className="text-neutral-500" />
                </button>
                <span className="text-xs text-neutral-500">{page} / {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30 transition-colors">
                  <ChevronRight size={16} className="text-neutral-500" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelected(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-white shadow-2xl w-full h-full md:rounded-2xl md:max-w-4xl md:mx-4 md:max-h-[90vh] md:h-auto flex flex-col md:flex-row overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* Image */}
              <div
                className="flex-1 bg-neutral-100 flex items-center justify-center p-4 relative min-h-[300px] overflow-hidden cursor-zoom-in"
                onDoubleClick={() => setZoom((z) => z >= 2 ? 1 : Math.min(4, z * 2))}
                onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.max(0.25, Math.min(4, z + (e.deltaY < 0 ? 0.15 : -0.15)))); }}
              >
                <div style={{ transform: `scale(${zoom})`, transition: "transform 0.2s" }} className="max-w-full max-h-full">
                  {selected.result_url ? (
                    <img src={selected.result_url} alt="" className="max-w-full max-h-[70vh] object-contain rounded-lg" draggable={false}
                      onLoad={(e) => { const img = e.currentTarget; setImgSize({ w: img.naturalWidth, h: img.naturalHeight }); }} />
                  ) : (
                    <div className="w-64 h-64 bg-neutral-200 rounded-xl flex items-center justify-center"><ImageIcon size={40} className="text-neutral-300" /></div>
                  )}
                </div>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm px-2 py-1">
                  <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className="p-1 hover:bg-neutral-100 rounded"><ZoomOut size={14} className="text-neutral-600" /></button>
                  <span className="text-[11px] text-neutral-500 min-w-[40px] text-center">{Math.round(zoom * 100)}%</span>
                  <button onClick={() => setZoom((z) => Math.min(4, z + 0.25))} className="p-1 hover:bg-neutral-100 rounded"><ZoomIn size={14} className="text-neutral-600" /></button>
                  {imgSize && <span className="text-[10px] text-neutral-400 ml-1 border-l border-neutral-200 pl-1.5">{imgSize.w}×{imgSize.h}</span>}
                </div>
              </div>

              {/* Info panel */}
              <div className="w-full md:w-[300px] border-t md:border-t-0 md:border-l border-neutral-100 flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-neutral-100">
                  <h3 className="text-sm font-semibold text-neutral-900">作品详情</h3>
                  <button onClick={() => setSelected(null)} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={16} className="text-neutral-400" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <label className="block text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1">提示词</label>
                    <p className="text-xs text-neutral-700 leading-relaxed bg-neutral-50 rounded-lg p-2.5">{selected.prompt || "无提示词"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-neutral-50 rounded-lg p-2.5">
                      <label className="block text-[10px] text-neutral-400 mb-0.5">类型</label>
                      <p className="text-xs font-medium text-neutral-700">{typeLabel(selected.type)}</p>
                    </div>
                    <div className="bg-neutral-50 rounded-lg p-2.5">
                      <label className="block text-[10px] text-neutral-400 mb-0.5">模型</label>
                      <p className="text-xs font-medium text-neutral-700">{selected.model}</p>
                    </div>
                    <div className="bg-neutral-50 rounded-lg p-2.5">
                      <label className="block text-[10px] text-neutral-400 mb-0.5">消耗</label>
                      <p className="text-xs font-medium text-neutral-700">{selected.credits_cost} 积分</p>
                    </div>
                    <div className="bg-neutral-50 rounded-lg p-2.5">
                      <label className="block text-[10px] text-neutral-400 mb-0.5">时间</label>
                      <p className="text-xs font-medium text-neutral-700">{new Date(selected.created_at).toLocaleDateString("zh-CN")}</p>
                    </div>
                    {imgSize && (
                      <div className="bg-neutral-50 rounded-lg p-2.5 col-span-2">
                        <label className="block text-[10px] text-neutral-400 mb-0.5">图片尺寸</label>
                        <p className="text-xs font-medium text-neutral-700">{imgSize.w} × {imgSize.h} px</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="p-4 border-t border-neutral-100 space-y-2">
                  {selected.status === "failed" ? (
                    <>
                      <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-50 border border-red-100 mb-2">
                        <AlertCircle size={14} className="text-red-400 shrink-0" />
                        <div>
                          <p className="text-[11px] font-medium text-red-500">生成失败 · 已退回积分</p>
                          <p className="text-[10px] text-red-400">{selected.error_msg || "未知错误"}</p>
                        </div>
                      </div>
                      <button onClick={() => handleReGenerate(selected)} className="w-full py-2 rounded-xl bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors flex items-center justify-center gap-1.5">
                        <RotateCcw size={13} /> 重新生成
                      </button>
                      <button onClick={() => handleDelete(selected.id)} className="w-full py-2 rounded-xl bg-red-50 text-red-500 text-xs font-medium border border-red-200 hover:bg-red-100 transition-colors flex items-center justify-center gap-1.5">
                        <Trash2 size={13} /> 删除记录
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => selected.result_url && downloadImage(selected.result_url, `creation-${selected.id}.png`)}
                        disabled={!selected.result_url} className="w-full py-2 rounded-xl bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5">
                        <Download size={13} /> 下载原图
                      </button>
                      <button onClick={() => handleEdit(selected)} disabled={!selected.result_url}
                        className="w-full py-2 rounded-xl text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5">
                        <Pencil size={13} /> 重新编辑
                      </button>
                      <button onClick={handlePublish} disabled={publishing || published || !selected.result_url}
                        className={cn("w-full py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
                          published ? "bg-green-50 text-green-600 border border-green-200" : "bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100")}>
                        {publishing ? <><Loader2 size={13} className="animate-spin" /> 发布中...</> : published ? <><Check size={13} /> 已提交审核</> : <><Share2 size={13} /> 发布到灵感库</>}
                      </button>
                      <button onClick={() => handleDelete(selected.id)} className="w-full py-2 rounded-xl text-xs font-medium text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-1.5">
                        <Trash2 size={13} /> 删除
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
