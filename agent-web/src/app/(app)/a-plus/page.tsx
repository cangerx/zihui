"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Loader2,
  Sparkles,
  Download,
  Upload,
  X,
  Wand2,
  ChevronDown,
  Check,
  Globe,
  Languages,
  Ratio,
  ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI, generationAPI } from "@/lib/api";
import { downloadImage } from "@/lib/download";

const PLATFORMS = [
  { value: "taobao", label: "淘宝/天猫" },
  { value: "jd", label: "京东" },
  { value: "amazon", label: "亚马逊" },
  { value: "shopee", label: "Shopee" },
  { value: "temu", label: "Temu" },
  { value: "tiktok", label: "TikTok Shop" },
];

const COUNTRIES = [
  { value: "cn", label: "中国" },
  { value: "us", label: "美国" },
  { value: "jp", label: "日本" },
  { value: "kr", label: "韩国" },
  { value: "uk", label: "英国" },
  { value: "de", label: "德国" },
  { value: "fr", label: "法国" },
  { value: "sea", label: "东南亚" },
];

const LANGUAGES = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

const RATIOS = [
  { value: "800x1200", label: "800×1200" },
  { value: "750x1000", label: "750×1000" },
  { value: "1000x1000", label: "1000×1000" },
  { value: "1500x2000", label: "1500×2000" },
];

const MODULES = [
  { key: "hero", label: "首屏主视觉", desc: "大图Banner，吸引眼球" },
  { key: "core_selling", label: "核心卖点图", desc: "突出产品独特优势" },
  { key: "scene", label: "使用场景图", desc: "生活场景展示" },
  { key: "multi_angle", label: "多角度图", desc: "全方位展示产品" },
  { key: "atmosphere", label: "场景氛围图", desc: "营造品牌氛围" },
  { key: "detail", label: "商品细节图", desc: "展示材质工艺" },
  { key: "brand_story", label: "品牌故事图", desc: "传递品牌理念" },
  { key: "size", label: "尺寸/容量图", desc: "直观尺寸参考" },
  { key: "comparison", label: "效果对比图", desc: "使用前后对比" },
  { key: "spec", label: "详细规格表", desc: "产品参数一览" },
  { key: "craft", label: "工艺制作图", desc: "展示制作工艺" },
  { key: "accessories", label: "配件/赠品图", desc: "包含物一览" },
  { key: "series", label: "系列展示图", desc: "同系列产品" },
  { key: "ingredient", label: "商品成分图", desc: "材料成分表" },
  { key: "warranty", label: "售后保障图", desc: "售后服务承诺" },
  { key: "usage_tips", label: "使用建议图", desc: "使用方法指南" },
];

export default function APlusPage() {
  const [images, setImages] = useState<{ file: File; url: string }[]>([]);
  const [platform, setPlatform] = useState("taobao");
  const [country, setCountry] = useState("cn");
  const [language, setLanguage] = useState("zh");
  const [ratio, setRatio] = useState("800x1200");
  const [description, setDescription] = useState("");
  const [selectedModules, setSelectedModules] = useState<string[]>([
    "hero",
    "core_selling",
    "scene",
    "multi_angle",
    "detail",
    "atmosphere",
  ]);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleAddImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newImages = files.slice(0, 3 - images.length).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setImages((prev) => [...prev, ...newImages].slice(0, 3));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const toggleModule = (key: string) => {
    setSelectedModules((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const pollGeneration = useCallback((genId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await generationAPI.get(genId);
        const gen = res.data?.data;
        if (gen?.status === "completed") {
          setResults((prev) => prev.map((r) => (r.id === genId ? gen : r)));
          setGenerating(false);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (gen?.status === "failed") {
          setResults((prev) => prev.map((r) => (r.id === genId ? gen : r)));
          setGenerating(false);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    }, 3000);
  }, []);

  const handleGenerate = async () => {
    if (images.length === 0) return;
    setGenerating(true);
    try {
      const fd = new FormData();
      // Backend expects single "image" field — use first image
      fd.append("image", images[0].file);
      fd.append("platform", platform);
      fd.append("country", country);
      fd.append("language", language);
      fd.append("ratio", ratio);
      if (description) fd.append("prompt", description);
      fd.append("modules", JSON.stringify(selectedModules));

      const res = await imageAPI.productPhoto(fd);
      const gen = res.data?.data;
      setResults([gen]);
      if (gen?.id && gen?.status !== "completed") {
        pollGeneration(gen.id);
      } else {
        setGenerating(false);
      }
    } catch (e: any) {
      console.error(e);
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Left panel */}
      <motion.div
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full md:w-[380px] border-b md:border-b-0 md:border-r border-neutral-100 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm flex flex-col shrink-0 max-h-[50vh] md:max-h-none"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-neutral-100/60 dark:border-neutral-800/60">
          <motion.div
            whileHover={{ scale: 1.1, rotate: 5 }}
            className="w-9 h-9 rounded-xl bg-violet-500 flex items-center justify-center shadow-md shadow-purple-200/40"
          >
            <FileText size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900">A+ 详情页</h1>
            <p className="text-xs text-neutral-400">一键生成电商详情页长图</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Image upload */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">
              商品原图 ({images.length}/3)
            </label>
            <div className="flex gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-neutral-200 group">
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImage(i)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={10} className="text-white" />
                  </button>
                </div>
              ))}
              {images.length < 3 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-20 h-20 rounded-xl border-2 border-dashed border-neutral-200 flex flex-col items-center justify-center text-neutral-400 hover:border-neutral-300 hover:text-neutral-500 transition-colors"
                >
                  <Upload size={16} />
                  <span className="text-[10px] mt-1">添加</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleAddImages}
                className="hidden"
              />
            </div>
          </div>

          {/* Platform */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">
              <Globe size={11} className="inline mr-1" /> 平台
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPlatform(p.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs transition-all",
                    platform === p.value
                      ? "bg-violet-50 text-violet-700 border border-violet-300 font-medium"
                      : "bg-neutral-50 text-neutral-500 border border-transparent hover:bg-neutral-100"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Country + Language row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">国家</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-neutral-200/60 bg-neutral-50/50 text-sm outline-none focus:border-violet-300 transition-all"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">语言</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-neutral-200/60 bg-neutral-50/50 text-sm outline-none focus:border-violet-300 transition-all"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Ratio */}
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 uppercase tracking-wider mb-2">
              <Ratio size={11} className="inline mr-1" /> 图片尺寸
            </label>
            <div className="flex flex-wrap gap-1.5">
              {RATIOS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRatio(r.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs transition-all",
                    ratio === r.value
                      ? "bg-violet-50 text-violet-700 border border-violet-300 font-medium"
                      : "bg-neutral-50 text-neutral-500 border border-transparent hover:bg-neutral-100"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description + AI help */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                商品卖点&要求
              </label>
              <button className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-600 transition-colors">
                <Wand2 size={11} /> AI 帮写
              </button>
            </div>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={"描述商品的核心卖点、适用人群、使用场景等...\n例如：高端不锈钢保温杯，12小时持久保温，商务风设计，适合白领办公族"}
              className="w-full px-3 py-2.5 rounded-xl border border-neutral-200/60 bg-neutral-50/50 text-sm outline-none focus:border-violet-300 focus:bg-white focus:shadow-sm resize-none transition-all"
            />
          </div>

          {/* Module selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
                包含模块 ({selectedModules.length})
              </label>
              <button
                onClick={() =>
                  setSelectedModules(
                    selectedModules.length === MODULES.length
                      ? ["hero", "core_selling", "scene"]
                      : MODULES.map((m) => m.key)
                  )
                }
                className="text-[11px] text-violet-500 hover:text-violet-600 transition-colors"
              >
                {selectedModules.length === MODULES.length ? "精简选择" : "全选"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 max-h-[240px] overflow-y-auto pr-1">
              {MODULES.map((mod) => {
                const active = selectedModules.includes(mod.key);
                return (
                  <button
                    key={mod.key}
                    onClick={() => toggleModule(mod.key)}
                    className={cn(
                      "flex items-start gap-2 p-2 rounded-lg border text-left transition-all",
                      active
                        ? "border-violet-300 bg-violet-50/50"
                        : "border-neutral-200/60 hover:border-neutral-300"
                    )}
                  >
                    <div
                      className={cn(
                        "w-4 h-4 mt-0.5 rounded border shrink-0 flex items-center justify-center transition-colors",
                        active ? "bg-violet-500 border-violet-500" : "border-neutral-300"
                      )}
                    >
                      {active && <Check size={10} className="text-white" />}
                    </div>
                    <div>
                      <span className="text-xs font-medium text-neutral-700 leading-tight">{mod.label}</span>
                      <p className="text-[10px] text-neutral-400 leading-tight">{mod.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Generate button */}
        <div className="p-5 border-t border-neutral-100/60 dark:border-neutral-800/60">
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            disabled={images.length === 0 || generating}
            onClick={handleGenerate}
            className="w-full py-2.5 rounded-xl bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 hover:shadow-lg hover:shadow-purple-200/50 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            {generating ? (
              <><Loader2 size={16} className="animate-spin" /> 生成中...</>
            ) : (
              <><Sparkles size={16} /> 一键生成爆款套图</>
            )}
          </motion.button>
        </div>
      </motion.div>

      {/* Right: Result panel */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.15 }}
        className="flex-1 overflow-y-auto bg-[#fafafa] dark:bg-[#0A0A0A]"
      >
        {results.length > 0 ? (
          <div className="p-6 space-y-4">
            {results.map((r: any, i: number) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="group relative rounded-2xl overflow-hidden border border-neutral-200/60 bg-white shadow-sm"
              >
                {r?.result_url ? (
                  <div className="relative">
                    <img src={r.result_url} alt="" className="w-full" />
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => downloadImage(r.result_url, `aplus-${i + 1}.png`)}
                      className="absolute top-3 right-3 p-2.5 rounded-xl bg-black/50 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Download size={16} />
                    </motion.button>
                  </div>
                ) : (
                  <div className="py-20 flex items-center justify-center">
                    <div className="text-center">
                      <Loader2 size={24} className="mx-auto text-violet-400 animate-spin mb-3" />
                      <p className="text-sm text-neutral-500">
                        {r?.status === "pending" || r?.status === "processing"
                          ? "A+详情页生成中，预计需要30-60秒..."
                          : r?.status === "failed"
                            ? `生成失败: ${r?.error_msg || "未知错误"}`
                            : "生成完成"}
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-8">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center max-w-sm"
            >
              <div className="w-20 h-20 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mx-auto mb-5">
                <FileText size={32} className="text-violet-400" />
              </div>
              <h2 className="text-lg font-bold text-neutral-800 mb-2">
                AI 生成电商详情页
              </h2>
              <p className="text-sm text-neutral-400 leading-relaxed mb-6">
                上传商品图片，选择平台和模块，AI 自动生成精美电商详情页长图。
                支持淘宝、京东、亚马逊等主流平台。
              </p>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { icon: ShoppingBag, label: "多平台适配" },
                  { icon: Languages, label: "多语言生成" },
                  { icon: Wand2, label: "AI智能排版" },
                ].map((item, i) => (
                  <div key={i} className="p-3 rounded-xl bg-white border border-neutral-100">
                    <item.icon size={18} className="mx-auto text-violet-400 mb-1.5" />
                    <span className="text-[11px] text-neutral-500">{item.label}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
