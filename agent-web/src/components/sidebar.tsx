"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Home,
  Compass,
  Wrench,
  FolderOpen,
  HardDrive,
  User,
  Sparkles,
  Gift,
  Sun,
  Moon,
  Monitor,
  Puzzle,
  LayoutTemplate,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";
import { useLoginModalStore } from "@/store/login-modal";
import { useSiteConfigStore } from "@/store/site-config";
import { useThemeStore, type ThemeMode } from "@/store/theme";
import { usePluginStore } from "@/store/plugins";
import { useAppsStore } from "@/store/apps";
import { getIcon } from "@/lib/icon-map";
import { isWebRouteEnabled } from "@/lib/features";

const staticNavItems = [
  { label: "灵感", href: "/inspiration", icon: Compass },
  { label: "模板", href: "/templates", icon: LayoutTemplate },
  { label: "技能", href: "/tools", icon: Wrench },
  { label: "作品", href: "/projects", icon: FolderOpen },
  { label: "素材空间", href: "/assets", icon: HardDrive },
  { label: "邀请有礼", href: "/referral", icon: Gift },
].filter((item) => isWebRouteEnabled(item.href));

const THEME_CYCLE: ThemeMode[] = ["light", "dark", "auto"];
const THEME_ICON = { light: Sun, dark: Moon, auto: Monitor };
const THEME_LABEL = { light: "浅色模式", dark: "深色模式", auto: "跟随系统" };

export default function Sidebar() {
  const pathname = usePathname();
  const { user, credits } = useAuthStore();
  const { config } = useSiteConfigStore();
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore();
  const { plugins, fetchPlugins } = usePluginStore();
  const { apps, fetchApps, sidebarApps } = useAppsStore();

  useEffect(() => {
    fetchPlugins();
    fetchApps();
  }, [fetchPlugins, fetchApps]);

  const navItems = useMemo(() => {
    const dynamicItems = sidebarApps()
      .filter((app) => isWebRouteEnabled(app.route))
      .map((app) => ({
        label: app.name,
        href: app.route,
        icon: getIcon(app.icon),
      }));
    // sidebar apps first, then static nav items
    return [...dynamicItems, ...staticNavItems];
  }, [apps, sidebarApps]);
  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(themeMode);
    setThemeMode(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };
  const ThemeIcon = THEME_ICON[themeMode];
  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <aside className="hidden md:flex flex-col items-center w-[72px] h-screen border-r border-neutral-200/40 dark:border-neutral-800/60 bg-white/50 dark:bg-neutral-900/50 backdrop-blur-sm shrink-0 relative z-10">
      {/* Logo */}
      <div className="flex items-center justify-center h-14 w-full">
        <Link href="/" className="group">
          <motion.div
            whileHover={{ scale: 1.08, rotate: 3 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          >
            <img src={config.site_favicon || "/logo-icon.svg"} alt={config.site_name} className="w-7 h-7" />
          </motion.div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col items-center gap-0.5 py-3 w-full px-2">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="relative w-full group">
              <motion.div
                className={cn(
                  "flex flex-col items-center justify-center gap-1 w-full py-2.5 rounded-xl text-[11px] relative transition-colors",
                  active
                    ? "text-neutral-900 dark:text-neutral-100 font-medium"
                    : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                )}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                {/* Tooltip */}
                <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                  {item.label}
                </div>
                {active && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 rounded-xl bg-neutral-100 dark:bg-neutral-800"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                {active && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-neutral-900 dark:bg-neutral-100"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative z-10">
                  <Icon size={20} strokeWidth={active ? 2 : 1.5} />
                </span>
                <span className="relative z-10">{item.label}</span>
              </motion.div>
            </Link>
          );
        })}
        {/* Plugin sidebar items */}
        {plugins.filter((p) => p.menu_position === "sidebar" && isWebRouteEnabled(`/plugins/${p.id}`)).map((p) => {
          const href = `/plugins/${p.id}`;
          const active = isActive(href);
          return (
            <Link key={p.id} href={href} className="relative w-full group">
              <motion.div
                className={cn(
                  "flex flex-col items-center justify-center gap-1 w-full py-2.5 rounded-xl text-[11px] relative transition-colors",
                  active
                    ? "text-neutral-900 dark:text-neutral-100 font-medium"
                    : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                )}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
              >
                <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                  {p.menu_label || p.name}
                </div>
                {active && (
                  <motion.div
                    className="absolute inset-0 rounded-xl bg-neutral-100 dark:bg-neutral-800"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative z-10">
                  <Puzzle size={20} strokeWidth={active ? 2 : 1.5} />
                </span>
                <span className="relative z-10">{p.menu_label || p.name}</span>
              </motion.div>
            </Link>
          );
        })}
      </nav>

      {/* Bottom: theme toggle + credits + avatar */}
      <div className="mt-auto pb-3 px-2 w-full flex flex-col items-center gap-2">
        {/* Theme toggle */}
        <motion.button
          whileHover={{ scale: 1.1, rotate: 15 }}
          whileTap={{ scale: 0.9 }}
          onClick={cycleTheme}
          className="group relative flex flex-col items-center gap-0.5 py-2 w-full rounded-xl text-[10px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100/80 dark:hover:bg-neutral-800/60 transition-colors"
        >
          <ThemeIcon size={16} strokeWidth={1.5} />
          <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
            {THEME_LABEL[themeMode]}
          </div>
        </motion.button>
        {user ? (
          <>
            {isWebRouteEnabled("/pricing") && <Link href="/pricing" className="group relative w-full">
              <motion.div
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className="flex flex-col items-center gap-0.5 py-2 rounded-xl text-[10px] text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
              >
                <Sparkles size={16} strokeWidth={1.5} />
                <span className="font-medium">{credits?.balance?.toFixed(0) || 0}</span>
              </motion.div>
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                积分余额
              </div>
            </Link>}
            {isWebRouteEnabled("/settings") && <Link href="/settings" className="group relative">
              <motion.div
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center overflow-hidden ring-2 ring-white/80 dark:ring-neutral-700/80 shadow-sm"
              >
                {user.avatar ? (
                  <img src={user.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <User size={15} className="text-neutral-400" />
                )}
              </motion.div>
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                {user.nickname || "个人中心"}
              </div>
            </Link>}
          </>
        ) : (
          <>
            {isWebRouteEnabled("/pricing") && <Link href="/pricing" className="group relative w-full">
              <motion.div
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className="flex flex-col items-center gap-0.5 py-2 rounded-xl text-[10px] text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
              >
                <Sparkles size={16} strokeWidth={1.5} />
                <span className="font-medium">升级</span>
              </motion.div>
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                升级会员
              </div>
            </Link>}
            <motion.div
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => useLoginModalStore.getState().openLoginModal()}
              className="group relative w-9 h-9 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center ring-2 ring-white/80 dark:ring-neutral-700/80 shadow-sm cursor-pointer"
            >
              <User size={15} className="text-neutral-400" />
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                登录
              </div>
            </motion.div>
          </>
        )}
      </div>
    </aside>
  );
}
