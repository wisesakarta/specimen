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
      const isBatchDirect = scrapeResult.fonts.some(
        (f: any) =>
          typeof f?.url === "string" &&
          (/^https?:\/\//i.test(f.url) || /^inline-font:\/\/[a-z0-9]+$/i.test(f.url))
      );
      
      const payload = {
        mode: isBatchDirect ? "batch-direct" : "browser-intercept",
        targetUrl: scrapeResult.targetUrl || scrapeResult.originalUrl,
        expectedCount: expectedCountHint,
        injectScript: scrapeResult.injectScript,
        masterFoundry: scrapeResult.masterFoundry,
        licenseId: smartForm.licenseId || undefined,
        licenseProof: smartForm.licenseProof || undefined,
        fonts: scrapeResult.fonts,
        metadata: {
          foundry: scrapeResult.foundryName,
          family: scrapeResult.fonts?.[0]?.family || "",
          fonts: scrapeResult.fonts,
          masterFoundry: scrapeResult.masterFoundry === true,
          ...(scrapeResult.metadata || {}),
          ...smartForm
        },
      };

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to spawn daemon job (HTTP ${res.status})`);
      }

      const { jobId } = await res.json();
      appendLog(`[Daemon] Background job spawned. PID: ${jobId}`);

      let lastLogCount = 0;
      
      const pollInterval = window.setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/jobs/${jobId}`);
          if (!statusRes.ok) return;

          const job = await statusRes.json();
          
          if (job.logs && job.logs.length > lastLogCount) {
            const newLogs = job.logs.slice(lastLogCount);
            setActivityLog(prev => [...prev, ...newLogs].slice(-200));
            lastLogCount = job.logs.length;
          }

          if (job.status === "SUCCESS") {
            window.clearInterval(pollInterval);
            setIsDownloading(false);
            
            const downloadUrl = `/api/jobs/${jobId}/download`;
            const link = document.createElement("a");
            link.href = downloadUrl;
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            
            window.setTimeout(() => link.remove(), 1000);
            appendLog(`[Daemon] Execution SUCCESS. Artifact delivery initiated.`);
          } else if (job.status === "FAILED") {
            window.clearInterval(pollInterval);
            setIsDownloading(false);
            appendLog(`✕ [Daemon] Execution FAILED: ${job.result?.error || "Internal error"}`);
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 2000);

    } catch (e: any) {
      appendLog(`✕ ${e.message}`);
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
