"use client";

import { memo, useEffect, useRef } from "react";
import {
  Download, RotateCcw, Pencil, Trash2, Copy, ImageIcon,
  Paintbrush, Scaling, RotateCw, FlipHorizontal2, FlipVertical2, CopyPlus,
} from "lucide-react";
import { useCanvasCallbacks } from "./CanvasContext";
import { downloadImage } from "@/lib/download";
import { fetchImageViaProxy } from "@/lib/api";

export interface ContextMenuProps {
  nodeId: string;
  src?: string;
  prompt?: string;
  status?: string;
  x: number;
  y: number;
  onClose: () => void;
}

type MenuItem = { icon: typeof Download; label: string; onClick: () => void; danger?: boolean; divider?: false }
  | { divider: true };

function ContextMenu({ nodeId, src, prompt, status, x, y, onClose }: ContextMenuProps) {
  const { onReGenerate, onEdit, onDelete, onRetry, onInpaint, onResize, onQuickEdit, onDuplicate } = useCanvasCallbacks();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const isCompleted = status === "completed";

  const items: MenuItem[] = [
    ...(isCompleted && src
      ? [{ icon: Download, label: "下载图片", onClick: () => downloadImage(src, `generate-${nodeId}.png`) }]
      : []),
    ...(isCompleted && src
      ? [{ icon: ImageIcon, label: "复制图片", onClick: async () => {
          try {
            // Use Promise<Blob> in ClipboardItem so write() is called
            // synchronously within the user gesture (avoids "not focused" error).
            const pngPromise = (async (): Promise<Blob> => {
              let blob: Blob | undefined;

              // For data URLs, fetch directly
              if (src.startsWith("data:")) {
                const res = await fetch(src);
                blob = await res.blob();
              } else {
                // Try direct CORS fetch with a short timeout
                try {
                  const controller = new AbortController();
                  const timer = setTimeout(() => controller.abort(), 5000);
                  const res = await fetch(src, { mode: "cors", signal: controller.signal });
                  clearTimeout(timer);
                  if (res.ok) blob = await res.blob();
                } catch { /* CORS blocked or timeout */ }

                // Fallback to server-side proxy
                if (!blob) {
                  try { blob = await fetchImageViaProxy(src); } catch { /* proxy failed */ }
                }
              }
              if (!blob) throw new Error("无法获取图片");

              if (blob.type === "image/png") return blob;
              return new Promise<Blob>((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                  const c = document.createElement("canvas");
                  c.width = img.naturalWidth;
                  c.height = img.naturalHeight;
                  c.getContext("2d")!.drawImage(img, 0, 0);
                  c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
                };
                img.onerror = () => reject(new Error("image load failed"));
                img.src = URL.createObjectURL(blob!);
              });
            })();

            await navigator.clipboard.write([new ClipboardItem({ "image/png": pngPromise })]);
          } catch (e) {
            console.error("复制图片失败:", e);
          }
        }}]
      : []),
    ...(isCompleted && prompt
      ? [{ icon: Copy, label: "复制提示词", onClick: () => navigator.clipboard.writeText(prompt) }]
      : []),
    ...(isCompleted && onDuplicate
      ? [{ icon: CopyPlus, label: "复制节点", onClick: () => onDuplicate(nodeId) }]
      : []),
    ...(isCompleted ? [{ divider: true } as MenuItem] : []),
    ...(onRetry
      ? [{ icon: RotateCcw, label: "重新生成", onClick: () => onRetry(nodeId) }]
      : []),
    ...(isCompleted
      ? [{ icon: Pencil, label: "编辑提示词", onClick: () => onEdit(prompt || "") }]
      : []),
    ...(isCompleted && src && onInpaint
      ? [{ icon: Paintbrush, label: "涂抹编辑", onClick: () => onInpaint(nodeId, src) }]
      : []),
    ...(isCompleted && src && onResize
      ? [{ icon: Scaling, label: "调整尺寸", onClick: () => onResize(nodeId, src) }]
      : []),
    ...(isCompleted && onQuickEdit ? [
      { divider: true } as MenuItem,
      { icon: RotateCw, label: "旋转 90°", onClick: () => onQuickEdit(nodeId, "rotate-cw") },
      { icon: FlipHorizontal2, label: "水平翻转", onClick: () => onQuickEdit(nodeId, "flip-h") },
      { icon: FlipVertical2, label: "垂直翻转", onClick: () => onQuickEdit(nodeId, "flip-v") },
    ] : []),
    { divider: true } as MenuItem,
    { icon: Trash2, label: "删除", onClick: () => onDelete(nodeId), danger: true },
  ];

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] py-1 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl rounded-xl shadow-xl border border-neutral-200/60 dark:border-neutral-700/60 animate-in fade-in zoom-in-95 duration-150"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => {
        if ("divider" in item && item.divider) {
          return <div key={`d-${i}`} className="h-px bg-neutral-100 dark:bg-neutral-800 my-0.5 mx-2" />;
        }
        const mi = item as Exclude<MenuItem, { divider: true }>;
        return (
          <button
            key={i}
            onClick={() => { mi.onClick(); onClose(); }}
            className={`flex items-center gap-2.5 w-full px-3 py-2 text-xs transition-colors ${
              mi.danger
                ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            <mi.icon size={13} />
            {mi.label}
          </button>
        );
      })}
    </div>
  );
}

export default memo(ContextMenu);
