import { create } from "zustand";
import { appAPI } from "@/lib/api";
import { detectTenantParams } from "@/lib/tenant";

interface SiteConfig {
  site_name: string;
  site_description: string;
  site_keywords: string;
  site_logo: string;
  site_logo_dark: string;
  site_favicon: string;
  site_copyright: string;
  site_icp: string;
  site_og_image: string;
  site_og_type: string;
  site_twitter_card: string;
  site_canonical_url: string;
  site_analytics_id: string;
  primary_color: string;
}

interface SiteConfigStore {
  config: SiteConfig;
  loaded: boolean;
  agentCode: string | null;
  agentId: number | null;
  isAgentSite: boolean;
  fetchConfig: () => Promise<void>;
}

const defaultConfig: SiteConfig = {
  site_name: "Zihui AI",
  site_description: "AI 聊天、生图、修图、视频、音乐，一站式智能创作平台",
  site_keywords: "AI,人工智能,AI绘画,AI聊天,智能创作",
  site_logo: "",
  site_logo_dark: "",
  site_favicon: "/logo-icon.svg",
  site_copyright: "Copyright 2026 Zihui AI",
  site_icp: "",
  site_og_image: "",
  site_og_type: "website",
  site_twitter_card: "summary_large_image",
  site_canonical_url: "",
  site_analytics_id: "",
  primary_color: "",
};

export const useSiteConfigStore = create<SiteConfigStore>((set, get) => ({
  config: { ...defaultConfig },
  loaded: false,
  agentCode: null,
  agentId: null,
  isAgentSite: false,
  fetchConfig: async () => {
    if (get().loaded) return;
    try {
      const params = detectTenantParams();
      const res = await appAPI.bootstrap();
      const bootstrap = res.data?.data;
      const data = bootstrap?.brand ? {
        site_name: bootstrap.brand.name,
        site_description: bootstrap.brand.description,
        site_favicon: bootstrap.brand.favicon || defaultConfig.site_favicon,
      } : null;
      const agentCode = params.agent_code || null;
      const agentId = null;

      if (agentCode && typeof window !== "undefined") {
        localStorage.setItem("agent_code", agentCode);
      }

      if (data) {
        set({
          config: { ...defaultConfig, ...data },
          loaded: true,
          agentCode,
          agentId,
          isAgentSite: !!agentCode,
        });
      }
    } catch {
      set({ loaded: true });
    }
  },
}));
