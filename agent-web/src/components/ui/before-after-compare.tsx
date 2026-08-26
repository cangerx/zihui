"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ChevronsLeftRight, ZoomIn, ZoomOut, Maximize } from "lucide-react";

interface BeforeAfterCompareProps {
  beforeSrc: string;
  afterSrc: string;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

export default function BeforeAfterCompare({
  beforeSrc,
  afterSrc,
  beforeLabel = "原图",
  afterLabel = "结果",
  className,
}: BeforeAfterCompareProps) {
  const [position, setPosition] = useState(50);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingSlider = useRef(false);
  const panning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const animating = useRef(false);

  const clampTranslate = useCallback((tx: number, ty: number, s: number) => {
    if (!containerRef.current || s <= 1) return { x: 0, y: 0 };
    const { offsetWidth: w, offsetHeight: h } = containerRef.current;
    const maxX = w * (s - 1) / 2;
    const maxY = h * (s - 1) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, tx)),
      y: Math.max(-maxY, Math.min(maxY, ty)),
    };
  }, []);

  const updatePosition = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPosition(pct);
  }, []);

  const handleSliderDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      draggingSlider.current = true;
      containerRef.current?.setPointerCapture(e.pointerId);
      updatePosition(e.clientX);
    },
    [updatePosition]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingSlider.current) {
        updatePosition(e.clientX);
        return;
      }
      if (panning.current && scale > 1) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        const clamped = clampTranslate(
          translateStart.current.x + dx,
          translateStart.current.y + dy,
          scale
        );
        setTranslate(clamped);
      }
    },
    [updatePosition, scale, clampTranslate]
  );

  const handlePointerUp = useCallback(() => {
    draggingSlider.current = false;
    panning.current = false;
  }, []);

  const handleImageDown = useCallback(
    (e: React.PointerEvent) => {
      if (scale <= 1) {
        draggingSlider.current = true;
        containerRef.current?.setPointerCapture(e.pointerId);
        updatePosition(e.clientX);
        return;
      }
      panning.current = true;
      containerRef.current?.setPointerCapture(e.pointerId);
      panStart.current = { x: e.clientX, y: e.clientY };
      translateStart.current = { ...translate };
    },
    [scale, translate, updatePosition]
  );

  const handleDoubleClick = useCallback(() => {
    animating.current = true;
    if (scale === 1) {
      setScale(2);
    } else {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    }
    setTimeout(() => { animating.current = false; }, 250);
  }, [scale]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setScale((s) => {
      const next = Math.max(1, Math.min(5, s + delta));
      if (next === 1) setTranslate({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const lastPinchDist = useRef(0);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (lastPinchDist.current > 0) {
        const diff = (dist - lastPinchDist.current) * 0.01;
        setScale((s) => {
          const next = Math.max(1, Math.min(5, s + diff));
          if (next === 1) setTranslate({ x: 0, y: 0 });
          return next;
        });
      }
      lastPinchDist.current = dist;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastPinchDist.current = 0;
  }, []);

  const resetZoom = () => {
    animating.current = true;
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setTimeout(() => { animating.current = false; }, 250);
  };

  const imgStyle: React.CSSProperties = {
    transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
    transition: animating.current ? "transform 0.25s ease-out" : "none",
  };

  return (
    <div className={cn("relative flex flex-col gap-2", className)}>
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1 bg-black/40 backdrop-blur-sm rounded-lg px-1.5 py-1">
        <button onClick={() => { animating.current = true; setScale((s) => Math.min(5, s + 0.5)); setTimeout(() => { animating.current = false; }, 250); }} className="p-1 text-white/80 hover:text-white transition-colors" title="放大">
          <ZoomIn size={14} />
        </button>
        <span className="text-[10px] text-white/70 min-w-[28px] text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => { animating.current = true; setScale((s) => { const n = Math.max(1, s - 0.5); if (n === 1) setTranslate({ x: 0, y: 0 }); return n; }); setTimeout(() => { animating.current = false; }, 250); }} className="p-1 text-white/80 hover:text-white transition-colors" title="缩小">
          <ZoomOut size={14} />
        </button>
        {scale > 1 && (
          <button onClick={resetZoom} className="p-1 text-white/80 hover:text-white transition-colors" title="重置">
            <Maximize size={14} />
          </button>
        )}
      </div>

      {/* Compare area */}
      <div
        ref={containerRef}
        className={cn(
          "relative select-none overflow-hidden rounded-xl shadow-lg flex-1 min-h-0 bg-neutral-100 dark:bg-neutral-900",
          scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-col-resize"
        )}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerDown={handleImageDown}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Invisible spacer */}
        <img src={afterSrc} alt="" className="w-full block invisible" draggable={false} />

        {/* After (bottom layer) */}
        <img src={afterSrc} alt={afterLabel} className="absolute inset-0 w-full h-full object-contain" style={imgStyle} draggable={false} />

        {/* Before (top layer, clipped from right) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        >
          <img
            src={beforeSrc}
            alt={beforeLabel}
            className="w-full h-full object-contain"
            style={imgStyle}
            draggable={false}
          />
        </div>

        {/* Divider line + handle */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.4)] z-10"
          style={{ left: `${position}%`, transform: "translateX(-50%)" }}
          onPointerDown={handleSliderDown}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center border border-neutral-200/60 cursor-col-resize hover:scale-110 transition-transform">
            <ChevronsLeftRight size={12} className="text-neutral-400" />
          </div>
        </div>

        {/* Labels */}
        <div className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-black/40 backdrop-blur-sm text-[11px] text-white font-medium z-10 pointer-events-none">
          {beforeLabel}
        </div>
        <div className="absolute bottom-3 right-3 px-2 py-0.5 rounded-md bg-black/40 backdrop-blur-sm text-[11px] text-white font-medium z-10 pointer-events-none">
          {afterLabel}
        </div>

        {/* Zoom badge */}
        {scale > 1 && (
          <div className="absolute bottom-3 left-3 px-2 py-0.5 rounded-md bg-black/40 backdrop-blur-sm text-[10px] text-white/70 z-10 pointer-events-none">
            {Math.round(scale * 100)}%
          </div>
        )}
      </div>

      {/* Hint */}
      {scale === 1 && (
        <p className="text-[10px] text-neutral-400 text-center">滚轮缩放 · 双击放大 · 拖拽对比</p>
      )}
    </div>
  );
}
