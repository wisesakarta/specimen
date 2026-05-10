"use client";

import { useState } from "react";
import Win95Window from "./Win95Window";
import Win95Icon from "./Win95Icon";

interface Win95ShutdownDialogProps {
  onClose: () => void;
  onConfirm: (mode: "shutdown" | "restart") => void;
}

type ShutdownMode = "shutdown" | "restart";

interface RadioRow {
  value: ShutdownMode;
  label: string;
}

/**
 * Win95ShutdownDialog
 * Canonical "Shut Down Windows" dialog reinterpreted for Specimen 95.
 *
 * Reference: pcjs Win95 emulator — "Shut Down Windows" modal with left
 * Shut Down icon, vertically stacked radio options, and three right-aligned
 * button controls (Yes / No / Help).
 */
export default function Win95ShutdownDialog({ onClose, onConfirm }: Win95ShutdownDialogProps) {
  const [selectedMode, setSelectedMode] = useState<ShutdownMode>("shutdown");

  const rows: RadioRow[] = [
    { value: "shutdown", label: "Shut down the computer?" },
    { value: "restart",  label: "Restart the computer?" },
  ];

  return (
    <div
      className="fixed inset-0 z-[5000] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.35)" }}
    >
      <Win95Window
        title="Shut Down Windows"
        onClose={onClose}
        active
        hideMinimize
        hideMaximize
        className="w-[360px]"
        style={{ fontFamily: "var(--font-shell)" }}
      >
        <div className="flex gap-4 px-5 py-5">
          {/* Canonical left-column shutdown glyph */}
          <div className="shrink-0 mt-1">
            <Win95Icon icon="ShutDown" size={32} />
          </div>

          <div className="flex flex-col flex-1 gap-4">
            <p
              style={{
                fontFamily: "var(--font-shell)",
                fontSize: 12,
                color: "var(--win-text)",
                margin: 0,
              }}
            >
              Are you sure you want to:
            </p>

            <div className="flex flex-col gap-2 pl-1">
              {rows.map((row) => {
                const checked = selectedMode === row.value;
                return (
                  <label
                    key={row.value}
                    className="flex items-center gap-3 cursor-default"
                    style={{ fontFamily: "var(--font-shell)", fontSize: 12 }}
                  >
                    <span
                      className="relative flex items-center justify-center"
                      style={{
                        width: 12,
                        height: 12,
                        background: "var(--win-highlight)",
                        borderRadius: "50%",
                        boxShadow: "var(--bevel-sunken)",
                      }}
                    >
                      <input
                        type="radio"
                        name="shutdown-mode"
                        className="sr-only"
                        checked={checked}
                        onChange={() => setSelectedMode(row.value)}
                      />
                      {checked && (
                        <span
                          aria-hidden
                          style={{
                            width: 4,
                            height: 4,
                            background: "var(--win-text)",
                            borderRadius: "50%",
                          }}
                        />
                      )}
                    </span>
                    <span>{row.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer ridge + canonical button row */}
        <div
          aria-hidden
          className="flex flex-col"
          style={{ margin: "0 5px" }}
        >
          <div style={{ height: 1, background: "var(--win-shadow)" }} />
          <div style={{ height: 1, background: "var(--win-highlight)" }} />
        </div>
        <div className="flex justify-end gap-2 px-5 py-3">
          <button
            type="button"
            className="win-btn"
            style={{ minWidth: 75, height: 23 }}
            onClick={() => onConfirm(selectedMode)}
          >
            Yes
          </button>
          <button
            type="button"
            className="win-btn"
            style={{ minWidth: 75, height: 23 }}
            onClick={onClose}
          >
            No
          </button>
          <button
            type="button"
            className="win-btn"
            style={{ minWidth: 75, height: 23 }}
            disabled
          >
            Help
          </button>
        </div>
      </Win95Window>
    </div>
  );
}
