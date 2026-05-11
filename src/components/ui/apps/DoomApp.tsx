"use client";

import { useRef, useState } from "react";
import type { SovereignRuntimeProps } from "@/runtime/runtime-dispatch";

/**
 * DoomApp — DOOM shareware via js-dos emulator.
 * Loads the DOOM1.WAD shareware bundle through the js-dos CDN.
 * Per AGENTS.md §-1.1: a sovereign citizen that demonstrates
 * the runtime can execute DOS-era software.
 */
export default function DoomApp({ isVisible, onFocus }: SovereignRuntimeProps) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ background: "#000" }}
      onMouseDown={() => onFocus?.()}
    >
      <iframe
        src="/doom/index.html"
        title="DOOM"
        onLoad={() => setIsLoading(false)}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          display: "block",
          visibility: isLoading ? "hidden" : "visible",
        }}
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
}
