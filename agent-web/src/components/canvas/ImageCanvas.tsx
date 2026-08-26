"use client";

import { useMemo, useEffect, useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Image as ImageIcon,
  Undo2,
  Redo2,
  Maximize,
  MousePointerSquareDashed,
  Trash2,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ImageNodeComponent from "./ImageNode";
import ContextMenu from "./ContextMenu";
import { CanvasProvider, type CanvasCallbacks } from "./CanvasContext";
import type { useImageCanvas } from "./use-image-canvas";

type CanvasReturn = ReturnType<typeof useImageCanvas>;

export interface ImageCanvasProps {
  canvas: CanvasReturn;
  callbacks: CanvasCallbacks;
  emptyTitle?: string;
  emptyDesc?: string;
  emptyHints?: boolean;
}

const nodeTypes: NodeTypes = {
  image: ImageNodeComponent,
};

function CanvasToolbar({ canvas }: { canvas: CanvasReturn }) {
  const { fitView } = useReactFlow();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const hasNodes = mounted && canvas.nodeCount > 0;

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2, duration: 300 });
  }, [fitView]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); canvas.undo(); }
      if (mod && e.key === "z" && e.shiftKey) { e.preventDefault(); canvas.redo(); }
      if (mod && e.key === "y") { e.preventDefault(); canvas.redo(); }
      if (mod && e.key === "a") { e.preventDefault(); canvas.selectAll(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canvas]);

  return (
    <Panel position="bottom-center" className="!mb-3">
      <div className="flex items-center gap-0.5 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl rounded-xl shadow-lg border border-neutral-200/60 dark:border-neutral-700/60 px-1.5 py-1">
        <button
          onClick={canvas.undo}
          disabled={!canvas.canUndo}
          className={cn("p-1.5 rounded-lg transition-colors", canvas.canUndo ? "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800" : "text-neutral-300 dark:text-neutral-600 cursor-not-allowed")}
          title="撤销 (⌘Z)"
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={canvas.redo}
          disabled={!canvas.canRedo}
          className={cn("p-1.5 rounded-lg transition-colors", canvas.canRedo ? "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800" : "text-neutral-300 dark:text-neutral-600 cursor-not-allowed")}
          title="重做 (⌘⇧Z)"
        >
          <Redo2 size={14} />
        </button>
        <div className="w-px h-4 bg-neutral-200/60 dark:bg-neutral-700/60 mx-0.5" />
        <button
          onClick={handleFitView}
          disabled={!hasNodes}
          className={cn("p-1.5 rounded-lg transition-colors", hasNodes ? "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800" : "text-neutral-300 dark:text-neutral-600 cursor-not-allowed")}
          title="适配视图"
        >
          <Maximize size={14} />
        </button>
        <button
          onClick={canvas.selectAll}
          disabled={!hasNodes}
          className={cn("p-1.5 rounded-lg transition-colors", hasNodes ? "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800" : "text-neutral-300 dark:text-neutral-600 cursor-not-allowed")}
          title="全选 (⌘A)"
        >
          <MousePointerSquareDashed size={14} />
        </button>
        <div className="w-px h-4 bg-neutral-200/60 dark:bg-neutral-700/60 mx-0.5" />
        <button
          onClick={() => { if (hasNodes && confirm("确定清空画布？")) canvas.clearAll(); }}
          disabled={!hasNodes}
          className={cn("p-1.5 rounded-lg transition-colors", hasNodes ? "text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" : "text-neutral-300 dark:text-neutral-600 cursor-not-allowed")}
          title="清空画布"
        >
          <Trash2 size={14} />
        </button>
        {hasNodes && (
          <>
            <div className="w-px h-4 bg-neutral-200/60 dark:bg-neutral-700/60 mx-0.5" />
            <span className="flex items-center gap-1 px-1.5 text-[10px] text-neutral-400">
              <Layers size={11} /> {canvas.nodeCount}
            </span>
          </>
        )}
      </div>
    </Panel>
  );
}

export default function ImageCanvas({
  canvas,
  callbacks,
  emptyTitle = "无限画板",
  emptyDesc = "输入描述生成图片，拖拽排列，二次编辑",
  emptyHints = true,
}: ImageCanvasProps) {
  const {
    nodes,
    onNodesChange,
    ctxMenu,
    onNodeContextMenu,
    onPaneClick,
    closeCtxMenu,
  } = canvas;

  const callbacksMemo = useMemo(() => callbacks, [callbacks]);

  return (
    <CanvasProvider value={callbacksMemo}>
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView={canvas.initialNodeCount > 0}
        minZoom={0.05}
        maxZoom={3}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        snapToGrid
        snapGrid={[20, 20]}
        className="bg-[#f0f0f0] dark:bg-[#111111]"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#d1d5db" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
          className="!bg-white/90 dark:!bg-neutral-900/90 !border-neutral-200/60 dark:!border-neutral-700/60 !rounded-xl !shadow-sm"
        />
        <CanvasToolbar canvas={canvas} />
        {nodes.length === 0 && (
          <Panel position="top-center" className="!pointer-events-none !top-1/2 !-translate-y-1/2">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/80 dark:bg-neutral-800/80 border border-neutral-200/60 dark:border-neutral-700/60 flex items-center justify-center mx-auto mb-4 shadow-sm">
                <ImageIcon size={28} className="text-neutral-300" />
              </div>
              <p className="text-sm text-neutral-400 font-medium">{emptyTitle}</p>
              <p className="text-xs text-neutral-300 mt-1">{emptyDesc}</p>
              {emptyHints && (
                <p className="text-[11px] text-neutral-300 mt-3">
                  <span className="px-1.5 py-0.5 bg-white dark:bg-neutral-800 rounded text-neutral-400 border border-neutral-200/60 dark:border-neutral-700/60 text-[10px]">滚轮</span> 缩放
                  <span className="mx-2">·</span>
                  <span className="px-1.5 py-0.5 bg-white dark:bg-neutral-800 rounded text-neutral-400 border border-neutral-200/60 dark:border-neutral-700/60 text-[10px]">拖拽</span> 平移
                  <span className="mx-2">·</span>
                  <span className="px-1.5 py-0.5 bg-white dark:bg-neutral-800 rounded text-neutral-400 border border-neutral-200/60 dark:border-neutral-700/60 text-[10px]">⌘Z</span> 撤销
                </p>
              )}
            </div>
          </Panel>
        )}
      </ReactFlow>
      {ctxMenu && <ContextMenu {...ctxMenu} onClose={closeCtxMenu} />}
    </CanvasProvider>
  );
}
