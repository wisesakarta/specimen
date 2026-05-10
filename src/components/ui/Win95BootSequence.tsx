"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Win95ProgressBar from "./Win95ProgressBar";

interface Win95BootSequenceProps {
  onComplete: () => void;
}

/**
 * Win95BootSequence
 * Canonical Windows 95 boot splash reinterpreted for Specimen 95.
 *
 * Reference: pcjs Win95 emulator boot sequence.
 * Layout: full-viewport teal backdrop, centered "Specimen 95" wordmark
 * above "Starting Specimen 95..." status strip, progress band near the
 * bottom edge.
 *
 * Motion: single opacity fade-in on mount, 50ms linear, matching the
 * instant window materialization rule in AGENTS.md Section XVI.
 */
export default function Win95BootSequence({ onComplete }: Win95BootSequenceProps) {
  const [stage, setStage] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    // Canonical Win95 boot sits on-screen long enough to read the wordmark
    // and observe the progress indicator before yielding to the desktop.
    const settleTimer = setTimeout(() => setStage("ready"), 2200);
    const completeTimer = setTimeout(onComplete, 3400);

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-[10000] select-none overflow-hidden"
      style={{
        background: "var(--win-desktop)",
        fontFamily: "var(--font-shell)",
      }}
    >
      {/* Centered wordmark — canonical Win95 splash layout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: "linear" }}
          className="flex items-baseline gap-3"
        >
          <span
            style={{
              fontFamily: "var(--font-shell)",
              fontSize: "clamp(56px, 10vw, 96px)",
              fontWeight: 700,
              fontStyle: "italic",
              color: "var(--win-highlight)",
              letterSpacing: "-0.02em",
              textShadow: "3px 3px 0 var(--win-dk-shadow)",
              lineHeight: 1,
            }}
          >
            Specimen
          </span>
          <span
            style={{
              fontFamily: "var(--font-shell)",
              fontSize: "clamp(40px, 7vw, 68px)",
              fontWeight: 700,
              color: "var(--win-highlight)",
              letterSpacing: "-0.02em",
              textShadow: "3px 3px 0 var(--win-dk-shadow)",
              lineHeight: 1,
            }}
          >
            95
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: "linear", delay: 0.2 }}
          className="mt-8 flex flex-col items-center gap-3"
        >
          <span
            style={{
              fontFamily: "var(--font-shell)",
              fontSize: 12,
              color: "var(--win-highlight)",
              opacity: 0.9,
            }}
          >
            Starting Specimen 95{stage === "ready" ? " — Ready" : "..."}
          </span>
        </motion.div>
      </div>

      {/* Progress band — pinned near the bottom edge, canonical placement */}
      <div className="absolute bottom-[12%] left-1/2 -translate-x-1/2 w-[280px]">
        <Win95ProgressBar indeterminate height={14} />
      </div>

      {/* Copyright strap — canonical Win95 splash foot */}
      <div
        className="absolute bottom-6 left-0 right-0 text-center"
        style={{
          fontFamily: "var(--font-shell)",
          fontSize: 11,
          color: "var(--win-highlight)",
          opacity: 0.7,
        }}
      >
        Technical Standard · Specimen 95
      </div>

      {/* Black fade-in overlay — matches canonical pre-splash black screen */}
      <AnimatePresence>
        {stage === "loading" && (
          <motion.div
            key="substrate"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: "linear" }}
            className="absolute inset-0 bg-black pointer-events-none"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
