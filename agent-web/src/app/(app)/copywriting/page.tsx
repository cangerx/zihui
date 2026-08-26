"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Copy, Check, RefreshCw, Trash2, Loader2, Clock,
  PenLine, ShoppingBag, Sparkles, FileText, Heart, BookOpen,
  ChevronDown, ImagePlus, X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { API_BASE_URL, modelAPI, copywritingAPI, promptTemplateAPI, uploadAPI } from "@/lib/api";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAppsStore } from "@/store/apps";
import ImageUploader from "@/components/ui/image-uploader";

interface HistoryItem {
  id: number;
  prompt: string;
  image_url: string;
  platform: string;
  tone: string;
  length: string;
  model: string;
  template: string;
  result: string;
  tokens: number;
  created_at: string;
}

interface TemplateItem {
  id: number;
  title: string;
  description: string;
  prompt: string;
  image_url: string;
}

const PLATFORMS = [
  { key: "小红书", icon: "📕", accent: "red" },
  { key: "淘宝", icon: "🛒", accent: "orange" },
  { key: "抖音", icon: "🎵", accent: "neutral" },
  { key: "亚马逊", icon: "📦", accent: "blue" },
  { key: "公众号", icon: "💬", accent: "green" },
];
const TONES = ["种草", "专业", "活泼", "高端", "促销"];
const LENGTHS = [
  { key: "short", label: "短文案" },
  { key: "medium", label: "中等" },
  { key: "long", label: "长文案" },
];

const VISION_MODELS = ["gpt-4o", "gpt-4o-mini", "gemini-2.5-flash", "gemini-2.0-flash", "claude-sonnet-4-20250514", "claude-3-5-sonnet"];

const FALLBACK_TEMPLATES = [
  { id: 1, title: "商品描述", description: "多平台商品文案", prompt: "请为以下商品撰写描述文案：\n\n商品名称：\n核心卖点：\n目标人群：", image_url: "", icon: ShoppingBag },
  { id: 2, title: "种草笔记", description: "小红书风格笔记", prompt: "请为以下产品写一篇种草笔记：\n\n产品名称：\n使用体验：\n推荐理由：", image_url: "", icon: Heart },
  { id: 3, title: "营销文案", description: "促销活动文案", prompt: "请为以下活动撰写营销文案：\n\n活动主题：\n优惠内容：\n活动时间：", image_url: "", icon: Sparkles },
  { id: 4, title: "标题优化", description: "高点击率标题", prompt: "请为以下内容生成5个高点击率标题变体：\n\n原标题：\n内容主题：", image_url: "", icon: PenLine },
  { id: 5, title: "产品卖点", description: "提炼核心卖点", prompt: "请提炼以下产品的核心卖点文案：\n\n产品名称：\n产品特点：\n竞品对比：", image_url: "", icon: FileText },
  { id: 6, title: "品牌故事", description: "品牌故事文案", prompt: "请为以下品牌撰写品牌故事：\n\n品牌名称：\n创立背景：\n品牌理念：", image_url: "", icon: BookOpen },
];

const FALLBACK_MODELS = [
  { id: "deepseek-chat", name: "DeepSeek V3" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
];

function XiaohongshuPreview({ content }: { content: string }) {
  return (
    <div className="max-w-md mx-auto rounded-2xl overflow-hidden border border-red-100 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-red-50">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-400 to-pink-500" />
        <div className="flex-1">
          <p className="text-xs font-semibold text-neutral-800">创作者</p>
          <p className="text-[10px] text-neutral-400">刚刚</p>
        </div>
        <span className="px-3 py-1 rounded-full bg-red-500 text-white text-[10px] font-medium">+ 关注</span>
      </div>
      <div className="px-4 py-3 text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap">{content}</div>
      <div className="flex items-center justify-around px-4 py-3 border-t border-red-50 text-neutral-400">
        <span className="flex items-center gap-1 text-xs">❤️ 收藏</span>
        <span className="flex items-center gap-1 text-xs">💬 评论</span>
        <span className="flex items-center gap-1 text-xs">⭐ 点赞</span>
        <span className="flex items-center gap-1 text-xs">↗️ 分享</span>
      </div>
    </div>
  );
}

function TaobaoPreview({ content }: { content: string }) {
  return (
    <div className="max-w-md mx-auto rounded-xl overflow-hidden border border-orange-100 bg-white shadow-sm">
      <div className="bg-gradient-to-r from-orange-500 to-red-500 px-4 py-2 text-center">
        <span className="text-white text-xs font-bold tracking-wider">🔥 限时特惠</span>
      </div>
      <div className="px-4 py-3 text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap">{content}</div>
      <div className="px-4 py-3 border-t border-orange-50 flex items-center justify-between">
        <div className="flex gap-1.5">
          <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-600 text-[10px] font-medium">包邮</span>
          <span className="px-2 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-medium">正品保障</span>
          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-600 text-[10px] font-medium">7天退换</span>
        </div>
        <span className="px-4 py-1.5 rounded-full bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-bold">立即购买</span>
      </div>
    </div>
  );
}

function DouyinPreview({ content }: { content: string }) {
  return (
    <div className="max-w-md mx-auto rounded-xl overflow-hidden bg-neutral-900 shadow-lg relative min-h-[300px] flex flex-col justify-end">
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
      <div className="relative z-10 px-4 pb-4">
        <p className="text-white text-sm leading-relaxed whitespace-pre-wrap mb-3">{content}</p>
        <div className="flex items-center gap-2">
          <span className="text-white/60 text-xs">@创作者</span>
          <span className="text-white/40 text-[10px]">· 刚刚</span>
        </div>
      </div>
      <div className="absolute right-3 bottom-16 flex flex-col items-center gap-4 z-10">
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm">❤️</div>
          <span className="text-white text-[10px] mt-0.5">2.1w</span>
        </div>
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm">💬</div>
          <span className="text-white text-[10px] mt-0.5">856</span>
        </div>
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm">⭐</div>
          <span className="text-white text-[10px] mt-0.5">收藏</span>
        </div>
      </div>
    </div>
  );
}

function AmazonPreview({ content }: { content: string }) {
  return (
    <div className="max-w-lg mx-auto rounded-xl overflow-hidden border border-blue-100 bg-white shadow-sm">
      <div className="px-4 py-2 border-b border-neutral-100 flex items-center gap-2">
        <span className="text-lg font-bold text-[#232f3e]">amazon</span>
        <div className="flex-1 h-8 rounded bg-neutral-100 mx-2" />
      </div>
      <div className="px-4 py-3 text-sm text-neutral-800 leading-relaxed whitespace-pre-wrap">{content}</div>
      <div className="px-4 py-3 border-t border-neutral-100 flex items-center gap-3">
        <span className="px-4 py-1.5 rounded-full bg-[#ffd814] text-neutral-900 text-xs font-bold">Add to Cart</span>
        <span className="px-4 py-1.5 rounded-full bg-[#ffa41c] text-neutral-900 text-xs font-bold">Buy Now</span>
      </div>
    </div>
  );
}

function GongzhonghaoPreview({ content }: { content: string }) {
  return (
    <div className="max-w-md mx-auto rounded-xl overflow-hidden border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-neutral-100">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-green-600" />
        <span className="text-xs font-medium text-neutral-800">公众号名称</span>
        <span className="text-[10px] text-neutral-400 ml-auto">刚刚</span>
      </div>
      <div className="px-5 py-4 text-sm text-neutral-800 leading-[1.8] whitespace-pre-wrap" style={{ fontFamily: "serif" }}>{content}</div>
      <div className="px-4 py-3 border-t border-neutral-100 flex items-center justify-between">
        <div className="flex items-center gap-4 text-neutral-400 text-xs">
          <span>👍 在看</span>
          <span>💬 留言</span>
        </div>
        <span className="text-xs text-green-600 font-medium">分享</span>
      </div>
    </div>
  );
}

function PlatformPreview({ platform, content, generating }: { platform: string; content: string; generating: boolean }) {
  const inner = (() => {
    switch (platform) {
      case "小红书": return <XiaohongshuPreview content={content} />;
      case "淘宝": return <TaobaoPreview content={content} />;
      case "抖音": return <DouyinPreview content={content} />;
      case "亚马逊": return <AmazonPreview content={content} />;
      case "公众号": return <GongzhonghaoPreview content={content} />;
      default: return <div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>;
    }
  })();
  return (
    <div>
      {inner}
      {generating && <span className="inline-block w-1.5 h-4 bg-amber-500 animate-pulse ml-0.5 mt-2 rounded-sm" />}
    </div>
  );
}

export default function CopywritingPage() {
  return (
    <Suspense fallback={null}>
      <CopywritingContent />
    </Suspense>
  );
}

function CopywritingContent() {
  usePageTitle("AI 文案创作");
  const fetchApps = useAppsStore((s) => s.fetchApps);
  useEffect(() => { fetchApps(); }, [fetchApps]);

  const [prompt, setPrompt] = useState("");
  const [platform, setPlatform] = useState("小红书");
  const [tone, setTone] = useState("种草");
  const [length, setLength] = useState("medium");
  const [selectedModel, setSelectedModel] = useState("deepseek-chat");
  const [models, setModels] = useState<{ id: string; name: string }[]>(FALLBACK_MODELS);
  const [templates, setTemplates] = useState<(TemplateItem & { icon?: any })[]>([]);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [result, setResult] = useState("");
  const [copied, setCopied] = useState(false);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    modelAPI.list("chat").then((res) => {
      const list = res.data?.data || res.data || [];
      if (list.length > 0) {
        setModels(list.map((m: any) => ({ id: m.name || m.id, name: m.display_name || m.name || m.id })));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    promptTemplateAPI.list("copywriting").then((res) => {
      const list = res.data?.data || res.data || [];
      if (list.length > 0) setTemplates(list);
      else setTemplates(FALLBACK_TEMPLATES as any);
    }).catch(() => { setTemplates(FALLBACK_TEMPLATES as any); });
  }, []);

  const loadHistory = useCallback(() => {
    copywritingAPI.history({ page: 1, page_size: 20 }).then((res) => {
      setHistory(res.data?.data || []);
    }).catch(() => {});
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Auto-switch to vision model when image uploaded
  useEffect(() => {
    if (imageFile && !VISION_MODELS.includes(selectedModel)) {
      const visionModel = models.find((m) => VISION_MODELS.includes(m.id));
      if (visionModel) setSelectedModel(visionModel.id);
    }
  }, [imageFile, models, selectedModel]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setStreamContent("");
    setResult("");

    let finalImageUrl = imageUrl;
    if (imageFile && !imageUrl) {
      setUploading(true);
      try {
        const res = await uploadAPI.upload(imageFile);
        finalImageUrl = res.data?.url || res.data?.data?.url || "";
        setImageUrl(finalImageUrl);
      } catch {
        alert("图片上传失败，请重试");
        setGenerating(false);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    const token = localStorage.getItem("token");
    const controller = new AbortController();
    abortRef.current = controller;
    let fullContent = "";

    try {
      const res = await fetch(`${API_BASE_URL}/copywriting/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ prompt: prompt.trim(), platform, tone, length, model: selectedModel, image_url: finalImageUrl }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 402) alert("积分不足，请充值后再试");
        else if (res.status === 403) alert(err.error || "内容包含违规信息，请修改后重试");
        else if (res.status === 503) alert("当前模型暂不可用，请切换其他模型");
        else alert(err.error || "生成失败，请重试");
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const d = line.slice(6);
            if (d === "[DONE]") break;
            try {
              fullContent += JSON.parse(d).choices?.[0]?.delta?.content || "";
              setStreamContent(fullContent);
            } catch {}
          }
        }
      }
      if (fullContent) {
        setResult(fullContent);
        loadHistory();
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") alert("生成失败，请重试");
    } finally {
      setGenerating(false);
      setStreamContent("");
      abortRef.current = null;
    }
  }, [prompt, platform, tone, length, selectedModel, generating, loadHistory, imageFile, imageUrl]);

  const handleStop = () => { abortRef.current?.abort(); };
  const handleCopy = () => { navigator.clipboard.writeText(result); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const handleRegenerate = () => { if (prompt.trim()) handleGenerate(); };
  const handleTemplateClick = (tpl: any) => { setPrompt(tpl.prompt || ""); textareaRef.current?.focus(); };
  const handleHistoryClick = (item: HistoryItem) => {
    setResult(item.result);
    setPrompt(item.prompt);
    setPlatform(item.platform || "小红书");
    setTone(item.tone || "种草");
    setLength(item.length || "medium");
    setShowHistory(false);
  };
  const handleDeleteHistory = async (id: number) => {
    await copywritingAPI.deleteHistory(id);
    setHistory((prev) => prev.filter((h) => h.id !== id));
  };
  const handleImageSelect = (file: File, previewUrl: string) => {
    setImageFile(file);
    setImagePreview(previewUrl);
    setImageUrl("");
  };
  const handleImageClear = () => {
    setImageFile(null);
    setImagePreview("");
    setImageUrl("");
  };

  const displayContent = generating ? streamContent : result;
  const wordCount = displayContent.length;

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; }
  }, []);

  useEffect(() => {
    if (generating && resultRef.current) resultRef.current.scrollTop = resultRef.current.scrollHeight;
  }, [streamContent, generating]);

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden bg-[#FAFAF8] dark:bg-[#0A0A0A]">
      {/* Left Panel */}
      <div className="w-full lg:w-[480px] xl:w-[520px] flex-shrink-0 border-r border-neutral-200/60 dark:border-neutral-800 flex flex-col overflow-y-auto">
        <div className="p-6 flex-1">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
              <PenLine className="w-5 h-5 text-amber-500" />
              AI 文案创作
            </h1>
            <p className="text-sm text-neutral-500 mt-1">上传产品图片或输入描述，智能生成多平台文案</p>
          </div>

          {/* Templates */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">场景模板</h3>
            <div className="grid grid-cols-3 gap-2">
              {templates.slice(0, 6).map((tpl) => {
                const Icon = (tpl as any).icon || FileText;
                return (
                  <motion.button
                    key={tpl.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleTemplateClick(tpl)}
                    className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-neutral-200/60 dark:border-neutral-700 hover:border-amber-300 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 transition-colors text-center"
                  >
                    <Icon className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{tpl.title}</span>
                    <span className="text-[10px] text-neutral-400 line-clamp-1">{tpl.description}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Image Upload */}
          <div className="mb-4">
            <label className="text-xs font-medium text-neutral-500 mb-2 block flex items-center gap-1">
              <ImagePlus className="w-3.5 h-3.5" /> 产品图片（可选）
            </label>
            {imagePreview ? (
              <div className="relative w-full h-32 rounded-xl overflow-hidden border border-neutral-200/60 dark:border-neutral-700">
                <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
                <button onClick={handleImageClear} className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
                {uploading && (
                  <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  </div>
                )}
              </div>
            ) : (
              <ImageUploader
                onFileSelect={handleImageSelect}
                className="h-24"
                hint="上传产品图片，AI 识别后生成文案"
                subHint="支持 JPG、PNG、WebP"
                accentColor="amber"
              />
            )}
          </div>

          {/* Prompt */}
          <div className="mb-4">
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); autoResize(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !generating) { e.preventDefault(); handleGenerate(); } }}
              placeholder="描述你的文案需求，越详细效果越好..."
              className="w-full min-h-[100px] p-4 rounded-xl border border-neutral-200/60 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/40 transition-shadow"
            />
          </div>

          {/* Platform */}
          <div className="mb-3">
            <label className="text-xs font-medium text-neutral-500 mb-2 block">平台</label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPlatform(p.key)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1",
                    platform === p.key
                      ? "bg-amber-500 text-white"
                      : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                  )}
                >
                  <span>{p.icon}</span> {p.key}
                </button>
              ))}
            </div>
          </div>

          {/* Tone */}
          <div className="mb-3">
            <label className="text-xs font-medium text-neutral-500 mb-2 block">风格</label>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    tone === t
                      ? "bg-amber-500 text-white"
                      : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Length + Model */}
          <div className="mb-4 flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-neutral-500 mb-2 block">长度</label>
              <div className="flex gap-1.5">
                {LENGTHS.map((l) => (
                  <button
                    key={l.key}
                    onClick={() => setLength(l.key)}
                    className={cn(
                      "flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors",
                      length === l.key
                        ? "bg-amber-500 text-white"
                        : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="w-40">
              <label className="text-xs font-medium text-neutral-500 mb-2 block">模型</label>
              <div className="relative">
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full appearance-none px-3 py-1.5 pr-7 rounded-lg text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-none focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            onClick={generating ? handleStop : handleGenerate}
            disabled={!prompt.trim() && !generating}
            className={cn(
              "w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors",
              generating
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {generating ? (
              <><Loader2 className="w-4 h-4 animate-spin" />停止生成</>
            ) : (
              <><Send className="w-4 h-4" />生成文案</>
            )}
          </motion.button>
          <p className="text-[10px] text-neutral-400 mt-2 text-center">⌘ + Enter 快捷生成</p>
        </div>
      </div>

      {/* Right Panel - Result */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 border-b border-neutral-200/60 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">生成结果</span>
            {wordCount > 0 && <span className="text-xs text-neutral-400">{wordCount} 字</span>}
            {displayContent && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">{platform} 预览</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {result && (
              <>
                <button onClick={handleCopy} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" title="复制">
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-neutral-500" />}
                </button>
                <button onClick={handleRegenerate} disabled={generating} className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50" title="重新生成">
                  <RefreshCw className="w-4 h-4 text-neutral-500" />
                </button>
              </>
            )}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn("p-2 rounded-lg transition-colors", showHistory ? "bg-amber-100 dark:bg-amber-900/30" : "hover:bg-neutral-100 dark:hover:bg-neutral-800")}
              title="历史记录"
            >
              <Clock className="w-4 h-4 text-neutral-500" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div ref={resultRef} className={cn("flex-1 overflow-y-auto p-6", showHistory && "border-r border-neutral-200/60 dark:border-neutral-800")}>
            <AnimatePresence mode="wait">
              {displayContent ? (
                <motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <PlatformPreview platform={platform} content={displayContent} generating={generating} />
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center h-full text-center py-20">
                  <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center mb-4">
                    <PenLine className="w-7 h-7 text-amber-400" />
                  </div>
                  <p className="text-sm text-neutral-500">选择模板或输入需求，开始创作</p>
                  <p className="text-xs text-neutral-400 mt-1">支持小红书、淘宝、抖音等多平台文案</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {showHistory && (
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 280, opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="w-[280px] flex-shrink-0 overflow-y-auto bg-neutral-50/50 dark:bg-neutral-900/50">
              <div className="p-4">
                <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">历史记录</h3>
                {history.length === 0 ? (
                  <p className="text-xs text-neutral-400 text-center py-8">暂无记录</p>
                ) : (
                  <div className="space-y-2">
                    {history.map((item) => (
                      <div key={item.id} className="group p-3 rounded-lg border border-neutral-200/60 dark:border-neutral-700 hover:border-amber-300 cursor-pointer transition-colors" onClick={() => handleHistoryClick(item)}>
                        <p className="text-xs text-neutral-700 dark:text-neutral-300 line-clamp-2 font-medium">{item.prompt}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-[10px] text-neutral-400">{item.platform} · {item.tone}</span>
                          <button onClick={(e) => { e.stopPropagation(); handleDeleteHistory(item.id); }} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-all">
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
