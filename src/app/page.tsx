"use client";

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import Win95AnalysisDashboard from "@/components/ui/Win95AnalysisDashboard";
import Win95Desktop from "@/components/ui/Win95Desktop";

interface SmartFormState {
  licenseId?: string;
  licenseProof?: string;
}

export type Notice = {
  type: "info" | "success" | "error" | "analyzing";
  message: string;
};

const DEFAULT_SMART_FORM: SmartFormState = {
  licenseId: "",
  licenseProof: "",
};

export default function HomePage() {
  const [smartForm, setSmartForm] = useState<SmartFormState>(DEFAULT_SMART_FORM);
  const [targetUrl, setTargetUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [scrapeResult, setScrapeResult] = useState<any | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isAppRunning, setIsAppRunning] = useState(false);

  const appendLog = (message: string) => {
    setActivityLog((prev) => [...prev, message].slice(-200));
  };

  const triggerZipDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();

    // Delay revoke so large downloads are not aborted by early object URL cleanup.
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 60000);
  };

  const zipBase64ToBlob = (base64: string): Blob => {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: "application/zip" });
  };

  const resetSession = () => {
    setScrapeResult(null);
    setActivityLog([]);
    setDownloadProgress({ current: 0, total: 0 });
    setIsAnalyzing(false);
    setIsDownloading(false);
    setNotice(null);
    setTargetUrl("");
  };

  // Auto-dismiss toast (keeps UI calm during long downloads)
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(id);
  }, [notice]);

  const handleAnalyze = async () => {
    if (!targetUrl.trim()) {
      setNotice({ type: "error", message: "drop something first." });
      return;
    }
    // Prevent stale result reuse when a new analyze attempt starts.
    setScrapeResult(null);
    setActivityLog([]);
    setDownloadProgress({ current: 0, total: 0 });
    setIsAnalyzing(true);
    setNotice({ type: "analyzing", message: "Analyzing..." });
    try {
      const res = await fetch("/api/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setScrapeResult(data);
    } catch (error: any) {
      // Keep state consistent: failed analyze must not leave old scrapeResult active.
      setScrapeResult(null);
      setNotice({ type: "error", message: `couldn't get in. ${error.message}` });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDownloadAll = async () => {
    if (!scrapeResult?.fonts?.length) return;
    const expectedCountHint =
      typeof scrapeResult?.expectedCount === "number" && scrapeResult.expectedCount > 1
        ? scrapeResult.expectedCount
        : undefined;
    setIsDownloading(true);
    setDownloadProgress({ current: 0, total: 0 });
    setActivityLog([]);

    try {
      const res = await fetch("/api/font-download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "browser-intercept",
          targetUrl: scrapeResult.targetUrl || scrapeResult.originalUrl,
          expectedCount: expectedCountHint,
          injectScript: scrapeResult.injectScript,
          masterFoundry: scrapeResult.masterFoundry,
          licenseId: smartForm.licenseId || undefined,
          licenseProof: smartForm.licenseProof || undefined,
          stream: true,
          metadata: {
            foundry: scrapeResult.foundryName,
            family: scrapeResult.fonts?.[0]?.family || "",
            fonts: scrapeResult.fonts,
            masterFoundry: scrapeResult.masterFoundry === true,
            ...(scrapeResult.metadata || {}), // CRITICAL: Forward metadata from scraper (e.g. bypassWhitelist)
            ...smartForm
          },
        }),
      });

      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;

          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "log") {
            appendLog(String(event.message || ""));
            continue;
          }

          if (event.type === "progress") {
            const current = typeof event.current === "number" ? event.current : 0;
            const total = typeof event.total === "number" ? event.total : 0;
            setDownloadProgress({ current, total });
            continue;
          }

          if (event.type === "error") {
            const message = String(event.error || "Download failed");
            appendLog(`✕ ${message}`);
            throw new Error(message);
          }

          if (event.type === "result") {
            setIsDownloading(false);
            if (event.result && typeof event.result === "object") {
              setScrapeResult((prev: any) => (prev ? { ...prev, downloadResult: event.result } : prev));
            }
            if (event.zipBase64) {
              const blob = zipBase64ToBlob(String(event.zipBase64));
              const fallbackFoundryToken =
                String(scrapeResult?.foundryName || "fonts")
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/-+/g, "-")
                  .replace(/^-+|-+$/g, "") || "fonts";
              const fileName = event.zipFile || `specimen-${fallbackFoundryToken}-fonts.zip`;
              triggerZipDownload(blob, fileName);
            }
            return;
          }
        }
      }
    } catch (e: any) {
      appendLog(`✕ ${e.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Win95Desktop
      isSpecimenOpen={isAppRunning || isAnalyzing || !!scrapeResult}
      onOpenSpecimen={() => setIsAppRunning(true)}
      onCloseSpecimen={() => {
        setIsAppRunning(false);
        resetSession();
      }}
      notice={notice}
      targetUrl={targetUrl}
      onSearchChange={(val) => setTargetUrl(val)}
      onAnalyze={handleAnalyze}
      isAnalyzing={isAnalyzing}
      isDownloading={isDownloading}
      isSearchVisible={isAppRunning && !scrapeResult && !isAnalyzing}
      runtimeLogs={activityLog}
    >


      {({ isActive, onMinimize }) => (
        <AnimatePresence>
          {scrapeResult && (
              <Win95AnalysisDashboard
                  result={scrapeResult}
                  logs={activityLog}
                  onDownload={handleDownloadAll}
                  onReset={resetSession}
                  isDownloading={isDownloading}
                  progress={downloadProgress}
                  isActive={isActive}
                  onMinimize={onMinimize}
              />
          )}
        </AnimatePresence>
      )}
    </Win95Desktop>
  );
}
