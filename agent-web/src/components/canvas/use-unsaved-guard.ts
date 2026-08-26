"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface UseUnsavedGuardOptions {
  dirty: boolean;
  onSave?: () => void | Promise<void>;
}

export function useUnsavedGuard({ dirty, onSave }: UseUnsavedGuardOptions) {
  const [showDialog, setShowDialog] = useState(false);
  const pendingNavRef = useRef<string | null>(null);
  const confirmedRef = useRef(false);

  // Browser close / refresh
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty && !confirmedRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Intercept client-side navigation (pushState / popstate)
  useEffect(() => {
    if (!dirty) return;

    const origPushState = history.pushState.bind(history);
    const origReplaceState = history.replaceState.bind(history);

    const interceptPush = (data: any, unused: string, url?: string | URL | null) => {
      if (confirmedRef.current) {
        origPushState(data, unused, url);
        return;
      }
      pendingNavRef.current = url?.toString() || null;
      setTimeout(() => setShowDialog(true), 0);
    };

    history.pushState = interceptPush as typeof history.pushState;

    const handlePopState = (e: PopStateEvent) => {
      if (confirmedRef.current) return;
      // Push current state back to prevent navigation
      history.pushState(null, "", window.location.href);
      pendingNavRef.current = null; // popstate — unknown destination
      setTimeout(() => setShowDialog(true), 0);
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      history.pushState = origPushState;
      window.removeEventListener("popstate", handlePopState);
    };
  }, [dirty]);

  const handleSaveAndLeave = useCallback(async () => {
    try {
      if (onSave) await onSave();
    } catch {}
    confirmedRef.current = true;
    setShowDialog(false);
    if (pendingNavRef.current) {
      window.location.href = pendingNavRef.current;
    } else {
      history.back();
    }
  }, [onSave]);

  const handleLeaveWithoutSave = useCallback(() => {
    confirmedRef.current = true;
    setShowDialog(false);
    if (pendingNavRef.current) {
      window.location.href = pendingNavRef.current;
    } else {
      history.back();
    }
  }, []);

  const handleContinueEdit = useCallback(() => {
    pendingNavRef.current = null;
    setShowDialog(false);
  }, []);

  return {
    showDialog,
    handleSaveAndLeave,
    handleLeaveWithoutSave,
    handleContinueEdit,
  };
}
