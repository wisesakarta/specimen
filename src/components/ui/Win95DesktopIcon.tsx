"use client";

import { cn } from "@/lib/style-composer";
import { resolveWin95Icon } from "@/lib/icon-map";
import Win95Icon from "./Win95Icon";

interface Win95DesktopIconProps {
  label: string;
  icon: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  className?: string;
  active?: boolean;
}

// Checkerboard gradient identical to Codepen's @mixin ch(color, 1px, transparent).
// Two 45° gradients offset by 1px create a 2×2px tile where alternating pixels
// are the selection color — the canonical Win95 dither pattern.
const DITHER_STYLE = {
  backgroundColor: "transparent",
  backgroundImage: [
    "linear-gradient(45deg, #000080 25%, transparent 25%, transparent 75%, #000080 75%, #000080)",
    "linear-gradient(45deg, #000080 25%, transparent 25%, transparent 75%, #000080 75%, #000080)",
  ].join(", "),
  backgroundSize: "2px 2px",
  backgroundPosition: "0 0, 1px 1px",
} as const;

export default function Win95DesktopIcon({
  label,
  icon,
  onClick,
  onDoubleClick,
  className,
  active = false,
}: Win95DesktopIconProps) {
  // Resolve the PNG path so we can use it as a CSS mask — restricts the
  // dither to the icon's opaque pixels only (not the transparent surround).
  const isPath = icon.startsWith("/") || icon.endsWith(".png") || icon.startsWith("data:");
  const iconSrc = isPath ? icon : (resolveWin95Icon(icon, 32) ?? "");

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 w-20 p-2 cursor-default select-none",
        className
      )}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
    >
      {/* Icon area — 40×40 container, 32×32 icon at full opacity */}
      <div className="relative" style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Win95Icon icon={icon} size={32} />

        {/* Win95 dither overlay — checkerboard masked to the icon silhouette */}
        {active && iconSrc && (
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              ...DITHER_STYLE,
              maskImage: `url(${iconSrc})`,
              maskSize: "32px 32px",
              maskPosition: "center",
              maskRepeat: "no-repeat",
              WebkitMaskImage: `url(${iconSrc})`,
              WebkitMaskSize: "32px 32px",
              WebkitMaskPosition: "center",
              WebkitMaskRepeat: "no-repeat",
            }}
          />
        )}
      </div>

      {/* Label — solid navy bg + white text + dotted outline when selected */}
      <div
        className="relative px-1 text-center break-words max-w-full"
        style={{
          fontFamily: "var(--font-shell)",
          fontSize: 11,
          lineHeight: 1.2,
          color: active ? "var(--win-select-text)" : "var(--win-highlight)",
          background: active ? "var(--win-select-bg)" : "transparent",
          textShadow: active ? "none" : "1px 1px 0 rgba(0,0,0,0.9)",
          outline: active ? "1px dotted var(--win-highlight)" : "none",
          outlineOffset: -1,
        }}
      >
        {label}
      </div>
    </div>
  );
}
