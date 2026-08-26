import { create } from "zustand";
import { appAPI } from "@/lib/api";

export interface AppParams {
  model?: string;
  ratio?: string;
  resolution?: string;
  style?: string;
  quality?: string;
  count?: number;
  locked?: string[];
}

export interface AppInfo {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  route: string;
  category: string;
  position: string;
  sort_order: number;
  bg_color: string;
  params?: AppParams | null;
}

interface AppsStore {
  apps: AppInfo[];
  loaded: boolean;
  fetchApps: () => Promise<void>;
  sidebarApps: () => AppInfo[];
  toolApps: (category?: string) => AppInfo[];
  isEnabled: (key: string) => boolean;
  getAppParams: (key: string) => AppParams | null;
}

export const useAppsStore = create<AppsStore>((set, get) => ({
  apps: [],
  loaded: false,
  fetchApps: async () => {
    if (get().loaded) return;
    try {
      const res = await appAPI.apps();
      set({ apps: res.data?.data || [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  sidebarApps: () => get().apps.filter((a) => a.position === "sidebar"),
  toolApps: (category?: string) => {
    const apps = get().apps.filter((a) => a.position === "tools");
    return category ? apps.filter((a) => a.category === category) : apps;
  },
  isEnabled: (key: string) => get().apps.some((a) => a.key === key),
  getAppParams: (key: string) => {
    const app = get().apps.find((a) => a.key === key);
    return app?.params || null;
  },
}));
