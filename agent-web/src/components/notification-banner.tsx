"use client";

import { useState, useEffect } from "react";
import { X, Bell } from "lucide-react";
import { notificationAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Notification {
  id: number;
  title: string;
  content: string;
  type: string;
  show_popup: boolean;
}

export default function NotificationBanner() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    notificationAPI.list().then((res) => {
      setNotifications(res.data.data || []);
    }).catch(() => {});
  }, []);

  const visible = notifications.filter((n) => !dismissed.has(n.id));
  if (visible.length === 0) return null;

  const current = visible[0];

  return (
    <div className={cn(
      "mx-4 mt-3 px-4 py-2.5 rounded-xl flex items-center gap-3 text-sm animate-in slide-in-from-top-2",
      current.type === "maintenance"
        ? "bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border border-amber-200/60 dark:border-amber-800/40"
        : "bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 border border-blue-200/60 dark:border-blue-800/40"
    )}>
      <Bell size={14} className="shrink-0" />
      <span className="flex-1">
        <strong className="font-medium">{current.title}</strong>
        {current.content && <span className="ml-2 text-xs opacity-75">{current.content}</span>}
      </span>
      <button
        onClick={() => setDismissed((s) => new Set([...s, current.id]))}
        className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
      >
        <X size={14} />
      </button>
    </div>
  );
}
