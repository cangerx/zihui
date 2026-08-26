"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/store/theme";

export default function ThemeProvider() {
  const mode = useThemeStore((s) => s.mode);
  const hydrated = useThemeStore((s) => s.hydrated);
  const hydrate = useThemeStore((s) => s.hydrate);

  // Hydrate from localStorage on first mount
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Apply dark class based on mode
  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;

    const apply = (dark: boolean) => {
      if (dark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    if (mode === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const handler = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }

    apply(mode === "dark");
  }, [mode, hydrated]);

  return null;
}
