"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { CreditCard, Download, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageAPI } from "@/lib/api";
import ImageUploader from "@/components/ui/image-uploader";
import { downloadImage } from "@/lib/download";
import { usePollGeneration } from "@/hooks/use-poll-generation";
import { usePageTitle } from "@/hooks/use-page-title";

const BG_COLORS = [
  { name: "白底", value: "#ffffff", style: "bg-white border border-neutral-200" },
  { name: "蓝底", value: "#438edb", style: "bg-[#438edb]" },
  { name: "红底", value: "#d93b3b", style: "bg-[#d93b3b]" },
  { name: "灰底", value: "#d1d5db", style: "bg-neutral-300" },
  { name: "渐变蓝", value: "#linear-blue", style: "bg-gradient-to-b from-sky-300 to-blue-500" },
];

const SIZE_SPECS = [
  { label: "一寸", w: 295, h: 413, desc: "25x35mm" },
  { label: "二寸", w: 413, h: 579, desc: "35x49mm" },
  { label: "小一寸", w: 260, h: 378, desc: "22x32mm" },
  { label: "小二寸", w: 413, h: 531, desc: "35x45mm" },
  { label: "大一寸", w: 390, h: 567, desc: "33x48mm" },
  { label: "护照", w: 390, h: 567, desc: "33x48mm" },
  { label: "签证", w: 600, h: 600, desc: "51x51mm" },
  { label: "驾照", w: 260, h: 378, desc: "22x32mm" },
];

const LAYOUT_SPECS = [
  { label: "单张", count: 1, cols: 1 },
  { label: "4张排版", count: 4, cols: 2 },
  { label: "8张排版", count: 8, cols: 4 },
  { label: "9张排版", count: 9, cols: 3 },
];

export default function IdPhotoPage() {
  usePageTitle("证件照");
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState("");
  const [selectedBg, setSelectedBg] = useState("#ffffff");
  const [selectedSize, setSelectedSize] = useState(SIZE_SPECS[0]);
  const [selectedLayout, setSelectedLayout] = useState(LAYOUT_SPECS[0]);
  const { result: pollResult, polling, error: pollError, startPolling, reset: resetPoll } = usePollGeneration();

  const [compositedUrl, setCompositedUrl] = useState("");
  const cutoutUrl = pollResult?.status === "completed" ? pollResult.result_url || "" : resultUrl;
  const isProcessing = processing || polling;
  const errorMsg = pollError || (pollResult?.status === "failed" ? pollResult.error_msg : null);

  // Composite cutout result with selected background color
  const compositeWithBg = useCallback(async (transparentUrl: string) => {
    if (!transparentUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
      img.src = transparentUrl;
    });
    const { w: targetW, h: targetH } = selectedSize;
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d")!;
    // Draw background
    if (selectedBg.startsWith("#linear")) {
      const grad = ctx.createLinearGradient(0, 0, 0, targetH);
      grad.addColorStop(0, "#7dd3fc");
      grad.addColorStop(1, "#3b82f6");
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = selectedBg;
    }
    ctx.fillRect(0, 0, targetW, targetH);
    // Draw cutout image scaled to fit
    const scale = Math.min(targetW / img.naturalWidth, targetH / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (blob) {
      setCompositedUrl(URL.createObjectURL(blob));
    }
  }, [selectedBg, selectedSize]);

  // Re-composite when bg color or size changes while cutout exists
  useEffect(() => {
    if (cutoutUrl) compositeWithBg(cutoutUrl);
  }, [cutoutUrl, selectedBg, selectedSize, compositeWithBg]);

  const finalResultUrl = compositedUrl || cutoutUrl;

  const handleFileSelect = (file: File, url: string) => {
    setUploadedFile(file);
    setPreviewUrl(url);
    setResultUrl("");
    setCompositedUrl("");
    resetPoll();
  };

  const handleGenerate = async () => {
    if (!uploadedFile) return;
    setProcessing(true);
    setResultUrl("");
    setCompositedUrl("");
    try {
      const fd = new FormData();
      fd.append("image", uploadedFile);
      fd.append("bg_color", selectedBg);
      fd.append("spec", selectedSize.label);
      const res = await imageAPI.cutout(fd);
      const gen = res.data?.data;
      if (gen?.result_url) {
        setResultUrl(gen.result_url);
        setProcessing(false);
      } else if (gen?.id) {
        setProcessing(false);
        startPolling(gen.id);
      } else {
        setProcessing(false);
      }
    } catch (e: any) {
      console.error(e);
      setProcessing(false);
    }
  };

  const handleReset = () => {
    setPreviewUrl("");
    setResultUrl("");
    setUploadedFile(null);
    resetPoll();
  };

  // Generate layout sheet for download
  const handleLayoutDownload = useCallback(async () => {
    if (!finalResultUrl) return;
    const { count, cols } = selectedLayout;
    const { w: cellW, h: cellH } = selectedSize;
    const rows = Math.ceil(count / cols);
    const padding = 20;
    const canvasW = cols * cellW + (cols + 1) * padding;
    const canvasH = rows * cellH + (rows + 1) * padding;

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);

    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.src = finalResultUrl;
    });

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padding + col * (cellW + padding);
      const y = padding + row * (cellH + padding);
      ctx.drawImage(img, x, y, cellW, cellH);
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `id-photo-${selectedSize.label}-${selectedLayout.label}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [finalResultUrl, selectedLayout, selectedSize]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <motion.div
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35 }}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-neutral-100 dark:border-neutral-800 glass shrink-0"
      >
        <div className="flex items-center gap-3">
          <motion.div whileHover={{ scale: 1.1, rotate: 5 }} className="w-9 h-9 rounded-xl bg-blue-500 flex items-center justify-center shadow-md shadow-blue-200/50">
            <CreditCard size={16} className="text-white" />
          </motion.div>
          <div>
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">证件照</h1>
            <p className="text-xs text-neutral-400">换底色 / 改尺寸 / 排版打印</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {finalResultUrl && (
            <button onClick={handleReset} className="px-3 py-1.5 rounded-lg border border-neutral-200/60 text-sm text-neutral-600 hover:bg-neutral-50 transition-colors flex items-center gap-1.5">
              <RotateCcw size={14} /> 重新上传
            </button>
          )}
          {!finalResultUrl && previewUrl && (
            <button
              onClick={handleGenerate}
              disabled={isProcessing}
              className="px-4 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {isProcessing ? <><Loader2 size={14} className="animate-spin" /> 处理中...</> : <><CreditCard size={14} /> 生成证件照</>}
            </button>
          )}
          {finalResultUrl && (
            <>
              <button
                onClick={() => downloadImage(finalResultUrl, `id-photo-${selectedSize.label}.png`)}
                className="px-3 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors flex items-center gap-1.5"
              >
                <Download size={14} /> 下载单张
              </button>
              <button
                onClick={handleLayoutDownload}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors flex items-center gap-1.5"
              >
                <Download size={14} /> 下载排版
              </button>
            </>
          )}
        </div>
      </motion.div>

      {/* Content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden overflow-y-auto md:overflow-y-hidden">
        {previewUrl ? (
          <>
            {/* Preview */}
            <div className="flex-1 flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4 sm:p-6">
              <div className="flex flex-col items-center gap-4">
                <div className="text-xs text-neutral-500">
                  {selectedSize.label} ({selectedSize.desc}) · {selectedSize.w}x{selectedSize.h}px
                </div>
                <div
                  className="rounded-lg overflow-hidden shadow-lg flex items-center justify-center"
                  style={{
                    backgroundColor: selectedBg.startsWith("#") ? selectedBg : undefined,
                    width: Math.min(selectedSize.w, 300),
                    height: Math.min(selectedSize.h, 420),
                  }}
                >
                  <img
                    src={finalResultUrl || previewUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {isProcessing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg">
                      <div className="bg-white/90 backdrop-blur-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin text-blue-500" />
                        <span className="text-sm text-neutral-700">AI 处理中...</span>
                      </div>
                    </div>
                  )}
                </div>
                {errorMsg && (
                  <div className="bg-red-50 border border-red-200 px-4 py-2 rounded-xl flex items-center gap-2">
                    <AlertCircle size={14} className="text-red-500" />
                    <span className="text-xs text-red-600">{errorMsg}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right panel */}
            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="w-full md:w-[260px] border-t md:border-t-0 md:border-l border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 md:overflow-y-auto p-4 sm:p-5 space-y-6 shrink-0"
            >
              {/* Background color */}
              <div>
                <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">底色</h3>
                <div className="flex flex-wrap gap-2">
                  {BG_COLORS.map((bg) => (
                    <button
                      key={bg.value}
                      onClick={() => setSelectedBg(bg.value)}
                      className={cn(
                        "w-9 h-9 rounded-lg transition-all",
                        bg.style,
                        selectedBg === bg.value ? "ring-2 ring-blue-500 ring-offset-2" : "hover:ring-1 hover:ring-neutral-300"
                      )}
                      title={bg.name}
                    />
                  ))}
                </div>
              </div>

              {/* Size spec */}
              <div>
                <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">尺寸规格</h3>
                <div className="flex flex-wrap gap-1.5">
                  {SIZE_SPECS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => setSelectedSize(s)}
                      className={cn(
                        "px-2.5 py-1.5 rounded-lg text-xs border transition-all",
                        selectedSize.label === s.label
                          ? "bg-blue-50 border-blue-300 text-blue-700 font-medium"
                          : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                      )}
                    >
                      {s.label}
                      <span className="text-[10px] text-neutral-400 ml-0.5">{s.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Layout for printing */}
              <div>
                <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">排版</h3>
                <div className="flex flex-wrap gap-1.5">
                  {LAYOUT_SPECS.map((l) => (
                    <button
                      key={l.label}
                      onClick={() => setSelectedLayout(l)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs border transition-all",
                        selectedLayout.label === l.label
                          ? "bg-blue-50 border-blue-300 text-blue-700 font-medium"
                          : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                      )}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <ImageUploader
              onFileSelect={handleFileSelect}
              accentColor="blue"
              hint="上传人像照片"
              subHint="AI 自动抠图换底色，支持多种证件尺寸"
              className="max-w-md w-full"
            />
          </div>
        )}
      </div>
    </div>
  );
}
