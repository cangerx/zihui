import { create } from "zustand";
import { appAPI } from "@/lib/api";
import { featureFlags } from "@/lib/features";

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string;
  route: string;
  menu_label: string;
  menu_position: string; // "tools" | "sidebar" | "hidden"
  has_api: boolean;
  has_web: boolean;
}

interface PluginStore {
  plugins: PluginInfo[];
  loaded: boolean;
  fetchPlugins: () => Promise<void>;
}

export const usePluginStore = create<PluginStore>((set, get) => ({
  plugins: [],
  loaded: false,
  fetchPlugins: async () => {
    if (get().loaded) return;
    if (!featureFlags.plugins) {
      set({ plugins: [], loaded: true });
      return;
    }
    try {
      const res = await appAPI.plugins();
      set({ plugins: res.data?.data || [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
