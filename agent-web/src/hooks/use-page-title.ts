"use client";

import { useEffect } from "react";
import { useSiteConfigStore } from "@/store/site-config";

export function usePageTitle(title: string) {
  const siteName = useSiteConfigStore((s) => s.config.site_name);

  useEffect(() => {
    document.title = `${title} | ${siteName || "Zihui AI"}`;
    return () => {
      document.title = siteName || "Zihui AI - 智能创作平台";
    };
  }, [title, siteName]);
}
