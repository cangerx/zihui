"use client";

import { Music, Mic, Piano, Guitar, Drum } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";

const genres = ["流行", "古典", "电子", "爵士", "摇滚", "民谣", "嘻哈", "环境"];
const moods = ["欢快", "悲伤", "激昂", "宁静", "浪漫", "紧张", "梦幻", "史诗"];

export default function MusicPage() {
  usePageTitle("AI 音乐");
  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
          <Music size={20} className="text-amber-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">AI 音乐</h1>
          <p className="text-sm text-neutral-500">描述风格和情绪，AI 创作原创音乐</p>
        </div>
      </div>

      <div className="mb-6 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100 flex items-center gap-3">
        <span className="text-lg">🚧</span>
        <div>
          <p className="text-sm font-medium text-amber-700">功能开发中</p>
          <p className="text-xs text-amber-600/80">AI 音乐生成即将上线，敬请期待</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200/60 p-5 space-y-5 opacity-60 pointer-events-none">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1.5">描述你想要的音乐</label>
          <textarea
            rows={3}
            placeholder="例如：一段轻快的钢琴曲，适合早晨醒来时听..."
            className="w-full px-3 py-2 rounded-lg border border-neutral-200/60 text-sm outline-none focus:border-neutral-300 focus:shadow-sm resize-none transition-colors"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">风格</label>
          <div className="flex flex-wrap gap-2">
            {genres.map((g) => (
              <button
                key={g}
                className="px-3 py-1.5 rounded-full border border-neutral-200/60 text-xs text-neutral-600 hover:border-amber-300 hover:bg-amber-50 transition-colors"
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">情绪</label>
          <div className="flex flex-wrap gap-2">
            {moods.map((m) => (
              <button
                key={m}
                className="px-3 py-1.5 rounded-full border border-neutral-200/60 text-xs text-neutral-600 hover:border-amber-300 hover:bg-amber-50 transition-colors"
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">时长</label>
            <select className="w-full px-3 py-2 rounded-lg border border-neutral-200/60 text-sm outline-none">
              <option>30 秒</option>
              <option>60 秒</option>
              <option>120 秒</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">是否含人声</label>
            <select className="w-full px-3 py-2 rounded-lg border border-neutral-200/60 text-sm outline-none">
              <option>纯音乐</option>
              <option>含人声</option>
            </select>
          </div>
        </div>

        <button className="w-full py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors">
          生成音乐
        </button>
      </div>

      {/* Generated music placeholder */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wider mb-4">生成历史</h2>
        <div className="rounded-2xl border border-neutral-200/60 bg-white p-12 text-center">
          <Music size={32} className="mx-auto text-neutral-200 mb-3" />
          <p className="text-neutral-400 text-sm">还没有生成过音乐</p>
        </div>
      </div>
    </div>
  );
}
