"use client";

import Link from "next/link";
import { useSiteConfigStore } from "@/store/site-config";
import { isWebRouteEnabled } from "@/lib/features";

const footerColumns = [
  {
    title: "模板中心",
    links: [
      { label: "电商", href: "/templates?category=ecommerce" },
      { label: "社交媒体", href: "/templates?category=social" },
      { label: "微信营销", href: "/templates?category=wechat" },
      { label: "公众号", href: "/templates?category=official" },
      { label: "行政办公/教育", href: "/templates?category=office" },
      { label: "生活娱乐", href: "/templates?category=lifestyle" },
      { label: "海报", href: "/poster" },
    ],
  },
  {
    title: "AI 工具",
    links: [
      { label: "AI 对话", href: "/chat" },
      { label: "AI 商品图", href: "/product-photo" },
      { label: "智能抠图", href: "/cutout" },
      { label: "AI 消除", href: "/eraser" },
      { label: "AI 扩图", href: "/expand" },
      { label: "变清晰", href: "/upscale" },
      { label: "AI 海报", href: "/poster" },
    ],
  },
  {
    title: "内容中心",
    links: [
      { label: "模板中心", href: "/templates" },
      { label: "灵感广场", href: "/inspiration" },
    ],
  },
  {
    title: "支持与服务",
    links: [
      { label: "关于我们", href: "/about" },
      { label: "用户协议", href: "/terms" },
      { label: "隐私政策", href: "/privacy" },
      { label: "账号规则", href: "/account-rules" },
    ],
  },
];

export default function Footer() {
  const { config } = useSiteConfigStore();
  const visibleColumns = footerColumns
    .map((column) => ({
      ...column,
      links: column.links.filter((link) => isWebRouteEnabled(link.href)),
    }))
    .filter((column) => column.links.length > 0);

  return (
    <footer className="border-t border-neutral-100 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      {/* Link columns */}
      <div className="max-w-6xl mx-auto px-6 pt-10 pb-8">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-2 pr-4">
            {config.site_logo_dark ? (
              <img
                src={config.site_logo_dark}
                alt={config.site_name}
                className="h-8 mb-3 object-contain"
              />
            ) : (
              <div className="mb-3 flex items-center gap-2">
                <img src={config.site_favicon || "/logo-icon.svg"} alt="" className="h-8 w-8" />
                <span className="text-lg font-semibold text-neutral-900">{config.site_name}</span>
              </div>
            )}
            <p className="text-xs text-neutral-400 leading-relaxed">
              {config.site_description || "一站式智能创作平台"}
            </p>
          </div>

          {/* Link groups */}
          {visibleColumns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-medium text-neutral-900 mb-3">
                {col.title}
              </h4>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-xs text-neutral-400 hover:text-neutral-700 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-neutral-100">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex flex-col items-center gap-1.5 text-[11px] text-neutral-400">
            <p>{config.site_copyright}</p>
            {config.site_icp && (
              <p>
                <a
                  href="https://beian.miit.gov.cn/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-neutral-500 transition-colors"
                >
                  {config.site_icp}
                </a>
              </p>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
