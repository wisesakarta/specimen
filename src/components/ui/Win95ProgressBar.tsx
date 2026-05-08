"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/style-composer";

interface Win95ProgressBarProps {
  progress?: number; // 0-100
  indeterminate?: boolean;
  className?: string;
  height?: number | string;
}

/**
 * Win95ProgressBar — The "Tiled" Segmented Progress Bar
 * 
 * Consistent across the entire Specimen OS.
 * Grounded in Environmental Materiality with a subtle dither overlay.
 */
export default function Win95ProgressBar({
  progress = 0,
  indeterminate = false,
  className,
  height = 16,
}: Win95ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, progress));

  return (
    <div 
      className={cn(
        "relative bg-[var(--win-face)] p-[1px] overflow-hidden select-none",
        className
      )}
      style={{ 
        height,
        boxShadow: "var(--bevel-sunken)",
      }}
    >
      {/* The Track Background — Pure white in standard Win95 dialogs, 
          but often grey in boot screens. We'll use a slightly muted white. */}
      <div className="absolute inset-0 bg-[rgba(255,255,255,0.05)]" />

      {/* The Segmented Fill */}
      {indeterminate ? (
        <div className="win-progress-fill win-progress-fill-indeterminate" />
      ) : (
        <motion.div 
          className="win-progress-fill"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.2, ease: "linear" }}
        />
      )}

      {/* Atmospheric Dither Overlay — To win Awwwards Site of the Year */}
      <div className="absolute inset-0 win-dither pointer-events-none opacity-[0.08]" />
    </div>
  );
}
