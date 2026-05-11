"use client";

import { useEffect, useState } from "react";
import type { SovereignRuntimeProps } from "@/runtime/runtime-dispatch";
import Win95ProgressBar from "@/components/ui/Win95ProgressBar";

export default function DoomApp({ onFocus, onActivityChange }: SovereignRuntimeProps) {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isLoading) {
      onActivityChange?.({ subtitle: "Loading...", dirty: false });
    } else {
      onActivityChange?.({ subtitle: "Running", dirty: false });
    }
  }, [isLoading]);

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
        allow="autoplay"
      />
      {isLoading && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3"
          style={{ background: "#000", color: "#c0c0c0" }}
        >
          <span style={{ fontFamily: "var(--font-shell)", fontSize: 11 }}>
            Loading DOOM...
          </span>
          <Win95ProgressBar indeterminate className="w-40" height={14} />
        </div>
      )}
    </div>
  );
}
