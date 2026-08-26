/**
 * Zihui AI Plugin SDK
 *
 * Disabled by default in round 1. When enabled, plugins use the Zihui globals.
 * Provides access to auth, API calls, toast notifications, etc.
 */

import { useAuthStore } from "@/store/auth";
import api, { API_BASE_URL } from "@/lib/api";
import { featureFlags } from "@/lib/features";

export interface ZihuiPluginSDK {
  /** Get current user info */
  getUser: () => { id: number; nickname: string; email: string; avatar: string } | null;
  /** Get current auth token */
  getToken: () => string | null;
  /** Make authenticated API call relative to the configured application API. */
  callAPI: (method: string, path: string, data?: any) => Promise<any>;
  /** Get the base API URL */
  getAPIBase: () => string;
  /** Navigate to a route */
  navigate: (path: string) => void;
}

export function createPluginSDK(): ZihuiPluginSDK {
  return {
    getUser: () => {
      const { user } = useAuthStore.getState();
      if (!user) return null;
      return {
        id: user.id,
        nickname: user.nickname || "",
        email: user.email || "",
        avatar: user.avatar || "",
      };
    },
    getToken: () => {
      return useAuthStore.getState().token;
    },
    callAPI: async (method: string, path: string, data?: any) => {
      const m = method.toLowerCase();
      if (m === "get") return api.get(path, { params: data });
      if (m === "post") return api.post(path, data);
      if (m === "put") return api.put(path, data);
      if (m === "delete") return api.delete(path, { data });
      throw new Error(`Unsupported method: ${method}`);
    },
    getAPIBase: () => API_BASE_URL,
    navigate: (path: string) => {
      window.location.href = path;
    },
  };
}

/** Initialize the SDK on window for plugin access */
export function initPluginSDK() {
  if (featureFlags.plugins && typeof window !== "undefined") {
    (window as any).__ZIHUI_SDK__ = createPluginSDK();
    if (!(window as any).__ZIHUI_PLUGINS__) {
      (window as any).__ZIHUI_PLUGINS__ = {};
    }
  }
}
