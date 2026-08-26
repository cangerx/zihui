"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { imageAPI } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

export function useOptimizePrompt() {
  const { toast } = useToast();
  const [optimizing, setOptimizing] = useState(false);
  const typewriterRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (typewriterRef.current) clearTimeout(typewriterRef.current);
    };
  }, []);

  const typewriterFill = useCallback((text: string, setter: (v: string) => void) => {
    if (typewriterRef.current) clearTimeout(typewriterRef.current);
    let i = 0;
    setter("");
    // Speed adapts to text length: longer text → faster typing
    const baseDelay = text.length > 200 ? 8 : text.length > 100 ? 12 : 18;
    const tick = () => {
      if (i < text.length) {
        setter(text.slice(0, i + 1));
        i++;
        typewriterRef.current = setTimeout(tick, baseDelay + Math.random() * 8);
      } else {
        setOptimizing(false);
        toast("提示词已优化 ✨", "success");
      }
    };
    tick();
  }, [toast]);

  const optimize = useCallback(async (text: string, setter: (v: string) => void) => {
    if (!text.trim() || optimizing) return;
    setOptimizing(true);
    try {
      const res = await imageAPI.optimizePrompt(text.trim());
      const optimized = res.data?.optimized_prompt;
      if (optimized) {
        typewriterFill(optimized, setter);
      } else {
        toast("未获取到优化结果，请重试", "error");
        setOptimizing(false);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || "优化失败，请稍后重试";
      toast(msg, "error");
      console.error("优化提示词失败", e);
      setOptimizing(false);
    }
  }, [optimizing, typewriterFill, toast]);

  return { optimizing, optimize };
}
