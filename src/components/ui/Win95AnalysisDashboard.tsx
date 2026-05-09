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
  const [isMaximized, setIsMaximized] = useState(false);

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
      className={cn(
        "absolute inset-0 z-40 flex flex-col",
        isMaximized ? "p-0" : "p-[2px] sm:p-2 md:p-8"
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0 } }}
      exit={{ opacity: 0, transition: { duration: 0 } }}
      style={{ bottom: 28 }} // Offset for desktop taskbar
    >
      <Win95Window
        title={`${result.foundryName ?? "Foundry"} — Specimen Analyzer`}
        icon="🔍"
        active={isActive}
        onClose={onReset}
        onMinimize={onMinimize}
        onMaximize={() => setIsMaximized(!isMaximized)}
        isMaximized={isMaximized}
        className="flex-1 min-w-0 flex flex-col w-full h-full shadow-[2px_2px_10px_rgba(0,0,0,0.5)]"
        contentClassName="flex-1 flex flex-col overflow-hidden min-h-0 bg-[var(--win-face)]"
      >
        {/* Unified Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-2 py-1 flex-shrink-0" style={{ borderBottom: "1px solid var(--win-shadow)", boxShadow: "0 1px 0 var(--win-highlight)" }}>
          <Win95Btn onClick={onReset} disabled={isDownloading}>
            Cancel
          </Win95Btn>
          <Win95Btn primary onClick={onDownload} disabled={isDownloading}>
            {isDownloading
              ? progress.total > 0
                ? `Downloading… (${progress.current}/${progress.total})`
                : "Downloading…"
              : "Download All"}
          </Win95Btn>
        </div>

        {/* Main Workspace Area */}
        <div className="flex-1 flex flex-col md:flex-row gap-[4px] p-[4px] overflow-hidden min-h-0">
          
          {/* Left Pane: Font Analysis ListView */}
          <div className="flex-1 flex flex-col min-w-0 bg-[var(--win-window)]" style={{ boxShadow: "var(--bevel-sunken)" }}>
            
            {/* Context Header */}
            <div className="flex items-center justify-between px-3 py-2 flex-shrink-0 border-b border-[var(--win-shadow)] bg-[var(--win-face)]">
              <span className="font-bold truncate text-[12px]">
                {result.foundryName}
              </span>
              <span className="truncate ml-2 text-[10px] text-[var(--win-text-muted)]">
                {result.targetUrl || result.originalUrl}
              </span>
            </div>

            {/* ListView Headers */}
            <div className="flex items-center flex-shrink-0 select-none bg-[var(--win-face)] border-b border-[var(--win-shadow)] text-[11px] text-[var(--win-text)]">
              <div className="flex-1 px-2 py-1 border-r border-[var(--win-shadow)] shadow-[1px_0_0_var(--win-highlight)]">Name</div>
              <div className="w-[80px] px-2 py-1 border-r border-[var(--win-shadow)] shadow-[1px_0_0_var(--win-highlight)] text-right">Format</div>
              <div className="w-[70px] px-2 py-1 text-right">Weight</div>
            </div>

            {/* ListView Content */}
            <div className="flex-1 overflow-y-auto min-h-0 p-1">
              {result.fonts.map((font: any, i: number) => (
                <div key={i} className="win-list-row flex items-center">
                  <span className="flex-1 truncate">
                    {font.family}{font.metadata?.styleName ? ` — ${font.metadata.styleName}` : ""}
                  </span>
                  <span className="w-[80px] text-right opacity-70 text-[10px]">
                    {font.format?.toUpperCase()}
                  </span>
                  <span className="w-[70px] text-right opacity-70 text-[10px]">
                    {font.metadata?.weight ?? ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right Pane: Activity Log Terminal */}
          <div className="w-full md:w-[420px] flex flex-col min-w-0" style={{ boxShadow: "var(--bevel-sunken)" }}>
            <div className="flex items-center px-2 py-1 bg-[var(--win-title-inactive)] text-[var(--win-title-text-inactive)] text-[11px] font-bold flex-shrink-0">
              Activity Log
            </div>
            <div
              className="flex-1 overflow-y-auto p-2 min-h-0 font-mono text-[11px] leading-[1.5]"
              style={{ background: "#000080", color: "#c0c0c0" }}
            >
              {logs.length === 0 && (
                <span className="opacity-40">C:\SPECIMEN&gt; Waiting for activity...</span>
              )}
              {logs.map((log, i) => (
                <div key={i} className="break-all whitespace-pre-wrap">
                  <span className="opacity-40 mr-2">{String(i + 1).padStart(3, "0")}</span>
                  {log}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Global Progress Bar Area */}
        <AnimatePresence>
          {isDownloading && (
            <motion.div
              className="flex-shrink-0 px-[4px] pb-[4px]"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <Win95ProgressBar 
                progress={progressPct}
                indeterminate={progress.total === 0}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unified Status Bar */}
        <Win95StatusBar>
          <Win95StatusPanel className="flex-1">
            {downloadedCount !== null
              ? `${downloadedCount} file(s) downloaded${skippedCount ? `, ${skippedCount} skipped` : ""}`
              : `${result.fonts.length} font(s) detected`}
          </Win95StatusPanel>
          <Win95StatusPanel style={{ width: 140 }}>
            {result.foundryName}
          </Win95StatusPanel>
          <Win95StatusPanel style={{ width: 140 }}>
            {logs.length > 0 ? `${logs.length} line(s)` : "Idle"}
          </Win95StatusPanel>
        </Win95StatusBar>
      </Win95Window>
    </motion.div>
  );
}

/* ─── Internal sub-components ─── */

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
    <button
      className={cn("win-btn", primary && "win-btn-primary")}
      onClick={onClick}
      disabled={disabled}
      onPointerDown={() => !disabled && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
    >
      {children}
    </button>
  );
}
