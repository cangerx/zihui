"use client";

import { useState, useCallback } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageUploaderProps {
  onFileSelect: (file: File, previewUrl: string) => void;
  previewUrl?: string;
  onClear?: () => void;
  accept?: string;
  maxSizeMB?: number;
  accentColor?: string;
  className?: string;
  hint?: string;
  subHint?: string;
}

export default function ImageUploader({
  onFileSelect,
  previewUrl,
  onClear,
  accept = "image/*",
  maxSizeMB = 20,
  accentColor = "neutral",
  className,
  hint = "点击或拖拽上传",
  subHint = "支持 JPG、PNG、WebP",
}: ImageUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");

  const colorMap: Record<string, { bg: string; border: string; icon: string }> = {
    neutral: { bg: "bg-neutral-50", border: "hover:border-neutral-400", icon: "text-neutral-300" },
    blue: { bg: "bg-blue-50", border: "hover:border-blue-300", icon: "text-blue-400" },
    emerald: { bg: "bg-emerald-50", border: "hover:border-emerald-300", icon: "text-emerald-400" },
    orange: { bg: "bg-orange-50", border: "hover:border-orange-300", icon: "text-orange-400" },
    amber: { bg: "bg-amber-50", border: "hover:border-amber-300", icon: "text-amber-400" },
    cyan: { bg: "bg-cyan-50", border: "hover:border-cyan-300", icon: "text-cyan-400" },
    purple: { bg: "bg-purple-50", border: "hover:border-purple-300", icon: "text-purple-400" },
  };

  const colors = colorMap[accentColor] || colorMap.neutral;

  const validateAndSelect = useCallback(
    (file: File) => {
      setError("");
      if (!file.type.startsWith("image/")) {
        setError("请上传图片文件");
        return;
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        setError(`文件大小不能超过 ${maxSizeMB}MB`);
        return;
      }
      const url = URL.createObjectURL(file);
      onFileSelect(file, url);
    },
    [maxSizeMB, onFileSelect]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSelect(file);
  };

  if (previewUrl) {
    return (
      <div className={cn("relative group", className)}>
        <img
          src={previewUrl}
          alt=""
          className="w-full rounded-xl border border-neutral-200/60 object-contain max-h-[200px]"
        />
        {onClear && (
          <button
            onClick={onClear}
            className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/50 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          >
            更换
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <label
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        className={cn(
          "flex flex-col items-center justify-center gap-3 py-10 rounded-xl border-2 border-dashed cursor-pointer transition-all",
          dragOver
            ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/30 scale-[1.01]"
            : cn("border-neutral-200 dark:border-neutral-700", colors.border, "bg-neutral-50/50 dark:bg-neutral-800/30")
        )}
      >
        <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center", colors.bg)}>
          <Upload size={24} className={colors.icon} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{hint}</p>
          <p className="text-xs text-neutral-400 mt-1">{subHint}，最大 {maxSizeMB}MB</p>
        </div>
        <input type="file" accept={accept} className="hidden" onChange={handleFileChange} />
      </label>
      {error && (
        <p className="text-xs text-red-500 mt-2 px-1">{error}</p>
      )}
    </div>
  );
}
