"use client";

import { cn } from "@/lib/style-composer";
import React from "react";

/**
 * PHASE 7 — CANONICAL MENU PRIMITIVES
 * 
 * Standardized Windows 95 menu system for all applications.
 * Replaces fragmented implementations with a single material authority.
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
        "flex bg-[var(--win-face)] border-b border-[var(--win-shadow)] px-1 select-none h-5 items-center z-50",
        className
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex gap-0 h-full">
        {children}
      </div>
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
        className={cn(
          "px-2 h-full flex items-center text-[11px] leading-none focus:outline-none cursor-default border-0",
          isOpen ? "bg-[var(--win-select-bg)] text-white" : "hover:bg-black/5"
        )}
        style={{ background: isOpen ? "var(--win-select-bg)" : "transparent" }}
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
          className={cn(
            "absolute left-0 top-full flex flex-col bg-[var(--win-face)] shadow-[2px_2px_0_rgba(0,0,0,0.3)] border border-[var(--win-dk-shadow)] z-[100] min-w-[150px] py-0.5",
            dropdownClassName
          )}
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
      className={cn(
        "w-full px-4 py-1 text-left text-[11px] cursor-default whitespace-nowrap flex justify-between items-center border-0 bg-transparent hover:bg-[var(--win-select-bg)] hover:text-white outline-none",
        disabled && "opacity-40 hover:bg-transparent hover:text-inherit",
        className
      )}
      onClick={(e) => {
        if (disabled) return;
        e.stopPropagation();
        onClick?.(e);
      }}
      disabled={disabled}
    >
      <div className="flex items-center gap-2">
        {checked !== undefined && (
          <span className="w-3 inline-block font-bold">{checked ? "✓" : ""}</span>
        )}
        <span>{label}</span>
      </div>
      {shortcut && <span className="opacity-60 ml-8">{shortcut}</span>}
    </button>
  );
}

/**
 * Standard horizontal separator for menu items.
 */
export function Win95MenuSeparator() {
  return <div className="h-[1px] bg-[var(--win-shadow)] my-0.5 mx-1 shadow-[0_1px_0_white]" />;
}
