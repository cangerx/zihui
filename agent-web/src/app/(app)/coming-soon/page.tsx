"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Clock, ArrowLeft } from "lucide-react";

const TOOL_NAMES: Record<string, string> = {
  "a-plus": "A+ 详情页",
  "batch-photo": "批量套图",
  "copy-hot": "爆款图复刻",
  "try-on": "AI 穿戴套图",
  "id-photo": "证件照",
  "resize": "无损改尺寸",
  "collage": "拼图",
  "portrait": "形象照",
  "batch-edit": "图片批处理",
  "logo": "AI Logo",
  "note": "AI 图文笔记",
  "ppt": "LivePPT",
  video: "AI 视频",
  music: "AI 音乐",
};

export default function ComingSoonPage() {
  return (
    <Suspense fallback={null}>
      <ComingSoonContent />
    </Suspense>
  );
}

function ComingSoonContent() {
  const searchParams = useSearchParams();
  const toolKey = searchParams.get("tool") || "";
  const toolName = TOOL_NAMES[toolKey] || toolKey || "该功能";

  return (
    <div className="flex-1 flex items-center justify-center h-full bg-[#fafafa]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="text-center max-w-md px-6"
      >
        <motion.div
          animate={{ rotate: [0, 10, -10, 0] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
          className="w-20 h-20 rounded-3xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mx-auto mb-6 shadow-sm"
        >
          <Clock size={32} className="text-neutral-400" />
        </motion.div>

        <h1 className="text-2xl font-bold text-neutral-900 mb-2">
          {toolName}
        </h1>
        <p className="text-neutral-500 mb-1">功能正在开发中，敬请期待</p>
        <p className="text-sm text-neutral-400 mb-8">
          我们正在全力打造更优质的体验，感谢您的耐心等待
        </p>

        <div className="flex items-center justify-center gap-3">
          <Link
            href="/tools"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors shadow-sm"
          >
            <ArrowLeft size={14} />
            返回工具中心
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
