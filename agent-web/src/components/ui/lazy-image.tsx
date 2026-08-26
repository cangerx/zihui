"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ImageOff, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface LazyImageProps {
  src: string;
  thumbSrc?: string;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  onClick?: () => void;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  draggable?: boolean;
  style?: React.CSSProperties;
}

export default function LazyImage({
  src,
  thumbSrc,
  alt = "",
  className,
  fallbackClassName,
  onClick,
  onLoad,
  draggable = false,
  style,
}: LazyImageProps) {
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver for lazy loading
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reset state when src changes
  useEffect(() => {
    setLoaded(false);
    setError(false);
    setRetryCount(0);
  }, [src]);

  const handleLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      setLoaded(true);
      setError(false);
      onLoad?.(e);
    },
    [onLoad]
  );

  const handleError = useCallback(() => {
    if (retryCount < 1) {
      // Auto retry once
      setRetryCount((c) => c + 1);
    } else {
      setError(true);
    }
  }, [retryCount]);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoaded(false);
    setRetryCount(0);
  }, []);

  const effectiveSrc = thumbSrc || src;
  const imgSrc = retryCount > 0 && effectiveSrc ? `${effectiveSrc}${effectiveSrc.includes("?") ? "&" : "?"}retry=${retryCount}` : effectiveSrc;

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden", className)} onClick={onClick} style={style}>
      {/* Skeleton shimmer — visible while loading */}
      {!loaded && !error && (
        <div className="absolute inset-0 bg-neutral-200/40 dark:bg-neutral-800/40">
          <div className="absolute inset-0 animate-shimmer" />
        </div>
      )}

      {/* Error fallback */}
      {error && (
        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-neutral-100 dark:bg-neutral-900 cursor-pointer",
            fallbackClassName
          )}
          onClick={(e) => {
            e.stopPropagation();
            handleRetry();
          }}
        >
          <ImageOff size={20} className="text-neutral-300 dark:text-neutral-600" />
          <span className="text-[10px] text-neutral-400">加载失败</span>
          <span className="text-[10px] text-neutral-400 flex items-center gap-0.5">
            <RotateCcw size={10} /> 点击重试
          </span>
        </div>
      )}

      {/* Actual image — only rendered when in viewport */}
      {inView && src && !error && (
        <img
          src={imgSrc}
          alt={alt}
          decoding="async"
          className={cn(
            "w-full h-full object-cover transition-all duration-500 ease-out",
            loaded ? "opacity-100 scale-100" : "opacity-0 scale-[1.02]"
          )}
          onLoad={handleLoad}
          onError={handleError}
          draggable={draggable}
        />
      )}
    </div>
  );
}
