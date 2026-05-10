"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Win95ShutdownSequenceProps {
  mode?: "shutdown" | "restart";
  onComplete?: () => void;
}

/**
 * Win95ShutdownSequence
 * Canonical Windows 95 shutdown sequence.
 *
 * Reference: pcjs Win95 emulator.
 * Sequence:
 *   1. Teal backdrop with centered "Please wait while your computer
 *      shuts down." message, rendered in the canonical bitmap shell font.
 *   2. Transition to full-black screen with amber "It is now safe to
 *      turn off your computer." message — the canonical Win95 power-down
 *      prompt (#ff6600 on #000000).
 *
 * Motion is deliberately austere: single opacity transitions, no bloom,
 * no ambient overlays. The Win95 shutdown surface is operational finality,
 * not atmospheric reveal.
 */
export default function Win95ShutdownSequence({ mode = "shutdown" }: Win95ShutdownSequenceProps) {
  const [isTerminated, setIsTerminated] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (mode === "restart") {
        window.location.reload();
      } else {
        setIsTerminated(true);
      }
    }, 2400);

    return () => clearTimeout(timer);
  }, [mode]);

  return (
    <div
      className="fixed inset-0 z-[20000] flex items-center justify-center select-none overflow-hidden"
      style={{ background: isTerminated ? "#000000" : "var(--win-desktop)" }}
    >
      <AnimatePresence mode="wait">
        {!isTerminated ? (
          <motion.div
            key="terminating"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: "linear" }}
            className="flex flex-col items-center gap-6 px-6"
          >
            <span
              style={{
                fontFamily: "var(--font-shell)",
                fontSize: 14,
                color: "var(--win-highlight)",
                textAlign: "center",
                lineHeight: 1.4,
                maxWidth: 520,
              }}
            >
              Please wait while your computer shuts down.
            </span>
          </motion.div>
        ) : (
          <motion.div
            key="terminated"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: "linear" }}
            className="flex flex-col items-center px-6"
          >
            <span
              style={{
                fontFamily: "var(--font-shell)",
                fontSize: 24,
                color: "#ff6600",
                textAlign: "center",
                letterSpacing: "0.02em",
              }}
            >
              It&rsquo;s now safe to turn off your computer.
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
