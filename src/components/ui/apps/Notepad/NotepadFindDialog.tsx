"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/style-composer";

interface NotepadFindDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onFind: (query: string, direction: "up" | "down", matchCase: boolean) => void;
  initialQuery?: string;
}

export default function NotepadFindDialog({
  isOpen,
  onClose,
  onFind,
  initialQuery = "",
}: NotepadFindDialogProps) {
  const [query, setQuery] = useState(initialQuery);
  const [direction, setDirection] = useState<"up" | "down">("down");
  const [matchCase, setMatchCase] = useState(false);

  useEffect(() => {
    if (isOpen) setQuery(initialQuery);
  }, [isOpen, initialQuery]);

  if (!isOpen) return null;

  return (
    <div 
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-[280px] bg-[var(--win-face)] shadow-[var(--bevel-raised)] border border-[var(--win-dk-shadow)] p-[2px]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Title Bar */}
      <div className="flex items-center justify-between bg-[var(--win-title-active)] text-white px-1 h-[18px] select-none">
        <span className="text-[11px] font-bold">Find</span>
        <button 
          className="win-ctrl-btn w-3.5 h-3.5 !bg-[var(--win-face)] !text-black"
          onClick={onClose}
        >
          <svg width="6" height="6" viewBox="0 0 7 7">
            <line x1="0" y1="0" x2="7" y2="7" stroke="currentColor" strokeWidth="1.5" />
            <line x1="7" y1="0" x2="0" y2="7" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <label className="text-[11px] whitespace-nowrap">Fi<span className="underline">n</span>d what:</label>
          <input 
            type="text"
            className="win-input flex-1 h-5 px-1 !bg-white"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onFind(query, direction, matchCase);
              if (e.key === "Escape") onClose();
            }}
          />
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col gap-2 flex-1">
            <label className="flex items-center gap-2 text-[11px] cursor-default">
              <input 
                type="checkbox" 
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
                className="w-3 h-3"
              />
              <span>Match <span className="underline">c</span>ase</span>
            </label>
          </div>

          <div className="border border-[var(--win-shadow)] p-2 relative pt-3 min-w-[80px]">
            <span className="absolute -top-2 left-2 bg-[var(--win-face)] px-1 text-[11px]">Direction</span>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-[11px] cursor-default">
                <input 
                  type="radio" 
                  name="direction" 
                  value="up" 
                  checked={direction === "up"}
                  onChange={() => setDirection("up")}
                  className="w-3 h-3"
                />
                <span><span className="underline">U</span>p</span>
              </label>
              <label className="flex items-center gap-1 text-[11px] cursor-default">
                <input 
                  type="radio" 
                  name="direction" 
                  value="down" 
                  checked={direction === "down"}
                  onChange={() => setDirection("down")}
                  className="w-3 h-3"
                />
                <span><span className="underline">D</span>own</span>
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-1">
          <button 
            className="win-btn !min-w-[70px] !h-6"
            onClick={() => onFind(query, direction, matchCase)}
            disabled={!query}
          >
            Find Next
          </button>
          <button 
            className="win-btn !min-w-[70px] !h-6"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
