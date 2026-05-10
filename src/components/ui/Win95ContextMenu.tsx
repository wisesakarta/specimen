"use client";

import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  bold?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface Win95ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

/**
 * Win95ContextMenu
 * Canonical Windows 95 right-click context menu.
 * Renders at absolute position (x, y) with raised bevel, selection highlight,
 * and ridge separators. Closes on click outside or Escape.
 */
export default function Win95ContextMenu({ x, y, items, onClose }: Win95ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[9000] flex flex-col"
      style={{
        left: x,
        top: y,
        minWidth: 160,
        padding: 3,
        background: "var(--win-face)",
        boxShadow: "var(--bevel-raised)",
        fontFamily: "var(--font-shell)",
        fontSize: "var(--win-font-size)",
      }}
    >
      {items.map((entry, i) => {
        if ("separator" in entry) {
          return (
            <div key={i} aria-hidden className="flex flex-col" style={{ margin: "3px 2px" }}>
              <div style={{ height: 1, background: "var(--win-shadow)" }} />
              <div style={{ height: 1, background: "var(--win-highlight)" }} />
            </div>
          );
        }

        const item = entry as ContextMenuItem;
        return (
          <button
            key={i}
            type="button"
            disabled={item.disabled}
            className="w-full flex items-center cursor-default border-0 outline-none text-left"
            style={{
              padding: "3px 20px 3px 24px",
              background: "transparent",
              color: item.disabled ? "var(--win-shadow)" : "var(--win-text)",
              textShadow: item.disabled ? "1px 1px 0 var(--win-highlight)" : "none",
              fontFamily: "var(--font-shell)",
              fontSize: "var(--win-font-size)",
              fontWeight: item.bold ? 700 : 400,
            }}
            onMouseEnter={(e) => {
              if (item.disabled) return;
              e.currentTarget.style.background = "var(--win-select-bg)";
              e.currentTarget.style.color = "var(--win-select-text)";
            }}
            onMouseLeave={(e) => {
              if (item.disabled) return;
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--win-text)";
            }}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
