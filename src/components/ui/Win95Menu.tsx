"use client";

import { cn } from "@/lib/style-composer";
import React from "react";

/**
 * Canonical Win95 menu primitives — menu bar, dropdown, action, separator.
 * All menus in Specimen 95 render through these components to guarantee a
 * single visual and behavioral contract (AGENTS.md Section XV).
 */

export interface Win95MenuBarProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Standard horizontal container for application menus.
 */
export function Win95MenuBar({ children, className }: Win95MenuBarProps) {
  return (
    <div
      className={cn(
        "flex select-none items-center",
        className
      )}
      style={{
        height: 20,
        padding: "0 2px",
        background: "var(--win-face)",
        borderBottom: "1px solid var(--win-shadow)",
        fontFamily: "var(--font-shell)",
        fontSize: "var(--win-font-size)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex h-full">{children}</div>
    </div>
  );
}

export interface Win95MenuDropdownProps {
  label: React.ReactNode;
  isOpen: boolean;
  onOpen: () => void;
  onHover: () => void;
  children: React.ReactNode;
  className?: string;
  dropdownClassName?: string;
}

/**
 * A menu category (e.g., "File", "Edit") that opens a dropdown.
 * Canonical Win95 behavior: the category label inverts to selection colors
 * while the dropdown is open; the dropdown itself is a raised-bevel panel
 * with no drop shadow.
 */
export function Win95MenuDropdown({
  label,
  isOpen,
  onOpen,
  onHover,
  children,
  className,
  dropdownClassName,
}: Win95MenuDropdownProps) {
  return (
    <div className={cn("relative h-full flex items-center", className)}>
      <button
        type="button"
        className="h-full flex items-center cursor-default border-0 focus:outline-none"
        style={{
          padding: "0 8px",
          fontFamily: "var(--font-shell)",
          fontSize: "var(--win-font-size)",
          background: isOpen ? "var(--win-select-bg)" : "transparent",
          color: isOpen ? "var(--win-select-text)" : "var(--win-text)",
        }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onMouseEnter={onHover}
      >
        {label}
      </button>
      {isOpen && (
        <div
          className={cn("absolute left-0 top-full flex flex-col z-[100]", dropdownClassName)}
          style={{
            minWidth: 160,
            padding: 2,
            background: "var(--win-face)",
            boxShadow: "var(--bevel-raised)",
            fontFamily: "var(--font-shell)",
            fontSize: "var(--win-font-size)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export interface Win95MenuActionProps {
  label: React.ReactNode;
  shortcut?: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  checked?: boolean;
  className?: string;
}

/**
 * A clickable item within a menu dropdown.
 */
export function Win95MenuAction({
  label,
  shortcut,
  onClick,
  disabled,
  checked,
  className,
}: Win95MenuActionProps) {
  return (
    <button
      type="button"
      className={cn(
        "w-full flex items-center cursor-default whitespace-nowrap border-0 outline-none",
        className
      )}
      style={{
        padding: "3px 20px 3px 22px",
        background: "transparent",
        color: disabled ? "var(--win-shadow)" : "var(--win-text)",
        textShadow: disabled ? "1px 1px 0 var(--win-highlight)" : "none",
        fontFamily: "var(--font-shell)",
        fontSize: "var(--win-font-size)",
        gap: 24,
        justifyContent: "space-between",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "var(--win-select-bg)";
        e.currentTarget.style.color = "var(--win-select-text)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--win-text)";
      }}
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        onClick?.(e);
      }}
      disabled={disabled}
    >
      <span className="flex items-center" style={{ gap: 6 }}>
        {checked !== undefined && (
          <span
            aria-hidden
            style={{ width: 12, display: "inline-block", marginLeft: -16, textAlign: "center" }}
          >
            {checked ? "✓" : ""}
          </span>
        )}
        <span>{label}</span>
      </span>
      {shortcut && (
        <span style={{ color: "inherit", opacity: 0.85 }}>{shortcut}</span>
      )}
    </button>
  );
}

/**
 * Canonical Win95 menu separator — ridge line (shadow over highlight).
 */
export function Win95MenuSeparator() {
  return (
    <div aria-hidden className="flex flex-col" style={{ margin: "3px 2px" }}>
      <div style={{ height: 1, background: "var(--win-shadow)" }} />
      <div style={{ height: 1, background: "var(--win-highlight)" }} />
    </div>
  );
}
