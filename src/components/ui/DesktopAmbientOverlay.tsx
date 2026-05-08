"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

/**
 * DesktopAmbientOverlay — Environmental Materiality Layer
 * 
 * Provides the quiet, technical presence that transforms SPECIMEN
 * from a flat interface into a serious software civilization.
 * 
 * Materiality Rules:
 * - NO scanlines.
 * - NO chromatic aberration.
 * - NO aggressive flicker.
 * - Sub-5% opacity everywhere.
 */
export default function DesktopAmbientOverlay() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden select-none">
      
      {/* 1. Restrained Environmental Grain 
          Provides a technical "substrate" that feels inhabited and serious. 
      */}
      <div 
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          backgroundSize: '150px 150px',
        }}
      />

      {/* 2. Faint Substrate Depth
          A very low-contrast vignette that grounds the shell and prevents "flat void" syndrome.
      */}
      <div 
        className="absolute inset-0 opacity-[0.15]"
        style={{
          background: 'radial-gradient(circle at center, transparent 0%, rgba(0,0,0,0.4) 100%)',
          mixBlendMode: 'multiply'
        }}
      />

      {/* 3. Subtle Phosphor Persistence / Atmospheric Bloom
          A nearly invisible glow that softens the harsh digital edges without becoming "cinematic."
      */}
      <div 
        className="absolute inset-0 opacity-[0.06]"
        style={{
          boxShadow: 'inset 0 0 80px rgba(0, 128, 128, 0.4)', // The --win-desktop teal color
        }}
      />

      {/* 4. Topology Emergence Layer
          Quietly pulses to indicate environmental availability.
          Added subtle "emotional flicker" — extremely restrained.
      */}
      <motion.div
        className="absolute inset-0 bg-[var(--win-highlight)]"
        animate={{
          opacity: [0.01, 0.015, 0.012, 0.018, 0.01],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "linear",
          times: [0, 0.3, 0.5, 0.8, 1]
        }}
      />
    </div>
  );
}
