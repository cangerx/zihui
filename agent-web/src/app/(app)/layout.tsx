"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Sparkles, User, Home, LayoutGrid, Compass, HardDrive, FolderOpen, Lock, LayoutTemplate } from "lucide-react";
import Sidebar from "@/components/sidebar";
import NotificationBanner from "@/components/notification-banner";
import LoginModal from "@/components/login-modal";
import { useAuthStore } from "@/store/auth";
import { useLoginModalStore } from "@/store/login-modal";
import { cn } from "@/lib/utils";
import { initPluginSDK } from "@/lib/plugin-sdk";

const mobileNavItems = [
  { label: "首页", href: "/", icon: Home },
  { label: "灵感", href: "/inspiration", icon: Compass },
  { label: "模板", href: "/templates", icon: LayoutTemplate },
  { label: "素材", href: "/assets", icon: HardDrive },
  { label: "作品", href: "/projects", icon: FolderOpen },
];

const PUBLIC_ROUTES = ["/", "/inspiration", "/templates", "/tools", "/pricing", "/coming-soon"];

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15, ease: "easeIn" as const } },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AppLayoutInner>{children}</AppLayoutInner>
    </Suspense>
  );
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, credits, token, isLoading, fetchProfile } = useAuthStore();
  const { openLoginModal } = useLoginModalStore();

  const [mounted, setMounted] = useState(false);

  const needAuth = useMemo(() => {
    return mounted && !token && !PUBLIC_ROUTES.includes(pathname);
  }, [mounted, token, pathname]);

  useEffect(() => {
    setMounted(true);
    initPluginSDK();
  }, []);

  useEffect(() => {
    if (token && !user && !isLoading) {
      fetchProfile();
    }
  }, [token, user, isLoading, fetchProfile]);

  useEffect(() => {
    if (needAuth) {
      openLoginModal();
    }
  }, [needAuth, openLoginModal]);

  // Handle referral redirect: /?ref=xxx&login=1
  useEffect(() => {
    const ref = searchParams.get("ref");
    const login = searchParams.get("login");
    if (ref) {
      localStorage.setItem("ref_code", ref);
    }
    if (login === "1") {
      // Clean URL then open modal
      window.history.replaceState({}, "", "/");
      setTimeout(() => openLoginModal(), 100);
    }
  }, [searchParams, openLoginModal]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#fafafa] dark:bg-[#0A0A0A]">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden relative">
        {/* Floating top-right: only show login when NOT logged in */}
        {mounted && !user && (
          <div className={cn("absolute top-3 right-5 z-30 flex items-center gap-2.5", pathname === "/referral" && "hidden")}>
            <motion.div
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              onClick={openLoginModal}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-medium shadow-sm cursor-pointer hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors"
            >
              <User size={13} />
              <span>登录 / 注册</span>
            </motion.div>
          </div>
        )}
        <NotificationBanner />
        <AnimatePresence mode="wait">
          <motion.main
            key={pathname}
            variants={pageVariants}
            initial="initial"
            animate="enter"
            exit="exit"
            className="flex-1 overflow-y-auto pb-16 md:pb-0"
          >
            {children}
          </motion.main>
        </AnimatePresence>
        <AnimatePresence>
          {needAuth && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 dark:bg-black/70 backdrop-blur-sm"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ type: "spring", stiffness: 400, damping: 28 }}
                className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white dark:bg-neutral-900 shadow-xl border border-neutral-200/50 dark:border-neutral-800/50"
              >
                <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                  <Lock size={20} className="text-neutral-500" />
                </div>
                <p className="text-neutral-700 dark:text-neutral-300 text-sm font-medium">
                  请登录后使用此功能
                </p>
                <motion.button
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={openLoginModal}
                  className="px-6 py-2.5 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium shadow-sm hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors"
                >
                  登录 / 注册
                </motion.button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-lg border-t border-neutral-200/40 dark:border-neutral-800/40 flex items-center justify-around px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        {mobileNavItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="relative flex flex-col items-center gap-0.5 py-1.5 px-4">
              {active && (
                <motion.div
                  layoutId="mobile-nav-active"
                  className="absolute -top-0.5 w-5 h-[3px] rounded-full bg-neutral-900"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <Icon size={20} strokeWidth={active ? 2 : 1.5} className={cn("transition-colors", active ? "text-neutral-900" : "text-neutral-400")} />
              <span className={cn("text-[10px] transition-colors", active ? "text-neutral-900 font-medium" : "text-neutral-400")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
      <LoginModal />
    </div>
  );
}
