"use client";

import { cn } from "@/lib/style-composer";
import Win95Icon from "./Win95Icon";

interface Win95DesktopIconProps {
  label: string;
  icon: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  className?: string;
  active?: boolean;
}

/**
 * Win95DesktopIcon
 * Canonical desktop icon tile. When selected, the label paints with the
 * standard selection background (navy) and white text, with a 1px dotted
 * focus rectangle around the label — matching the Windows 95 shell behavior.
 */
export default function Win95DesktopIcon({
  label,
  icon,
  onClick,
  onDoubleClick,
  className,
  active = false,
}: Win95DesktopIconProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1 w-20 p-2 cursor-default select-none",
        className
      )}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
    >
      {/* Icon tile — 32×32 with dithered selection wash when active */}
      <div className="relative" style={{ width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Win95Icon
          icon={icon}
          size={32}
          className={cn(active && "opacity-60")}
        />
        {active && (
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "var(--win-select-bg)",
              opacity: 0.35,
              mixBlendMode: "multiply",
            }}
          />
        )}
      </div>

      {/* Label — canonical white-on-teal with 1px text shadow when unselected */}
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
