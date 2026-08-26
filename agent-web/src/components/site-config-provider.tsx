"use client";

import { useEffect } from "react";
import { useSiteConfigStore } from "@/store/site-config";

export default function SiteConfigProvider() {
  const { config, loaded, fetchConfig } = useSiteConfigStore();

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    if (!loaded) return;

    // Update document title
    document.title = config.site_name
      ? `${config.site_name} - ${config.site_description || "智能创作平台"}`
      : "Zihui AI - 智能创作平台";

    // Update meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.setAttribute("name", "description");
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute("content", config.site_description);

    // Update meta keywords
    let metaKw = document.querySelector('meta[name="keywords"]');
    if (!metaKw) {
      metaKw = document.createElement("meta");
      metaKw.setAttribute("name", "keywords");
      document.head.appendChild(metaKw);
    }
    metaKw.setAttribute("content", config.site_keywords);

    // Update favicon
    if (config.site_favicon) {
      let link = document.querySelector(
        'link[rel="icon"]'
      ) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = config.site_favicon;
    }

    // OG meta tags
    const ogTags: Record<string, string> = {
      "og:title": `${config.site_name} - ${config.site_description || "智能创作平台"}`,
      "og:description": config.site_description,
      "og:site_name": config.site_name,
      "og:type": config.site_og_type || "website",
    };
    if (config.site_og_image) ogTags["og:image"] = config.site_og_image;
    if (config.site_canonical_url) ogTags["og:url"] = config.site_canonical_url;

    for (const [prop, content] of Object.entries(ogTags)) {
      let el = document.querySelector(`meta[property="${prop}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", prop);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    }

    // Twitter meta tags
    const twitterTags: Record<string, string> = {
      "twitter:card": config.site_twitter_card || "summary_large_image",
      "twitter:title": `${config.site_name} - ${config.site_description || "智能创作平台"}`,
      "twitter:description": config.site_description,
    };
    if (config.site_og_image) twitterTags["twitter:image"] = config.site_og_image;

    for (const [name, content] of Object.entries(twitterTags)) {
      let el = document.querySelector(`meta[name="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    }

    // Canonical URL
    if (config.site_canonical_url) {
      let canonical = document.querySelector(
        'link[rel="canonical"]'
      ) as HTMLLinkElement | null;
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.rel = "canonical";
        document.head.appendChild(canonical);
      }
      canonical.href = config.site_canonical_url;
    }
  }, [loaded, config]);

  return null;
}
