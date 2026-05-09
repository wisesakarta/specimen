"use client";

import { useEffect, useRef } from "react";
import Webamp from "webamp";
import type { AudioPlaybackState } from "@/lib/runtime";
import type { WindowData } from "@/lib/os-config";

interface WebampPlayerProps {
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onFocus?: () => void;
  onPositionChange?: (pos: { x: number; y: number }) => void;
  onPlaybackChange?: (state: AudioPlaybackState) => void;
  isVisible?: boolean;
  initialData?: WindowData;
}

export default function WebampPlayer({
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onPositionChange,
  onPlaybackChange,
  isVisible = true,
  initialData,
}: WebampPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const webampRef = useRef<any>(null);
  // Ref to div#webamp that Webamp appends to document.body
  const webampBodyNodeRef = useRef<HTMLElement | null>(null);
  // Tracks current track metadata for playback state emissions
  const currentTrackRef = useRef<{ title?: string; artist?: string } | undefined>(undefined);

  // Mutable refs so the init effect (deps=[]) always calls the latest callbacks
  const onCloseRef = useRef(onClose);
  const onMinimizeRef = useRef(onMinimize);
  const onFocusRef = useRef(onFocus);
  const onPositionChangeRef = useRef(onPositionChange);
  const onPlaybackChangeRef = useRef(onPlaybackChange);
  const isVisibleRef = useRef(isVisible);

  onCloseRef.current = onClose;
  onMinimizeRef.current = onMinimize;
  onFocusRef.current = onFocus;
  onPositionChangeRef.current = onPositionChange;
  onPlaybackChangeRef.current = onPlaybackChange;
  isVisibleRef.current = isVisible;

  // Toggle the body-level #webamp node when isVisible changes.
  useEffect(() => {
    const node = webampBodyNodeRef.current;
    if (!node) return;
    node.style.display = isVisible ? "" : "none";
  }, [isVisible]);

  // Handle skin projection from shell
  useEffect(() => {
    let effectCancelled = false;
    if (!webampRef.current || !initialData) return;
    
    const skinUrl = typeof initialData === "string" ? initialData : (initialData as any)?.skinUrl;
    if (skinUrl) {
      const applySkin = async () => {
        try {
          await webampRef.current.setSkinFromUrl(skinUrl);
        } catch (err) {
          if (!effectCancelled) {
            console.error("Failed to project skin:", err);
          }
        }
      };
      applySkin();
    }

    return () => {
      effectCancelled = true;
    };
  }, [initialData]);

  useEffect(() => {
    if (!Webamp.browserIsSupported()) return;

    const webamp = new Webamp({
      initialTracks: [
        {
          metaData: {
            artist: "Technical Standard",
            title: "Specimen (Theme)",
          },
          url: "https://cdn.jsdelivr.net/npm/webamp/built/demo/mp3/llama-2.91.mp3",
          duration: 5,
        },
      ],
      initialSkin: initialData && typeof initialData === "string" 
        ? { url: initialData } 
        : ((initialData as any)?.skinUrl ? { url: (initialData as any).skinUrl } : undefined)
    });

    webampRef.current = webamp;

    webamp.onClose(() => onCloseRef.current?.());
    webamp.onMinimize(() => onMinimizeRef.current?.());

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
          const target = mutation.target as HTMLElement;
          if (target.id === "webamp" || target.classList.contains("webamp-window")) {
            const x = parseInt(target.style.left || "0", 10);
            const y = parseInt(target.style.top || "0", 10);
            if (!isNaN(x) && !isNaN(y)) {
              onPositionChangeRef.current?.({ x, y });
            }
          }
        }
      });
    });

    let cancelled = false;
    let audioEl: HTMLAudioElement | null = null;
    let onPlay: (() => void) | null = null;
    let onPause: (() => void) | null = null;

    const run = async () => {
      if (!containerRef.current) return;
      try {
        await webamp.renderWhenReady(containerRef.current);
      } catch (err) {
        console.warn("Webamp render failed (likely disposed):", err);
        return;
      }
      
      if (cancelled) return;

      // Webamp appends div#webamp to document.body — capture it for visibility control
      webampBodyNodeRef.current = document.getElementById("webamp");

      // Apply current visibility in case user minimized before render resolved
      if (webampBodyNodeRef.current && !isVisibleRef.current) {
        webampBodyNodeRef.current.style.display = "none";
      }

      observer.observe(containerRef.current, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["style"],
      });

      // Track change → update metadata + emit playback state
      webamp.onTrackDidChange((track: any) => {
        const info = {
          title: track?.metaData?.title ?? undefined,
          artist: track?.metaData?.artist ?? undefined,
        };
        currentTrackRef.current = info;
        if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: info.title ?? "Unknown",
            artist: info.artist ?? "Unknown",
          });
        }
        onPlaybackChangeRef.current?.({ isPlaying: true, track: info });
      });

      // Audio element play/pause → emit state + sync Media Session
      audioEl = document.querySelector<HTMLAudioElement>("#webamp audio") ?? document.querySelector("audio");
      if (audioEl) {
        onPlay = () => {
          if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "playing";
          }
          onPlaybackChangeRef.current?.({ isPlaying: true, track: currentTrackRef.current });
        };
        onPause = () => {
          if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
          }
          onPlaybackChangeRef.current?.({ isPlaying: false, track: currentTrackRef.current });
        };
        audioEl.addEventListener("play", onPlay);
        audioEl.addEventListener("pause", onPause);
      }

      // Media keyboard keys → control Webamp audio element
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("play", () => audioEl?.play());
        navigator.mediaSession.setActionHandler("pause", () => audioEl?.pause());
        navigator.mediaSession.setActionHandler("stop", () => audioEl?.pause());
      }
    };

    run();

    return () => {
      cancelled = true;
      if (audioEl && onPlay && onPause) {
        audioEl.removeEventListener("play", onPlay);
        audioEl.removeEventListener("pause", onPause);
      }
      if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("stop", null);
      }
      if (webampBodyNodeRef.current) {
        webampBodyNodeRef.current.style.display = "";
        webampBodyNodeRef.current = null;
      }
      observer.disconnect();
      try {
        webampRef.current = null;
        webamp.dispose();
      } catch (e) {
        console.warn("Webamp disposed with suppressed error:", e);
      }
    };
  }, []); // Never re-run — Webamp owns its own lifecycle

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      onMouseDown={() => onFocusRef.current?.()}
    >
      <div className="absolute inset-0 flex items-center justify-center text-[#00ff00] font-mono text-xs pointer-events-none opacity-20">
        LOADING WINAMP...
      </div>
    </div>
  );
}
