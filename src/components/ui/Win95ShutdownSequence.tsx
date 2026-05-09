"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DesktopAmbientOverlay from "./DesktopAmbientOverlay";

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
            {/* Termination message container */}
            <div className="z-10 flex flex-col items-center">
               <div className="text-[16px] text-white opacity-90 tracking-wide text-center" style={{ fontFamily: "var(--font-shell)" }}>
                 Please wait while your computer shuts down.
               </div>
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
            {/* Final disconnect state indicator */}
            <div className="flex flex-col items-center gap-6 z-[20001]">
              <div 
                className="text-[20px] text-[#ff7700] text-center"
                style={{ 
                  fontFamily: "var(--font-shell)",
                  fontWeight: "normal",
                  letterSpacing: "0.02em" 
                }}
              >
                It is now safe to turn off your computer.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
