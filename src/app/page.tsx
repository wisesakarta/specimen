"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import SakaSearchInput from "@/components/ui/SakaSearchInput";
import AnalysisDashboard from "@/components/ui/AnalysisDashboard";
import BrutalistNotification from "@/components/ui/BrutalistNotification";

interface SmartFormState {
  outputFolder: string;
  source: string;
  licenseId?: string;
  licenseProof?: string;
}

type Notice = {
  type: "info" | "success" | "error" | "analyzing";
  message: string;
};

const DEFAULT_SMART_FORM: SmartFormState = {
  outputFolder: "",
  source: "",
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
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = window.localStorage.getItem("specimen-theme") ?? window.localStorage.getItem("aksara-theme") ?? window.localStorage.getItem("saka-theme");
    const resolved = saved === "dark" || saved === "light" ? (saved as "light" | "dark") : "light";
    setTheme(resolved);
  }, []);

  // Smooth scroll
  useEffect(() => {
    let lenis: any = null;
    let rafId = 0;
    let isMounted = true;

    const setup = async () => {
      const { default: Lenis } = await import("lenis");
      if (!isMounted) return;
      lenis = new Lenis({ duration: 1.08 });
      const raf = (time: number) => {
        lenis?.raf(time);
        rafId = window.requestAnimationFrame(raf);
      };
      rafId = window.requestAnimationFrame(raf);
    };
    void setup();
    return () => {
      isMounted = false;
      window.cancelAnimationFrame(rafId);
      lenis?.destroy();
    };
  }, []);

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
    setIsAnalyzing(true);
    // Heist Theme: Randomize the "Loading" message
    const heistMsgs = ["reading.", "finding the gaps.", "there it is.", "almost."];
    const randomMsg = heistMsgs[Math.floor(Math.random() * heistMsgs.length)];
    
    setNotice({ type: "analyzing", message: randomMsg });
    try {
      const res = await fetch("/api/analyze-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setScrapeResult(data);
      appendLog(`→ ${data.foundryName}. ${data.fonts?.length || 0} assets on the table.`);
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
    const fonts = Array.isArray(scrapeResult?.fonts) ? scrapeResult.fonts : [];
    const hasPlaceholder = fonts.some(
      (font: any) => String(font?.url || "").toLowerCase() === "browser-intercept" || String(font?.url || "").toLowerCase() === "interception-mode"
    );
    const directFonts = fonts.filter(
      (font: any) =>
        typeof font?.url === "string" &&
        (/^https?:\/\//i.test(font.url) || /^inline-font:\/\//i.test(font.url))
    );
    const targetHost = (() => {
      try {
        return new URL(scrapeResult.targetUrl || scrapeResult.originalUrl || "").hostname.toLowerCase();
      } catch {
        return "";
      }
    })();
    const shouldPreferDirect = /(^|\.)abcdinamo\.com$/.test(targetHost);
    const shouldBatchDirect = directFonts.length > 0 && (!hasPlaceholder || shouldPreferDirect);
    setIsDownloading(true);
    setDownloadProgress({ current: 0, total: scrapeResult.fonts.length });
    appendLog("→ running.");

    try {
      if (shouldBatchDirect) {
        appendLog(`→ ${directFonts.length} assets. batch mode.`);
        const res = await fetch("/api/font-download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "batch-direct",
            fonts: directFonts,
            source: smartForm.source || scrapeResult.foundryName || "",
            outputFolder: smartForm.outputFolder || "",
            licenseId: smartForm.licenseId || undefined,
            licenseProof: smartForm.licenseProof || undefined,
            metadata: {
              foundry: scrapeResult.foundryName,
              family: directFonts?.[0]?.family || "",
              targetUrl: scrapeResult.targetUrl || scrapeResult.originalUrl || "",
              fonts: directFonts,
              ...(scrapeResult.metadata || {}),
              ...smartForm
            }
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Download failed (${res.status})`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;

        const cd = res.headers.get("content-disposition") || "";
        const match = cd.match(/filename=\"?([^\";]+)\"?/i);
        link.download = match?.[1] || `specimen-${String(scrapeResult?.foundryName || "fonts").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "fonts"}-fonts.zip`;
        link.click();
        URL.revokeObjectURL(url);

        setDownloadProgress({ current: scrapeResult.fonts.length, total: scrapeResult.fonts.length });
        appendLog("→ done.");
        return;
      }

      appendLog("→ intercept mode.");
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
          try {
            const event = JSON.parse(line);
            if (event.type === "log") appendLog(event.message);
            if (event.type === "progress") setDownloadProgress({ current: event.current, total: event.total });
            if (event.type === "result") {
              appendLog("→ done.");
              setIsDownloading(false);
              if (event.zipBase64) {
                const link = document.createElement("a");
                link.href = `data:application/zip;base64,${event.zipBase64}`;
                link.download = event.zipFile || `specimen-${String(scrapeResult?.foundryName || "fonts").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "fonts"}-fonts.zip`;
                link.click();
              }
              return;
            }
          } catch (e) {}
        }
      }
    } catch (e: any) {
      appendLog(`✕ ${e.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="w-full min-h-screen flex flex-col items-center">
      
      {/* Search Section - Hidden when analyzing/done */}
      <AnimatePresence>
        {!(scrapeResult || isAnalyzing) && (
            <section className="w-full flex-1 flex items-center absolute inset-0 z-10 pointer-events-auto">
                <div className="w-full max-w-[1200px] mx-auto">
                    <SakaSearchInput 
                        value={targetUrl}
                        onChange={(e) => setTargetUrl(e.target.value)}
                        onAnalyze={handleAnalyze}
                        disabled={isAnalyzing}
                    />
                </div>
            </section>
        )}
      </AnimatePresence>

      {/* Analysis Dashboard - Overlay */}
      <AnimatePresence>
        {scrapeResult && (
            <AnalysisDashboard 
                result={scrapeResult}
                logs={activityLog}
                onDownload={handleDownloadAll}
                onReset={resetSession}
                isDownloading={isDownloading}
                progress={downloadProgress}
            />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {notice && (
          <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none">
            <BrutalistNotification 
                type={notice.type}
                message={notice.message}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
