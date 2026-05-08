"use client";

import { motion, type Variants, useDragControls } from "framer-motion";
import { cn } from "@/lib/style-composer";
import { useRef, useState } from "react";
import Win95Icon from "./Win95Icon";

interface Win95WindowProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
  onClose?: () => void;
  active?: boolean;
  style?: React.CSSProperties;
  variants?: Variants;
  initial?: string;
  animate?: string;
  exit?: string;
  icon?: React.ReactNode;
  /** Extra buttons rendered right of title text, left of controls */
  toolbar?: React.ReactNode;
  /** Optional menu bar — only rendered when explicitly provided. */
  menuBar?: React.ReactNode;
  onClick?: () => void;
  /** Callback when window is dragged */
  onDragStart?: () => void;
  /** Callback when drag ends */
  onDragEnd?: (e: any, info: any) => void;
  /** Callback when minimize button is clicked */
  onMinimize?: () => void;
  /** Callback when resizing */
  onResize?: (width: number, height: number) => void;
  /** Viewport constraints */
  dragConstraints?: React.RefObject<HTMLDivElement>;
  /** Disable drag interaction (topology normalization) */
  disableDrag?: boolean;
  /** Hide minimize button (common for dialogs) */
  hideMinimize?: boolean;
  /** Hide maximize button (common for dialogs) */
  hideMaximize?: boolean;
  /** Whether the window is currently maximized */
  isMaximized?: boolean;
  /** Callback when maximize button or title bar is double-clicked */
  onMaximize?: () => void;
  /** Explicit X position */
  x?: number | string;
  /** Explicit Y position */
  y?: number | string;
}

/* Win95 window restoration materiality — Weighted & Emergent */
const windowVariants: Variants = {
  hidden: { 
    opacity: 0,
    scale: 0.995,
    filter: "brightness(0.8) contrast(1.2)",
  },
  visible: {
    opacity: 1,
    scale: 1,
    filter: [
      "brightness(1.5) contrast(1.5)", // Momentary phosphor flare
      "brightness(1) contrast(1)"
    ],
    transition: { 
      duration: 0.15, // Weighted entry
      ease: [0.2, 0, 0, 1], 
      filter: { duration: 0.1, times: [0, 1] }
    },
  },
  exit: {
    opacity: 0,
    scale: 0.995,
    filter: "brightness(0.9)",
    transition: { duration: 0.08, ease: "linear" },
  },
};

export default function Win95Window({
  title,
  children,
  className,
  contentClassName,
  contentStyle,
  onClose,
  active = true,
  style,
  variants: customVariants,
  initial = "hidden",
  animate = "visible",
  exit = "exit",
  icon,
  toolbar,
  menuBar,
  onClick,
  onDragStart,
  onDragEnd,
  onMinimize,
  onResize,
  dragConstraints,
  disableDrag = false,
  hideMinimize = false,
  hideMaximize = false,
  isMaximized = false,
  onMaximize,
  x,
  y,
}: Win95WindowProps) {
  const dragControls = useDragControls();
  const windowRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <motion.div
      ref={windowRef}
      onClick={onClick}
      drag={!disableDrag}
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      dragConstraints={dragConstraints}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      animate={animate === "visible" ? { 
        x: x ?? 0, 
        y: y ?? 0,
        scale: 1,
        opacity: 1,
        transition: { duration: 0 }
      } : animate}
      exit={exit}
      className={cn("flex flex-col", className)}
      style={{
        background: "var(--win-face)",
        pointerEvents: "auto",
        boxShadow: "var(--bevel-raised)",
        border: "1px solid var(--win-dk-shadow)",
        ...style,
      }}
      variants={customVariants ?? windowVariants}
      initial={initial}
    >
      {/* Title Bar — Solid Navy in Win95 */}
      <div
        className={cn(
          "flex items-center gap-1 px-2 select-none",
          active ? "bg-[var(--win-title-active)] text-[var(--win-title-text)]" : "bg-[var(--win-title-inactive)] text-[var(--win-title-text-inactive)]"
        )}
        style={{
          height: "var(--win-titlebar-height)",
          minHeight: "var(--win-titlebar-height)",
          fontFamily: "var(--font-shell)",
          cursor: !disableDrag ? (isDragging ? "var(--win-cursor-move)" : "var(--win-cursor-auto)") : "var(--win-cursor-auto)",
          touchAction: "none", // Prevent browser-native touch gestures (scroll/zoom) during drag
        }}
        onPointerDown={(e) => { 
          if (!disableDrag && !isMaximized) {
            setIsDragging(true); 
            dragControls.start(e); 
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!hideMaximize) onMaximize?.();
        }}
        onPointerUp={() => setIsDragging(false)}
        onPointerLeave={() => setIsDragging(false)}
      >
        {/* Icon — Win95 pixel-art icon in title bar */}
        {icon && typeof icon === "string" && (
          <Win95Icon icon={icon} size={16} className="mr-1" />
        )}
        {icon && typeof icon !== "string" && (
          <span className="mr-1 flex-shrink-0">{icon}</span>
        )}

        {/* Title text */}
        <span
          className="flex-1 truncate font-bold"
          style={{ fontSize: "var(--win-titlebar-font-size)" }}
        >
          {title}
        </span>

        {/* Optional toolbar items */}
        {toolbar && <div className="flex items-center gap-1 mr-1">{toolbar}</div>}

        {/* Window controls — Using enlarged touch hitboxes for mobile survivability */}
        <div className="flex items-center gap-[2px] ml-1">
          {/* Minimize */}
          {!hideMinimize && (
            <div className="relative group/btn">
              <button
                className="win-ctrl-btn"
                aria-label="Minimize"
                tabIndex={-1}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onMinimize?.();
                }}
              >
                <span style={{ marginBottom: "-4px", display: "block", height: "2px", width: "7px", background: "currentColor" }} />
              </button>
              {/* Invisible touch hitbox enlargement */}
              <div className="absolute inset-[-4px] md:hidden" 
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onMinimize?.(); }} 
              />
            </div>
          )}

          {/* Maximize / Restore */}
          {!hideMaximize && (
            <div className="relative group/btn">
              <button
                className="win-ctrl-btn"
                aria-label={isMaximized ? "Restore" : "Maximize"}
                tabIndex={-1}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onMaximize?.();
                }}
              >
                {isMaximized ? (
                  /* Restore icon (two overlapping boxes) */
                  <div className="relative w-[9px] h-[9px] flex items-center justify-center">
                    <span style={{ position: "absolute", top: 0, right: 0, display: "block", width: "6px", height: "6px", border: "1.5px solid currentColor", borderTopWidth: "2px" }} />
                    <span style={{ position: "absolute", bottom: 0, left: 0, display: "block", width: "6px", height: "6px", border: "1.5px solid currentColor", borderTopWidth: "2px", background: "var(--win-face)" }} />
                  </div>
                ) : (
                  /* Maximize icon (single box) */
                  <span style={{ display: "block", width: "7px", height: "7px", border: "1.5px solid currentColor", borderTopWidth: "2px" }} />
                )}
              </button>
              <div className="absolute inset-[-4px] md:hidden" 
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onMaximize?.(); }} 
              />
            </div>
          )}

          {/* Close */}
          <div className="relative group/btn">
            <button
              className="win-ctrl-btn"
              aria-label="Close"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onClose?.(); }}
              tabIndex={-1}
            >
              <svg width="7" height="7" viewBox="0 0 7 7" style={{ display: "block", shapeRendering: "crispEdges" }}>
                <line x1="0" y1="0" x2="7" y2="7" stroke="currentColor" strokeWidth="1.5" />
                <line x1="7" y1="0" x2="0" y2="7" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            <div className="absolute inset-[-4px] md:hidden" 
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onClose?.(); }} 
            />
          </div>
        </div>
      </div>

      {/* Menu Bar — Win95 style */}
      {menuBar && (
        <div className="flex px-1 py-[2px] gap-2 border-b border-[var(--win-shadow)] shadow-[inset_0_-1px_0_white]">
          {menuBar}
        </div>
      )}

      {/* Content */}
      <div className={cn("flex-1 flex flex-col overflow-hidden relative", contentClassName)} style={contentStyle}>
        {children}
      </div>

      {/* Resize Handle — Win95 canonical 3×3 dot grip pattern */}
      {onResize && !isMaximized && (
        <motion.div
          className="absolute bottom-[1px] right-[1px] w-[14px] h-[14px] cursor-nwse-resize z-50"
          drag
          dragConstraints={{ top: 0, left: 0, right: 0, bottom: 0 }}
          dragElastic={0}
          dragMomentum={false}
          onDragStart={() => onClick?.()}
          onDrag={(_, info) => {
            if (windowRef.current) {
              const rect = windowRef.current.getBoundingClientRect();
              onResize?.(
                Math.max(300, rect.width + info.delta.x),
                Math.max(200, rect.height + info.delta.y)
              );
            }
          }}
          style={{ touchAction: "none" }}
        >
          {/* Win95 resize grip: 3 diagonal rows of paired highlight+shadow dots */}
          <svg width="14" height="14" viewBox="0 0 14 14" style={{ display: "block", imageRendering: "pixelated" }}>
            {/* Row 1 — bottom-right corner dot */}
            <rect x="10" y="10" width="2" height="2" fill="var(--win-highlight)" />
            <rect x="11" y="11" width="2" height="2" fill="var(--win-shadow)" />
            {/* Row 2 — middle dot */}
            <rect x="6"  y="10" width="2" height="2" fill="var(--win-highlight)" />
            <rect x="7"  y="11" width="2" height="2" fill="var(--win-shadow)" />
            <rect x="10" y="6"  width="2" height="2" fill="var(--win-highlight)" />
            <rect x="11" y="7"  width="2" height="2" fill="var(--win-shadow)" />
            {/* Row 3 — outermost dots */}
            <rect x="2"  y="10" width="2" height="2" fill="var(--win-highlight)" />
            <rect x="3"  y="11" width="2" height="2" fill="var(--win-shadow)" />
            <rect x="6"  y="6"  width="2" height="2" fill="var(--win-highlight)" />
            <rect x="7"  y="7"  width="2" height="2" fill="var(--win-shadow)" />
            <rect x="10" y="2"  width="2" height="2" fill="var(--win-highlight)" />
            <rect x="11" y="3"  width="2" height="2" fill="var(--win-shadow)" />
          </svg>
        </motion.div>
      )}
    </motion.div>
  );
}

/* ─── Sub-components ─── */

export function Win95MenuBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center px-1 border-b select-none"
      style={{
        height: "20px",
        background: "var(--win-face)",
        borderBottomColor: "var(--win-shadow)",
        fontFamily: "var(--font-shell)",
        fontSize: "var(--win-font-size)",
      }}
    >
      {children}
    </div>
  );
}

export function Win95MenuItem({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      className={cn(
        "h-full px-2 hover:bg-[var(--win-select-bg)] hover:text-[var(--win-select-text)] border-0",
        active && "bg-[var(--win-select-bg)] text-[var(--win-select-text)]"
      )}
      style={{ fontSize: "var(--win-font-size)", background: "transparent" }}
    >
      {children}
    </button>
  );
}

export function Win95StatusBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center px-2 gap-2 border-t select-none"
      style={{
        height: "22px",
        background: "var(--win-face)",
        borderTopColor: "var(--win-shadow)",
        fontFamily: "var(--font-shell)",
        fontSize: "var(--win-font-size)",
      }}
    >
      {children}
    </div>
  );
}

export function Win95StatusPanel({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn("px-2 flex items-center", className)}
      style={{
        boxShadow: "var(--bevel-sunken)",
        height: "18px",
        fontFamily: "var(--font-shell)",
        fontSize: "var(--win-font-size)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
