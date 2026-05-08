"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DesktopAmbientOverlay from "./DesktopAmbientOverlay";
import Win95ProgressBar from "./Win95ProgressBar";

interface Win95ShutdownSequenceProps {
  mode?: "shutdown" | "restart";
  onComplete?: () => void;
}

export default function Win95ShutdownSequence({ mode = "shutdown", onComplete }: Win95ShutdownSequenceProps) {
  const [isTerminated, setIsTerminated] = useState(false);

  useEffect(() => {
    // Quiet termination sequence
    const timer = setTimeout(() => {
      if (mode === "restart") {
        window.location.reload();
      } else {
        setIsTerminated(true);
      }
    }, 2800);

    return () => clearTimeout(timer);
  }, [mode]);

  return (
    <div className="fixed inset-0 z-[20000] bg-black flex items-center justify-center select-none overflow-hidden cursor-none">
      <DesktopAmbientOverlay />
      
      <AnimatePresence mode="wait">
        {!isTerminated ? (
          <motion.div 
            key="terminating"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: "linear" }}
            className="w-full h-full bg-black flex items-center justify-center relative"
          >
            {/* 1. Subtle Dithered Horizon (Termination Phase) */}
            <div 
              className="absolute inset-0 win-dither opacity-[0.05]"
              style={{
                background: 'radial-gradient(circle at 50% 0%, rgba(128, 0, 0, 0.2) 0%, transparent 60%)',
                mixBlendMode: 'overlay'
              }}
            />

            {/* 2. Authentic Win95 "Please wait..." box */}
            <div className="flex flex-col items-center gap-4 p-8 win-dither bg-[rgba(0,0,0,0.6)] z-10">
               <div className="font-sans text-[12px] text-[var(--win-face)] opacity-70 tracking-wide">
                 Please wait while the environment terminates...
               </div>
               <Win95ProgressBar 
                  indeterminate
                  height={4}
                  className="w-40 border-0"
               />
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="terminated"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1.2 }}
            className="w-full h-full bg-black flex flex-col items-center justify-center relative"
          >
            {/* 3. Full-Screen Dithered Finality */}
            <div className="absolute inset-0 win-dither opacity-[0.1]" />

            {/* 4. Authentic Win95 "It is now safe..." materiality */}
            <div className="flex flex-col items-center gap-6 z-[20001]">
              <div 
                className="font-sans text-[16px] text-orange-600 opacity-80 text-center leading-relaxed"
                style={{ letterSpacing: "0.04em", textShadow: '0 0 4px rgba(255, 100, 0, 0.2)' }}
              >
                It is now safe to disconnect.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
