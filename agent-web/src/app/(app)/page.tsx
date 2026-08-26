"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, X, ChevronDown, ShoppingBag, FileText, Sparkles, Image as ImageIcon,
  Palette, PenLine, ArrowRight, ArrowUp, Zap, Loader2, Download, Paperclip,
  Globe, Wand2, Copy, Check, RefreshCw, ThumbsUp, ThumbsDown,
  Plus, Trash2, MessageSquare, Search, PanelLeftClose, PanelLeft, Pencil,
  Clock, Mail, Code, Maximize2, Edit3,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { modelAPI, imageAPI, generationAPI, inspirationAPI, chatAPI, uploadAPI } from "@/lib/api";
import LazyImage from "@/components/ui/lazy-image";
import { downloadImage } from "@/lib/download";
import CustomRatioPopover from "@/components/ui/custom-ratio-popover";
import Footer from "@/components/footer";
import { usePageTitle } from "@/hooks/use-page-title";
import { useOptimizePrompt } from "@/hooks/use-optimize-prompt";
import { featureFlags, isWebRouteEnabled } from "@/lib/features";

/* ═══ Types ═══ */
interface Conversation { id: number; title: string; model: string; message_count: number; pinned: boolean; updated_at: string; }
interface Message { id: number; role: "user" | "assistant" | "system"; content: string; model: string; created_at: string; }
interface ImageGenTask { prompt: string; status: "pending" | "generating" | "completed" | "failed"; url?: string; genId?: number; error?: string; }
interface ModeConfig { key: string; label: string; icon: any; color: string; subtitle: string; placeholder: string; params: { key: string; label: string; options: string[]; default: string }[]; shortcuts: { title: string; desc: string; href: string; icon: any }[]; }
interface ImageModelItem { name: string; display_name: string; icon: string; description: string; badge: string; tags: string[]; vip_only: boolean; config: any; }

/* ═══ Config ═══ */
const MODES: ModeConfig[] = [
  { key: "image", label: "图文创作", icon: ImageIcon, color: "#FF8C42", subtitle: "支持小红书、公众号贴图等平台图文创作", placeholder: "描述你想要创作的图文内容...",
    params: [{ key: "ratio", label: "尺寸", options: ["1:1","3:4","4:3","9:16","16:9"], default: "3:4" }, { key: "style", label: "风格", options: ["智能","写实","插画","3D","动漫"], default: "智能" }],
    shortcuts: [{ title: "去画布", desc: "图文创作", href: "/generate", icon: Palette }, { title: "文案创作", desc: "智能文案生成", href: "/copywriting", icon: PenLine }] },
  { key: "poster", label: "海报设计", icon: Wand2, color: "#59CD6D", subtitle: "支持海报设计、长图海报、详情页生成", placeholder: "描述你想要设计的图文海报主题...",
    params: [{ key: "ratio", label: "智能尺寸", options: ["智能尺寸","1:1","3:4","9:16","16:9","A4"], default: "智能尺寸" }, { key: "style", label: "风格", options: ["智能","简约","国潮","赛博","复古"], default: "智能" }],
    shortcuts: [] },
  { key: "product", label: "商品图", icon: ShoppingBag, color: "#3382FD", subtitle: "电商商品主图、场景图、白底图一键生成", placeholder: "输入商品信息或卖点...",
    params: [{ key: "platform", label: "平台", options: ["淘宝/天猫","亚马逊","京东","拼多多","Shopee","独立站"], default: "淘宝/天猫" }, { key: "ratio", label: "尺寸", options: ["1:1","3:4","4:5","16:9"], default: "1:1" }],
    shortcuts: [{ title: "商品套图", desc: "主图场景全套生成", href: "/product-photo", icon: ShoppingBag }, { title: "A+ 详情页", desc: "高转化详情页生成", href: "/a-plus", icon: FileText }, { title: "智能抠图", desc: "3秒去除背景", href: "/cutout", icon: Sparkles }] },
  { key: "copywriting", label: "文案创作", icon: PenLine, color: "#F5A623", subtitle: "电商文案、种草笔记、营销文案智能生成", placeholder: "输入商品或主题信息...",
    params: [{ key: "platform", label: "平台", options: ["小红书","淘宝","抖音","亚马逊","公众号"], default: "小红书" }, { key: "tone", label: "风格", options: ["种草","专业","活泼","高端","促销"], default: "种草" }],
    shortcuts: [{ title: "商品描述", desc: "多平台商品文案", href: "/copywriting", icon: ShoppingBag }, { title: "种草文案", desc: "小红书风格笔记", href: "/copywriting", icon: PenLine }, { title: "标题优化", desc: "高点击率标题", href: "/copywriting", icon: Sparkles }] },
];

const MODE_FEATURES: Record<string, keyof typeof featureFlags> = {
  image: "image",
  poster: "image",
  product: "image",
  copywriting: "copywriting",
};

const INSP_PH = [
  { bg: "bg-rose-100 dark:bg-rose-900/30" }, { bg: "bg-blue-100 dark:bg-blue-900/30" },
  { bg: "bg-amber-100 dark:bg-amber-900/30" }, { bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  { bg: "bg-purple-100 dark:bg-purple-900/30" }, { bg: "bg-red-100 dark:bg-red-900/30" },
  { bg: "bg-sky-100 dark:bg-sky-900/30" }, { bg: "bg-lime-100 dark:bg-lime-900/30" },
  { bg: "bg-fuchsia-100 dark:bg-fuchsia-900/30" }, { bg: "bg-teal-100 dark:bg-teal-900/30" },
  { bg: "bg-orange-100 dark:bg-orange-900/30" }, { bg: "bg-violet-100 dark:bg-violet-900/30" },
];

const FALLBACK_MODELS = [
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" }, { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI" },
  { id: "deepseek-chat", name: "DeepSeek V3", provider: "DeepSeek" }, { id: "deepseek-reasoner", name: "DeepSeek R1", provider: "DeepSeek" },
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "Anthropic" }, { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
];

const SUGGESTIONS = [
  { label: "帮我写一封邮件", icon: Mail }, { label: "生成一张图片", icon: Palette },
  { label: "翻译这段文字", icon: Globe }, { label: "写一段代码", icon: Code },
];

const RATIO_OPTIONS = ["1:1", "3:4", "4:3", "9:16", "16:9"];

const GEN_STAGES = [
  { text: "正在理解你的描述…", icon: "✨", ms: 3000 },
  { text: "构图中…", icon: "🎨", ms: 5000 },
  { text: "打草稿…", icon: "✏️", ms: 7000 },
  { text: "精细绘制中…", icon: "🖌️", ms: 10000 },
  { text: "快完成了…", icon: "⏳", ms: Infinity },
];

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.08 } } };
const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } } };

/* ═══ Helpers ═══ */
function extractImageGenPrompts(text: string): string[] {
  const r = /<image_gen>([\s\S]*?)<\/image_gen>/g; const p: string[] = []; let m;
  while ((m = r.exec(text)) !== null) p.push(m[1].trim()); return p;
}
function stripImageGenTags(t: string) { return t.replace(/<image_gen>[\s\S]*?<\/image_gen>/g, "").trim(); }
function groupByDate(convs: Conversation[]) {
  const today = new Date(); today.setHours(0,0,0,0);
  const yd = new Date(today); yd.setDate(yd.getDate()-1);
  const wk = new Date(today); wk.setDate(wk.getDate()-7);
  const g: { label: string; items: Conversation[] }[] = [];
  const a: Conversation[] = [], b: Conversation[] = [], c: Conversation[] = [], d: Conversation[] = [];
  for (const cv of convs) { const dt = new Date(cv.updated_at); if (dt>=today) a.push(cv); else if (dt>=yd) b.push(cv); else if (dt>=wk) c.push(cv); else d.push(cv); }
  if (a.length) g.push({ label: "今天", items: a }); if (b.length) g.push({ label: "昨天", items: b });
  if (c.length) g.push({ label: "近7天", items: c }); if (d.length) g.push({ label: "更早", items: d }); return g;
}

/* ═══ Sub-components ═══ */

const ROTATING_WORDS = [
  { text: "想法，", color: "text-violet-500" },
  { text: "灵感，", color: "text-amber-500" },
  { text: "故事，", color: "text-rose-500" },
  { text: "画面，", color: "text-emerald-500" },
  { text: "创意，", color: "text-sky-500" },
  { text: "瞬间，", color: "text-fuchsia-500" },
];

function RotatingWord() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % ROTATING_WORDS.length), 3000);
    return () => clearInterval(timer);
  }, []);
  const word = ROTATING_WORDS[index];
  return (
    <span className="inline-block relative mx-1 min-w-[4.5rem] text-left align-baseline">
      <AnimatePresence mode="wait">
        <motion.span
          key={word.text}
          initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -20, filter: "blur(8px)" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className={`inline-block ${word.color}`}
        >
          {word.text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function ParamPill({ options, value, onChange, color }: { options: string[]; value: string; onChange: (v: string) => void; color: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const cl = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", cl); return () => document.removeEventListener("mousedown", cl); }, []);
  return (
    <div ref={ref} className="relative">
      <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-neutral-600 hover:bg-neutral-100/80 transition-colors whitespace-nowrap">
        <span className="font-medium">{value}</span>
        <ChevronDown size={11} className={cn("text-neutral-400 transition-transform duration-200", open && "rotate-180")} />
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="absolute bottom-full left-0 mb-2 bg-white/95 dark:bg-neutral-800/95 backdrop-blur-xl rounded-xl border border-neutral-200/60 dark:border-neutral-700 shadow-xl py-1.5 z-50 min-w-[120px]">
            {options.map((opt) => (
              <button key={opt} onClick={() => { onChange(opt); setOpen(false); }}
                className={cn("block w-full text-left px-3 py-1.5 text-xs transition-colors", value === opt ? "font-medium" : "text-neutral-500 hover:bg-neutral-50")}
                style={value === opt ? { color } : undefined}>{opt}</button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ActionBar({ content, onRegenerate }: { content: string; onRegenerate?: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-0.5 mt-2 opacity-0 group-hover/msg:opacity-100 transition-opacity">
      <button onClick={copy} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" title="复制">
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
      </button>
      {onRegenerate && <button onClick={onRegenerate} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" title="重新生成"><RefreshCw size={14} /></button>}
      <button className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"><ThumbsUp size={14} /></button>
      <button className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"><ThumbsDown size={14} /></button>
    </motion.div>
  );
}

function ImageGenLoading({ prompt, onScroll }: { prompt: string; onScroll?: () => void }) {
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (stage >= GEN_STAGES.length - 1) return;
    const t = setTimeout(() => { setStage((s) => s + 1); onScroll?.(); }, GEN_STAGES[stage].ms);
    return () => clearTimeout(t);
  }, [stage, onScroll]);
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + (100 - p) * 0.02, 95));
    }, 200);
    return () => clearInterval(interval);
  }, []);
  const cur = GEN_STAGES[stage];
  return (
    <div className="aspect-[3/4] flex flex-col items-center justify-center gap-3 relative overflow-hidden rounded-xl">
      {/* Animated gradient background */}
      <div className="absolute inset-0 img-gen-gradient" />
      {/* Shimmer overlay */}
      <div className="absolute inset-0 img-gen-shimmer" />
      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <motion.div key={i} className="absolute w-1 h-1 rounded-full bg-neutral-300/50"
            initial={{ x: `${20 + i * 12}%`, y: "110%", opacity: 0 }}
            animate={{ y: "-10%", opacity: [0, 0.8, 0] }}
            transition={{ duration: 4 + i * 0.5, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }} />
        ))}
      </div>
      {/* Center content */}
      <div className="relative z-10 text-center">
        <AnimatePresence mode="wait">
          <motion.div key={stage} initial={{ opacity: 0, y: 12, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, scale: 0.9 }} transition={{ type: "spring", stiffness: 300, damping: 25 }}>
            <motion.span className="text-3xl mb-3 block" animate={{ scale: [1, 1.15, 1], rotate: [0, 5, -5, 0] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>{cur.icon}</motion.span>
            <p className="text-xs text-neutral-600 font-medium tracking-wide">{cur.text}</p>
          </motion.div>
        </AnimatePresence>
        {prompt && <p className="text-[10px] text-neutral-400 mt-3 line-clamp-2 max-w-[160px] mx-auto">{prompt}</p>}
      </div>
      {/* Progress bar */}
      <div className="absolute bottom-4 left-4 right-4 z-10">
        <div className="h-1 rounded-full bg-neutral-200/60 overflow-hidden">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-neutral-400 to-neutral-600" style={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   HomePage — unified with Chat (01Agent style)
   ═══════════════════════════════════════════════════════ */
export default function HomePage() {
  return <Suspense fallback={null}><HomeContent /></Suspense>;
}

function HomeContent() {
  usePageTitle("智能创作平台");
  const router = useRouter();
  const searchParams = useSearchParams();

  /* ── View state ── */
  const [viewMode, setViewMode] = useState<"idle" | "chatting">("idle");

  /* ── Shared ── */
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  /* ── Mode system ── */
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const visibleModes = MODES.filter((item) => featureFlags[MODE_FEATURES[item.key]]);
  const mode = visibleModes.find((m) => m.key === activeMode) || null;

  /* ── Image models ── */
  const [imageModels, setImageModels] = useState<ImageModelItem[]>([]);
  const [selModel, setSelModel] = useState("");
  const [showModelPicker, setShowModelPicker] = useState(false);

  /* ── Reference images ── */
  const [refImages, setRefImages] = useState<{ url: string; file?: File }[]>([]);
  const refInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  /* ── Image gen modal ── */
  const [generating, setGenerating] = useState(false);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genResults, setGenResults] = useState<any[]>([]);
  const [genPrompt, setGenPrompt] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Inspiration ── */
  const [showcaseData, setShowcaseData] = useState<any[]>([]);

  /* ── Chat state ── */
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [selectedChatModel, setSelectedChatModel] = useState("gpt-4o");
  const [chatModels, setChatModels] = useState(FALLBACK_MODELS);
  const [showChatModelPicker, setShowChatModelPicker] = useState(false);
  const [chatImageModels, setChatImageModels] = useState<{ name: string; display_name: string; provider: string }[]>([]);
  const [imageGenTasks, setImageGenTasks] = useState<Record<number, ImageGenTask[]>>({});
  const [historySidebarOpen, setHistorySidebarOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [chatRefImages, setChatRefImages] = useState<{ url: string; file?: File; uploaded?: string }[]>([]);
  const [selectedImageModel, setSelectedImageModel] = useState("");
  const [selectedRatio, setSelectedRatio] = useState("1:1");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showImgModelPicker, setShowImgModelPicker] = useState(false);
  const [showRatioPicker, setShowRatioPicker] = useState(false);
  const [dragging, setDragging] = useState(false);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  const { optimizing, optimize: handleOptimizePrompt } = useOptimizePrompt();
  const curChatModel = chatModels.find((m) => m.id === selectedChatModel) || chatModels[0];
  const curImgModel = imageModels.find((m) => m.name === selModel);
  const curChatImgModel = imageModels.find((m) => m.name === selectedImageModel);
  const availableRatios: string[] = curChatImgModel?.config?.ratios?.values?.length ? curChatImgModel.config.ratios.values : RATIO_OPTIONS;
  const defaultRatio: string = curChatImgModel?.config?.ratios?.default || "1:1";

  /* ── Init ── */
  useEffect(() => {
    if (featureFlags.image) {
      modelAPI.imageModels().then((res) => {
        const data: ImageModelItem[] = res.data?.data ?? [];
        setImageModels(data);
        if (data.length > 0) setSelModel(data[0].name);
        setChatImageModels(data.map((m: any) => ({ name: m.name, display_name: m.display_name || m.name, provider: m.provider || "" })));
        if (data.length > 0) {
          setSelectedImageModel(data[0].name);
          const dr = data[0].config?.ratios?.default;
          if (dr) setSelectedRatio(dr);
        }
      }).catch(() => {});
    }
    if (featureFlags.chat) {
      modelAPI.list("chat").then((res) => {
        const models = res.data?.data;
        if (models?.length > 0) {
          setChatModels(models.map((m: any) => ({ id: m.name, name: m.display_name || m.name, provider: m.description || m.type })));
          setSelectedChatModel(models[0].name);
        }
      }).catch(() => {});
    }
    if (featureFlags.discovery) {
      inspirationAPI.list({ page: 1, page_size: 6 }).then((res) => setShowcaseData(res.data?.data ?? [])).catch(() => {});
    }
    if (featureFlags.chat) {
      chatAPI.listConversations().then((res) => setConversations(res.data?.data || [])).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const q = searchParams.get("q") || searchParams.get("prompt");
    if (q && selectedChatModel && !autoSentRef.current) { autoSentRef.current = true; setViewMode("chatting"); setTimeout(() => sendChatMessage(q), 300); }
  }, [searchParams, selectedChatModel]);

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current); }; }, []);
  useEffect(() => { if (mode) { const d: Record<string, string> = {}; mode.params.forEach((p) => { d[p.key] = p.default; }); setParamValues(d); } }, [activeMode]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  /* ── Conversation management ── */
  const selectConversation = async (conv: Conversation) => {
    setActiveConv(conv); setSelectedChatModel(conv.model); setViewMode("chatting");
    try { const res = await chatAPI.getConversation(conv.id); setMessages(res.data.messages || []); } catch { setMessages([]); }
  };
  const createNewConv = () => { setActiveConv(null); setMessages([]); setInput(""); };
  const deleteConv = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try { await chatAPI.deleteConversation(id); setConversations((p) => p.filter((c) => c.id !== id)); if (activeConv?.id === id) { setActiveConv(null); setMessages([]); } } catch {}
  };

  /* ── Mode helpers ── */
  const selectMode = (key: string) => {
    if (!MODE_FEATURES[key] || !featureFlags[MODE_FEATURES[key]]) return;
    setActiveMode(key);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };
  const clearMode = () => { setActiveMode(null); setParamValues({}); };

  /* ── Image gen polling ── */
  const pollGeneration = useCallback((genId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await generationAPI.get(genId); const gen = res.data?.data;
        if (gen?.status === "completed" || gen?.status === "failed") { setGenResults((p) => p.map((r) => r.id === genId ? gen : r)); setGenerating(false); if (pollRef.current) clearInterval(pollRef.current); }
      } catch {}
    }, 3000);
  }, []);

  /* ── Chat image gen ── */
  const scrollToBottom = useCallback(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, []);

  const requestImageGeneration = useCallback(async (msgId: number, content: string) => {
    const prompts = extractImageGenPrompts(content);
    if (!prompts.length) return;
    // Upload any pending chat reference images
    const refUrls: string[] = [];
    for (const img of chatRefImages) {
      if (img.uploaded) { refUrls.push(img.uploaded); continue; }
      if (img.file) {
        try { const r = await uploadAPI.upload(img.file); const u = r.data?.data?.url || r.data?.url; if (u) refUrls.push(u); } catch { /* skip */ }
      } else if (img.url && !img.url.startsWith("blob:")) { refUrls.push(img.url); }
    }
    triggerImageGeneration(msgId, content, selectedImageModel || undefined, refUrls.length ? refUrls : undefined);
  }, [selectedImageModel, chatRefImages]);

  const triggerImageGeneration = useCallback(async (msgId: number, content: string, model?: string, refUrls?: string[]) => {
    const prompts = extractImageGenPrompts(content);
    if (!prompts.length) return;
    const tasks: ImageGenTask[] = prompts.map((p) => ({ prompt: p, status: "generating" }));
    setImageGenTasks((prev) => ({ ...prev, [msgId]: tasks }));
    scrollToBottom();
    for (let i = 0; i < prompts.length; i++) {
      try {
        const res = await imageAPI.generate({ prompt: prompts[i], n: 1, model, ratio: selectedRatio || undefined, image_urls: refUrls?.length ? refUrls : undefined }); const gen = res.data?.data;
        if (gen?.id) {
          setImageGenTasks((prev) => { const u = [...(prev[msgId]||[])]; u[i] = { ...u[i], genId: gen.id, status: "generating" }; return { ...prev, [msgId]: u }; });
          const pi = setInterval(async () => {
            try {
              const pr = await generationAPI.get(gen.id); const pg = pr.data?.data;
              if (pg?.status === "completed" && pg?.result_url) { clearInterval(pi); setImageGenTasks((prev) => { const u = [...(prev[msgId]||[])]; u[i] = { ...u[i], status: "completed", url: pg.result_url }; return { ...prev, [msgId]: u }; }); scrollToBottom(); }
              else if (pg?.status === "failed") { clearInterval(pi); setImageGenTasks((prev) => { const u = [...(prev[msgId]||[])]; u[i] = { ...u[i], status: "failed", error: pg?.error_msg || "生成失败" }; return { ...prev, [msgId]: u }; }); }
            } catch {}
          }, 3000);
        } else if (gen?.result_url) { setImageGenTasks((prev) => { const u = [...(prev[msgId]||[])]; u[i] = { ...u[i], status: "completed", url: gen.result_url }; return { ...prev, [msgId]: u }; }); scrollToBottom(); }
      } catch (err: any) { setImageGenTasks((prev) => { const u = [...(prev[msgId]||[])]; u[i] = { ...u[i], status: "failed", error: err?.response?.data?.error || "请求失败" }; return { ...prev, [msgId]: u }; }); }
    }
    setChatRefImages([]);
  }, [selectedRatio, scrollToBottom]);

  /* ── Send chat message ── */
  const sendChatMessage = useCallback(async (overrideInput?: string) => {
    if (!featureFlags.chat) return;
    const content = (overrideInput ?? input).trim();
    if (!content || sendingRef.current) return;
    sendingRef.current = true;
    setInput("");

    let conv = activeConv;
    if (!conv) {
      try { const res = await chatAPI.createConversation({ model: selectedChatModel, title: content.slice(0, 30) }); conv = res.data; setConversations((p) => [res.data, ...p]); setActiveConv(res.data); } catch { sendingRef.current = false; setSending(false); return; }
    }
    if (!conv) { sendingRef.current = false; setSending(false); return; }

    setSending(true); sendingRef.current = true;
    setMessages((prev) => [...prev, { id: Date.now(), role: "user", content, model: conv!.model, created_at: new Date().toISOString() }]);

    try {
      const result = await chatAPI.sendMessage(conv.id, { content, model: selectedChatModel });
      setMessages((prev) => [...prev.slice(0, -1), result.data.user_message, result.data.assistant_message]);
      if (extractImageGenPrompts(result.data.assistant_message.content).length > 0) {
        requestImageGeneration(result.data.assistant_message.id, result.data.assistant_message.content);
      }
    } catch (err) {
      const status = (err as any)?.status || (err as any)?.response?.status;
      if (status === 402) alert("积分不足，请充值后再试");
      else if (status === 403) alert("内容包含违规信息，请修改后重试");
      else if (status === 503) alert("当前模型暂不可用，请切换其他模型");
      else alert("消息发送失败，请稍后重试");
      setMessages((prev) => prev.slice(0, -1));
    } finally { setSending(false); sendingRef.current = false; }
  }, [input, activeConv, selectedChatModel, requestImageGeneration]);

  const regenerateLastMsg = () => {
    if (!activeConv || messages.length < 2 || sending) return;
    const idx = [...messages].reverse().findIndex((m) => m.role === "user"); if (idx === -1) return;
    const msg = messages[messages.length - 1 - idx];
    setMessages((p) => p.slice(0, p.length - 1 - idx + 1));
    sendChatMessage(msg.content);
  };
  const autoResize = useCallback(() => { const el = chatInputRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; } }, []);

  /* ── Idle → Chat ── */
  const handleIdleSend = useCallback(async () => {
    if (!input.trim()) return;
    if (activeMode && !isWebRouteEnabled(activeMode === "copywriting" ? "/copywriting" : "/generate")) return;
    const q = encodeURIComponent(input.trim());
    if (activeMode === "product") { router.push(`/product-photo?prompt=${q}`); return; }
    if (activeMode === "poster") { router.push(`/poster?prompt=${q}&auto=1`); return; }
    if (activeMode === "image") {
      const params = new URLSearchParams({ prompt: input.trim(), auto: "1" });
      if (selModel) params.set("model", selModel);
      // Upload reference images and collect URLs
      if (refImages.length > 0) {
        const urls: string[] = [];
        for (const img of refImages) {
          if (img.file) {
            try {
              const res = await uploadAPI.upload(img.file);
              const url = res.data?.data?.url || res.data?.url;
              if (url) urls.push(url);
            } catch { /* skip failed uploads */ }
          } else if (img.url) {
            urls.push(img.url);
          }
        }
        if (urls.length > 0) params.set("ref_images", urls.join(","));
      }
      router.push(`/generate?${params.toString()}`);
      return;
    }
    // Default + copywriting: enter chat mode
    if (!featureFlags.chat) return;
    const txt = input.trim(); setViewMode("chatting");
    setTimeout(() => sendChatMessage(txt), 150);
  }, [input, activeMode, selModel, refImages, paramValues, router, pollGeneration, sendChatMessage]);

  const backToIdle = () => { setViewMode("idle"); setActiveConv(null); setMessages([]); setHistorySidebarOpen(false); setInput(""); };

  const filteredConvs = historySearch ? conversations.filter((c) => c.title.toLowerCase().includes(historySearch.toLowerCase())) : conversations;
  const convGroups = groupByDate(filteredConvs);
  const chatKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !sending) { e.preventDefault(); sendChatMessage(); } };

  /* ═══════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════ */
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-[#FAFAF8] dark:bg-[#0A0A0A]">
      <AnimatePresence mode="wait">
        {viewMode === "idle" ? (
          /* ═════════ IDLE STATE ═════════ */
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -30, transition: { duration: 0.3 } }} className="flex-1 flex flex-col overflow-y-auto">
            <section className="pt-12 sm:pt-20 pb-6 px-4 sm:px-6 relative">
              <motion.div className="absolute inset-0 pointer-events-none overflow-hidden" animate={{ opacity: mode ? 1 : 0.6 }} transition={{ duration: 0.8 }}>
                <div className="absolute top-[-15%] left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full blur-[120px] opacity-20 transition-colors duration-1000"
                  style={{ background: mode ? mode.color + "12" : "rgba(168,162,158,0.08)" }} />
              </motion.div>
              <div className="max-w-3xl mx-auto text-center relative z-10">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
                  <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
                    <span className="text-neutral-900 dark:text-neutral-100">从一个</span>
                    <RotatingWord />
                    <span className="text-neutral-900 dark:text-neutral-100">开始创作</span>
                  </h1>
                </motion.div>
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}>
                  <AnimatePresence mode="wait">
                    <motion.p key={activeMode || "default"} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }} className="text-sm text-neutral-400 mb-8">
                      {mode ? mode.subtitle : "AI 图片生成 · 文案创作 · 电商设计，一站搞定"}
                    </motion.p>
                  </AnimatePresence>
                </motion.div>

                {/* ═══ INPUT BOX ═══ */}
                <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
                  <motion.div
                    animate={{ boxShadow: isDraggingOver ? `0 0 0 2px #FF8C4280, 0 8px 40px #FF8C4230` : isFocused ? `0 0 0 1px ${mode?.color || "#d4d4d4"}40, 0 4px 30px ${mode?.color || "#d4d4d4"}15, 0 1px 3px rgba(0,0,0,0.04)` : "0 2px 20px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)" }}
                    transition={{ duration: 0.3 }}
                    className={cn("rounded-2xl bg-white dark:bg-neutral-900 border text-left overflow-visible relative transition-colors duration-200", isDraggingOver ? "border-orange-400/60 dark:border-orange-500/60" : "border-neutral-200/60 dark:border-neutral-800/60")}
                    onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current++; if (dragCounterRef.current === 1) { setIsDraggingOver(true); if (!activeMode) selectMode("image"); } }}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDraggingOver(false); } }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current = 0; setIsDraggingOver(false); if (!activeMode) selectMode("image"); const files = e.dataTransfer.files; if (!files?.length) return; const imgs = Array.from(files).filter(f => f.type.startsWith("image/")).slice(0, 4 - refImages.length).map(f => ({ url: URL.createObjectURL(f), file: f })); if (imgs.length) setRefImages(prev => [...prev, ...imgs].slice(0, 4)); }}
                  >
                    {/* ── Drag overlay ── */}
                    <AnimatePresence>
                      {isDraggingOver && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="absolute inset-0 z-20 rounded-2xl bg-gradient-to-br from-orange-50/90 to-amber-50/90 dark:from-orange-950/80 dark:to-amber-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 pointer-events-none"
                        >
                          <motion.div
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.5, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 400, damping: 25 }}
                            className="w-12 h-12 rounded-2xl bg-orange-500/10 dark:bg-orange-400/20 flex items-center justify-center"
                          >
                            <ImageIcon size={24} className="text-orange-500 dark:text-orange-400" />
                          </motion.div>
                          <motion.p
                            initial={{ y: 8, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            transition={{ delay: 0.05 }}
                            className="text-sm font-medium text-orange-600 dark:text-orange-400"
                          >
                            松开上传参考图
                          </motion.p>
                          <p className="text-[11px] text-orange-400/70 dark:text-orange-500/60">最多 4 张</p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="px-5 pt-4 pb-2">
                      {/* Reference image tags */}
                      <AnimatePresence>
                        {activeMode === "image" && refImages.length > 0 && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                            className="flex flex-wrap gap-2 mb-2">
                            {refImages.map((img, i) => (
                              <motion.span key={i} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
                                className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60">
                                <img src={img.url} alt={`参考图${i + 1}`} className="w-6 h-6 rounded object-cover" />
                                <span className="text-xs text-neutral-600 dark:text-neutral-300">参考图{i + 1}</span>
                                <button onClick={() => setRefImages((p) => p.filter((_, j) => j !== i))}
                                  className="p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors">
                                  <X size={10} className="text-neutral-400" />
                                </button>
                              </motion.span>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div className="flex items-start gap-2">
                        <AnimatePresence>
                          {mode && (
                            <motion.span initial={{ opacity: 0, scale: 0.8, x: -20 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.8, x: -20 }}
                              transition={{ type: "spring", stiffness: 400, damping: 25 }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-white shrink-0 mt-0.5 cursor-pointer"
                              style={{ backgroundColor: mode.color }} onClick={clearMode}>
                              {mode.label}<X size={12} className="opacity-70" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                        <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)}
                          onFocus={() => setIsFocused(true)} onBlur={() => setIsFocused(false)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleIdleSend(); } }}
                          placeholder={mode?.placeholder || "请输入你的创作需求"} rows={3}
                          className="flex-1 resize-none border-none text-sm outline-none ring-0 focus:ring-0 focus:outline-none bg-transparent text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-600 leading-relaxed" />
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 px-3 py-2 border-t border-neutral-100/60 dark:border-neutral-800/60">
                      <AnimatePresence mode="popLayout">
                        {mode && mode.params.map((p) => (
                          <motion.div key={p.key} initial={{ opacity: 0, scale: 0.9, x: -10 }} animate={{ opacity: 1, scale: 1, x: 0 }} exit={{ opacity: 0, scale: 0.9, x: -10 }}
                            transition={{ type: "spring", stiffness: 400, damping: 25 }}>
                            <ParamPill options={p.options} value={paramValues[p.key] || p.default} onChange={(v) => setParamValues((prev) => ({ ...prev, [p.key]: v }))} color={mode.color} />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      {(activeMode === "image" || activeMode === "poster") && imageModels.length > 0 && (
                        <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => setShowModelPicker(true)}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:bg-neutral-100/80 transition-colors">
                          <Sparkles size={12} className="text-neutral-400" /><span className="font-medium">{curImgModel?.display_name || "模型"}</span>
                          <ChevronDown size={10} className="text-neutral-400" />
                        </motion.button>
                      )}
                      {(!activeMode || activeMode === "copywriting") && chatModels.length > 0 && (
                        <div className="relative">
                          <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => setShowChatModelPicker(!showChatModelPicker)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-neutral-500 hover:bg-neutral-100/80 transition-colors">
                            <MessageSquare size={12} className="text-neutral-400" /><span className="font-medium">{curChatModel?.name || "对话模型"}</span>
                            <ChevronDown size={10} className="text-neutral-400" />
                          </motion.button>
                          <AnimatePresence>
                            {showChatModelPicker && (
                              <motion.div initial={{ opacity: 0, y: 4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.97 }}
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700 rounded-xl shadow-lg py-1 z-50">
                                {chatModels.map((m) => (
                                  <button key={m.id} onClick={() => { setSelectedChatModel(m.id); setShowChatModelPicker(false); }}
                                    className={cn("w-full flex items-center justify-between px-3 py-2 text-[13px] hover:bg-neutral-50 transition-colors", selectedChatModel === m.id ? "text-neutral-900 font-medium" : "text-neutral-600")}>
                                    <span>{m.name}</span><span className="text-[11px] text-neutral-400">{m.provider}</span>
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                      <div className="w-px h-3.5 bg-neutral-200/60 mx-1" />
                      <motion.button
                        whileHover={!optimizing && input.trim() ? { y: -1, scale: 1.04 } : {}}
                        whileTap={!optimizing && input.trim() ? { scale: 0.93 } : {}}
                        onClick={() => handleOptimizePrompt(input, setInput)}
                        disabled={optimizing || !input.trim()}
                        className={cn(
                          "relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-300",
                          optimizing
                            ? "bg-amber-50 text-amber-600 shadow-sm shadow-amber-100"
                            : !input.trim()
                              ? "text-neutral-300 cursor-not-allowed"
                              : "text-neutral-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:text-amber-600 hover:shadow-sm hover:shadow-amber-100/50"
                        )}
                        title="AI 优化提示词"
                      >
                        <AnimatePresence mode="wait">
                          {optimizing ? (
                            <motion.span key="loading" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.5 }}
                              transition={{ duration: 0.2 }}>
                              <Loader2 size={12} className="text-amber-500 animate-spin" />
                            </motion.span>
                          ) : (
                            <motion.span key="idle" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, rotate: 90 }}
                              transition={{ duration: 0.2 }}>
                              <Zap size={12} className="text-amber-400" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                        <span className="hidden sm:inline">{optimizing ? "优化中…" : "优化"}</span>
                        {optimizing && (
                          <motion.span
                            className="absolute inset-0 rounded-lg border border-amber-300/50"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 0.6, 0] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          />
                        )}
                      </motion.button>
                      <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }}
                        onClick={() => { if (activeMode === "image") refInputRef.current?.click(); }}
                        className={cn("p-1.5 rounded-lg transition-colors", activeMode === "image" ? "text-neutral-500 hover:bg-neutral-100/80 dark:hover:bg-neutral-800/80" : "text-neutral-300 cursor-default")}
                        title={activeMode === "image" ? "上传参考图" : ""}><Paperclip size={14} /></motion.button>
                      <input ref={refInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                        const files = e.target.files;
                        if (!files) return;
                        const newImgs = Array.from(files).slice(0, 4 - refImages.length).map((f) => ({ url: URL.createObjectURL(f), file: f }));
                        setRefImages((prev) => [...prev, ...newImgs].slice(0, 4));
                        e.target.value = "";
                      }} />
                      <div className="flex-1" />
                      <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => { setViewMode("chatting"); setHistorySidebarOpen(true); }}
                        className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100/80 transition-colors mr-1" title="对话历史"><Clock size={14} /></motion.button>
                      <motion.button onClick={handleIdleSend} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.92 }} disabled={!input.trim()}
                        className={cn("p-2.5 rounded-xl text-white transition-all duration-300", input.trim() ? "shadow-lg" : "opacity-40 cursor-not-allowed")}
                        style={{ backgroundColor: input.trim() ? (mode?.color || "#18181b") : "#d4d4d4", boxShadow: input.trim() ? `0 4px 14px ${mode?.color || "#18181b"}30` : "none" }}>
                        <Send size={15} />
                      </motion.button>
                    </div>
                  </motion.div>
                </motion.div>

                {/* ═══ MODE BUTTONS ═══ */}
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.5 }} className="flex items-center justify-center gap-2 mt-5 flex-wrap">
                  {visibleModes.map((m) => (
                    <motion.button key={m.key} whileHover={{ scale: 1.04, y: -1 }} whileTap={{ scale: 0.96 }} onClick={() => selectMode(m.key)}
                      className={cn("flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] transition-all duration-300 border",
                        activeMode === m.key ? "bg-white dark:bg-neutral-800 font-medium text-neutral-900 dark:text-neutral-100 shadow-md border-transparent" : "bg-white/60 dark:bg-neutral-800/60 text-neutral-500 hover:bg-white/90 dark:hover:bg-neutral-700/90 border-transparent hover:border-neutral-200/60 dark:hover:border-neutral-600/60")}
                      style={activeMode === m.key ? { boxShadow: `0 0 0 1.5px ${m.color}, 0 4px 12px ${m.color}20` } : undefined}>
                      <m.icon size={14} style={{ color: activeMode === m.key ? m.color : undefined }} /><span>{m.label}</span>
                    </motion.button>
                  ))}
                </motion.div>

                {/* ═══ SHORTCUTS ═══ */}
                <AnimatePresence mode="wait">
                  {mode && mode.shortcuts.length > 0 && (
                    <motion.div key={`sc-${activeMode}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="mt-6">
                      <p className="text-xs text-neutral-400 mb-3">+ 添加快捷语</p>
                      <div className="flex items-center justify-center gap-3 overflow-x-auto scrollbar-hide pb-1">
                        {mode.shortcuts.map((s) => (
                          <Link key={s.title} href={s.href} className="shrink-0">
                            <motion.div whileHover={{ y: -3, boxShadow: "0 8px 25px rgba(0,0,0,0.08)" }} whileTap={{ scale: 0.97 }}
                              className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700 shadow-sm hover:border-neutral-300/80 dark:hover:border-neutral-600 transition-all cursor-pointer min-w-[180px]">
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${mode.color}12` }}><s.icon size={16} style={{ color: mode.color }} /></div>
                              <div className="text-left"><p className="text-sm font-medium text-neutral-800">{s.title}</p><p className="text-[11px] text-neutral-400">{s.desc}</p></div>
                              <ArrowRight size={14} className="text-neutral-300 ml-auto" />
                            </motion.div>
                          </Link>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* ═══ POSTER GALLERY ═══ */}
                <AnimatePresence>
                  {activeMode === "poster" && (
                    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.35 }} className="mt-6">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <button className="text-sm font-medium text-neutral-900 border-b-2 border-neutral-900 pb-0.5">发现</button>
                          <button className="text-sm text-neutral-400 hover:text-neutral-600 transition-colors">我的</button>
                        </div>
                        <Link href="/generate" className="flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-600 transition-colors"><Palette size={12} /> 去画布 <ArrowRight size={12} /></Link>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                        {INSP_PH.map((item, i) => (
                          <motion.div key={i} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}
                            whileHover={{ scale: 1.05, y: -3 }} className={cn("w-[140px] h-[200px] rounded-2xl shrink-0 cursor-pointer border border-neutral-200/60 dark:border-neutral-800/60 shadow-sm", item.bg)} />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            {/* ═══ INSPIRATION SECTION ═══ */}
            <AnimatePresence>
              {!activeMode && (
                <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: 0.4, duration: 0.5 }} className="px-4 sm:px-6 pb-12">
                  <div className="max-w-5xl mx-auto">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3"><h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100">精选灵感</h2><p className="text-xs text-neutral-400">来自社区的优秀 AI 创作</p></div>
                      <Link href="/inspiration" className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors flex items-center gap-1">查看更多 <ArrowRight size={12} /></Link>
                    </div>
                    <motion.div variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
                      {(() => {
                        const real = showcaseData.slice(0, 6);
                        const padCount = Math.max(0, 6 - real.length);
                        const items = [...real, ...INSP_PH.slice(0, padCount)];
                        return items.map((item: any, i: number) => {
                          const hasPrompt = !!item.prompt;
                          const cardHref = hasPrompt
                            ? `/generate?prompt=${encodeURIComponent(item.prompt)}${item.model_used ? `&model=${encodeURIComponent(item.model_used)}` : ""}`
                            : "/inspiration";
                          return (
                            <motion.div key={item.id ?? `ph-${i}`} variants={fadeUp}>
                              <Link href={cardHref} className="group block rounded-2xl overflow-hidden border border-white/60 shadow-sm hover:shadow-lg transition-all duration-300 relative">
                                {item.image_url ? (
                                  <div className="aspect-[4/5] relative overflow-hidden bg-neutral-100">
                                    <LazyImage src={item.image_url} thumbSrc={item.thumb_url} alt={item.title || ""} className="w-full h-full group-hover:scale-105 transition-transform duration-500" />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300" />
                                    <div className="absolute bottom-0 left-0 right-0 p-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                      <p className="text-[11px] text-white font-medium line-clamp-1">{item.title}</p>
                                      <p className="text-[10px] text-white/70">{item.author || "匿名"}</p>
                                    </div>
                                    {hasPrompt && (
                                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                        <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm text-[10px] text-white font-medium">
                                          <Sparkles size={10} /> 生成
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                ) : (<div className={cn("aspect-[4/5] rounded-2xl", item.bg)} />)}
                              </Link>
                            </motion.div>
                          );
                        });
                      })()}
                    </motion.div>
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
            <div className="mt-auto"><Footer /></div>
          </motion.div>
        ) : (
          /* ═════════ CHATTING STATE ═════════ */
          <motion.div key="chatting" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30, transition: { duration: 0.2 } }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="flex-1 flex overflow-hidden">
            {/* ── History sidebar ── */}
            <AnimatePresence initial={false}>
              {historySidebarOpen && (
                <motion.aside initial={{ width: 0, opacity: 0 }} animate={{ width: 260, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="hidden sm:flex flex-col shrink-0 border-r border-neutral-200/40 bg-neutral-50/80 overflow-hidden">
                  <div className="flex items-center justify-between px-3 pt-3 pb-2">
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={createNewConv}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-white dark:hover:bg-neutral-800 hover:shadow-sm transition-all border border-transparent hover:border-neutral-200/60 dark:hover:border-neutral-700">
                      <Plus size={16} className="text-neutral-500" />新对话
                    </motion.button>
                    <button onClick={() => setHistorySidebarOpen(false)} className="p-1.5 rounded-lg hover:bg-neutral-200/60 text-neutral-400 hover:text-neutral-600 transition-colors"><PanelLeftClose size={16} /></button>
                  </div>
                  <div className="px-3 pb-2">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700 focus-within:border-neutral-300 dark:focus-within:border-neutral-600 transition-colors">
                      <Search size={14} className="text-neutral-400 shrink-0" />
                      <input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="搜索对话..." className="flex-1 text-xs outline-none bg-transparent placeholder:text-neutral-400" />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-1.5">
                    {convGroups.length === 0 ? (
                      <div className="text-center py-16 px-4"><MessageSquare size={24} className="mx-auto text-neutral-200 mb-2" /><p className="text-xs text-neutral-400">{historySearch ? "无搜索结果" : "暂无对话"}</p></div>
                    ) : convGroups.map((g) => (
                      <div key={g.label} className="mb-1">
                        <div className="px-3 py-1.5 text-[11px] font-medium text-neutral-400 uppercase tracking-wider">{g.label}</div>
                        {g.items.map((conv) => (
                          <div key={conv.id} onClick={() => selectConversation(conv)}
                            className={cn("group flex items-center gap-2 mx-1 px-2.5 py-2 rounded-lg cursor-pointer text-[13px] transition-all",
                              activeConv?.id === conv.id ? "bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-sm border border-neutral-200/60 dark:border-neutral-700" : "text-neutral-600 dark:text-neutral-400 hover:bg-white/60 dark:hover:bg-neutral-800/60")}>
                            <MessageSquare size={14} className={cn("shrink-0", activeConv?.id === conv.id ? "text-neutral-600" : "text-neutral-300")} />
                            <span className="flex-1 truncate">{conv.title}</span>
                            <button onClick={(e) => deleteConv(conv.id, e)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-all shrink-0"><Trash2 size={12} /></button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>

            {/* ── Main chat area ── */}
            <div className="flex-1 flex flex-col min-w-0 bg-white">
              {messages.length > 0 || activeConv ? (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-3 px-4 pr-28 py-2.5 border-b border-neutral-100 dark:border-neutral-800">
                    {!historySidebarOpen && <button onClick={() => setHistorySidebarOpen(true)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"><PanelLeft size={18} /></button>}
                    {!historySidebarOpen && <button onClick={createNewConv} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" title="新对话"><Pencil size={18} /></button>}
                    <button onClick={backToIdle} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" title="返回首页"><ArrowRight size={18} className="rotate-180" /></button>
                    <div className="flex-1 min-w-0"><h2 className="text-sm font-medium text-neutral-800 truncate">{activeConv?.title || "新对话"}</h2></div>
                    <span className="px-2.5 py-1 rounded-full border border-neutral-200 text-xs text-neutral-400">{curChatModel.name}</span>
                  </div>
                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto">
                    <div className="max-w-[760px] mx-auto px-4 sm:px-6 py-6 space-y-6">
                      <AnimatePresence initial={false}>
                        {messages.map((msg, idx) => (
                          <motion.div key={msg.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="group/msg">
                            {msg.role === "user" ? (
                              <div className="flex justify-end"><div className="max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap bg-neutral-100 text-neutral-900 rounded-2xl rounded-br-md px-4 py-2.5">{msg.content}</div></div>
                            ) : (
                              <div className="flex gap-3">
                                <div className="w-7 h-7 rounded-full bg-neutral-900 flex items-center justify-center shrink-0 mt-0.5"><Sparkles size={13} className="text-white" /></div>
                                <div className="flex-1 min-w-0">
                                  <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-[14px] leading-relaxed [&>*:first-child]:mt-0"><ReactMarkdown remarkPlugins={[remarkGfm]}>{stripImageGenTags(msg.content)}</ReactMarkdown></div>
                                  {imageGenTasks[msg.id]?.length > 0 && (() => {
                                    const tasks = imageGenTasks[msg.id];
                                    const cnt = tasks.length;
                                    const gridCls = cnt === 1 ? "grid-cols-1 max-w-sm" : "grid-cols-2 max-w-lg";
                                    return (
                                      <div className={cn("mt-3 grid gap-2.5", gridCls)}>
                                        {tasks.map((task, ti) => (
                                          <motion.div key={ti} initial={{ opacity: 0, scale: 0.9, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: ti * 0.15, type: "spring", stiffness: 260, damping: 20 }}
                                            className="group/img relative rounded-xl overflow-hidden border border-neutral-200/60 bg-neutral-50 shadow-sm">
                                            {task.status === "completed" && task.url ? (
                                              <motion.div initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: "easeOut" }}>
                                                <img src={task.url} alt={task.prompt} className="w-full aspect-[3/4] object-cover cursor-pointer hover:scale-[1.02] transition-transform duration-300" onClick={() => setPreviewUrl(task.url!)} />
                                                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity" />
                                                <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 opacity-0 group-hover/img:opacity-100 transition-opacity">
                                                  <button onClick={() => setPreviewUrl(task.url!)} className="p-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors" title="放大"><Maximize2 size={13} /></button>
                                                  <button onClick={() => downloadImage(task.url!, `chat-img-${ti+1}.png`)} className="p-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors" title="下载"><Download size={13} /></button>
                                                  <button onClick={() => { setChatRefImages((p) => [...p, { url: task.url! }].slice(0, 4)); chatInputRef.current?.focus(); }} className="p-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors" title="基于此图编辑"><Edit3 size={13} /></button>
                                                </div>
                                              </motion.div>
                                            ) : task.status === "failed" ? (
                                              <div className="aspect-[3/4] flex items-center justify-center">
                                                <div className="text-center px-3"><ImageIcon size={24} className="mx-auto text-red-300 mb-2" /><p className="text-xs text-red-400 mb-2">{task.error || "生成失败"}</p>
                                                  <button onClick={() => requestImageGeneration(msg.id, msg.content)} className="text-[11px] px-3 py-1 rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors">重试</button></div>
                                              </div>
                                            ) : (
                                              <ImageGenLoading prompt={task.prompt} onScroll={scrollToBottom} />
                                            )}
                                          </motion.div>
                                        ))}
                                      </div>
                                    );
                                  })()}
                                  <ActionBar content={stripImageGenTags(msg.content)} onRegenerate={idx === messages.length - 1 ? regenerateLastMsg : undefined} />
                                </div>
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      {/* Thinking dots */}
                      <AnimatePresence>
                        {sending && (
                          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-3">
                            <div className="w-7 h-7 rounded-full bg-neutral-900 flex items-center justify-center shrink-0"><Sparkles size={13} className="text-white" /></div>
                            <div className="flex items-center gap-1.5 py-3">
                              <motion.span animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0 }} className="w-2 h-2 rounded-full bg-neutral-300 dark:bg-neutral-600" />
                              <motion.span animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.2 }} className="w-2 h-2 rounded-full bg-neutral-300 dark:bg-neutral-600" />
                              <motion.span animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.4 }} className="w-2 h-2 rounded-full bg-neutral-300 dark:bg-neutral-600" />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <div ref={messagesEndRef} />
                    </div>
                  </div>
                  {/* Input area */}
                  <div className="px-4 sm:px-6 pb-4 pt-2"
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/")).slice(0, 4 - chatRefImages.length); if (files.length) setChatRefImages((p) => [...p, ...files.map(f => ({ url: URL.createObjectURL(f), file: f }))].slice(0, 4)); }}>
                    <div className="max-w-[760px] mx-auto">
                      <div className={cn("rounded-2xl border bg-white dark:bg-neutral-900 shadow-sm focus-within:shadow-md transition-all", dragging ? "border-blue-400 bg-blue-50/30 dark:bg-blue-950/30" : "border-neutral-200 dark:border-neutral-700 focus-within:border-neutral-300 dark:focus-within:border-neutral-600")}>
                        {/* Reference image previews */}
                        <AnimatePresence>
                          {chatRefImages.length > 0 && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="px-3 pt-3 flex flex-wrap gap-2">
                              {chatRefImages.map((img, i) => (
                                <motion.div key={i} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="relative group/ref">
                                  <img src={img.url} alt={`参考图${i+1}`} className="w-14 h-14 rounded-lg object-cover border border-neutral-200/60" />
                                  <button onClick={() => setChatRefImages(p => p.filter((_, j) => j !== i))}
                                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-neutral-800 text-white flex items-center justify-center opacity-0 group-hover/ref:opacity-100 transition-opacity"><X size={10} /></button>
                                </motion.div>
                              ))}
                              {chatRefImages.length < 4 && (
                                <button onClick={() => chatFileInputRef.current?.click()} className="w-14 h-14 rounded-lg border-2 border-dashed border-neutral-200 hover:border-neutral-400 flex items-center justify-center transition-colors">
                                  <Plus size={16} className="text-neutral-300" />
                                </button>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <textarea ref={chatInputRef} value={input} onChange={(e) => { setInput(e.target.value); autoResize(); }} onKeyDown={chatKeyDown}
                          onPaste={(e) => { const items = Array.from(e.clipboardData.items).filter(i => i.type.startsWith("image/")); if (items.length) { e.preventDefault(); items.slice(0, 4 - chatRefImages.length).forEach(item => { const f = item.getAsFile(); if (f) setChatRefImages(p => [...p, { url: URL.createObjectURL(f), file: f }].slice(0, 4)); }); } }}
                          placeholder={chatRefImages.length > 0 ? "描述你想要的修改效果..." : "给 AI 发送消息"} rows={1} className="w-full resize-none px-4 pt-3.5 pb-2 text-sm outline-none bg-transparent placeholder:text-neutral-400" />
                        <input ref={chatFileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []).slice(0, 4 - chatRefImages.length); setChatRefImages(p => [...p, ...files.map(f => ({ url: URL.createObjectURL(f), file: f }))].slice(0, 4)); e.target.value = ""; }} />
                        <div className="flex items-center justify-between px-3 pb-2.5">
                          <div className="flex items-center gap-1">
                            <button onClick={() => chatFileInputRef.current?.click()} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" title="上传参考图"><Paperclip size={16} /></button>
                            {/* Image model picker (inline) */}
                            {chatImageModels.length > 0 && (
                              <div className="relative">
                                <button onClick={() => { setShowImgModelPicker(!showImgModelPicker); setShowRatioPicker(false); }}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-neutral-500 hover:bg-neutral-100 transition-colors">
                                  <Palette size={12} className="text-neutral-400" />{chatImageModels.find(m => m.name === selectedImageModel)?.display_name || "图片模型"}<ChevronDown size={10} />
                                </button>
                                <AnimatePresence>
                                  {showImgModelPicker && (
                                    <motion.div initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
                                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                      className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700 rounded-xl shadow-lg py-1 z-50">
                                      {chatImageModels.map((m) => (
                                        <button key={m.name} onClick={() => { setSelectedImageModel(m.name); setShowImgModelPicker(false); const mc = imageModels.find(im => im.name === m.name); const dr = mc?.config?.ratios?.default; if (dr) setSelectedRatio(dr); else { const vals = mc?.config?.ratios?.values; if (vals?.length && !vals.includes(selectedRatio)) setSelectedRatio(vals[0]); } }}
                                          className={cn("w-full flex items-center justify-between px-3 py-2 text-[13px] hover:bg-neutral-50 transition-colors", selectedImageModel === m.name ? "text-neutral-900 font-medium" : "text-neutral-600")}>
                                          <span>{m.display_name}</span><span className="text-[11px] text-neutral-400">{m.provider}</span>
                                        </button>
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )}
                            {/* Ratio picker (inline) */}
                            <div className="relative">
                              <button onClick={() => { setShowRatioPicker(!showRatioPicker); setShowImgModelPicker(false); }}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-neutral-500 hover:bg-neutral-100 transition-colors">
                                {selectedRatio}<ChevronDown size={10} />
                              </button>
                              <AnimatePresence>
                                {showRatioPicker && (
                                  <motion.div initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    className="absolute bottom-full left-0 mb-1 w-32 bg-white border border-neutral-200/60 rounded-xl shadow-lg py-1 z-50">
                                    {availableRatios.map((r) => (
                                      <button key={r} onClick={() => { setSelectedRatio(r); setShowRatioPicker(false); }}
                                        className={cn("w-full text-left px-3 py-1.5 text-[13px] hover:bg-neutral-50 transition-colors", selectedRatio === r ? "text-neutral-900 font-medium" : "text-neutral-500")}>{r}</button>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                            <CustomRatioPopover
                              onConfirm={(r) => { setSelectedRatio(r); setShowRatioPicker(false); }}
                              isActive={!availableRatios.includes(selectedRatio)}
                              className="ml-0"
                            />
                            <div className="w-px h-3.5 bg-neutral-200/60 mx-0.5" />
                            {/* Chat model picker */}
                            <div className="relative">
                              <button onClick={() => setShowChatModelPicker(!showChatModelPicker)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-neutral-500 hover:bg-neutral-100 transition-colors">
                                <MessageSquare size={12} className="text-neutral-400" />{curChatModel.name}<ChevronDown size={10} />
                              </button>
                              <AnimatePresence>
                                {showChatModelPicker && (
                                  <motion.div initial={{ opacity: 0, y: 4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.97 }}
                                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                    className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700 rounded-xl shadow-lg py-1 z-50">
                                    {chatModels.map((m) => (
                                      <button key={m.id} onClick={() => { setSelectedChatModel(m.id); setShowChatModelPicker(false); }}
                                        className={cn("w-full flex items-center justify-between px-3 py-2 text-[13px] hover:bg-neutral-50 transition-colors", selectedChatModel === m.id ? "text-neutral-900 font-medium" : "text-neutral-600")}>
                                        <span>{m.name}</span><span className="text-[11px] text-neutral-400">{m.provider}</span>
                                      </button>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>
                          <AnimatePresence mode="wait">
                            {sending ? (
                              <motion.button key="loading" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }} disabled
                                className="p-1.5 rounded-lg bg-neutral-100 text-neutral-400 transition-colors"><Loader2 size={16} className="animate-spin" /></motion.button>
                            ) : (
                              <motion.button key="send" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }} onClick={() => sendChatMessage()} disabled={!input.trim() || sending}
                                className={cn("p-1.5 rounded-lg transition-colors", input.trim() ? "bg-neutral-900 text-white hover:bg-neutral-700" : "bg-neutral-100 text-neutral-300")}><ArrowUp size={16} /></motion.button>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                      <p className="text-center text-[11px] text-neutral-400 mt-2">AI 可能会犯错，请核实重要信息。</p>
                    </div>
                  </div>
                </>
              ) : (
                /* ── Empty chat state (no conversation yet) ── */
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <button onClick={backToIdle} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" title="返回首页"><ArrowRight size={18} className="rotate-180" /></button>
                    {!historySidebarOpen && <button onClick={() => setHistorySidebarOpen(true)} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"><PanelLeft size={18} /></button>}
                    <button onClick={createNewConv} className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors" title="新对话"><Pencil size={18} /></button>
                  </div>
                  <div className="flex-1 flex items-center justify-center">
                    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-[640px] px-6">
                      <div className="text-center mb-8">
                        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 25 }}
                          className="w-12 h-12 rounded-full bg-neutral-900 flex items-center justify-center mx-auto mb-4"><Sparkles size={20} className="text-white" /></motion.div>
                        <h1 className="text-2xl font-semibold text-neutral-900 mb-1">有什么可以帮你的？</h1>
                        <p className="text-sm text-neutral-400">选择模型，输入问题开始对话</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-6">
                        {SUGGESTIONS.map((s, i) => (
                          <motion.button key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.05 }}
                            onClick={() => { setInput(s.label); chatInputRef.current?.focus(); }}
                            className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-neutral-200/60 text-left text-sm text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 transition-all">
                            <s.icon size={16} className="text-neutral-400 shrink-0" /><span>{s.label}</span>
                          </motion.button>
                        ))}
                      </div>
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm focus-within:border-neutral-300 focus-within:shadow-md transition-all">
                          <textarea ref={chatInputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={chatKeyDown}
                            placeholder="给 AI 发送消息" rows={3} className="w-full resize-none px-4 pt-3.5 pb-2 text-sm outline-none bg-transparent placeholder:text-neutral-400" />
                          <div className="flex items-center justify-between px-3 pb-2.5">
                            <div className="flex items-center gap-1">
                              <button className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"><Paperclip size={16} /></button>
                              <div className="relative">
                                <button onClick={() => setShowChatModelPicker(!showChatModelPicker)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-neutral-500 hover:bg-neutral-100 transition-colors">
                                  {curChatModel.name}<ChevronDown size={12} />
                                </button>
                                <AnimatePresence>
                                  {showChatModelPicker && (
                                    <motion.div initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
                                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                      className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700 rounded-xl shadow-lg py-1 z-50">
                                      {chatModels.map((m) => (
                                        <button key={m.id} onClick={() => { setSelectedChatModel(m.id); setShowChatModelPicker(false); }}
                                          className={cn("w-full flex items-center justify-between px-3 py-2 text-[13px] hover:bg-neutral-50 transition-colors", selectedChatModel === m.id ? "text-neutral-900 font-medium" : "text-neutral-600")}>
                                          <span>{m.name}</span><span className="text-[11px] text-neutral-400">{m.provider}</span>
                                        </button>
                                      ))}
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            </div>
                            <motion.button onClick={() => sendChatMessage()} disabled={!input.trim()}
                              className={cn("p-1.5 rounded-lg transition-colors", input.trim() ? "bg-neutral-900 text-white hover:bg-neutral-700" : "bg-neutral-100 text-neutral-300")}><ArrowUp size={16} /></motion.button>
                          </div>
                        </div>
                        <p className="text-center text-[11px] text-neutral-400 mt-2">AI 可能会犯错，请核实重要信息。</p>
                      </motion.div>
                    </motion.div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MODEL PICKER MODAL (image) ═══ */}
      <AnimatePresence>
        {showModelPicker && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowModelPicker(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              className="bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[60vh] overflow-y-auto p-5 border border-neutral-200/40 dark:border-neutral-700" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-neutral-900">选择模型</h2>
                <button onClick={() => setShowModelPicker(false)} className="p-1 rounded-lg hover:bg-neutral-50 transition-colors"><X size={16} className="text-neutral-400" /></button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {imageModels.map((m, idx) => (
                  <motion.button key={m.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03, duration: 0.2 }}
                    whileHover={{ scale: 1.02, y: -1 }} whileTap={{ scale: 0.98 }} onClick={() => { setSelModel(m.name); setShowModelPicker(false); }}
                    className={cn("flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                      selModel === m.name ? "border-neutral-400 dark:border-neutral-500 bg-neutral-50 dark:bg-neutral-800 shadow-sm" : "border-neutral-100 dark:border-neutral-700 hover:border-neutral-200 dark:hover:border-neutral-600 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50")}>
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", selModel === m.name ? "bg-neutral-800" : "bg-neutral-100")}>
                      <Sparkles size={14} className={selModel === m.name ? "text-white" : "text-neutral-400"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5"><span className="text-xs font-medium text-neutral-900">{m.display_name}</span>
                        {m.badge && <span className="text-[9px] px-1 py-px rounded-full bg-red-500 text-white font-medium">{m.badge}</span>}</div>
                      {m.description && <p className="text-[10px] text-neutral-400 mt-0.5 truncate">{m.description}</p>}
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ GENERATION RESULT MODAL ═══ */}
      <AnimatePresence>
        {showGenModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => { if (!generating) { setShowGenModal(false); if (pollRef.current) clearInterval(pollRef.current); } }}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              className="bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl rounded-2xl shadow-2xl w-full max-w-[640px] max-h-[80vh] overflow-y-auto border border-neutral-200/40 dark:border-neutral-700" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 pt-5 pb-3">
                <div className="flex-1 min-w-0"><h2 className="text-sm font-semibold text-neutral-900 mb-0.5">图片生成</h2><p className="text-xs text-neutral-400 truncate">{genPrompt}</p></div>
                <button onClick={() => { setShowGenModal(false); if (pollRef.current) clearInterval(pollRef.current); setGenerating(false); }}
                  className="p-1.5 rounded-lg hover:bg-neutral-50 transition-colors shrink-0 ml-3"><X size={16} className="text-neutral-400" /></button>
              </div>
              <div className="px-5 pb-5">
                <div className="grid grid-cols-2 gap-3">
                  {genResults.length > 0 ? genResults.map((r: any, i: number) => (
                    <motion.div key={r?.id || i} initial={{ opacity: 0, filter: "blur(20px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ delay: i * 0.1, duration: 0.6 }}
                      className="group relative aspect-square rounded-xl overflow-hidden border border-neutral-200/60 bg-neutral-50">
                      {r?.result_url ? <img src={r.result_url} alt="" className="w-full h-full object-cover" /> :
                        <div className="w-full h-full flex items-center justify-center">
                          {(r?.status === "pending" || r?.status === "processing") ? <div className="text-center"><Loader2 size={24} className="mx-auto text-neutral-300 animate-spin mb-2" /><p className="text-xs text-neutral-400">生成中...</p></div>
                            : r?.status === "failed" ? <p className="text-xs text-red-400">生成失败</p> : null}
                        </div>}
                      {r?.result_url && <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => downloadImage(r.result_url, `gen-${i+1}.png`)}
                        className="absolute bottom-2 right-2 p-2 rounded-xl bg-black/50 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity"><Download size={14} /></motion.button>}
                    </motion.div>
                  )) : generating ? (
                    <div className="col-span-2 aspect-video rounded-xl bg-neutral-50 border border-dashed border-neutral-200 flex items-center justify-center">
                      <div className="text-center"><Loader2 size={28} className="mx-auto text-neutral-300 animate-spin mb-3" /><p className="text-xs text-neutral-400">AI 正在创作...</p></div>
                    </div>
                  ) : null}
                </div>
                {!generating && genResults.length > 0 && (
                  <div className="flex items-center justify-center gap-3 mt-4 pt-4 border-t border-neutral-100">
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => {
                      setGenerating(true); setGenResults([]);
                      imageAPI.generate({ prompt: genPrompt, model: selModel || undefined, ratio: paramValues.ratio || undefined, n: 1 })
                        .then((res) => { const gen = res.data?.data; setGenResults(Array.isArray(gen) ? gen : [gen]); if (gen?.id && gen?.status !== "completed") pollGeneration(gen.id); else setGenerating(false); })
                        .catch(() => setGenerating(false));
                    }} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-800 transition-colors">
                      <Sparkles size={13} /> 重新生成
                    </motion.button>
                    <button onClick={() => setShowGenModal(false)} className="px-4 py-2 rounded-xl text-xs font-medium text-neutral-500 hover:bg-neutral-50 transition-colors">关闭</button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Lightbox image preview ═══ */}
      <AnimatePresence>
        {previewUrl && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setPreviewUrl(null)}
            onKeyDown={(e) => { if (e.key === "Escape") setPreviewUrl(null); }} tabIndex={-1} ref={(el) => el?.focus()}>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }} onClick={(e) => e.stopPropagation()}
              className="relative max-w-[90vw] max-h-[90vh]">
              <img src={previewUrl} alt="预览" className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain" />
              <div className="absolute top-3 right-3 flex items-center gap-2">
                <button onClick={() => downloadImage(previewUrl, "image.png")} className="p-2 rounded-xl bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors" title="下载"><Download size={16} /></button>
                <button onClick={() => setPreviewUrl(null)} className="p-2 rounded-xl bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors" title="关闭"><X size={16} /></button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
