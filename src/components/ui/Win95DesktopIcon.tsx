"use client";

import { cn } from "@/lib/style-composer";
import { useRef, useState } from "react";
import Win95Icon from "./Win95Icon";

interface Win95DesktopIconProps {
  label: string;
  icon: string;
  onClick?: () => void;
  onDoubleClick?: () => void;
  className?: string;
  active?: boolean;
}

export default function Win95DesktopIcon({
  label,
  icon,
  onClick,
  onDoubleClick,
  className,
  active = false,
}: Win95DesktopIconProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Win95 icon flash: inverted → selected → open (80ms total)
    setIsFlashing(true);
    if (flashRef.current) clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => {
      setIsFlashing(false);
      onDoubleClick?.();
    }, 80);
  };

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
      onDoubleClick={handleDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Icon Area — 32×32 with authentic Win95 selection metaphors */}
      <div
        className={cn(
          "w-10 h-10 flex items-center justify-center relative",
          isFlashing && "bg-[var(--win-highlight)]",
          !isFlashing && active && "bg-[var(--win-select-bg)]",
        )}
        style={{
          // Use dithered pattern for selection mask if possible, or solid navy for authenticity
          backgroundColor: active && !isFlashing ? "var(--win-select-bg)" : undefined,
        }}
      >
        <Win95Icon
          icon={icon}
          size={32}
          className={cn(
            "transition-transform duration-75",
            isFlashing && "[filter:invert(1)]",
            !isFlashing && active && "opacity-50 [filter:brightness(0.5)_sepia(1)_hue-rotate(190deg)_saturate(500%)]",
          )}
        />
        {/* Precise focus rectangle */}
        {active && !isFlashing && (
          <div className="absolute inset-0 border border-dotted border-white opacity-40 pointer-events-none" style={{ margin: "-1px" }} />
        )}
      </div>

      {/* Label */}
      <div
        className={cn(
          "px-1 text-center break-words max-w-full text-white drop-shadow-[1px_1px_0_rgba(0,0,0,0.9)] transition-colors duration-75",
          active && !isFlashing && "bg-[var(--win-select-bg)] text-white drop-shadow-none",
          isFlashing && "bg-[var(--win-highlight)] text-black drop-shadow-none"
        )}
        style={{ 
          fontFamily: "var(--font-shell)", 
          fontSize: "11px", 
          lineHeight: "1.2",
          outline: active && !isFlashing ? "1px dotted white" : "none",
          outlineOffset: -2
        }}
      >
        {label}
      </div>
    </div>
  );
}
