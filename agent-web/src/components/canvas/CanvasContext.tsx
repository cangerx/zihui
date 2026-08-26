"use client";

import { createContext, useContext } from "react";

export interface CanvasCallbacks {
  onReGenerate: (prompt: string) => void;
  onEdit: (prompt: string) => void;
  onDelete: (id: string) => void;
  onRetry?: (nodeId: string) => void;
  onInpaint?: (nodeId: string, src: string) => void;
  onResize?: (nodeId: string, src: string) => void;
  onQuickEdit?: (nodeId: string, action: string) => void;
  onDuplicate?: (nodeId: string) => void;
}

const CanvasContext = createContext<CanvasCallbacks>({
  onReGenerate: () => {},
  onEdit: () => {},
  onDelete: () => {},
});

export const CanvasProvider = CanvasContext.Provider;
export const useCanvasCallbacks = () => useContext(CanvasContext);
