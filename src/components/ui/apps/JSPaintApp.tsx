"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SovereignRuntimeProps } from "../Win95RuntimeHost";

/**
 * JSPaintApp — Graphical sovereign vessel runtime.
 * 
 * Phase 17B: JS Paint Restraint Correction & Implicit Continuity
 * 
 * Continuity Vectors:
 * 1. Artifact Persistence — Title synchronization and dirty state sensing.
 * 2. Environmental Grounding — Material dither substrate and focus recovery.
 */
export default function JSPaintApp({
  isVisible,
  onFocus,
  onActivityChange,
}: SovereignRuntimeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastTitleRef = useRef<string>("");
  const [isRestoring, setIsRestoring] = useState(true);
  const [hasContent, setHasContent] = useState(false);

  // After suspension → resume, trigger a resize event inside the iframe so JS Paint
  // recalculates its canvas area. Without this, the layout may be stale from display:none.
  useEffect(() => {
    if (!isVisible) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    // 1. Trigger Resize for Layout Integrity
    const t = setTimeout(() => {
      try {
        iframe.contentWindow?.dispatchEvent(new Event("resize"));
      } catch (e) {
        console.warn("JSPAINT: Failed to dispatch resize", e);
      }
    }, 50);

    // 2. Title Synchronization Loop (Artifact Legitimacy)
    const pollInterval = setInterval(() => {
      try {
        const currentTitle = iframe.contentDocument?.title || "";
        if (currentTitle && currentTitle !== lastTitleRef.current) {
          lastTitleRef.current = currentTitle;
          
          // Clean the title (JS Paint often appends " - JS Paint")
          const cleanTitle = currentTitle.replace(" - JS Paint", "").trim();
          const isDirty = currentTitle.includes("*");
          
          onActivityChange?.({
            subtitle: cleanTitle || "Untitled",
            dirty: isDirty,
          });

          // If title changes from default "Untitled", we definitely have content
          if (cleanTitle && cleanTitle !== "Untitled") {
            setHasContent(true);
          }
        }
      } catch {
        // Cross-origin guard
      }
    }, 1000);

    return () => {
      clearTimeout(t);
      clearInterval(pollInterval);
    };
  }, [isVisible, onActivityChange]);

  const handleLoad = () => {
    setIsRestoring(false);
  };

  return (
    <motion.div
      className="w-full h-full relative overflow-hidden"
      onMouseDown={() => onFocus()}
      initial={false}
      animate={isVisible ? { 
        filter: "brightness(1) contrast(1)",
        backgroundColor: "#c0c0c0" // win-face
      } : { 
        filter: "brightness(0.85) contrast(0.9) saturate(0.6)",
        backgroundColor: "#808080" 
      }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <iframe
        ref={iframeRef}
        src="/jspaint/index.html"
        title="JS Paint"
        onLoad={handleLoad}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          display: "block",
          opacity: isRestoring ? 0 : 1,
        }}
        allow="clipboard-read; clipboard-write; fullscreen"
      />

      {/* Environmental Substrate — Atmospheric continuity */}
      <div className="absolute inset-0 win-dither pointer-events-none opacity-[0.04] z-50" />
      
      {/* Artifact Framing — Subtle inner shadow to ground the iframe */}
      <div className="absolute inset-0 pointer-events-none z-30 shadow-[inset_1px_1px_4px_rgba(0,0,0,0.1)]" />
    </motion.div>
  );
}
