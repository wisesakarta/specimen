"use client";

import { useState } from "react";

export default function WebBrowser() {
  const [url, setUrl] = useState("https://fonts.google.com");
  const [displayUrl, setDisplayUrl] = useState("https://fonts.google.com");

  const handleGo = (e: React.FormEvent) => {
    e.preventDefault();
    let target = displayUrl;
    if (!target.startsWith("http")) target = "https://" + target;
    setUrl(target);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--win-face)]">
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

      {/* Browser Viewport */}
      <div className="flex-1 bg-white overflow-hidden relative">
        <iframe 
          src={url}
          className="w-full h-full border-0"
          title="Web Browser"
        />
        
        {/* Overlay if iframe fails or for aesthetic */}
        <div className="absolute inset-0 pointer-events-none border-t border-[var(--win-shadow)]" />
      </div>
    </div>
  );
}
