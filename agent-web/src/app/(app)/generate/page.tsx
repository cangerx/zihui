"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  Suspense,
} from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Sparkles,
  Loader2,
  Minus,
  Plus,
  Zap,
  Image as ImageIcon,
  Upload,
  X,
  ChevronDown,
  Palette,
  Tag,
  BookOpen,
  Layers,
  Sun,
  Camera,
  Droplets,
  ToggleRight,
  ToggleLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI, modelAPI, uploadAPI, brandAPI, promptTemplateAPI, fetchImageViaProxy } from "@/lib/api";
import { usePageTitle } from "@/hooks/use-page-title";
import { useOptimizePrompt } from "@/hooks/use-optimize-prompt";
import { usePollGeneration } from "@/hooks/use-poll-generation";
import { useImageCanvas, ImageCanvas, InpaintEditor, ResizeDialog, UnsavedDialog, useUnsavedGuard, applyQuickEdit, CanvasTabs, type QuickEditAction } from "@/components/canvas";
import { useCanvasProjects } from "@/store/canvas-projects";
import { useAppsStore } from "@/store/apps";
import CustomRatioPopover from "@/components/ui/custom-ratio-popover";

const RATIO_LABELS: Record<string, string> = {
  auto: "自适应",
  "1:1": "1:1", "1:4": "1:4", "1:8": "1:8",
  "2:3": "2:3", "3:2": "3:2", "3:4": "3:4", "4:1": "4:1",
  "4:3": "4:3", "4:5": "4:5", "5:4": "5:4", "8:1": "8:1",
  "9:16": "9:16", "16:9": "16:9", "21:9": "21:9",
};
const RESOLUTION_LABELS: Record<string, string> = { "512": "低清 512", "1K": "标清 1K", "2K": "高清 2K", "4K": "超清 4K" };
const QUALITY_LABELS: Record<string, string> = { low: "低画质", medium: "标准", standard: "标准", high: "高清", hd: "高清" };
const FALLBACK_RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"];


const STYLES = [
  { label: "智能", value: "" },
  { label: "写实摄影", value: "photographic" },
  { label: "数字艺术", value: "digital-art" },
  { label: "动漫", value: "anime" },
  { label: "3D渲染", value: "3d-render" },
  { label: "插画", value: "illustration" },
  { label: "油画", value: "oil-painting" },
  { label: "水彩", value: "watercolor" },
  { label: "像素艺术", value: "pixel-art" },
];

const LIGHTING_OPTIONS = [
  { label: "不限", value: "" }, { label: "自然光", value: "natural light" },
  { label: "工作室灯光", value: "studio lighting" }, { label: "黄金时刻", value: "golden hour" },
  { label: "霓虹灯光", value: "neon lighting" }, { label: "月光", value: "moonlight" },
  { label: "逆光", value: "backlit" }, { label: "柔光", value: "soft light" },
];
const COMPOSITION_OPTIONS = [
  { label: "不限", value: "" }, { label: "特写", value: "close-up" },
  { label: "全景", value: "panoramic" }, { label: "俯视", value: "bird's eye view" },
  { label: "仰视", value: "low angle" }, { label: "对称", value: "symmetrical composition" },
  { label: "三分法", value: "rule of thirds" }, { label: "居中", value: "centered composition" },
];
const TONE_OPTIONS = [
  { label: "不限", value: "" }, { label: "暖色调", value: "warm tones" },
  { label: "冷色调", value: "cool tones" }, { label: "高饱和", value: "vibrant saturated colors" },
  { label: "低饱和", value: "desaturated muted colors" }, { label: "黑白", value: "black and white" },
  { label: "复古", value: "vintage retro color grading" }, { label: "赛博", value: "cyberpunk neon colors" },
];

const TEMPLATE_CATEGORIES = ["全部", "商品图", "人像", "风景", "创意", "建筑", "插画"];

interface PromptTpl {
  id: number;
  category: string;
  title: string;
  prompt: string;
  tags: string;
  image_url?: string;
}

interface ImageModelConfig {
  resolutions?: { values: string[]; default: string };
  ratios?: { values: string[]; default: string };
  qualities?: { values: string[]; default: string };
  max_count?: { values: string[]; default: string };
  formats?: { values: string[]; default: string };
  backgrounds?: { values: string[]; default: string };
}
interface ImageModel {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  provider?: string;
  price_per_call: number;
  badge?: string;
  tags?: string[];
  versions?: { name: string; model: string; tag?: string }[];
  config: ImageModelConfig;
}

export default function GeneratePage() {
  return (
    <Suspense fallback={null}>
      <ReactFlowProvider>
        <GenerateContent />
      </ReactFlowProvider>
    </Suspense>
  );
}

function GenerateContent() {
  usePageTitle("AI 生图画板");
  const searchParams = useSearchParams();
  const fetchAppsStore = useAppsStore((s) => s.fetchApps);
  const appParams = useAppsStore((s) => {
    const app = s.apps.find((a) => a.key === "generate");
    return app?.params || null;
  });
  const isLocked = useCallback((field: string) => appParams?.locked?.includes(field) ?? false, [appParams]);
  const [prompt, setPrompt] = useState(searchParams.get("prompt") || "");
  const [ratio, setRatio] = useState(searchParams.get("ratio") || appParams?.ratio || "1:1");
  const [resolution, setResolution] = useState(appParams?.resolution || "");
  const [quality, setQuality] = useState(appParams?.quality || "");
  const [count, setCount] = useState(appParams?.count || 1);
  const [generating, setGenerating] = useState(false);
  const [refImage, setRefImage] = useState<string>("");
  const [refImageUrls, setRefImageUrls] = useState<string[]>(() => {
    const urls = searchParams.get("ref_images");
    return urls ? urls.split(",").filter(Boolean) : [];
  });
  const refInputRef = useRef<HTMLInputElement>(null);
  const { optimizing: promptOptimizing, optimize: optimizePrompt } = useOptimizePrompt();

  // Model & style state
  const [models, setModels] = useState<ImageModel[]>([]);
  const [selectedModel, setSelectedModel] = useState(appParams?.model || "");
  const [selectedStyle, setSelectedStyle] = useState(appParams?.style || "");
  const [showModelPicker, setShowModelPicker] = useState(false);

  // Structured prompt editor state
  const [promptMode, setPromptMode] = useState<"simple" | "pro">("simple");
  const [structLighting, setStructLighting] = useState("");
  const [structComposition, setStructComposition] = useState("");
  const [structTone, setStructTone] = useState("");
  const [structDetail, setStructDetail] = useState("");

  // Ensure apps store is loaded & apply app params when they arrive
  const appParamsApplied = useRef(false);
  const appModelApplied = useRef(false);
  useEffect(() => { fetchAppsStore(); }, [fetchAppsStore]);
  useEffect(() => {
    if (!appParams || appParamsApplied.current) return;
    appParamsApplied.current = true;
    if (appParams.ratio && !searchParams.get("ratio")) setRatio(appParams.ratio);
    if (appParams.resolution) setResolution(appParams.resolution);
    if (appParams.quality) setQuality(appParams.quality);
    if (appParams.style) setSelectedStyle(appParams.style);
    if (appParams.count) setCount(appParams.count);
  }, [appParams]);
  // Apply app-configured model (needs both appParams and models to be ready)
  useEffect(() => {
    if (!appParams?.model || appModelApplied.current || models.length === 0) return;
    if (searchParams.get("model")) return;
    const m = models.find((x) => x.name === appParams.model);
    if (m) { appModelApplied.current = true; setSelectedModel(m.name); applyDefaults(m); }
  }, [appParams, models]);

  // Template state
  const [templates, setTemplates] = useState<PromptTpl[]>([]);
  const [tplCategory, setTplCategory] = useState("全部");
  const [showTemplates, setShowTemplates] = useState(false);

  // Brand linkage
  const [applyBrand, setApplyBrand] = useState(false);
  const [brandKeywords, setBrandKeywords] = useState("");
  const [hasBrandKit, setHasBrandKit] = useState(false);

  // Load brand kit (find default)
  useEffect(() => {
    let cancelled = false;
    brandAPI.list().then((res) => {
      if (cancelled) return;
      const list = res.data?.data ?? [];
      if (list.length > 0) {
        setHasBrandKit(true);
        const defaultKit = list.find((k: any) => k.is_default) || list[0];
        setBrandKeywords(defaultKit.keywords || "");
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Load templates
  useEffect(() => {
    let cancelled = false;
    const cat = tplCategory === "全部" ? undefined : tplCategory;
    promptTemplateAPI.list(cat).then((res) => {
      if (!cancelled) setTemplates(res.data?.data ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [tplCategory]);

  // Build final prompt from structured fields
  const buildStructuredPrompt = useCallback(() => {
    const parts = [prompt.trim()];
    if (structLighting) parts.push(structLighting);
    if (structComposition) parts.push(structComposition);
    if (structTone) parts.push(structTone);
    if (structDetail.trim()) parts.push(structDetail.trim());
    return parts.join(", ");
  }, [prompt, structLighting, structComposition, structTone, structDetail]);

  function applyDefaults(m: ImageModel) {
    const cfg = m.config;
    if (!isLocked("resolution")) {
      if (cfg?.resolutions) setResolution(cfg.resolutions.default || cfg.resolutions.values[0] || "");
      else setResolution("");
    }
    if (!isLocked("ratio") && cfg?.ratios) setRatio(cfg.ratios.default || cfg.ratios.values[0] || "1:1");
    if (!isLocked("quality")) {
      if (cfg?.qualities) setQuality(cfg.qualities.default || cfg.qualities.values[0] || "");
      else setQuality("");
    }
    if (!isLocked("count")) {
      const mc = parseInt(cfg?.max_count?.default || "4", 10);
      setCount((prev) => Math.min(prev, mc) || 1);
    }
  }

  function selectModel(name: string) {
    setSelectedModel(name);
    const m = models.find((x) => x.name === name);
    if (m) applyDefaults(m);
  }

  const urlModel = searchParams.get("model") || "";
  useEffect(() => {
    let cancelled = false;
    modelAPI.imageModels().then((res) => {
      if (cancelled) return;
      const list: ImageModel[] = res.data?.data ?? [];
      setModels(list);
      const preferredModel = urlModel || appParams?.model || "";
      const match = preferredModel && list.find((m: ImageModel) => m.name === preferredModel);
      if (match) {
        setSelectedModel(match.name);
        applyDefaults(match);
      } else if (list.length > 0 && !selectedModel) {
        setSelectedModel(list[0].name);
        applyDefaults(list[0]);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Canvas projects (multi-canvas)
  const { activeKey, markDirty, saveToServer, updateNodeCount } = useCanvasProjects();

  // Canvas hook (nodes, polling, context menu, layout)
  const canvas = useImageCanvas({ storageKey: activeKey });

  // Track dirty state: canvas is dirty if node count changed after init
  const initCountRef = useRef(canvas.initialNodeCount);
  // Reset initCountRef when switching canvas
  const prevActiveKeyRef = useRef(activeKey);
  useEffect(() => {
    if (prevActiveKeyRef.current !== activeKey) {
      prevActiveKeyRef.current = activeKey;
      initCountRef.current = canvas.nodeCount;
    }
  }, [activeKey, canvas.nodeCount]);
  const isDirty = canvas.nodeCount !== initCountRef.current;
  const unsaved = useUnsavedGuard({ dirty: isDirty });

  // Sync node count to projects store & mark dirty
  useEffect(() => {
    updateNodeCount(activeKey, canvas.nodeCount);
    if (isDirty) markDirty(activeKey);
  }, [canvas.nodeCount, activeKey, isDirty, updateNodeCount, markDirty]);

  // Save handler for CanvasTabs
  const handleSaveCanvas = useCallback(async () => {
    await saveToServer(activeKey, canvas.nodes);
  }, [activeKey, canvas.nodes, saveToServer]);

  // Load existing image from URL param (e.g. from works page)
  // Guard: skip if nodes already contain this src (e.g. restored from localStorage)
  const imageLoaded = useRef(false);
  useEffect(() => {
    const imageUrl = searchParams.get("image");
    if (imageUrl && !imageLoaded.current) {
      const alreadyExists = canvas.nodes.some((n) => n.data?.src === imageUrl);
      if (!alreadyExists) {
        canvas.loadImage(imageUrl, searchParams.get("prompt") || "");
      }
      imageLoaded.current = true;
    }
  }, []);

  // Auto-generate — wait for models to load before triggering
  const autoTriggered = useRef(false);
  const generatingRef = useRef(false);
  useEffect(() => {
    const auto = searchParams.get("auto");
    if (auto === "1" && prompt.trim() && selectedModel && !autoTriggered.current && !generatingRef.current) {
      autoTriggered.current = true;
      doGenerate();
    }
  }, [prompt, selectedModel]);

  const getDisplayHeight = useCallback((r: string) => {
    const BASE_W = 300;
    if (!r || r === "auto") return BASE_W;
    const m = r.match(/^(\d+):(\d+)$/);
    if (!m) return BASE_W;
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (w <= 0 || h <= 0) return BASE_W;
    return Math.round(BASE_W * h / w);
  }, []);

  const handleReGenerate = useCallback((p: string) => {
    setPrompt(p);
    // Auto-trigger generation with the given prompt
    if (!p.trim() || generating) return;
    setGenerating(true);
    const stylePrefix = selectedStyle ? `Style: ${selectedStyle}. ` : "";
    imageAPI.generate({
      prompt: stylePrefix + p,
      ratio,
      resolution: resolution || undefined,
      quality: quality || undefined,
      n: count,
      model: selectedModel || undefined,
      image_urls: refImageUrls.length > 0 ? refImageUrls : undefined,
    }).then((res) => {
      const gen = res.data?.data;
      const arr = Array.isArray(gen) ? gen : [gen];
      const displayHeight = getDisplayHeight(ratio);
      canvas.addImageNodes(arr, p, displayHeight);
      setGenerating(false);
    }).catch((e) => {
      console.error(e);
      setGenerating(false);
    });
  }, [generating, selectedStyle, ratio, resolution, quality, count, selectedModel, refImageUrls, getDisplayHeight, canvas]);
  const handleEdit = useCallback((p: string) => setPrompt(`基于这张图片进行修改：${p}`), []);

  // Reference image helpers: paste, drag-drop, file select
  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = () => setRefImage(reader.result as string);
    reader.readAsDataURL(file);
    // Upload to server and add to refImageUrls
    try {
      const res = await uploadAPI.upload(file);
      const url = res.data?.data?.url || res.data?.url;
      if (url) {
        setRefImageUrls(prev => [...prev, url]);
      }
    } catch (e) {
      console.error("[RefImage] upload failed:", e);
    }
  }, []);

  // Global paste listener
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        // Only allow paste on the prompt textarea if it contains an image
        const hasImage = Array.from(e.clipboardData?.items || []).some((i) => i.type.startsWith("image/"));
        if (!hasImage) return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) handleImageFile(file);
          break;
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [handleImageFile]);

  // Inpaint state
  const [inpaintTarget, setInpaintTarget] = useState<{ nodeId: string; src: string } | null>(null);
  const [inpaintLoading, setInpaintLoading] = useState(false);
  const { startPolling: startInpaintPoll, result: inpaintResult, polling: inpaintPolling } = usePollGeneration();

  const handleInpaint = useCallback((nodeId: string, src: string) => {
    setInpaintTarget({ nodeId, src });
  }, []);

  // Helper: fetch image src as Blob, handling cross-origin & data URLs
  const fetchImageBlob = useCallback(async (src: string): Promise<Blob> => {
    // data URL — direct fetch works
    if (src.startsWith("data:")) {
      const res = await fetch(src);
      return res.blob();
    }
    // 1. Try direct fetch with CORS
    try {
      const res = await fetch(src, { mode: "cors" });
      if (res.ok) return await res.blob();
    } catch { /* CORS blocked, try next */ }

    // 2. Fallback: canvas redraw
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext("2d")!.drawImage(img, 0, 0);
          c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
        };
        img.onerror = () => reject(new Error("crossOrigin load failed"));
        img.src = src;
      });
      return blob;
    } catch { /* also blocked, try proxy */ }

    // 3. Last resort: server-side proxy
    return await fetchImageViaProxy(src);
  }, []);

  const handleInpaintSubmit = useCallback(async (maskBlob: Blob, inpaintPrompt: string) => {
    if (!inpaintTarget) return;
    setInpaintLoading(true);
    try {
      const imgBlob = await fetchImageBlob(inpaintTarget.src);

      const fd = new FormData();
      fd.append("image", imgBlob, "image.png");
      fd.append("mask", maskBlob, "mask.png");
      fd.append("prompt", inpaintPrompt);
      const res = await imageAPI.eraser(fd);
      const gen = res.data?.data;

      if (gen?.result_url) {
        canvas.addImageNodes([gen], inpaintPrompt, 300);
        setInpaintTarget(null);
      } else if (gen?.id) {
        canvas.addImageNodes([gen], inpaintPrompt, 300);
        setInpaintTarget(null);
      }
    } catch (e: any) {
      console.error("Inpaint failed:", e);
      const msg = e?.response?.data?.error || e?.message || "未知错误";
      alert(`涂抹编辑失败: ${msg}`);
    } finally {
      setInpaintLoading(false);
    }
  }, [inpaintTarget, canvas, fetchImageBlob]);

  // Resize state
  const [resizeTarget, setResizeTarget] = useState<{ nodeId: string; src: string; w: number; h: number } | null>(null);
  const [resizeLoading, setResizeLoading] = useState(false);

  const handleResize = useCallback((nodeId: string, src: string) => {
    // Get natural dimensions via a temp image
    const img = new Image();
    img.onload = () => {
      setResizeTarget({ nodeId, src, w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = src;
  }, []);

  const handleResizeSubmit = useCallback(async (width: number, height: number) => {
    if (!resizeTarget) return;
    setResizeLoading(true);
    try {
      const imgBlob = await fetchImageBlob(resizeTarget.src);

      const fd = new FormData();
      fd.append("image", imgBlob, "image.png");
      fd.append("prompt", `Resize this image to ${width}x${height} pixels, maintaining quality and detail`);
      fd.append("size", `${width}x${height}`);
      const res = await imageAPI.upscale(fd);
      const gen = res.data?.data;

      if (gen) {
        const displayH = Math.round(300 * (height / width));
        canvas.addImageNodes([gen], `调整尺寸 ${width}×${height}`, displayH);
        setResizeTarget(null);
      }
    } catch (e: any) {
      console.error("Resize failed:", e);
      const msg = e?.response?.data?.error || e?.message || "未知错误";
      alert(`调整尺寸失败: ${msg}`);
    } finally {
      setResizeLoading(false);
    }
  }, [resizeTarget, canvas, fetchImageBlob]);

  const doGenerate = async () => {
    if (!prompt.trim() || generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    try {
      const finalPrompt = promptMode === "pro" ? buildStructuredPrompt() : prompt;
      const stylePrefix = selectedStyle ? `Style: ${selectedStyle}. ` : "";
      const res = await imageAPI.generate({
        prompt: stylePrefix + finalPrompt,
        ratio,
        resolution: resolution || undefined,
        quality: quality || undefined,
        n: count,
        model: selectedModel || undefined,
        image_urls: refImageUrls.length > 0 ? refImageUrls : undefined,
        apply_brand: applyBrand || undefined,
      });
      const gen = res.data?.data;
      const arr = Array.isArray(gen) ? gen : [gen];
      const displayHeight = getDisplayHeight(ratio);
      canvas.addImageNodes(arr, prompt, displayHeight);
    } catch (e) {
      console.error(e);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  // Retry failed node in-place
  const handleRetry = useCallback(async (nodeId: string) => {
    const node = canvas.nodes.find((n) => n.id === nodeId);
    if (!node?.data?.prompt) return;
    const p = node.data.prompt;

    // Reset node to pending
    canvas.updateNodeData(nodeId, { status: "pending", error: undefined, src: "" });

    try {
      const stylePrefix = selectedStyle ? `Style: ${selectedStyle}. ` : "";
      const res = await imageAPI.generate({
        prompt: stylePrefix + p,
        ratio,
        resolution: resolution || undefined,
        quality: quality || undefined,
        n: 1,
        model: selectedModel || undefined,
        image_urls: refImageUrls.length > 0 ? refImageUrls : undefined,
      });
      const gen = res.data?.data;
      const g = Array.isArray(gen) ? gen[0] : gen;

      canvas.updateNodeData(nodeId, {
        status: g?.status || "pending",
        src: g?.result_url || "",
        error: g?.error_msg,
        genId: g?.id,
      });

      if (g?.id && g?.status !== "completed") {
        canvas.pollGeneration(nodeId, g.id);
      }
    } catch (e: any) {
      canvas.updateNodeData(nodeId, {
        status: "failed",
        error: e?.response?.data?.error || e?.message || "重试失败",
      });
    }
  }, [canvas, selectedStyle, ratio, resolution, quality, selectedModel, refImageUrls]);

  // Quick edit (rotate/flip) — client-side, no API call
  const handleQuickEdit = useCallback(async (nodeId: string, action: string) => {
    const node = canvas.nodes.find((n) => n.id === nodeId);
    if (!node?.data?.src) return;
    try {
      const newSrc = await applyQuickEdit(node.data.src, action as QuickEditAction);
      canvas.updateNodeData(nodeId, { src: newSrc });
    } catch (e) {
      console.error("Quick edit failed:", e);
    }
  }, [canvas]);

  const canvasCallbacks = useMemo(() => ({
    onReGenerate: handleReGenerate,
    onEdit: handleEdit,
    onDelete: canvas.deleteNode,
    onRetry: handleRetry,
    onInpaint: handleInpaint,
    onResize: handleResize,
    onQuickEdit: handleQuickEdit,
    onDuplicate: canvas.duplicateNode,
  }), [handleReGenerate, handleEdit, canvas.deleteNode, handleRetry, handleInpaint, handleResize, handleQuickEdit, canvas.duplicateNode]);

  const currentModel = models.find((m) => m.name === selectedModel);
  const cfg = currentModel?.config;
  const maxCount = parseInt(cfg?.max_count?.default || "4", 10);

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden">
      {/* Left panel */}
      <motion.div
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] as const }}
        className="w-full md:w-[320px] border-b md:border-b-0 md:border-r border-neutral-100 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm flex flex-col shrink-0 max-h-[40vh] md:max-h-none"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-100/60 dark:border-neutral-800/60">
          <div className="w-9 h-9 rounded-xl bg-violet-500 flex items-center justify-center shadow-md shadow-purple-200/40">
            <ImageIcon size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900">AI 生图画板</h1>
            <p className="text-xs text-neutral-400">文字生图 · 无限画板 · 二次编辑</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Prompt — dual mode */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider">描述</label>
              <div className="flex items-center gap-1.5">
                {/* Mode toggle */}
                <button onClick={() => setPromptMode(promptMode === "simple" ? "pro" : "simple")}
                  className={cn("flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all",
                    promptMode === "pro" ? "bg-violet-50 dark:bg-violet-900/30 text-violet-600" : "text-neutral-400 hover:text-neutral-600")}>
                  <Layers size={10} /> {promptMode === "pro" ? "专业" : "简洁"}
                </button>
                {/* AI optimize */}
                <motion.button
                  whileHover={!promptOptimizing && prompt.trim() ? { scale: 1.05, y: -1 } : {}}
                  whileTap={!promptOptimizing && prompt.trim() ? { scale: 0.93 } : {}}
                  onClick={() => optimizePrompt(prompt, setPrompt)}
                  disabled={promptOptimizing || !prompt.trim()}
                  className={cn(
                    "relative flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-300",
                    promptOptimizing
                      ? "bg-amber-50 text-amber-600 shadow-sm shadow-amber-100/60"
                      : !prompt.trim()
                        ? "text-neutral-300 cursor-not-allowed"
                        : "text-neutral-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:text-amber-600 hover:shadow-sm hover:shadow-amber-100/50"
                  )}
                  title="AI 优化提示词"
                >
                  <AnimatePresence mode="wait">
                    {promptOptimizing ? (
                      <motion.span key="spin" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.5 }}
                        transition={{ duration: 0.2 }}>
                        <Loader2 size={11} className="text-amber-500 animate-spin" />
                      </motion.span>
                    ) : (
                      <motion.span key="zap" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, rotate: 90 }}
                        transition={{ duration: 0.2 }}>
                        <Zap size={11} className="text-amber-400" />
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {promptOptimizing ? "优化中…" : "优化提示词"}
                  {promptOptimizing && (
                    <motion.span
                      className="absolute inset-0 rounded-lg border border-amber-300/40"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: [0, 0.6, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    />
                  )}
                </motion.button>
              </div>
            </div>
            <textarea
              rows={promptMode === "pro" ? 3 : 4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  doGenerate();
                }
              }}
              placeholder={promptMode === "pro" ? "输入主体描述，如：一只橘猫坐在窗台上" : "描述你想生成的图片，如：赛博朋克风格城市夜景，霓虹灯光..."}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200/60 dark:border-neutral-700/60 bg-neutral-50/50 dark:bg-neutral-800/50 text-sm outline-none focus:border-violet-300 dark:focus:border-violet-500 focus:bg-white dark:focus:bg-neutral-800 focus:shadow-sm resize-none transition-all"
            />
            {/* Pro mode structured fields */}
            <AnimatePresence>
              {promptMode === "pro" && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden">
                  <div className="mt-2.5 space-y-2.5 p-3 rounded-xl bg-neutral-50/80 dark:bg-neutral-800/40 border border-neutral-100/60 dark:border-neutral-800/60">
                    {/* Lighting */}
                    <div>
                      <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1"><Sun size={9} /> 光线</label>
                      <div className="flex flex-wrap gap-1">
                        {LIGHTING_OPTIONS.map((o) => (
                          <button key={o.value} onClick={() => setStructLighting(o.value)}
                            className={cn("px-2 py-1 rounded-md text-[10px] transition-all",
                              structLighting === o.value ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-600 border border-neutral-200/60 dark:border-neutral-600")}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Composition */}
                    <div>
                      <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1"><Camera size={9} /> 构图</label>
                      <div className="flex flex-wrap gap-1">
                        {COMPOSITION_OPTIONS.map((o) => (
                          <button key={o.value} onClick={() => setStructComposition(o.value)}
                            className={cn("px-2 py-1 rounded-md text-[10px] transition-all",
                              structComposition === o.value ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-600 border border-neutral-200/60 dark:border-neutral-600")}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Tone */}
                    <div>
                      <label className="flex items-center gap-1 text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1"><Droplets size={9} /> 色调</label>
                      <div className="flex flex-wrap gap-1">
                        {TONE_OPTIONS.map((o) => (
                          <button key={o.value} onClick={() => setStructTone(o.value)}
                            className={cn("px-2 py-1 rounded-md text-[10px] transition-all",
                              structTone === o.value ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-700 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-600 border border-neutral-200/60 dark:border-neutral-600")}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Extra detail */}
                    <div>
                      <label className="text-[10px] font-medium text-neutral-400 uppercase tracking-wider mb-1 block">细节补充</label>
                      <input value={structDetail} onChange={(e) => setStructDetail(e.target.value)} placeholder="其他细节描述，如：8K超清、景深效果..."
                        className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-200/60 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-xs outline-none focus:border-violet-300 transition-all" />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Template library toggle */}
          <div>
            <button onClick={() => setShowTemplates(!showTemplates)}
              className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-400 hover:text-violet-500 transition-colors">
              <BookOpen size={11} /> {showTemplates ? "收起模板" : "灵感模板"}
            </button>
            <AnimatePresence>
              {showTemplates && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden">
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                      {TEMPLATE_CATEGORIES.map((cat) => (
                        <button key={cat} onClick={() => setTplCategory(cat)}
                          className={cn("px-2.5 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap transition-all shrink-0",
                            tplCategory === cat ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-neutral-50 dark:bg-neutral-800 text-neutral-500 hover:bg-neutral-100")}>
                          {cat}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {templates.length === 0 ? (
                        <p className="text-[11px] text-neutral-300 text-center py-3">暂无模板</p>
                      ) : templates.map((tpl) => (
                        <button key={tpl.id} onClick={() => { setPrompt(tpl.prompt); setShowTemplates(false); }}
                          className="w-full text-left p-2.5 rounded-lg bg-neutral-50/80 dark:bg-neutral-800/40 border border-neutral-100/60 dark:border-neutral-800/60 hover:border-violet-300 dark:hover:border-violet-600 transition-all group">
                          <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">{tpl.title}</div>
                          <div className="text-[10px] text-neutral-400 mt-0.5 line-clamp-2 leading-relaxed">{tpl.prompt}</div>
                          {tpl.tags && (
                            <div className="flex gap-1 mt-1">
                              {tpl.tags.split(",").slice(0, 3).map((tag) => (
                                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-400">{tag.trim()}</span>
                              ))}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Reference image */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1.5">参考图（可选）</label>
            {/* 从模板带入的参考图 */}
            {refImageUrls.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {refImageUrls.map((url, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-neutral-200/60 bg-neutral-50">
                    <img src={url} alt={`参考图${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => setRefImageUrls(prev => prev.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white hover:bg-black/70 transition-colors"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {refImage ? (
              <div className="relative w-full rounded-xl overflow-hidden border border-neutral-200/60 bg-neutral-50">
                <img src={refImage} alt="参考图" className="w-full h-28 object-cover" />
                <button
                  onClick={() => { setRefImage(""); setRefImageUrls(prev => prev.slice(0, -1)); }}
                  className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => refInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("!border-violet-400", "!bg-violet-50/50"); }}
                onDragLeave={(e) => { e.currentTarget.classList.remove("!border-violet-400", "!bg-violet-50/50"); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove("!border-violet-400", "!bg-violet-50/50");
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleImageFile(file);
                }}
                className="w-full h-20 rounded-xl border-2 border-dashed border-neutral-200/80 hover:border-violet-300 bg-neutral-50/50 flex flex-col items-center justify-center gap-1 transition-colors"
              >
                <Upload size={16} className="text-neutral-300" />
                <span className="text-[11px] text-neutral-400">点击上传、拖拽或粘贴图片</span>
              </button>
            )}
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageFile(file);
                e.target.value = "";
              }}
            />
          </div>

          {/* Model Selector */}
          <div className="relative">
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1.5">模型</label>
            <button
              onClick={() => !isLocked("model") && setShowModelPicker(!showModelPicker)}
              disabled={isLocked("model")}
              className={cn("w-full flex items-center justify-between px-3 py-2 rounded-xl border border-neutral-200/60 dark:border-neutral-700/60 bg-neutral-50/50 dark:bg-neutral-800/50 hover:bg-white dark:hover:bg-neutral-800 hover:border-violet-300 dark:hover:border-violet-500 transition-all text-sm", isLocked("model") && "opacity-60 cursor-not-allowed")}
            >
              <span className="text-neutral-800 dark:text-neutral-200 font-medium truncate">
                {models.find((m) => m.name === selectedModel)?.display_name || selectedModel || "选择模型"}
              </span>
              <ChevronDown size={14} className={cn("text-neutral-400 transition-transform", showModelPicker && "rotate-180")} />
            </button>
            {showModelPicker && !isLocked("model") && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowModelPicker(false)} />
                <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-700 shadow-xl max-h-[360px] overflow-y-auto">
                  {models.map((m) => {
                    const badgeColors: Record<string, string> = { Hot: "bg-red-100 text-red-600", New: "bg-emerald-100 text-emerald-600", Pro: "bg-violet-100 text-violet-600" };
                    return (
                      <button
                        key={m.name}
                        onClick={() => { selectModel(m.name); setShowModelPicker(false); }}
                        className={cn(
                          "w-full px-3 py-3 hover:bg-neutral-50 transition-colors text-left border-b border-neutral-100/60 last:border-b-0",
                          selectedModel === m.name && "bg-violet-50/60"
                        )}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-neutral-800">{m.display_name}</span>
                            {m.badge && <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", badgeColors[m.badge] || "bg-neutral-100 text-neutral-500")}>{m.badge}</span>}
                          </div>
                          <span className={cn("text-[11px] font-medium", m.price_per_call > 0 ? "text-amber-600" : "text-emerald-600")}>
                            {m.price_per_call > 0 ? `${m.price_per_call} 积分` : "免费"}
                          </span>
                        </div>
                        {m.description && <p className="text-[11px] text-neutral-500 leading-relaxed line-clamp-2">{m.description}</p>}
                        {m.tags && m.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {m.tags.map((tag: string) => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-500">{tag}</span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* Style Selector */}
          <div className={cn(isLocked("style") && "opacity-60 pointer-events-none")}>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1.5">风格</label>
            <div className="flex flex-wrap gap-1.5">
              {STYLES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSelectedStyle(s.value)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-[11px] transition-all",
                    selectedStyle === s.value
                      ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-sm"
                      : "bg-neutral-50 dark:bg-neutral-800 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Brand Linkage */}
          {hasBrandKit && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-violet-50/80 dark:bg-violet-900/20 border border-violet-100/60 dark:border-violet-800/40">
              <div className="flex items-center gap-2">
                <Palette size={13} className="text-violet-500" />
                <div>
                  <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300">应用品牌风格</span>
                  {applyBrand && brandKeywords && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {brandKeywords.split(",").filter(Boolean).slice(0, 4).map((kw, i) => (
                        <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100/80 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400">{kw.trim()}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setApplyBrand(!applyBrand)} className="transition-colors">
                {applyBrand ? <ToggleRight size={22} className="text-violet-500" /> : <ToggleLeft size={22} className="text-neutral-300" />}
              </button>
            </div>
          )}

          {/* Resolution - from model config */}
          {cfg?.resolutions && cfg.resolutions.values.length > 0 && (
            <div className={cn(isLocked("resolution") && "opacity-60 pointer-events-none")}>
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1.5">分辨率</label>
              <div className="flex rounded-xl bg-neutral-100/80 dark:bg-neutral-800/80 p-0.5">
                {cfg.resolutions.values.map((r) => (
                  <button
                    key={r}
                    onClick={() => setResolution(r)}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs transition-all",
                      resolution === r
                        ? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm font-medium"
                        : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                    )}
                  >
                    {RESOLUTION_LABELS[r] || r}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Aspect Ratio - from model config or fallback */}
          <div className={cn(isLocked("ratio") && "opacity-60 pointer-events-none")}>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1.5">宽高比</label>
            <div className="flex flex-wrap gap-1.5">
              {(cfg?.ratios?.values || FALLBACK_RATIOS).map((r) => (
                <button
                  key={r}
                  onClick={() => setRatio(r)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-[11px] transition-all",
                    ratio === r
                      ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-sm"
                      : "bg-neutral-50 dark:bg-neutral-800 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  )}
                >
                  {RATIO_LABELS[r] || r}
                </button>
              ))}
              <CustomRatioPopover
                onConfirm={(r) => setRatio(r)}
                isActive={!!(ratio && !(cfg?.ratios?.values || FALLBACK_RATIOS).includes(ratio))}
              />
            </div>
          </div>

          {/* Quality - from model config */}
          {cfg?.qualities && cfg.qualities.values.length > 0 && (
            <div className={cn(isLocked("quality") && "opacity-60 pointer-events-none")}>
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1.5">图像质量</label>
              <div className="flex rounded-xl bg-neutral-100/80 dark:bg-neutral-800/80 p-0.5">
                {cfg.qualities.values.map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs transition-all",
                      quality === q
                        ? "bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm font-medium"
                        : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                    )}
                  >
                    {QUALITY_LABELS[q] || q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Count */}
          <div className={cn(isLocked("count") && "opacity-60 pointer-events-none")}>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-1.5">数量</label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCount(Math.max(1, count - 1))}
                className="w-7 h-7 rounded-lg bg-neutral-50 dark:bg-neutral-800 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
              >
                <Minus size={12} className="text-neutral-500" />
              </button>
              <span className="text-sm font-semibold w-5 text-center text-neutral-900 dark:text-neutral-100">{count}</span>
              <button
                onClick={() => setCount(Math.min(maxCount, count + 1))}
                className="w-7 h-7 rounded-lg bg-neutral-50 dark:bg-neutral-800 flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
              >
                <Plus size={12} className="text-neutral-500" />
              </button>
            </div>
          </div>
        </div>

        {/* Generate button */}
        <div className="p-4 border-t border-neutral-100/60 dark:border-neutral-800/60">
          <button
            disabled={!prompt.trim() || generating}
            onClick={doGenerate}
            className="w-full py-2.5 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 hover:shadow-lg hover:shadow-purple-200/50 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 生成中...
              </>
            ) : (
              <>
                <Sparkles size={16} /> 生成图片
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* Right: Infinite Canvas */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        <CanvasTabs onSave={handleSaveCanvas} />
        <div className="flex-1 relative overflow-hidden">
          <ImageCanvas canvas={canvas} callbacks={canvasCallbacks} />
        </div>
      </div>

      {/* Inpaint Editor Modal */}
      <AnimatePresence>
        {inpaintTarget && (
          <InpaintEditor
            src={inpaintTarget.src}
            onSubmit={handleInpaintSubmit}
            onClose={() => setInpaintTarget(null)}
            loading={inpaintLoading}
          />
        )}
      </AnimatePresence>

      {/* Resize Dialog */}
      <AnimatePresence>
        {resizeTarget && (
          <ResizeDialog
            src={resizeTarget.src}
            originalWidth={resizeTarget.w}
            originalHeight={resizeTarget.h}
            onSubmit={handleResizeSubmit}
            onClose={() => setResizeTarget(null)}
            loading={resizeLoading}
          />
        )}
      </AnimatePresence>

      {/* Unsaved Changes Dialog */}
      <AnimatePresence>
        {unsaved.showDialog && (
          <UnsavedDialog
            onSaveAndLeave={unsaved.handleSaveAndLeave}
            onLeaveWithoutSave={unsaved.handleLeaveWithoutSave}
            onContinueEdit={unsaved.handleContinueEdit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
