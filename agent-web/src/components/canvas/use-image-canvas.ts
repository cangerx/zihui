"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useNodesState, type Node } from "@xyflow/react";
import { generationAPI } from "@/lib/api";
import type { ImageNodeData } from "./ImageNode";
import type { ContextMenuProps } from "./ContextMenu";

export type ImageNode = Node<ImageNodeData, "image">;

export interface UseImageCanvasOptions {
  initialNodes?: ImageNode[];
  storageKey?: string;
}

const STORAGE_PREFIX = "canvas_nodes_";
const MAX_HISTORY = 30;

function loadFromStorage(key: string): ImageNode[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ImageNode[];
    return parsed.filter((n) => n.data?.status !== "pending" && n.data?.status !== "processing");
  } catch { return []; }
}

function saveToStorage(key: string, nodes: ImageNode[]) {
  try {
    const toSave = nodes
      .filter((n) => n.data?.status === "completed" || n.data?.status === "failed")
      .map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        style: n.style,
        data: n.data,
      }));
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(toSave));
  } catch {}
}

export function useImageCanvas(options?: UseImageCanvasOptions) {
  const storageKey = options?.storageKey || "default";
  const initialNodes = options?.initialNodes ?? loadFromStorage(storageKey);

  const [nodes, setNodes, onNodesChange] = useNodesState<ImageNode>(initialNodes);
  const pollRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const nextPos = useRef({ x: 50, y: 50 });
  const initialNodeCount = initialNodes.length;
  const prevKeyRef = useRef(storageKey);

  // Compute nextPos from initial nodes
  useEffect(() => {
    if (initialNodes.length > 0) {
      const maxY = Math.max(...initialNodes.map((n) => n.position.y + (n.data?.displayHeight || 300)));
      nextPos.current = { x: 50, y: maxY + 60 };
    }
  }, []);

  // React to storageKey changes (canvas tab switch)
  useEffect(() => {
    if (prevKeyRef.current === storageKey) return;
    prevKeyRef.current = storageKey;
    const loaded = loadFromStorage(storageKey);
    Object.values(pollRefs.current).forEach(clearInterval);
    pollRefs.current = {};
    setNodes(loaded);
    historyRef.current = [loaded];
    historyIndexRef.current = 0;
    setHistoryVersion((v) => v + 1);
    if (loaded.length > 0) {
      const maxY = Math.max(...loaded.map((n) => n.position.y + (n.data?.displayHeight || 300)));
      nextPos.current = { x: 50, y: maxY + 60 };
    } else {
      nextPos.current = { x: 50, y: 50 };
    }
  }, [storageKey, setNodes]);

  // ── Undo/Redo ──
  const historyRef = useRef<ImageNode[][]>([initialNodes]);
  const historyIndexRef = useRef(0);
  const skipSaveRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const pushHistory = useCallback((nds: ImageNode[]) => {
    if (skipSaveRef.current) { skipSaveRef.current = false; return; }
    const idx = historyIndexRef.current;
    const newHistory = historyRef.current.slice(0, idx + 1);
    newHistory.push(nds);
    if (newHistory.length > MAX_HISTORY) newHistory.shift();
    historyRef.current = newHistory;
    historyIndexRef.current = newHistory.length - 1;
    setHistoryVersion((v) => v + 1);
  }, []);

  // Persist to localStorage (debounced, separate from history)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveToStorage(storageKey, nodes);
    }, 400);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [nodes, storageKey]);

  // Push history on meaningful changes (separate, shorter debounce)
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (historyTimer.current) clearTimeout(historyTimer.current);
    historyTimer.current = setTimeout(() => {
      pushHistory(nodes);
    }, 150);
    return () => { if (historyTimer.current) clearTimeout(historyTimer.current); };
  }, [nodes, pushHistory]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    skipSaveRef.current = true;
    setNodes(historyRef.current[historyIndexRef.current]);
    setHistoryVersion((v) => v + 1);
  }, [setNodes]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    skipSaveRef.current = true;
    setNodes(historyRef.current[historyIndexRef.current]);
    setHistoryVersion((v) => v + 1);
  }, [setNodes]);

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;
  // Force re-read via historyVersion
  void historyVersion;

  // Cleanup polls on unmount
  useEffect(() => {
    return () => {
      Object.values(pollRefs.current).forEach(clearInterval);
    };
  }, []);

  // ── Context menu ──
  const [ctxMenu, setCtxMenu] = useState<Omit<ContextMenuProps, "onClose"> | null>(null);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: ImageNode) => {
    event.preventDefault();
    setCtxMenu({
      nodeId: node.id,
      src: node.data.src,
      prompt: node.data.prompt,
      status: node.data.status,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const onPaneClick = useCallback(() => setCtxMenu(null), []);
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // ── Poll generation status ──
  const pollGeneration = useCallback((nodeId: string, genId: number) => {
    if (pollRefs.current[nodeId]) clearInterval(pollRefs.current[nodeId]);
    pollRefs.current[nodeId] = setInterval(async () => {
      try {
        const res = await generationAPI.get(genId);
        const gen = res.data?.data;
        if (gen?.status === "completed" || gen?.status === "failed") {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: gen.status, src: gen.result_url || n.data.src, error: gen.error_msg } }
                : n
            )
          );
          clearInterval(pollRefs.current[nodeId]);
          delete pollRefs.current[nodeId];
        }
      } catch {}
    }, 3000);
  }, [setNodes]);

  // ── Add new image nodes ──
  const addImageNodes = useCallback((
    generations: any[],
    prompt: string,
    displayHeight: number = 300,
  ) => {
    const newNodes: ImageNode[] = generations.map((g: any, i: number) => {
      const id = `img-${Date.now()}-${i}`;
      return {
        id,
        type: "image" as const,
        position: { x: nextPos.current.x + i * 320, y: nextPos.current.y },
        data: {
          src: g?.result_url || "",
          status: g?.status || "pending",
          error: g?.error_msg,
          prompt,
          genId: g?.id,
          displayWidth: 300,
          displayHeight,
        },
      };
    });

    nextPos.current.y += displayHeight + 60;
    if (nextPos.current.y > 1200) {
      nextPos.current = { x: nextPos.current.x + 340, y: 50 };
    }

    setNodes((nds) => [...nds, ...newNodes]);

    newNodes.forEach((node) => {
      if (node.data.genId && node.data.status !== "completed") {
        pollGeneration(node.id, node.data.genId as number);
      }
    });

    return newNodes;
  }, [setNodes, pollGeneration]);

  // ── Load an existing image ──
  const loadImage = useCallback((url: string, prompt: string = "", displayHeight: number = 300) => {
    const id = `img-loaded-${Date.now()}`;
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "image" as const,
        position: { x: nextPos.current.x, y: nextPos.current.y },
        data: {
          src: url,
          status: "completed" as const,
          prompt,
          displayWidth: 300,
          displayHeight,
        },
      },
    ]);
    nextPos.current.y += displayHeight + 60;
    return id;
  }, [setNodes]);

  // ── Delete a node ──
  const deleteNode = useCallback((id: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== id));
    if (pollRefs.current[id]) {
      clearInterval(pollRefs.current[id]);
      delete pollRefs.current[id];
    }
  }, [setNodes]);

  // ── Select all ──
  const selectAll = useCallback(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
  }, [setNodes]);

  // ── Clear all ──
  const clearAll = useCallback(() => {
    Object.values(pollRefs.current).forEach(clearInterval);
    pollRefs.current = {};
    setNodes([]);
    nextPos.current = { x: 50, y: 50 };
  }, [setNodes]);

  // ── Duplicate node ──
  const duplicateNode = useCallback((id: string) => {
    setNodes((nds) => {
      const source = nds.find((n) => n.id === id);
      if (!source) return nds;
      const newId = `img-dup-${Date.now()}`;
      const clone: ImageNode = {
        ...source,
        id: newId,
        position: { x: source.position.x + 30, y: source.position.y + 30 },
        selected: false,
      };
      return [...nds, clone];
    });
  }, [setNodes]);

  // ── Update node data (for client-side edits like rotate/flip/crop) ──
  const updateNodeData = useCallback((id: string, patch: Partial<ImageNodeData>) => {
    setNodes((nds) =>
      nds.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)
    );
  }, [setNodes]);

  // ── Replace all nodes (for loading from server) ──
  const replaceNodes = useCallback((newNodes: ImageNode[]) => {
    Object.values(pollRefs.current).forEach(clearInterval);
    pollRefs.current = {};
    skipSaveRef.current = true;
    setNodes(newNodes);
    historyRef.current = [newNodes];
    historyIndexRef.current = 0;
    setHistoryVersion((v) => v + 1);
    if (newNodes.length > 0) {
      const maxY = Math.max(...newNodes.map((n) => n.position.y + (n.data?.displayHeight || 300)));
      nextPos.current = { x: 50, y: maxY + 60 };
    } else {
      nextPos.current = { x: 50, y: 50 };
    }
  }, [setNodes]);

  const nodeCount = nodes.length;

  return {
    nodes,
    setNodes,
    onNodesChange,
    addImageNodes,
    loadImage,
    deleteNode,
    pollGeneration,
    selectAll,
    clearAll,
    duplicateNode,
    updateNodeData,
    replaceNodes,
    undo,
    redo,
    canUndo,
    canRedo,
    ctxMenu,
    onNodeContextMenu,
    onPaneClick,
    closeCtxMenu,
    nodeCount,
    initialNodeCount,
    storageKey,
  };
}
