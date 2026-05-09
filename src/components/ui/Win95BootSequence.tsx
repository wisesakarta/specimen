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

      {/* OS Identity Initialization */}
      <div className="absolute inset-0 flex items-center justify-center px-4">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className="flex flex-col items-start max-w-full"
        >
          <div className="text-[9px] sm:text-[12px] font-bold text-white/70 mb-1 ml-1 truncate" style={{ letterSpacing: '0.15em' }}>
            Technical Standard
          </div>
          <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
            <div 
              className="text-5xl sm:text-7xl font-black italic text-white" 
              style={{ textShadow: "3px 3px 0 var(--win-shadow)", letterSpacing: "-0.02em" }}
            >
              Specimen
            </div>
            <div className="text-2xl sm:text-4xl font-light text-white/80" style={{ letterSpacing: "0.04em" }}>
              v2.0
            </div>
          </div>
        </motion.div>
      </div>

      {/* Quiet Progress Bar — Mechanical Pulse */}
      <div className="absolute bottom-[15%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
        <Win95ProgressBar 
          indeterminate
          className="w-64"
          height={16}
        />
      </div>

      <AnimatePresence>
        {stage === "initializing" && (
          <motion.div 
            key="substrate"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.8, ease: [0.4, 0, 0.2, 1] }}
            className="w-full h-full bg-black flex items-center justify-center pointer-events-none"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
