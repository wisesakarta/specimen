"use client";

import { useEffect, useRef, useState } from "react";
import type { SovereignRuntimeProps } from "@/runtime/runtime-dispatch";

/**
 * JSPaintApp — Graphical sovereign vessel runtime.
 *
 * Dispatches the bundled JS Paint application into an iframe.
 * The shell contributes only chrome, position, and lifecycle; the runtime
 * owns its canvas, toolbox, and menu surfaces.
 *
 * Motion follows AGENTS.md Section XVI: no filter transitions, no
 * brightness/saturate fades. Visibility changes are instant so the canvas
 * state is not corrupted by composited animation frames.
 */
export default function JSPaintApp({
  isVisible,
  onFocus,
  onActivityChange,
}: SovereignRuntimeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastTitleRef = useRef<string>("");
  const [isLoading, setIsLoading] = useState(true);

  const onActivityChangeRef = useRef(onActivityChange);
  onActivityChangeRef.current = onActivityChange;

  // After suspension → resume, trigger a resize so JS Paint recalculates
  // its canvas area (stale display:none layouts otherwise).
  useEffect(() => {
    if (!isVisible) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const resizeTimer = setTimeout(() => {
      try {
        iframe.contentWindow?.dispatchEvent(new Event("resize"));
      } catch {
        // Cross-origin guard
      }
    }, 50);

    // Title polling — used to surface the current artifact name + dirty
    // indicator back to the shell via onActivityChange.
    const pollInterval = setInterval(() => {
      try {
        const currentTitle = iframe.contentDocument?.title || "";
        if (currentTitle && currentTitle !== lastTitleRef.current) {
          lastTitleRef.current = currentTitle;
          const cleanTitle = currentTitle.replace(" - JS Paint", "").trim();
          const isDirty = currentTitle.includes("*");
          onActivityChangeRef.current?.({
            subtitle: cleanTitle || "Untitled",
            dirty: isDirty,
          });
        }
      } catch {
        // Cross-origin guard
      }
    }, 1000);

    return () => {
      clearTimeout(resizeTimer);
      clearInterval(pollInterval);
    };
  }, [isVisible]);

  const handleLoad = () => {
    setIsLoading(false);
  };

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ background: "var(--win-face)" }}
      onMouseDown={() => onFocus?.()}
    >
      <iframe
        ref={iframeRef}
        src="/jspaint/index.html?v=2#local:specimen"
        title="JS Paint"
        onLoad={handleLoad}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          display: "block",
          visibility: isLoading ? "hidden" : "visible",
        }}
        allow="clipboard-read; clipboard-write; fullscreen; local-fonts"
      />
    </div>
  );
}
