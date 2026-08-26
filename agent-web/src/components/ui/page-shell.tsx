"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useSiteConfigStore } from "@/store/site-config";

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, icon, actions, className }: PageHeaderProps) {
  const siteName = useSiteConfigStore((s) => s.config.site_name);

  useEffect(() => {
    document.title = `${title} | ${siteName || "Zihui AI"}`;
    return () => { document.title = siteName || "Zihui AI - 智能创作平台"; };
  }, [title, siteName]);

  return (
    <div className={cn("px-6 py-4 border-b border-neutral-100 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center shrink-0">
              {icon}
            </div>
          )}
          <div>
            <h1 className="text-base font-semibold text-neutral-900">{title}</h1>
            {description && <p className="text-xs text-neutral-400 mt-0.5">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function PageContainer({ children, className, wide = false }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cn("h-full flex flex-col bg-[#fafafa] dark:bg-[#0A0A0A]", className)}>
      {children}
    </div>
  );
}

export function PageContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex-1 overflow-y-auto p-6", className)}>
      {children}
    </div>
  );
}

export function Card({ children, className, hover = true }: { children: React.ReactNode; className?: string; hover?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white/80 dark:bg-neutral-900/80 border border-neutral-200/60 dark:border-neutral-800/60 shadow-sm",
        hover && "hover:shadow-md hover:border-neutral-200 transition-all",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-lg font-bold text-neutral-900 mb-4", className)}>{children}</h2>
  );
}

export function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center justify-center py-20 text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-sm font-medium text-neutral-600 mb-1">{title}</h3>
      {description && <p className="text-xs text-neutral-400 max-w-xs">{description}</p>}
    </motion.div>
  );
}

/* ═══ ToolPageShell — unified wrapper for all tool pages ═══ */
interface ToolPageShellProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  backHref?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  loading?: boolean;
}

export function ToolPageShell({ title, description, icon, backHref, actions, children, className, loading }: ToolPageShellProps) {
  return (
    <PageContainer>
      <PageHeader
        title={title}
        description={description}
        icon={icon}
        actions={
          <div className="flex items-center gap-2">
            {backHref && (
              <Link href={backHref}>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  <ArrowLeft size={18} />
                </motion.button>
              </Link>
            )}
            {actions}
          </div>
        }
      />
      <PageContent className={className}>
        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={24} className="text-neutral-300 animate-spin" />
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        )}
      </PageContent>
    </PageContainer>
  );
}

/* ═══ Badge ═══ */
export function Badge({ children, variant = "default", className }: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error" | "info";
  className?: string;
}) {
  const variants = {
    default: "bg-neutral-100 text-neutral-600",
    success: "bg-emerald-50 text-emerald-600",
    warning: "bg-amber-50 text-amber-600",
    error: "bg-red-50 text-red-600",
    info: "bg-blue-50 text-blue-600",
  };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium", variants[variant], className)}>
      {children}
    </span>
  );
}

/* ═══ IconButton ═══ */
export function IconButton({ icon, onClick, className, title, disabled, size = "md" }: {
  icon: React.ReactNode;
  onClick?: () => void;
  className?: string;
  title?: string;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "p-1", md: "p-1.5", lg: "p-2" };
  return (
    <motion.button
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "rounded-lg hover:bg-neutral-100 text-neutral-400 hover:text-neutral-600 transition-colors",
        sizes[size],
        disabled && "opacity-40 pointer-events-none",
        className
      )}
    >
      {icon}
    </motion.button>
  );
}

/* ═══ StatusIndicator ═══ */
export function StatusIndicator({ status, label }: {
  status: "idle" | "loading" | "success" | "error";
  label?: string;
}) {
  const colors = { idle: "bg-neutral-300", loading: "bg-amber-400 animate-pulse", success: "bg-emerald-400", error: "bg-red-400" };
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("w-2 h-2 rounded-full", colors[status])} />
      {label && <span className="text-xs text-neutral-500">{label}</span>}
    </div>
  );
}

/* ═══ Motion helpers for page content ═══ */
export const fadeInUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
};

export const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

export const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};
