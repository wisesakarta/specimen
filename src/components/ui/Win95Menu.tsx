"use client";

import { cn } from "@/lib/style-composer";
import React, { useState, useRef, useEffect } from "react";

/**
 * Canonical Win95 menu primitives — menu bar, dropdown, submenu, action, separator.
 * All menus in Specimen 95 render through these components to guarantee a
 * single visual and behavioral contract (AGENTS.md Section XV).
 */

export interface Win95MenuBarProps {
  children: React.ReactNode;
  className?: string;
}

export function Win95MenuBar({ children, className }: Win95MenuBarProps) {
  return (
    <div
      className={cn("flex select-none items-center", className)}
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

export function Win95MenuDropdown({
  label, isOpen, onOpen, onHover, children, className, dropdownClassName,
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
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
        onMouseEnter={onHover}
      >
        {label}
      </button>
      {isOpen && (
        <div
          className={cn("absolute left-0 top-full flex flex-col z-[100]", dropdownClassName)}
          style={{
            minWidth: 180,
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
  /** Shows ✓ when true, empty alignment column when false */
  checked?: boolean;
  /** Shows • when checked=true (radio-style exclusive selection), empty column when false */
  bullet?: boolean;
  className?: string;
}

export function Win95MenuAction({
  label, shortcut, onClick, disabled, checked, bullet, className,
}: Win95MenuActionProps) {
  const hasIndicator = checked !== undefined || bullet !== undefined;
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
        e.currentTarget.style.textShadow = "none";
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
        {hasIndicator && (
          <span
            aria-hidden
            style={{ width: 12, display: "inline-block", marginLeft: -16, textAlign: "center" }}
          >
            {bullet ? (checked ? "•" : "") : (checked ? "✓" : "")}
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

export interface Win95MenuSubmenuProps {
  label: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}

/**
 * A menu item that opens a sub-menu to the right on hover.
 * Uses a 150ms close-delay so moving the mouse diagonally from item to
 * submenu doesn't flicker — matching canonical Win95 submenu behavior.
 */
export function Win95MenuSubmenu({ label, children, disabled }: Win95MenuSubmenuProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => { if (timerRef.current) clearTimeout(timerRef.current); };
  const scheduleClose = () => { timerRef.current = setTimeout(() => setOpen(false), 150); };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div
      className="relative"
      onMouseEnter={() => { cancelClose(); if (!disabled) setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <div
        className="flex items-center cursor-default whitespace-nowrap select-none"
        style={{
          padding: "3px 8px 3px 22px",
          background: open && !disabled ? "var(--win-select-bg)" : "transparent",
          color: disabled ? "var(--win-shadow)" : open ? "var(--win-select-text)" : "var(--win-text)",
          textShadow: disabled ? "1px 1px 0 var(--win-highlight)" : "none",
          fontFamily: "var(--font-shell)",
          fontSize: "var(--win-font-size)",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <span>{label}</span>
        {/* Win95 submenu arrow — CSS triangle */}
        <div
          aria-hidden
          style={{
            width: 0,
            height: 0,
            borderTop: "4px solid transparent",
            borderBottom: "4px solid transparent",
            borderLeft: `5px solid ${disabled ? "var(--win-shadow)" : open ? "var(--win-select-text)" : "var(--win-text)"}`,
            flexShrink: 0,
          }}
        />
      </div>

      {open && !disabled && (
        <div
          className="absolute flex flex-col z-[102]"
          style={{
            top: -2,
            left: "100%",
            minWidth: 140,
            padding: 2,
            background: "var(--win-face)",
            boxShadow: "var(--bevel-raised)",
            fontFamily: "var(--font-shell)",
            fontSize: "var(--win-font-size)",
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {children}
        </div>
      )}
    </div>
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
