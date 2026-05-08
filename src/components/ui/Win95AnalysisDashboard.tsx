"use client";

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/style-composer";
import { useEffect, useRef, useState } from "react";
import Win95Window, { Win95MenuBar, Win95MenuItem, Win95StatusBar, Win95StatusPanel } from "./Win95Window";
import Win95ProgressBar from "./Win95ProgressBar";

interface Win95AnalysisDashboardProps {
  result: any;
  logs: string[];
  onDownload: () => void;
  onReset: () => void;
  isDownloading: boolean;
  progress: { current: number; total: number };
  isActive?: boolean;
  onMinimize?: () => void;
}

export default function Win95AnalysisDashboard({
  result,
  logs,
  onDownload,
  onReset,
  isDownloading,
  progress,
  isActive,
  onMinimize,
}: Win95AnalysisDashboardProps) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [activeWindow, setActiveWindow] = useState<"analysis" | "log">("analysis");

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [logs]);

  if (!result) return null;

  const downloadedCount = Array.isArray(result?.downloadResult?.downloaded)
    ? result.downloadResult.downloaded.length
    : null;
  const skippedCount = Array.isArray(result?.downloadResult?.skipped)
    ? result.downloadResult.skipped.length
    : null;

  const progressPct =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <motion.div
      className="absolute inset-0 z-40 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.15 } }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      style={{ bottom: 28 }} // Offset for desktop taskbar
    >
      {/* Dashboard area */}
      <div className="flex-1 flex flex-col md:flex-row gap-2 p-2 overflow-hidden min-h-0">

        {/* Left window — Font Analysis */}
        <Win95Window
          title={`${result.foundryName ?? "Foundry"} — Font Analysis`}
          icon="🗂️"
          active={isActive && activeWindow === "analysis"}
          onClose={onReset}
          onMinimize={onMinimize}
          className="flex-1 min-w-0 flex flex-col"
          contentClassName="flex-1 flex flex-col overflow-hidden min-h-0"
          style={{ minHeight: 0 }}
          variants={{
            hidden: { opacity: 0, x: -20 },
            visible: { opacity: 1, x: 0, transition: { duration: 0.15, ease: "easeOut" } },
            exit:   { opacity: 0, x: -20, transition: { duration: 0.1 } },
          }}
          onClick={() => setActiveWindow("analysis")}
        >
          {/* Menu bar */}
          <div
            className="flex items-center border-b px-1 select-none flex-shrink-0"
            style={{
              height: 20,
              background: "var(--win-face)",
              borderBottomColor: "var(--win-shadow)",
              fontSize: "var(--win-font-size)",
            }}
          >
            <MenuBtn>File</MenuBtn>
            <MenuBtn>Edit</MenuBtn>
            <MenuBtn>View</MenuBtn>
          </div>

          {/* Info header */}
          <div
            className="flex items-center justify-between px-3 py-1 flex-shrink-0 border-b"
            style={{
              background: "var(--win-face)",
              borderBottomColor: "var(--win-shadow)",
              fontSize: "var(--win-font-size)",
            }}
          >
            <span className="font-bold truncate" style={{ fontSize: 13 }}>
              {result.foundryName}
            </span>
            <span style={{ color: "var(--win-shadow)", fontSize: 10 }} className="truncate ml-2">
              {result.targetUrl || result.originalUrl}
            </span>
          </div>

          {/* Column headers */}
          <div
            className="flex items-center px-2 border-b flex-shrink-0 select-none"
            style={{
              height: 18,
              background: "var(--win-face)",
              borderBottomColor: "var(--win-shadow)",
              fontSize: 10,
              color: "var(--win-text)",
            }}
          >
            <span className="flex-1">Name</span>
            <span style={{ width: 60 }} className="text-right">Format</span>
            <span style={{ width: 50 }} className="text-right">Weight</span>
          </div>

          {/* Font list */}
          <div
            className="flex-1 overflow-y-auto min-h-0"
            style={{ background: "var(--win-window)", boxShadow: "var(--bevel-sunken)" }}
          >
            {result.fonts.map((font: any, i: number) => (
              <motion.div
                key={i}
                className="win-list-row flex items-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: i * 0.015 } }}
              >
                <span className="flex-1 truncate">
                  {font.family}{font.metadata?.styleName ? ` — ${font.metadata.styleName}` : ""}
                </span>
                <span style={{ width: 60, textAlign: "right", color: "inherit", opacity: 0.7, fontSize: 10 }}>
                  {font.format?.toUpperCase()}
                </span>
                <span style={{ width: 50, textAlign: "right", color: "inherit", opacity: 0.7, fontSize: 10 }}>
                  {font.metadata?.weight ?? ""}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Action toolbar */}
          <div
            className="flex items-center gap-2 px-2 py-2 border-t flex-shrink-0"
            style={{
              background: "var(--win-face)",
              borderTopColor: "var(--win-shadow)",
            }}
          >
            <Win95Btn onClick={onReset} disabled={isDownloading}>
              Cancel
            </Win95Btn>
            <Win95Btn
              primary
              onClick={onDownload}
              disabled={isDownloading}
            >
              {isDownloading
                ? progress.total > 0
                  ? `Downloading… (${progress.current}/${progress.total})`
                  : "Downloading…"
                : "Download All"}
            </Win95Btn>
          </div>

          {/* Progress bar */}
          <AnimatePresence>
            {isDownloading && (
              <motion.div
                className="flex-shrink-0 px-2 pb-2"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                style={{ background: "var(--win-face)" }}
              >
                <Win95ProgressBar 
                  progress={progressPct}
                  indeterminate={progress.total === 0}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Status bar */}
          <Win95StatusBar>
            <Win95StatusPanel className="flex-1">
              {downloadedCount !== null
                ? `${downloadedCount} file(s) downloaded${skippedCount ? `, ${skippedCount} skipped` : ""}`
                : `${result.fonts.length} font(s) detected`}
            </Win95StatusPanel>
            <Win95StatusPanel style={{ width: 120 }}>
              {result.foundryName}
            </Win95StatusPanel>
          </Win95StatusBar>
        </Win95Window>

        {/* Right window — Activity Log */}
        <Win95Window
          title="Activity Log"
          icon="📋"
          active={isActive && activeWindow === "log"}
          onMinimize={onMinimize}
          className="flex-1 min-w-0 flex flex-col md:max-w-[420px]"
          contentClassName="flex-1 flex flex-col overflow-hidden min-h-0"
          style={{ minHeight: 0 }}
          variants={{
            hidden: { opacity: 0, x: 20 },
            visible: { opacity: 1, x: 0, transition: { duration: 0.15, ease: "easeOut", delay: 0.04 } },
            exit:   { opacity: 0, x: 20, transition: { duration: 0.1 } },
          }}
          onClick={() => setActiveWindow("log")}
        >
          {/* Log textarea */}
          <div
            className="flex-1 overflow-y-auto p-2 min-h-0 font-mono"
            style={{
              background: "#000080",
              color: "#c0c0c0",
              fontSize: 11,
              lineHeight: "1.5",
            }}
          >
            {logs.length === 0 && (
              <span style={{ opacity: 0.4 }}>C:\SPECIMEN&gt; Waiting for activity...</span>
            )}
            {logs.map((log, i) => (
              <div key={i} className="break-all whitespace-pre-wrap">
                <span style={{ opacity: 0.4, marginRight: 8 }}>{String(i + 1).padStart(3, "0")}</span>
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>

          {/* Status bar */}
          <Win95StatusBar>
            <Win95StatusPanel className="flex-1">
              {logs.length > 0 ? `${logs.length} line(s)` : "Idle"}
            </Win95StatusPanel>
          </Win95StatusBar>
        </Win95Window>
      </div>
    </motion.div>
  );
}

/* ─── Internal sub-components ─── */

function MenuBtn({ children }: { children: React.ReactNode }) {
  return (
    <button
      className="px-2 hover:bg-[var(--win-select-bg)] hover:text-[var(--win-select-text)] h-full border-0"
      style={{ background: "transparent", fontSize: "var(--win-font-size)", height: 20 }}
    >
      {children}
    </button>
  );
}

function Win95Btn({
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
    >
      {children}
    </motion.button>
  );
}
