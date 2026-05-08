"use client";

import { resolveWin95Icon } from "@/lib/icon-map";

interface Win95IconProps {
  /** The emoji or text identifier from the VFS icon field */
  icon: string;
  /** Pixel size to render — 16 for taskbar/inline, 32 for desktop icons */
  size?: 16 | 32;
  className?: string;
}

/**
 * Win95Icon
 *
 * Renders a React95-sourced pixel-art PNG icon when available, falls back to
 * the original emoji text for unknown identifiers. Shell-only component — never
 * used inside sovereign runtime content.
 */
export default function Win95Icon({ icon, size = 16, className }: Win95IconProps) {
  // Direct image path support
  const isDirectPath = icon.startsWith("/") || icon.endsWith(".png") || icon.endsWith(".svg") || icon.startsWith("data:");
  const src = isDirectPath ? icon : resolveWin95Icon(icon, size);

  if (src) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        aria-hidden
        style={{ imageRendering: "pixelated", display: "inline-block", flexShrink: 0 }}
        className={className}
      />
    );
  }

  // If it's a path that failed to resolve or a non-emoji string, don't render it as text if it looks like a filename
  if (icon.includes(".") || icon.includes("/")) {
    return <div style={{ width: size, height: size, flexShrink: 0 }} className={className} />;
  }

  return (
    <span
      style={{ display: "inline-block", width: size, height: size, textAlign: "center", lineHeight: `${size}px`, flexShrink: 0 }}
      className={className}
    >
      {icon}
    </span>
  );
}
