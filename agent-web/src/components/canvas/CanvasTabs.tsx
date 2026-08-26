"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Save, Pencil, Trash2, MoreHorizontal, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanvasProjects, type CanvasProject } from "@/store/canvas-projects";

interface CanvasTabsProps {
  onSave: () => Promise<void>;
}

function TabItem({
  project,
  isActive,
  onSwitch,
  onClose,
  onRename,
  onSave,
}: {
  project: CanvasProject;
  isActive: boolean;
  onSwitch: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  onSave: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [showMenu, setShowMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) {
      setEditName(project.name);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, project.name]);

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMenu]);

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== project.name) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(); }
    finally { setSaving(false); setShowMenu(false); }
  };

  return (
    <div className="relative group flex items-center">
      <motion.div
        layout
        onClick={onSwitch}
        onDoubleClick={() => setEditing(true)}
        className={cn(
          "relative flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all select-none",
          isActive
            ? "bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-sm border border-neutral-200/60 dark:border-neutral-700/60"
            : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100/60 dark:hover:bg-neutral-800/40"
        )}
      >
        {/* Dirty indicator */}
        {project.dirty && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        )}

        {editing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-20 bg-transparent text-xs font-medium outline-none border-b border-neutral-300 dark:border-neutral-600 py-0"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="max-w-[100px] truncate">{project.name}</span>
        )}

        {/* Context menu trigger */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          className={cn(
            "p-0.5 rounded transition-colors shrink-0",
            isActive
              ? "hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-400"
              : "opacity-0 group-hover:opacity-100 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60 text-neutral-400"
          )}
        >
          <MoreHorizontal size={12} />
        </button>
      </motion.div>

      {/* Context menu */}
      <AnimatePresence>
        {showMenu && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-1 z-50 min-w-[140px] bg-white dark:bg-neutral-900 rounded-xl shadow-xl border border-neutral-200/60 dark:border-neutral-700/60 py-1 overflow-hidden"
          >
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(false); setEditing(true); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
            >
              <Pencil size={12} /> 重命名
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleSave(); }}
              disabled={saving}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? "保存中..." : "保存到云端"}
            </button>
            <div className="h-px bg-neutral-100 dark:bg-neutral-800 my-0.5" />
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(false); onClose(); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={12} /> 删除
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function CanvasTabs({ onSave }: CanvasTabsProps) {
  const { projects, activeKey, loaded, fetchList, createProject, renameProject, removeProject, switchTo, saveToServer } = useCanvasProjects();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loaded) fetchList();
  }, [loaded, fetchList]);

  const handleCreate = useCallback(() => {
    createProject();
    // Scroll to end
    setTimeout(() => {
      scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: "smooth" });
    }, 50);
  }, [createProject]);

  const handleClose = useCallback(async (localKey: string) => {
    const project = projects.find((p) => p.localKey === localKey);
    if (project?.dirty) {
      if (!confirm("此画布有未保存的更改，确定删除？")) return;
    }
    await removeProject(localKey);
  }, [projects, removeProject]);

  const handleSaveProject = useCallback(async () => {
    await onSave();
  }, [onSave]);

  // Keyboard shortcut: Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSaveProject();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSaveProject]);

  if (!loaded) return null;

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-neutral-50/80 dark:bg-neutral-900/80 border-b border-neutral-200/40 dark:border-neutral-800/40 backdrop-blur-sm">
      <div
        ref={scrollRef}
        className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1"
      >
        <AnimatePresence initial={false}>
          {projects.map((project) => (
            <TabItem
              key={project.localKey}
              project={project}
              isActive={project.localKey === activeKey}
              onSwitch={() => switchTo(project.localKey)}
              onClose={() => handleClose(project.localKey)}
              onRename={(name) => renameProject(project.localKey, name)}
              onSave={handleSaveProject}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* New canvas button */}
      <motion.button
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        onClick={handleCreate}
        className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
        title="新建画布"
      >
        <Plus size={14} />
      </motion.button>
    </div>
  );
}
