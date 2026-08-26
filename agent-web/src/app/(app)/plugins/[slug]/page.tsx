"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { usePluginStore, type PluginInfo } from "@/store/plugins";
import { featureFlags } from "@/lib/features";
import { API_BASE_URL } from "@/lib/api";

export default function PluginPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { plugins, loaded, fetchPlugins } = usePluginStore();
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const [pluginLoaded, setPluginLoaded] = useState(false);

  useEffect(() => {
    if (!featureFlags.plugins) return;
    fetchPlugins();
  }, [fetchPlugins]);

  const plugin: PluginInfo | undefined = plugins.find((p) => p.id === slug);

  useEffect(() => {
    if (!featureFlags.plugins || !loaded || !plugin?.has_web || !containerRef.current) return;

    const staticBase = `${API_BASE_URL}/plugins/${plugin.id}/static`;

    // Load plugin's index.js from its static dist
    const script = document.createElement("script");
    script.src = `${staticBase}/index.js`;
    script.onload = () => {
      const pluginRegistry = (window as any).__ZIHUI_PLUGINS__;
      if (pluginRegistry?.[plugin.id]?.mount) {
        pluginRegistry[plugin.id].mount(containerRef.current);
        setPluginLoaded(true);
      } else {
        setError("插件加载失败：未找到 mount 函数");
      }
    };
    script.onerror = () => {
      setError("插件静态资源加载失败");
    };
    document.head.appendChild(script);

    // Load plugin's CSS if exists
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${staticBase}/index.css`;
    document.head.appendChild(link);

    return () => {
      // Cleanup: call unmount if available
      const pluginRegistry = (window as any).__ZIHUI_PLUGINS__;
      if (pluginRegistry?.[plugin.id]?.unmount) {
        pluginRegistry[plugin.id].unmount();
      }
      document.head.removeChild(script);
      if (link.parentNode) document.head.removeChild(link);
    };
  }, [loaded, plugin]);

  if (!featureFlags.plugins) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        插件功能当前未开放
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 size={24} className="animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <AlertCircle size={32} className="text-neutral-300" />
        <p className="text-sm text-neutral-500">插件不存在或未加载</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <AlertCircle size={32} className="text-red-300" />
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-screen">
      <div ref={containerRef} className="w-full h-full" />
      {!pluginLoaded && plugin.has_web && (
        <div className="flex items-center justify-center h-96">
          <Loader2 size={24} className="animate-spin text-neutral-400" />
          <span className="ml-2 text-sm text-neutral-400">
            加载 {plugin.name}...
          </span>
        </div>
      )}
    </div>
  );
}
