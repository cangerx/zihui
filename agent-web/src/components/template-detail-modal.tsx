"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Sparkles,
  Copy,
  Loader2,
  ImagePlus,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadAPI, modelAPI } from "@/lib/api";

/* ── Types ── */
export interface TemplateItem {
  id: number;
  title: string;
  description: string;
  image_url: string;
  thumb_url?: string;
  category: string;
  prompt: string;
  variables: string;
  tags: string;
  default_model: string;
  default_ratio: string;
  usage_count: number;
  sort: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateVariable {
  key: string;
  label: string;
  type: string;
  default?: string;
  options?: string[];
  required?: boolean;
}

export function parseVariables(json: string): TemplateVariable[] {
  try { return JSON.parse(json || "[]"); }
  catch { return []; }
}

/* ── Modal ── */
interface Props {
  tpl: TemplateItem | null;
  onClose: () => void;
}

export default function TemplateDetailModal({ tpl, onClose }: Props) {
  const router = useRouter();
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUploadKey = useRef<string>("");

  const [models, setModels] = useState<{ name: string; display_name?: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedRatio, setSelectedRatio] = useState("1:1");
  const RATIO_OPTIONS = ["1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"];

  useEffect(() => {
    modelAPI.imageModels().then((res) => {
      const list = res.data?.data ?? res.data ?? [];
      setModels(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!tpl) return;
    const vars = parseVariables(tpl.variables);
    const defaults: Record<string, string> = {};
    vars.forEach((v) => {
      if (v.default) defaults[v.key] = v.default;
      else if (v.type === "select" && v.options?.length) defaults[v.key] = v.options[0]!;
      else defaults[v.key] = "";
    });
    setVarValues(defaults);
    if (tpl.default_model) setSelectedModel(tpl.default_model);
    if (tpl.default_ratio) setSelectedRatio(tpl.default_ratio);
    else setSelectedRatio("1:1");
  }, [tpl]);

  const updateVar = useCallback((key: string, val: string) =>
    setVarValues((prev) => ({ ...prev, [key]: val })), []);

  const renderPrompt = useCallback(() => {
    if (!tpl) return "";
    let result = tpl.prompt;
    for (const [k, v] of Object.entries(varValues)) {
      if (v) result = result.replaceAll(`{{${k}}}`, v);
    }
    return result;
  }, [tpl, varValues]);

  const handleImageUpload = async (key: string, file: File) => {
    setUploadingKey(key);
    try {
      const res = await uploadAPI.upload(file);
      const url = res.data?.data?.url || res.data?.url || "";
      if (url) updateVar(key, url);
    } catch { /* ignore */ } finally {
      setUploadingKey(null);
    }
  };

  const triggerFileInput = (key: string) => {
    activeUploadKey.current = key;
    fileInputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(activeUploadKey.current, file);
    e.target.value = "";
  };

  const handleUseTemplate = () => {
    if (!tpl) return;
    const finalPrompt = renderPrompt();
    const params = new URLSearchParams();
    params.set("prompt", finalPrompt);
    if (selectedModel) params.set("model", selectedModel);
    if (selectedRatio) params.set("ratio", selectedRatio);
    const vars = parseVariables(tpl.variables);
    const imageUrls = vars
      .filter((v) => v.type === "image" || v.key.includes("photo") || v.key.includes("image"))
      .map((v) => varValues[v.key])
      .filter(Boolean);
    if (imageUrls.length > 0) params.set("ref_images", imageUrls.join(","));
    router.push(`/generate?${params.toString()}`);
    onClose();
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(renderPrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!tpl) return null;

  const vars = parseVariables(tpl.variables);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="relative bg-white dark:bg-neutral-900 w-full h-full md:rounded-3xl md:max-w-2xl md:mx-4 md:max-h-[88vh] md:h-auto flex flex-col overflow-hidden shadow-2xl"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />

          {/* Gradient top accent bar */}
          <div className="h-1 bg-violet-500 shrink-0" />

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 dark:border-neutral-800">
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-50 truncate">{tpl.title}</h3>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 font-medium">
                  {tpl.category}
                </span>
                {tpl.tags && tpl.tags.split(",").slice(0, 3).map((tag) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400">
                    {tag.trim()}
                  </span>
                ))}
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-xl transition-colors ml-3 shrink-0">
              <X size={18} className="text-neutral-400" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {tpl.description && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed">{tpl.description}</p>
            )}

            {/* Variable form */}
            {vars.length > 0 && (
              <div className="space-y-4">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wider">填写参数</label>
                {vars.map((v) => (
                  <div key={v.key} className="space-y-1.5">
                    <label className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                      {v.label}
                      {v.required && <span className="text-red-400 ml-0.5">*</span>}
                    </label>

                    {(v.type === "image" || v.key.includes("photo") || v.key.includes("image")) ? (
                      <div className="flex items-center gap-3">
                        {varValues[v.key] ? (
                          <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-violet-200 dark:border-violet-800 shadow-sm">
                            <img src={varValues[v.key]} alt="" className="w-full h-full object-cover" />
                            <button
                              onClick={() => updateVar(v.key, "")}
                              className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-sm"
                            >
                              <X size={10} className="text-white" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => triggerFileInput(v.key)}
                            disabled={uploadingKey === v.key}
                            className="w-20 h-20 rounded-xl border-2 border-dashed border-neutral-200 dark:border-neutral-700 flex flex-col items-center justify-center text-neutral-400 hover:border-violet-400 hover:text-violet-500 hover:bg-violet-50/50 dark:hover:bg-violet-900/20 transition-all"
                          >
                            {uploadingKey === v.key ? (
                              <Loader2 size={18} className="animate-spin" />
                            ) : (
                              <ImagePlus size={18} />
                            )}
                            <span className="text-[9px] mt-1">上传</span>
                          </button>
                        )}
                      </div>
                    ) : v.type === "select" && v.options?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {v.options.map((opt) => (
                          <button
                            key={opt}
                            onClick={() => updateVar(v.key, opt)}
                            className={cn(
                              "px-3.5 py-2 rounded-xl text-xs font-medium transition-all",
                              varValues[v.key] === opt
                                ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-sm"
                                : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                            )}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    ) : v.type === "textarea" ? (
                      <textarea
                        value={varValues[v.key] || ""}
                        onChange={(e) => updateVar(v.key, e.target.value)}
                        placeholder={v.default || `请输入${v.label}`}
                        rows={3}
                        className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/40 focus:bg-white dark:focus:bg-neutral-800 transition-all placeholder:text-neutral-400 resize-none"
                      />
                    ) : (
                      <input
                        value={varValues[v.key] || ""}
                        onChange={(e) => updateVar(v.key, e.target.value)}
                        placeholder={v.default || `请输入${v.label}`}
                        className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/40 focus:bg-white dark:focus:bg-neutral-800 transition-all placeholder:text-neutral-400"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Model selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wider">生成模型</label>
              <div className="flex flex-wrap gap-2">
                {models.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => setSelectedModel(m.name)}
                    className={cn(
                      "px-3.5 py-2 rounded-xl text-xs font-medium transition-all",
                      selectedModel === m.name
                        ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-sm"
                        : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    )}
                  >
                    {m.display_name || m.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Ratio selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wider">宽高比</label>
              <div className="flex flex-wrap gap-2">
                {RATIO_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setSelectedRatio(r)}
                    className={cn(
                      "px-3.5 py-2 rounded-xl text-xs font-medium transition-all",
                      selectedRatio === r
                        ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 shadow-sm"
                        : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt preview */}
            <div className="bg-neutral-50 dark:bg-neutral-800/50 rounded-2xl p-4 space-y-2.5 border border-neutral-200 dark:border-neutral-700">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                  <Sparkles size={13} /> 预览提示词
                </label>
                <button
                  onClick={copyPrompt}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors flex items-center gap-1 shadow-sm"
                >
                  {copied ? <><Check size={10} /> 已复制</> : <><Copy size={10} /> 复制</>}
                </button>
              </div>
              <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed max-h-[120px] overflow-y-auto whitespace-pre-wrap">
                {renderPrompt()}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/50">
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleUseTemplate}
              className="w-full py-3.5 rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-bold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles size={15} /> 使用此模板生成图片
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
