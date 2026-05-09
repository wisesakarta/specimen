"use client";

import { useState, useRef, useEffect } from "react";
import type { RuntimeActivityState } from "@/lib/runtime";
import Win95ProgressBar from "@/components/ui/Win95ProgressBar";

import type { SovereignRuntimeProps } from "@/runtime/runtime-dispatch";

interface WebBrowserProps extends SovereignRuntimeProps {}

export default function WebBrowser({ 
  onFocus,
  onMaximize,
  onActivityChange 
}: WebBrowserProps) {
  const [url, setUrl] = useState("https://fonts.google.com");
  const [displayUrl, setDisplayUrl] = useState("https://fonts.google.com");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "complete">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const currentReqRef = useRef(0);

  // Send initial subtitle
  useEffect(() => {
    if (status === "idle") {
      try {
        const domain = new URL(url).hostname;
        onActivityChange?.({ subtitle: domain, dirty: false });
      } catch {
        onActivityChange?.({ subtitle: "Web Browser", dirty: false });
      }
    }
  }, []);

  const handleGo = async (e: React.FormEvent) => {
    e.preventDefault();
    let target = displayUrl;
    if (!target.startsWith("http")) target = "https://" + target;
    
    currentReqRef.current += 1;
    const reqId = currentReqRef.current;

    setUrl(target);
    setDisplayUrl(target);
    setStatus("loading");
    setErrorMsg("");
    
    onActivityChange?.({ subtitle: "Loading...", dirty: true });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      await fetch(target, { mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeoutId);
    } catch (err: any) {
      if (currentReqRef.current !== reqId) return;
      if (err.name === 'AbortError') {
        setStatus("error");
        setErrorMsg("Network connection timed out.");
        onActivityChange?.({ subtitle: "Timeout", dirty: false });
      } else {
        setStatus("error");
        setErrorMsg("Network connection unavailable.");
        onActivityChange?.({ subtitle: "Offline", dirty: false });
      }
    }
  };

  const handleIframeLoad = () => {
    // If the fetch check already set error, don't override
    if (status === "error") return;

    try {
      const doc = iframeRef.current?.contentDocument;
      if (doc) {
        // We can read it (either same-origin or blocked about:blank)
        if (doc.URL === "about:blank" || doc.URL === "") {
          setStatus("error");
          setErrorMsg("Rendering prohibited by remote policy.");
          onActivityChange?.({ subtitle: "Blocked", dirty: false });
        } else {
          setStatus("complete");
          const pageTitle = doc.title || "Untitled";
          onActivityChange?.({ subtitle: pageTitle, dirty: false });
        }
      }
    } catch (e) {
      // SecurityError: Cross-origin success or Chrome error page
      // If it's a Chrome error page, the fetch catch block will eventually overwrite this to "error".
      setStatus("complete");
      try {
        const domain = new URL(url).hostname;
        onActivityChange?.({ subtitle: domain, dirty: false });
      } catch {
        onActivityChange?.({ subtitle: "Web Browser", dirty: false });
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--win-face)]" onMouseDown={() => onFocus?.()}>
      {/* Address Bar */}
      <form 
        onSubmit={handleGo}
        className="flex items-center gap-2 p-1 border-b border-[var(--win-shadow)] select-none"
      >
        <span className="text-[11px] ml-1">Address:</span>
        <input 
          className="flex-1 px-2 py-0.5 bg-white border border-[var(--win-shadow)] text-[11px] outline-none"
          value={displayUrl}
          onChange={(e) => setDisplayUrl(e.target.value)}
        />
        <button 
          type="submit"
          className="win-btn h-5 px-3 text-[10px]"
        >
          Go
        </button>
      </form>

      {/* Mechanical Loading State */}
      {status === "loading" && (
        <div className="p-1 border-b border-[var(--win-shadow)] flex items-center bg-[var(--win-face)] gap-2">
           <span className="text-[10px] text-[var(--win-text)] whitespace-nowrap ml-1">Connecting...</span>
           <Win95ProgressBar indeterminate className="flex-1 max-w-[200px]" height={12} />
        </div>
      )}

      {/* Browser Viewport */}
      <div className="flex-1 bg-white overflow-hidden relative">
        <iframe 
          ref={iframeRef}
          src={url}
          className="w-full h-full border-0"
          title="Web Browser"
          onLoad={handleIframeLoad}
          style={{ visibility: status === "complete" || status === "idle" ? "visible" : "hidden" }}
        />
        
        {/* Failure State Legitimacy */}
        {status === "error" && (
          <div className="absolute inset-0 bg-[var(--win-face)] flex flex-col items-center justify-center p-4">
            <div className="w-full max-w-[300px] border-2 border-[var(--win-face)]" style={{ boxShadow: 'var(--bevel-raised)' }}>
              <div className="bg-[#000080] text-white px-2 py-1 flex items-center gap-2 select-none">
                <span className="font-bold text-[11px]">Network Error</span>
              </div>
              <div className="p-4 bg-[var(--win-face)] flex flex-col gap-4 text-[11px]">
                <p className="font-mono text-[10px] leading-relaxed select-text">{errorMsg}</p>
                <div className="flex justify-end">
                  <button 
                    onClick={() => {
                      setStatus("idle");
                      onActivityChange?.({ subtitle: "Ready", dirty: false });
                    }} 
                    className="win-btn px-4 py-1"
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Overlay for aesthetic */}
        {status !== "error" && (
           <div className="absolute inset-0 pointer-events-none border-t border-[var(--win-shadow)]" />
        )}
      </div>
    </div>
  );
}
