"use client";

import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let globalId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++globalId;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const icons = {
    success: <CheckCircle size={16} className="text-emerald-500 shrink-0" />,
    error: <AlertCircle size={16} className="text-red-500 shrink-0" />,
    info: <Info size={16} className="text-blue-500 shrink-0" />,
  };

  const bgColors = {
    success: "bg-emerald-50 dark:bg-emerald-950/80 border-emerald-200/60 dark:border-emerald-800/60",
    error: "bg-red-50 dark:bg-red-950/80 border-red-200/60 dark:border-red-800/60",
    info: "bg-blue-50 dark:bg-blue-950/80 border-blue-200/60 dark:border-blue-800/60",
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm min-w-[260px] max-w-[380px]",
                bgColors[t.type]
              )}
            >
              {icons[t.type]}
              <span className="flex-1 text-sm text-neutral-800 dark:text-neutral-200">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="shrink-0 p-0.5 rounded hover:bg-black/5 transition-colors"
              >
                <X size={14} className="text-neutral-400" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
