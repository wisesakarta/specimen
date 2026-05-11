"use client";

import { useRef, useState } from "react";
import type { SovereignRuntimeProps } from "@/runtime/runtime-dispatch";

/**
 * SkiFreeApp — Classic SkiFree game (basicallydan/skifree.js).
 * Self-hosted at /skifree/index.html.
 * Per AGENTS.md §-1.1: a sovereign citizen demonstrating
 * the runtime can host interactive entertainment software.
 */
export default function SkiFreeApp({ isVisible, onFocus }: SovereignRuntimeProps) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div
      className="w-full h-full relative overflow-hidden"
      style={{ background: "#fff" }}
      onMouseDown={() => onFocus?.()}
    >
      <iframe
        src="/skifree/index.html"
        title="SkiFree"
        onLoad={() => setIsLoading(false)}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          display: "block",
          visibility: isLoading ? "hidden" : "visible",
        }}
        allow="autoplay"
      />
    </div>
  );
}
