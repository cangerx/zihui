import { fetchImageViaProxy } from "@/lib/api";

export async function downloadImage(url: string, filename?: string) {
  const name = filename || `zihui-${Date.now()}.png`;

  // Try direct fetch first, fallback to proxy, then open in new tab
  let blob: Blob | null = null;
  try {
    const res = await fetch(url);
    if (res.ok) blob = await res.blob();
  } catch { /* CORS blocked */ }

  if (!blob) {
    try { blob = await fetchImageViaProxy(url); } catch { /* proxy also failed */ }
  }

  if (blob) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } else {
    window.open(url, "_blank");
  }
}
