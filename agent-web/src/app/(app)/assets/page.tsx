"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  HardDrive,
  User,
  Loader2,
  Download,
  X,
  Plus,
  FolderPlus,
  Folder,
  Upload,
  Trash2,
  Image as ImageIcon,
  FileText,
  MoreHorizontal,
  Pencil,
  FolderInput,
  ChevronLeft,
  ChevronRight,
  Palette,
  Tag,
  Save,
  Sparkles,
  Check,
  Type,
  FileUp,
  Star,
  BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { spaceAPI, brandAPI } from "@/lib/api";
import { downloadImage } from "@/lib/download";
import { useAuthStore } from "@/store/auth";
import { useLoginModalStore } from "@/store/login-modal";
import { usePageTitle } from "@/hooks/use-page-title";

interface SpaceFolder {
  id: number;
  name: string;
  file_count: number;
  created_at: string;
}

interface SpaceFile {
  id: number;
  folder_id: number | null;
  name: string;
  url: string;
  size: number;
  mime_type: string;
  width: number;
  height: number;
  created_at: string;
}

interface Quota {
  used_bytes: number;
  max_bytes: number;
  file_count: number;
}

interface BrandColor {
  name: string;
  hex: string;
}

interface BrandFont {
  role: string; // "heading" | "body"
  name: string;
}

interface BrandLogo {
  type: string; // "primary" | "symbol" | "wordmark"
  name: string;
  file_id: number;
  url?: string;
}

interface BrandImage {
  file_id: number;
  label: string;
  category: string; // "style" | "photography" | "product"
  url?: string;
}

interface BrandKit {
  id?: number;
  brand_name: string;
  description: string;
  design_guide: string;
  colors: string;
  fonts: string;
  keywords: string;
  logos: string;
  brand_images: string;
  logo_file_ids: string;
  manual_file_id?: number;
  manual_parsed?: boolean;
  is_default?: boolean;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function AssetsPage() {
  usePageTitle("素材空间");
  const user = useAuthStore((s) => s.user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [folders, setFolders] = useState<SpaceFolder[]>([]);
  const [files, setFiles] = useState<SpaceFile[]>([]);
  const [quota, setQuota] = useState<Quota>({ used_bytes: 0, max_bytes: 104857600, file_count: 0 });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeFolder, setActiveFolder] = useState<number | null>(null); // null = all files
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<SpaceFile | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ type: "file" | "folder"; id: number; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ type: "file" | "folder"; id: number; name: string } | null>(null);
  const pageSize = 50;

  // Tab: "files" | "brand"
  const [activeTab, setActiveTab] = useState<"files" | "brand">("files");

  // Brand Kit state (multi-brand)
  const [brandList, setBrandList] = useState<BrandKit[]>([]);
  const [brandKit, setBrandKit] = useState<BrandKit>({ brand_name: "", description: "", design_guide: "", colors: "[]", fonts: "[]", keywords: "", logos: "[]", brand_images: "[]", logo_file_ids: "" });
  const [editingBrandId, setEditingBrandId] = useState<number | null>(null);
  const [brandColors, setBrandColors] = useState<BrandColor[]>([]);
  const [brandFonts, setBrandFonts] = useState<BrandFont[]>([]);
  const [brandLogos, setBrandLogos] = useState<BrandLogo[]>([]);
  const [brandImages, setBrandImages] = useState<BrandImage[]>([]);
  const [brandKeywordInput, setBrandKeywordInput] = useState("");
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [brandLoading, setBrandLoading] = useState(false);
  const [manualParsing, setManualParsing] = useState(false);
  const [newColorName, setNewColorName] = useState("主色");
  const [newColorHex, setNewColorHex] = useState("#6C5CE7");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const brandImageInputRef = useRef<HTMLInputElement>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  // ── Data loading ──
  const loadQuota = useCallback(async () => {
    try { const res = await spaceAPI.quota(); setQuota(res.data?.data); } catch {}
  }, []);

  const loadFolders = useCallback(async () => {
    try { const res = await spaceAPI.listFolders(); setFolders(res.data?.data ?? []); } catch {}
  }, []);

  const loadFiles = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params: any = { page, page_size: pageSize };
      if (activeFolder !== null) params.folder_id = activeFolder === 0 ? "root" : String(activeFolder);
      const res = await spaceAPI.listFiles(params);
      setFiles(res.data?.data ?? []);
      setTotal(res.data?.total ?? 0);
    } catch {} finally { setLoading(false); }
  }, [user, page, activeFolder]);

  useEffect(() => { if (user) { loadQuota(); loadFolders(); } }, [user, loadQuota, loadFolders]);
  useEffect(() => { loadFiles(); }, [loadFiles]);
  useEffect(() => { setPage(1); }, [activeFolder]);

  // Brand Kit loading (multi-brand)
  const loadBrandList = useCallback(async () => {
    if (!user) return;
    setBrandLoading(true);
    try {
      const res = await brandAPI.list();
      const list: BrandKit[] = res.data?.data ?? [];
      setBrandList(list);
      // Auto-select first brand if none selected
      if (list.length > 0 && editingBrandId === null) {
        selectBrand(list[0]);
      }
    } catch {} finally { setBrandLoading(false); }
  }, [user]);

  const selectBrand = (kit: BrandKit) => {
    setEditingBrandId(kit.id || null);
    setBrandKit(kit);
    try { setBrandColors(JSON.parse(kit.colors || "[]")); } catch { setBrandColors([]); }
    try { setBrandFonts(JSON.parse(kit.fonts || "[]")); } catch { setBrandFonts([]); }
    try { setBrandLogos(JSON.parse(kit.logos || "[]")); } catch { setBrandLogos([]); }
    try { setBrandImages(JSON.parse(kit.brand_images || "[]")); } catch { setBrandImages([]); }
    setBrandKeywordInput(kit.keywords || "");
  };

  const startNewBrand = () => {
    setEditingBrandId(null);
    setBrandKit({ brand_name: "", description: "", design_guide: "", colors: "[]", fonts: "[]", keywords: "", logos: "[]", brand_images: "[]", logo_file_ids: "" });
    setBrandColors([]);
    setBrandFonts([]);
    setBrandLogos([]);
    setBrandImages([]);
    setBrandKeywordInput("");
  };

  useEffect(() => { if (user && activeTab === "brand") loadBrandList(); }, [user, activeTab, loadBrandList]);

  // Brand Kit save (create or update)
  const saveBrandKit = async () => {
    setBrandSaving(true);
    setBrandSaved(false);
    const payload = {
      brand_name: brandKit.brand_name,
      description: brandKit.description,
      design_guide: brandKit.design_guide,
      colors: JSON.stringify(brandColors),
      fonts: JSON.stringify(brandFonts),
      keywords: brandKeywordInput,
      logos: JSON.stringify(brandLogos),
      brand_images: JSON.stringify(brandImages),
      logo_file_ids: brandKit.logo_file_ids,
    };
    try {
      if (editingBrandId) {
        await brandAPI.update(editingBrandId, payload);
      } else {
        const res = await brandAPI.create(payload);
        const created = res.data?.data;
        if (created?.id) setEditingBrandId(created.id);
      }
      setBrandSaved(true);
      setTimeout(() => setBrandSaved(false), 2000);
      loadBrandList();
    } catch (e: any) {
      alert(e?.response?.data?.error || "保存失败");
    } finally { setBrandSaving(false); }
  };

  const deleteBrand = async (id: number) => {
    if (!confirm("确定删除此品牌？")) return;
    try {
      await brandAPI.delete(id);
      if (editingBrandId === id) startNewBrand();
      loadBrandList();
    } catch {}
  };

  const setDefaultBrand = async (id: number) => {
    try {
      await brandAPI.setDefault(id);
      loadBrandList();
    } catch {}
  };

  // Brand color helpers
  const addColor = () => {
    if (brandColors.length >= 10) return;
    setBrandColors([...brandColors, { name: newColorName, hex: newColorHex }]);
    setNewColorName("辅色");
    setNewColorHex("#00B894");
  };
  const removeColor = (idx: number) => setBrandColors(brandColors.filter((_, i) => i !== idx));
  const updateColor = (idx: number, field: "name" | "hex", val: string) => {
    const updated = [...brandColors];
    updated[idx] = { ...updated[idx], [field]: val };
    setBrandColors(updated);
  };

  // Font helpers
  const addFont = (role: string) => {
    setBrandFonts([...brandFonts, { role, name: "" }]);
  };
  const removeFont = (idx: number) => setBrandFonts(brandFonts.filter((_, i) => i !== idx));
  const updateFont = (idx: number, field: "role" | "name", val: string) => {
    const updated = [...brandFonts];
    updated[idx] = { ...updated[idx], [field]: val };
    setBrandFonts(updated);
  };

  // Logo helpers
  const handleLogoUploadNew = async (fileList: FileList | File[], logoType: string) => {
    for (const f of Array.from(fileList)) {
      try {
        const res = await spaceAPI.uploadFile(f, undefined, "logo");
        const newFile = res.data?.data;
        if (newFile?.id) {
          setBrandLogos((prev) => [...prev, { type: logoType, name: f.name.replace(/\.[^.]+$/, ""), file_id: newFile.id, url: newFile.url }]);
        }
      } catch (e: any) { alert(e?.response?.data?.error || "上传失败"); }
    }
  };
  const removeBrandLogo = (idx: number) => setBrandLogos(brandLogos.filter((_, i) => i !== idx));

  // Brand image helpers
  const handleBrandImageUpload = async (fileList: FileList | File[], category: string) => {
    for (const f of Array.from(fileList)) {
      try {
        const res = await spaceAPI.uploadFile(f, undefined, "brand");
        const newFile = res.data?.data;
        if (newFile?.id) {
          setBrandImages((prev) => [...prev, { file_id: newFile.id, label: f.name.replace(/\.[^.]+$/, ""), category, url: newFile.url }]);
        }
      } catch (e: any) { alert(e?.response?.data?.error || "上传失败"); }
    }
  };
  const removeBrandImage = (idx: number) => setBrandImages(brandImages.filter((_, i) => i !== idx));

  // Manual parse
  const handleManualParse = async (file: File) => {
    if (!editingBrandId) {
      alert("请先保存品牌后再上传手册");
      return;
    }
    setManualParsing(true);
    try {
      const res = await brandAPI.parseManual(editingBrandId, file);
      const updated = res.data?.data;
      if (updated) {
        selectBrand(updated);
        loadBrandList();
      }
    } catch (e: any) {
      alert(e?.response?.data?.error || "解析失败");
    } finally { setManualParsing(false); }
  };

  // Logo upload (legacy)
  const handleLogoUpload = async (fileList: FileList | File[]) => {
    for (const f of Array.from(fileList)) {
      try {
        const res = await spaceAPI.uploadFile(f, undefined, "logo");
        const newFile = res.data?.data;
        if (newFile?.id) {
          const ids = brandKit.logo_file_ids ? brandKit.logo_file_ids.split(",").filter(Boolean) : [];
          ids.push(String(newFile.id));
          setBrandKit({ ...brandKit, logo_file_ids: ids.join(",") });
        }
        loadQuota();
      } catch (e: any) {
        alert(e?.response?.data?.error || "上传失败");
      }
    }
  };

  // Get logo files from IDs
  const [logoFiles, setLogoFiles] = useState<SpaceFile[]>([]);
  useEffect(() => {
    if (!brandKit.logo_file_ids) { setLogoFiles([]); return; }
    const ids = brandKit.logo_file_ids.split(",").filter(Boolean);
    if (ids.length === 0) { setLogoFiles([]); return; }
    spaceAPI.listFiles({ asset_type: "logo", page_size: 50 }).then((res) => {
      const allLogos: SpaceFile[] = res.data?.data ?? [];
      setLogoFiles(allLogos.filter((f) => ids.includes(String(f.id))));
    }).catch(() => {});
  }, [brandKit.logo_file_ids]);

  const removeLogo = (fileId: number) => {
    const ids = brandKit.logo_file_ids.split(",").filter((id) => id !== String(fileId));
    setBrandKit({ ...brandKit, logo_file_ids: ids.join(",") });
  };

  // ── Upload ──
  const handleUpload = async (fileList: FileList | File[]) => {
    if (uploading) return;
    setUploading(true);
    try {
      for (const f of Array.from(fileList)) {
        await spaceAPI.uploadFile(f, activeFolder && activeFolder > 0 ? activeFolder : undefined);
      }
      loadFiles(); loadQuota(); loadFolders();
    } catch (e: any) {
      alert(e?.response?.data?.error || "上传失败");
    } finally { setUploading(false); }
  };

  // ── Drag & Drop ──
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  };

  // ── Folder CRUD ──
  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try { await spaceAPI.createFolder(newFolderName.trim()); loadFolders(); setNewFolderName(""); setShowNewFolder(false); } catch {}
  };

  const deleteFolder = async (id: number) => {
    if (!confirm("删除文件夹将同时删除其中所有文件，确定吗？")) return;
    try { await spaceAPI.deleteFolder(id); loadFolders(); loadQuota(); if (activeFolder === id) { setActiveFolder(null); } loadFiles(); } catch {}
  };

  const renameItem = async () => {
    if (!renaming || !renaming.name.trim()) return;
    try {
      if (renaming.type === "folder") await spaceAPI.renameFolder(renaming.id, renaming.name.trim());
      else await spaceAPI.renameFile(renaming.id, renaming.name.trim());
      loadFolders(); loadFiles(); setRenaming(null);
    } catch {}
  };

  // ── File actions ──
  const deleteFile = async (id: number) => {
    try { await spaceAPI.deleteFile(id); setFiles((p) => p.filter((f) => f.id !== id)); setTotal((t) => t - 1); loadQuota(); if (selected?.id === id) setSelected(null); } catch {}
  };

  const totalPages = Math.ceil(total / pageSize);
  const usagePercent = quota.max_bytes > 0 ? Math.min(100, (quota.used_bytes / quota.max_bytes) * 100) : 0;

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-[#fafafa]">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mx-auto mb-4">
            <User size={24} className="text-neutral-400" />
          </div>
          <h3 className="text-sm font-medium text-neutral-600 mb-1">请先登录</h3>
          <p className="text-xs text-neutral-400 max-w-xs mb-4">登录后可使用素材空间</p>
          <button onClick={() => useLoginModalStore.getState().openLoginModal()} className="px-6 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors shadow-md">
            去登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#fafafa] dark:bg-[#0A0A0A]" onClick={() => setContextMenu(null)}>
      {/* Header */}
      <div className="px-6 pt-5 pb-3 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-100/60 dark:border-neutral-800/60">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <HardDrive size={18} className="text-neutral-500" />
              <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">素材空间</h1>
            </div>
            {/* Tab switcher */}
            <div className="flex items-center bg-neutral-100/80 dark:bg-neutral-800/80 rounded-lg p-0.5">
              <button onClick={() => setActiveTab("files")}
                className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-all", activeTab === "files" ? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>
                <span className="flex items-center gap-1.5"><Folder size={12} /> 文件</span>
              </button>
              <button onClick={() => setActiveTab("brand")}
                className={cn("px-3 py-1.5 rounded-md text-xs font-medium transition-all", activeTab === "brand" ? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm" : "text-neutral-500 hover:text-neutral-700")}>
                <span className="flex items-center gap-1.5"><Palette size={12} /> 品牌中心</span>
              </button>
            </div>
          </div>
          {activeTab === "files" && (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowNewFolder(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-neutral-600 hover:bg-neutral-100 transition-colors border border-neutral-200/60">
                <FolderPlus size={13} /> 新建文件夹
              </button>
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white bg-neutral-900 hover:bg-neutral-800 transition-colors shadow-sm">
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} 上传文件
              </button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(e) => e.target.files && handleUpload(e.target.files)} />
            </div>
          )}
        </div>
        {/* Quota bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", usagePercent > 90 ? "bg-red-400" : usagePercent > 70 ? "bg-amber-400" : "bg-blue-400")}
              style={{ width: `${usagePercent}%` }} />
          </div>
          <span className="text-[11px] text-neutral-400 shrink-0">
            {formatBytes(quota.used_bytes)} / {formatBytes(quota.max_bytes)}
          </span>
        </div>
      </div>

      {/* ═══ Brand Center Tab (Lovart-style) ═══ */}
      {activeTab === "brand" && (
        <div className="flex-1 flex overflow-hidden">
          {/* Brand list sidebar */}
          <div className="w-56 border-r border-neutral-100/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 overflow-y-auto shrink-0">
            <div className="p-3">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">我的品牌套件</span>
              </div>
              <button onClick={startNewBrand}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium border-2 border-dashed border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:border-neutral-900 hover:text-neutral-900 dark:hover:border-neutral-400 dark:hover:text-neutral-300 transition-all mb-3">
                <Plus size={14} /> 新建
              </button>
              {brandLoading && brandList.length === 0 && (
                <div className="flex justify-center py-8"><Loader2 size={16} className="text-neutral-300 animate-spin" /></div>
              )}
              <div className="space-y-1.5">
                {brandList.map((kit) => {
                  const kitColors: BrandColor[] = (() => { try { return JSON.parse(kit.colors || "[]"); } catch { return []; } })();
                  return (
                    <div key={kit.id}
                      className={cn("rounded-xl p-3 cursor-pointer transition-all border-2 group",
                        editingBrandId === kit.id
                          ? "border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-800"
                          : "border-transparent hover:border-neutral-200 dark:hover:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                      )}
                      onClick={() => selectBrand(kit)}>
                      {/* Color preview bar */}
                      <div className="flex gap-1 mb-2 h-6 rounded-lg overflow-hidden">
                        {kitColors.length > 0 ? kitColors.slice(0, 5).map((c, i) => (
                          <div key={i} className="flex-1 rounded" style={{ backgroundColor: c.hex }} />
                        )) : (
                          <div className="flex-1 bg-neutral-200 dark:bg-neutral-700 rounded flex items-center justify-center">
                            <Palette size={10} className="text-neutral-400" />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-neutral-800 dark:text-neutral-200 truncate">{kit.brand_name || "未命名"}</span>
                        <div className="flex items-center gap-1">
                          {kit.is_default && <Star size={10} className="text-amber-500 fill-amber-500" />}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {!kit.is_default && kit.id && (
                              <button onClick={(e) => { e.stopPropagation(); setDefaultBrand(kit.id!); }} title="设为默认"
                                className="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"><Star size={10} className="text-neutral-400" /></button>
                            )}
                            {kit.id && (
                              <button onClick={(e) => { e.stopPropagation(); deleteBrand(kit.id!); }} title="删除"
                                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30"><Trash2 size={10} className="text-red-400" /></button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {!brandLoading && brandList.length === 0 && (
                <p className="text-center text-[11px] text-neutral-300 dark:text-neutral-600 py-8">暂无品牌套件<br />点击上方新建</p>
              )}
            </div>
          </div>

          {/* Brand detail panel (Lovart-style sections) */}
          <div className="flex-1 overflow-y-auto bg-white dark:bg-[#0A0A0A]">
            <div className="max-w-3xl mx-auto px-8 py-8 space-y-8">
              {/* Title + Save */}
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <input value={brandKit.brand_name} onChange={(e) => setBrandKit({ ...brandKit, brand_name: e.target.value })}
                    placeholder="品牌名称" className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 bg-transparent outline-none w-full placeholder:text-neutral-300" />
                  <input value={brandKit.description} onChange={(e) => setBrandKit({ ...brandKit, description: e.target.value })}
                    placeholder="添加品牌描述..." className="text-sm text-neutral-500 bg-transparent outline-none w-full mt-1 placeholder:text-neutral-300" />
                </div>
                <button onClick={saveBrandKit} disabled={brandSaving}
                  className={cn("px-5 py-2 rounded-lg text-xs font-medium flex items-center gap-2 transition-all shrink-0 ml-4",
                    brandSaved ? "bg-emerald-500 text-white" : "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-100")}>
                  {brandSaving ? <Loader2 size={12} className="animate-spin" /> : brandSaved ? <Check size={12} /> : <Save size={12} />}
                  {brandSaving ? "保存中" : brandSaved ? "已保存" : editingBrandId ? "保存" : "创建"}
                </button>
              </div>

              {/* Brand keywords banner */}
              {brandKeywordInput && (
                <div className="flex flex-wrap gap-1.5">
                  {brandKeywordInput.split(",").filter(Boolean).map((kw, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 text-[11px] font-medium">
                      <Tag size={9} /> {kw.trim()}
                    </span>
                  ))}
                </div>
              )}

              {/* ── Section: 设计指南 ── */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <BookOpen size={14} className="text-neutral-400" />
                  <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">设计指南</h3>
                </div>
                <textarea value={brandKit.design_guide} onChange={(e) => setBrandKit({ ...brandKit, design_guide: e.target.value })}
                  rows={4} placeholder="描述品牌理念、设计原则和使用规范..."
                  className="w-full px-4 py-3 rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900 text-sm text-neutral-700 dark:text-neutral-300 outline-none focus:border-violet-300 transition-all resize-none leading-relaxed" />
              </section>

              {/* ── Section: Logo ── */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ImageIcon size={14} className="text-neutral-400" />
                    <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Logo</h3>
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {brandLogos.map((logo, idx) => (
                    <div key={idx} className="relative group">
                      <div className="aspect-square rounded-xl border-2 border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center overflow-hidden">
                        {logo.url ? (
                          <img src={logo.url} alt={logo.name} className="w-full h-full object-contain p-3" />
                        ) : (
                          <ImageIcon size={24} className="text-neutral-300" />
                        )}
                      </div>
                      <p className="text-[11px] text-neutral-500 mt-1.5 text-center truncate">{logo.name || logo.type}</p>
                      <p className="text-[9px] text-neutral-400 text-center capitalize">{logo.type}</p>
                      <button onClick={() => removeBrandLogo(idx)}
                        className="absolute top-1 right-1 p-1 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70">
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {/* Upload buttons for each logo type */}
                  {["primary", "symbol", "wordmark"].filter((t) => !brandLogos.some((l) => l.type === t)).map((logoType) => (
                    <label key={logoType} className="cursor-pointer">
                      <div className="aspect-square rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50 flex flex-col items-center justify-center hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors">
                        <Plus size={18} className="text-neutral-300 mb-1" />
                        <span className="text-[10px] text-neutral-400 capitalize">{logoType === "primary" ? "主 Logo" : logoType === "symbol" ? "图标" : "文字标"}</span>
                      </div>
                      <input type="file" accept="image/*" className="hidden"
                        onChange={(e) => { if (e.target.files) handleLogoUploadNew(e.target.files, logoType); e.target.value = ""; }} />
                    </label>
                  ))}
                </div>
              </section>

              {/* ── Section: 颜色 ── */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Palette size={14} className="text-neutral-400" />
                    <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">颜色</h3>
                  </div>
                  <span className="text-[10px] text-neutral-400">{brandColors.length}/10</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {brandColors.map((color, idx) => (
                    <div key={idx} className="group relative">
                      <div className="w-28 h-16 rounded-xl cursor-pointer border-2 border-neutral-100 dark:border-neutral-800 hover:border-neutral-300 transition-colors overflow-hidden"
                        style={{ backgroundColor: color.hex }}>
                        <input type="color" value={color.hex} onChange={(e) => updateColor(idx, "hex", e.target.value)}
                          className="opacity-0 w-full h-full cursor-pointer" />
                      </div>
                      <input value={color.name} onChange={(e) => updateColor(idx, "name", e.target.value)}
                        className="mt-1.5 w-28 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 bg-transparent outline-none text-center" />
                      <button onClick={() => removeColor(idx)}
                        className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-neutral-900 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
                        <X size={8} />
                      </button>
                    </div>
                  ))}
                  {brandColors.length < 10 && (
                    <div className="flex flex-col items-center">
                      <label className="w-28 h-16 rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 flex items-center justify-center cursor-pointer hover:border-neutral-400 transition-colors relative overflow-hidden">
                        <Plus size={16} className="text-neutral-300" />
                        <input type="color" value={newColorHex} onChange={(e) => { setNewColorHex(e.target.value); addColor(); }}
                          className="opacity-0 absolute inset-0 cursor-pointer" />
                      </label>
                      <span className="text-[10px] text-neutral-400 mt-1.5">添加颜色</span>
                    </div>
                  )}
                </div>
              </section>

              {/* ── Section: 字体 ── */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Type size={14} className="text-neutral-400" />
                    <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">字体</h3>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {brandFonts.map((font, idx) => (
                    <div key={idx} className="relative group w-36">
                      <div className="h-24 rounded-xl border-2 border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center">
                        <span className="text-3xl font-bold text-neutral-700 dark:text-neutral-300" style={{ fontFamily: font.name || "inherit" }}>Ag</span>
                      </div>
                      <input value={font.name} onChange={(e) => updateFont(idx, "name", e.target.value)} placeholder="字体名称"
                        className="mt-1.5 w-full text-[11px] font-medium text-neutral-600 dark:text-neutral-400 bg-transparent outline-none text-center" />
                      <span className="block text-[9px] text-neutral-400 text-center capitalize">{font.role === "heading" ? "标题字体" : "正文字体"}</span>
                      <button onClick={() => removeFont(idx)}
                        className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-neutral-900 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
                        <X size={8} />
                      </button>
                    </div>
                  ))}
                  {brandFonts.length < 4 && (
                    <div className="flex gap-2">
                      {["heading", "body"].filter((r) => !brandFonts.some((f) => f.role === r)).map((role) => (
                        <button key={role} onClick={() => addFont(role)}
                          className="w-36 h-24 rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 flex flex-col items-center justify-center hover:border-neutral-400 transition-colors">
                          <Plus size={16} className="text-neutral-300 mb-1" />
                          <span className="text-[10px] text-neutral-400">{role === "heading" ? "添加标题字体" : "添加正文字体"}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* ── Section: 品牌图像 ── */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ImageIcon size={14} className="text-neutral-400" />
                    <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">图像</h3>
                  </div>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
                  {brandImages.map((img, idx) => (
                    <div key={idx} className="relative group">
                      <div className="aspect-square rounded-xl border-2 border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 overflow-hidden">
                        {img.url ? (
                          <img src={img.url} alt={img.label} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><ImageIcon size={18} className="text-neutral-300" /></div>
                        )}
                      </div>
                      <p className="text-[10px] text-neutral-500 mt-1 text-center truncate">{img.label}</p>
                      <button onClick={() => removeBrandImage(idx)}
                        className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-neutral-900 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500">
                        <X size={8} />
                      </button>
                    </div>
                  ))}
                  <label className="cursor-pointer">
                    <div className="aspect-square rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 flex flex-col items-center justify-center hover:border-neutral-400 transition-colors">
                      <Plus size={16} className="text-neutral-300 mb-1" />
                      <span className="text-[9px] text-neutral-400">添加图像</span>
                    </div>
                    <input ref={brandImageInputRef} type="file" accept="image/*" multiple className="hidden"
                      onChange={(e) => { if (e.target.files) handleBrandImageUpload(e.target.files, "style"); e.target.value = ""; }} />
                  </label>
                </div>
              </section>

              {/* ── Section: 品牌关键词 ── */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Tag size={14} className="text-neutral-400" />
                  <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">品牌指南</h3>
                </div>
                <input value={brandKeywordInput} onChange={(e) => setBrandKeywordInput(e.target.value)}
                  placeholder="品牌关键词（逗号分隔，生成时自动注入提示词）"
                  className="w-full px-4 py-3 rounded-xl border border-neutral-200/60 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900 text-sm outline-none focus:border-violet-300 transition-all" />
              </section>

              {/* ── Section: 品牌手册上传 ── */}
              <section>
                <div className="rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50 p-8 text-center">
                  {manualParsing ? (
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 size={28} className="text-violet-500 animate-spin" />
                      <p className="text-sm text-neutral-500">AI 正在解析品牌手册...</p>
                      <p className="text-[11px] text-neutral-400">这可能需要 10-30 秒</p>
                    </div>
                  ) : (
                    <>
                      <FileUp size={28} className="text-neutral-300 mx-auto mb-3" />
                      <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-1">上传完整的品牌手册，自动填充所有内容</p>
                      <p className="text-[11px] text-neutral-400 mb-4">PNG、JPG、PDF · 最大 20MB</p>
                      <button onClick={() => manualInputRef.current?.click()}
                        className="px-5 py-2 rounded-lg text-xs font-medium bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors">
                        选择文件
                      </button>
                      <input ref={manualInputRef} type="file" accept="image/*,.pdf" className="hidden"
                        onChange={(e) => { if (e.target.files?.[0]) handleManualParse(e.target.files[0]); e.target.value = ""; }} />
                    </>
                  )}
                </div>
                {!editingBrandId && (
                  <p className="text-[11px] text-amber-500 mt-2 text-center">请先创建并保存品牌后再上传手册</p>
                )}
                <p className="text-[11px] text-neutral-400 mt-3 text-center">
                  还没有品牌素材？从零开始在画布上创建。
                </p>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Files Tab ═══ */}
      {activeTab === "files" && (
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Folders */}
        <div className="w-48 border-r border-neutral-100/60 bg-white/50 overflow-y-auto shrink-0 hidden md:block">
          <div className="p-3 space-y-0.5">
            <button onClick={() => setActiveFolder(null)}
              className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors", activeFolder === null ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")}>
              <HardDrive size={13} /> 全部文件
            </button>
            <button onClick={() => setActiveFolder(0)}
              className={cn("w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors", activeFolder === 0 ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")}>
              <FileText size={13} /> 未分类
            </button>
            <div className="h-px bg-neutral-100 my-2" />
            {folders.map((f) => (
              <button key={f.id} onClick={() => setActiveFolder(f.id)}
                onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: "folder", id: f.id, x: e.clientX, y: e.clientY }); }}
                className={cn("w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs transition-colors group", activeFolder === f.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")}>
                <span className="flex items-center gap-2 truncate"><Folder size={13} /> {f.name}</span>
                <span className={cn("text-[10px]", activeFolder === f.id ? "text-white/60" : "text-neutral-300")}>{f.file_count}</span>
              </button>
            ))}
            {/* New folder inline */}
            <AnimatePresence>
              {showNewFolder && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="flex items-center gap-1 px-1 py-1">
                    <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createFolder()}
                      placeholder="文件夹名称" className="flex-1 px-2 py-1.5 rounded-lg border border-neutral-200 text-xs outline-none focus:border-neutral-400 bg-white" />
                    <button onClick={createFolder} className="p-1.5 rounded-lg bg-neutral-900 text-white hover:bg-neutral-800"><Plus size={12} /></button>
                    <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400"><X size={12} /></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Main content - Files */}
        <div className="flex-1 overflow-y-auto"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}>

          {/* Drag overlay */}
          <AnimatePresence>
            {dragOver && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-blue-500/10 border-2 border-dashed border-blue-400 flex items-center justify-center pointer-events-none">
                <div className="bg-white rounded-2xl shadow-lg px-8 py-6 text-center">
                  <Upload size={32} className="text-blue-400 mx-auto mb-2" />
                  <p className="text-sm font-medium text-neutral-700">松开即可上传</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-20"><Loader2 size={24} className="text-neutral-300 animate-spin" /></div>
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-20 h-20 rounded-2xl bg-neutral-100 flex items-center justify-center mb-4">
                  <Upload size={28} className="text-neutral-300" />
                </div>
                <p className="text-sm font-medium text-neutral-500 mb-1">暂无文件</p>
                <p className="text-xs text-neutral-400 mb-4">上传品牌素材、参考图等资源到你的空间</p>
                <button onClick={() => fileInputRef.current?.click()} className="px-5 py-2 rounded-xl bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors flex items-center gap-1.5">
                  <Upload size={13} /> 上传文件
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {files.map((file) => (
                    <motion.div key={file.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                      className="group relative rounded-xl overflow-hidden bg-white border border-neutral-200/60 shadow-sm hover:shadow-md transition-all cursor-pointer"
                      onClick={() => setSelected(file)}
                      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: "file", id: file.id, x: e.clientX, y: e.clientY }); }}>
                      {file.mime_type?.startsWith("image/") ? (
                        <img src={file.url} alt={file.name} className="w-full aspect-square object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full aspect-square bg-neutral-50 flex flex-col items-center justify-center gap-2">
                          <FileText size={28} className="text-neutral-300" />
                          <span className="text-[10px] text-neutral-400 uppercase">{file.name.split(".").pop()}</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                      <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-[10px] text-white/90 truncate">{file.name}</p>
                        <p className="text-[9px] text-white/60">{formatBytes(file.size)}</p>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setContextMenu({ type: "file", id: file.id, x: e.clientX, y: e.clientY }); }}
                        className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white">
                        <MoreHorizontal size={12} className="text-neutral-500" />
                      </button>
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
        </div>
      </div>
      )}

      {/* Context menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-50 bg-white rounded-xl shadow-lg border border-neutral-200/60 py-1 min-w-[140px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button onClick={() => { setRenaming({ type: contextMenu.type, id: contextMenu.id, name: "" }); setContextMenu(null); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50 transition-colors">
              <Pencil size={12} /> 重命名
            </button>
            {contextMenu.type === "file" && (
              <button onClick={() => { const f = files.find((x) => x.id === contextMenu.id); if (f) downloadImage(f.url, f.name); setContextMenu(null); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-600 hover:bg-neutral-50 transition-colors">
                <Download size={12} /> 下载
              </button>
            )}
            {contextMenu.type === "file" && folders.length > 0 && (
              <div className="border-t border-neutral-100 pt-1 mt-1">
                <p className="px-3 py-1 text-[10px] text-neutral-400">移动到</p>
                {folders.map((f) => (
                  <button key={f.id} onClick={() => { spaceAPI.moveFile(contextMenu.id, f.id).then(() => { loadFiles(); loadFolders(); }); setContextMenu(null); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 transition-colors">
                    <FolderInput size={12} /> {f.name}
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-neutral-100 pt-1 mt-1">
              <button onClick={() => {
                if (contextMenu.type === "folder") deleteFolder(contextMenu.id);
                else deleteFile(contextMenu.id);
                setContextMenu(null);
              }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 size={12} /> 删除
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename dialog */}
      <AnimatePresence>
        {renaming && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRenaming(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-white rounded-xl shadow-xl p-5 w-80" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-neutral-900 mb-3">重命名</h3>
              <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && renameItem()}
                placeholder="输入新名称" className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm outline-none focus:border-neutral-400 mb-3" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setRenaming(null)} className="px-3 py-1.5 rounded-lg text-xs text-neutral-500 hover:bg-neutral-100">取消</button>
                <button onClick={renameItem} className="px-3 py-1.5 rounded-lg text-xs text-white bg-neutral-900 hover:bg-neutral-800">确定</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File preview modal */}
      <AnimatePresence>
        {selected && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelected(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-neutral-100">
                <h3 className="text-sm font-semibold text-neutral-900 truncate">{selected.name}</h3>
                <button onClick={() => setSelected(null)} className="p-1 hover:bg-neutral-100 rounded-lg"><X size={16} className="text-neutral-400" /></button>
              </div>
              <div className="flex-1 overflow-auto bg-neutral-50 flex items-center justify-center p-6">
                {selected.mime_type?.startsWith("image/") ? (
                  <img src={selected.url} alt={selected.name} className="max-w-full max-h-[60vh] object-contain rounded-lg" />
                ) : (
                  <div className="text-center py-12">
                    <FileText size={48} className="text-neutral-300 mx-auto mb-3" />
                    <p className="text-sm text-neutral-500">{selected.name}</p>
                  </div>
                )}
              </div>
              <div className="p-4 border-t border-neutral-100 flex items-center justify-between">
                <div className="text-xs text-neutral-400 space-x-3">
                  <span>{formatBytes(selected.size)}</span>
                  {selected.width > 0 && <span>{selected.width} x {selected.height}</span>}
                  <span>{new Date(selected.created_at).toLocaleDateString("zh-CN")}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => deleteFile(selected.id)} className="px-3 py-1.5 rounded-lg text-xs text-red-500 hover:bg-red-50 border border-red-200 flex items-center gap-1.5">
                    <Trash2 size={12} /> 删除
                  </button>
                  <button onClick={() => downloadImage(selected.url, selected.name)} className="px-3 py-1.5 rounded-lg text-xs text-white bg-neutral-900 hover:bg-neutral-800 flex items-center gap-1.5">
                    <Download size={12} /> 下载
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
