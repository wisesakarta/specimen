"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DesktopAmbientOverlay from "./DesktopAmbientOverlay";
import Win95ProgressBar from "./Win95ProgressBar";

interface Win95BootSequenceProps {
  onComplete: () => void;
}

export default function Win95BootSequence({ onComplete }: Win95BootSequenceProps) {
  const [stage, setStage] = useState<"initializing" | "ready">("initializing");

  useEffect(() => {
    // Quiet initialization phase
    const timer = setTimeout(() => {
      setStage("ready");
      // Gradual emergence
      const completionTimer = setTimeout(onComplete, 1800);
      return () => clearTimeout(completionTimer);
    }, 2500);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div 
      className="fixed inset-0 z-[10000] bg-black select-none overflow-hidden cursor-none" 
    >
      <DesktopAmbientOverlay />

      {/* 1. Dithered Horizon Substrate — The Emergence of Specimen */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.15 }}
        transition={{ duration: 3, ease: "easeInOut" }}
        className="absolute inset-0 win-dither"
        style={{
          background: 'radial-gradient(circle at 50% 120%, rgba(0, 128, 128, 0.4) 0%, transparent 70%)',
          mixBlendMode: 'overlay'
        }}
      />

      {/* 2. Quiet Progress Bar — Mechanical Pulse */}
      <div className="absolute bottom-[18%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
        <Win95ProgressBar 
          progress={100} // This bar animates from 0 to 100 via its internal motion
          className="w-48"
          height={14}
        />
        <div className="font-sans text-[10px] text-[var(--win-face)] opacity-40 tracking-[0.15em]">
          Restoring sovereign substrate...
        </div>
      </div>

      <AnimatePresence>
        {stage === "initializing" && (
          <motion.div 
            key="substrate"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.8, ease: [0.4, 0, 0.2, 1] }}
            className="w-full h-full bg-black flex items-center justify-center"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
