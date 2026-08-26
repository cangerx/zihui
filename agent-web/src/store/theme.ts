import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "auto";

interface ThemeState {
  mode: ThemeMode;
  hydrated: boolean;
  setMode: (mode: ThemeMode) => void;
  hydrate: () => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: "auto",
  hydrated: false,
  setMode: (mode: ThemeMode) => {
    if (typeof window !== "undefined") localStorage.setItem("theme-mode", mode);
    set({ mode });
  },
  hydrate: () => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme-mode") as ThemeMode | null;
      set({ mode: saved || "auto", hydrated: true });
    }
  },
}));
