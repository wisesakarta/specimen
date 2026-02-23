"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export type NoticeType = "info" | "success" | "error" | "analyzing";

interface BrutalistNotificationProps {
  type: NoticeType;
  message: string;
}

export default function BrutalistNotification({ type, message }: BrutalistNotificationProps) {
  const isError = type === "error";
  const isAnalyzing = type === "analyzing";
  const isSuccess = type === "success";

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 30, scale: 0.95 }}
      transition={{ 
        type: "spring", 
        stiffness: 400, 
        damping: 25,
        mass: 0.8
      }}
      className={cn(
        "relative flex items-center gap-4 px-8 py-5 border-[var(--brutalist-line)] bg-[var(--paper)] text-[var(--ink)]",
        "shadow-[8px_8px_0px_0px_var(--ink)]",
        "min-w-[320px] max-w-[90vw] overflow-hidden",
        isError && "border-red-500 shadow-red-500/30",
        isSuccess && "border-green-500 shadow-green-500/30"
      )}
    >
      {/* Icon / Status Indicator */}
      <div className={cn(
        "w-3 h-3 flex-shrink-0 bg-[var(--ink)]",
        isError && "bg-red-500",
        isSuccess && "bg-green-500"
      )} />

      {/* Message */}
      <span className="font-mono text-xs font-bold leading-none select-none">
        {message}
      </span>

      {/* Analyzing Scanline */}
      <AnimatePresence>
        {isAnalyzing && (
          <motion.div
            initial={{ left: "-100%" }}
            animate={{ left: "100%" }}
            transition={{ 
              duration: 1.5, 
              repeat: Infinity, 
              ease: "linear" 
            }}
            className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-[var(--ink)]/10 to-transparent pointer-events-none"
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
