"use client";

/**
 * Client-side image editing utilities: rotate, flip, crop.
 * Uses canvas API — no backend calls needed.
 */

import { fetchImageViaProxy } from "@/lib/api";

export type QuickEditAction = "rotate-cw" | "rotate-ccw" | "flip-h" | "flip-v";

/** Create an HTMLImageElement from a blob URL */
function imgFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Failed to load blob image")); };
    img.src = url;
  });
}

/** Load an image, falling back to fetch+blob → server proxy when CORS blocks */
async function loadImageSafe(src: string): Promise<HTMLImageElement> {
  // data URLs always work directly
  if (src.startsWith("data:")) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load data URL"));
      img.src = src;
    });
  }

  // 1. Try with crossOrigin (needed for toDataURL)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("crossOrigin blocked"));
      el.src = src;
    });
    return img;
  } catch { /* blocked, try fetch */ }

  // 2. Fallback: fetch as blob
  try {
    const res = await fetch(src);
    if (res.ok) return await imgFromBlob(await res.blob());
  } catch { /* also blocked, try proxy */ }

  // 3. Last resort: server-side proxy
  const blob = await fetchImageViaProxy(src);
  return imgFromBlob(blob);
}

/** Rotate or flip an image via canvas API, returns a data URL */
export async function applyQuickEdit(src: string, action: QuickEditAction): Promise<string> {
  const img = await loadImageSafe(src);
  const isRotate = action === "rotate-cw" || action === "rotate-ccw";
  const w = isRotate ? img.naturalHeight : img.naturalWidth;
  const h = isRotate ? img.naturalWidth : img.naturalHeight;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No context");

  ctx.save();

  if (action === "rotate-cw") {
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
  } else if (action === "rotate-ccw") {
    ctx.translate(0, h);
    ctx.rotate(-Math.PI / 2);
  } else if (action === "flip-h") {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  } else if (action === "flip-v") {
    ctx.translate(0, h);
    ctx.scale(1, -1);
  }

  ctx.drawImage(img, 0, 0);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

/** Crop an image to a given rect, returns a data URL */
export async function cropImage(
  src: string,
  rect: { x: number; y: number; w: number; h: number },
): Promise<string> {
  const img = await loadImageSafe(src);
  const canvas = document.createElement("canvas");
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No context");
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return canvas.toDataURL("image/png");
}
