import { create } from "zustand";
import { appAPI } from "@/lib/api";

interface ModulesState {
  modules: Record<string, boolean>;
  loaded: boolean;
  fetchModules: () => Promise<void>;
  isEnabled: (key: string) => boolean;
}

export const useModulesStore = create<ModulesState>((set, get) => ({
  modules: {},
  loaded: false,
  fetchModules: async () => {
    try {
      const res = await appAPI.modules();
      const data = res.data?.data ?? {};
      set({ modules: data, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  isEnabled: (key: string) => {
    const m = get().modules;
    return m[key] === true;
  },
}));
