import { useCallback, useEffect, useRef, useState } from "react";
import { generationAPI } from "@/lib/api";

interface Generation {
  id: number;
  status: string;
  result_url?: string;
  thumb_url?: string;
  error_msg?: string;
}

interface UsePollGenerationReturn {
  result: Generation | null;
  polling: boolean;
  error: string | null;
  startPolling: (genId: number) => void;
  stopPolling: () => void;
  reset: () => void;
}

export function usePollGeneration(intervalMs = 3000): UsePollGenerationReturn {
  const [result, setResult] = useState<Generation | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPolling(false);
  }, []);

  const startPolling = useCallback(
    (genId: number) => {
      stopPolling();
      setPolling(true);
      setError(null);

      timerRef.current = setInterval(async () => {
        try {
          const res = await generationAPI.get(genId);
          const gen = res.data?.data;
          if (!gen) return;

          if (gen.status === "completed") {
            setResult(gen);
            stopPolling();
          } else if (gen.status === "failed") {
            setResult(gen);
            setError(gen.error_msg || "生成失败");
            stopPolling();
          } else {
            setResult(gen);
          }
        } catch {
          // ignore transient errors
        }
      }, intervalMs);
    },
    [intervalMs, stopPolling],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setResult(null);
    setError(null);
  }, [stopPolling]);

  return { result, polling, error, startPolling, stopPolling, reset };
}
