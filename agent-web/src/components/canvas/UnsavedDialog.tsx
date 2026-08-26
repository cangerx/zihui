"use client";

import { motion } from "framer-motion";
import { Save, ArrowRight, X } from "lucide-react";

export interface UnsavedDialogProps {
  onSaveAndLeave: () => void;
  onLeaveWithoutSave: () => void;
  onContinueEdit: () => void;
}

export default function UnsavedDialog({
  onSaveAndLeave,
  onLeaveWithoutSave,
  onContinueEdit,
}: UnsavedDialogProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onContinueEdit}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: "spring", duration: 0.3 }}
        className="relative bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl w-[400px] max-w-[90vw] p-8 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onContinueEdit}
          className="absolute top-4 right-4 p-1 rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        >
          <X size={18} />
        </button>

        {/* Icon */}
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/40 flex items-center justify-center">
          <Save size={28} className="text-amber-500" />
        </div>

        {/* Title */}
        <h3 className="text-lg font-semibold text-neutral-900 dark:text-white mb-2">
          内容未保存
        </h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">
          您有未保存的修改，离开前是否要保存当前内容？
        </p>

        {/* Buttons */}
        <button
          onClick={onSaveAndLeave}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-sm font-medium hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors mb-3"
        >
          <Save size={16} />
          保存并离开
        </button>

        <button
          onClick={onLeaveWithoutSave}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors mb-3"
        >
          <ArrowRight size={16} />
          不保存，直接离开
        </button>

        <button
          onClick={onContinueEdit}
          className="text-sm text-neutral-400 hover:text-violet-500 transition-colors"
        >
          继续编辑
        </button>
      </motion.div>
    </motion.div>
  );
}
