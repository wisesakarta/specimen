"use client";

import { AnimatePresence, motion } from "framer-motion";
import { type InputHTMLAttributes, useRef, useState } from "react";
import { cn } from "@/lib/style-composer";
import Win95Window from "./Win95Window";

interface Win95SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  onAnalyze: () => void;
  onClose?: () => void;
  onMinimize?: () => void;
  active?: boolean;
}

export default function Win95SearchInput({
  value,
  onChange,
  onAnalyze,
  onClose,
  onMinimize,
  disabled,
  className,
  active,
  ...props
}: Win95SearchInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Win95Window
      title="Specimen — Open URL"
      icon="🔍"
      onClose={onClose}
      onMinimize={onMinimize}
      active={isFocused || !!value}
      className={cn("w-[var(--brutalist-input-width)] max-w-full", className)}
    >
      {/* Dialog body */}
      <div className="flex flex-col gap-3 p-4 pb-3" style={{ background: "var(--win-face)" }}>

        {/* Label + Input row */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="url-input"
            className="select-none"
            style={{ fontSize: "var(--win-font-size)" }}
          >
            Foundry URL:
          </label>
          <input
            ref={inputRef}
            id="url-input"
            {...props}
            value={value}
            onChange={onChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onKeyDown={(e) => e.key === "Enter" && !disabled && onAnalyze()}
            placeholder="https://..."
            spellCheck={false}
            autoComplete="off"
            className="win-input"
            style={{ fontSize: "12px" }}
            disabled={disabled}
          />
        </div>

        {/* Separator */}
        <div style={{ height: "1px", background: "var(--win-shadow)", marginBottom: 2 }} />

        {/* Button row */}
        <div className="flex items-center justify-end gap-2">
          <AnalyzeButton
            onClick={onAnalyze}
            disabled={disabled || !value}
            primary
          >
            Analyze
          </AnalyzeButton>
          <AnalyzeButton
            onClick={() => {
              if (onChange) {
                onChange({ target: { value: "" } } as React.ChangeEvent<HTMLInputElement>);
              }
              inputRef.current?.focus();
            }}
            disabled={disabled}
          >
            Clear
          </AnalyzeButton>
        </div>
      </div>
    </Win95Window>
  );
}

/* ─── Micro-animated Win2K button ─── */
function AnalyzeButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const [pressed, setPressed] = useState(false);

  return (
    <motion.button
      className={cn("win-btn", primary && "win-btn-primary")}
      onClick={onClick}
      disabled={disabled}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      animate={pressed && !disabled ? { y: 1 } : { y: 0 }}
      transition={{ duration: 0.05 }}
      style={{ minWidth: 75 }}
    >
      {children}
    </motion.button>
  );
}
