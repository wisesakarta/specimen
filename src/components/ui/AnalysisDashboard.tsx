"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { useGrid } from "@/context/GridContext";

interface AnalysisDashboardProps {
  result: any;
  logs: string[];
  onDownload: () => void;
  onReset: () => void;
  isDownloading: boolean;
  progress: { current: number; total: number };
}

export default function AnalysisDashboard({
  result,
  logs,
  onDownload,
  onReset,
  isDownloading,
  progress,
}: AnalysisDashboardProps) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const { pullTop, pullBottom, pullLeft, pullRight } = useGrid();

  // 1. Container Physics: Stiff & Stable (The "Bone")
  const containerSpringConfig = { stiffness: 400, damping: 30 };
  const cTop = useSpring(pullTop, containerSpringConfig);
  const cBottom = useSpring(pullBottom, containerSpringConfig);
  const cLeft = useSpring(pullLeft, containerSpringConfig);
  const cRight = useSpring(pullRight, containerSpringConfig);

  // 2. Content Physics: Bouncy & Loose (The "Jelly")
  // Lower damping = more wobble, feels liquid
  const contentSpringConfig = { stiffness: 350, damping: 18 }; 
  const iTop = useSpring(pullTop, contentSpringConfig);
  const iBottom = useSpring(pullBottom, contentSpringConfig);
  const iLeft = useSpring(pullLeft, contentSpringConfig);
  const iRight = useSpring(pullRight, contentSpringConfig);

  // --- TRANSFORMS ---

  // Container moves as a unit (reduced intensity for stability)
  const containerX = useTransform([cLeft, cRight], ([l, r]) => ((l as number) + (r as number)) * 0.15);
  const containerY = useTransform([cTop, cBottom], ([t, b]) => ((t as number) + (b as number)) * 0.15);
  const containerRotateX = useTransform([cTop, cBottom], ([t, b]) => ((t as number) - (b as number)) * 0.015);
  const containerRotateY = useTransform([cLeft, cRight], ([l, r]) => ((r as number) - (l as number)) * 0.015);

  // Internal Parallax (The subtle float)
  // These move *more* than the container to simulate "sloshing" insight
  const parallaxHeaderY = useTransform(iTop, (v) => v * 0.25);
  const parallaxListY = useTransform(iBottom, (v) => v * 0.25);
  
  const parallaxLeftX = useTransform(iLeft, (v) => v * 0.25);
  const parallaxRightX = useTransform(iRight, (v) => v * 0.25);

  // Cross-axis "sympathy" (Dragging side affects vertical content slightly)
  const skewContent = useTransform([iLeft, iRight], ([l, r]) => ((l as number) - (r as number)) * 0.02);


  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  if (!result) return null;

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{ 
        paddingTop: 'var(--brutalist-offset-y)',
        paddingBottom: 'var(--brutalist-offset-y)',
        paddingLeft: 'var(--brutalist-offset-x)',
        paddingRight: 'var(--brutalist-offset-x)',
        x: containerX,
        y: containerY,
        rotateX: containerRotateX,
        rotateY: containerRotateY,
        perspective: 1200
      }}
      variants={{
        hidden: { opacity: 0 },
        visible: { opacity: 1 },
        exit: { opacity: 0 }
      }}
      className="fixed inset-0 z-40 bg-[var(--canvas)] flex flex-col md:flex-row"
    >
      {/* Container Wrapper */}
      <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden relative">
          
        {/* Left Pane (Foundry Info) */}
        <motion.div 
            className="flex-1 flex flex-col border-[var(--line-strong)] h-full overflow-hidden relative min-h-0 bg-[var(--paper)]"
            style={{ borderRightWidth: '1px', borderRightStyle: 'solid' }}
            variants={{
                hidden: { x: -50, opacity: 0 },
                visible: { x: 0, opacity: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
            }}
        >
            {/* Header: Reacts to Top Pull + Left Pull */}
            <motion.div 
                className="p-6 md:p-8 flex flex-col gap-2 border-[var(--line-strong)] relative z-10"
                style={{ 
                    borderBottomWidth: '1px', borderBottomStyle: 'solid',
                    y: parallaxHeaderY,
                    x: parallaxLeftX,
                    rotateZ: skewContent
                }}
            >
                <div className="flex items-baseline justify-between select-none">
                    <h2 className="text-xs font-mono font-bold text-[var(--muted)]">Foundry</h2>
                    <div className="text-[10px] mono text-[var(--muted)]">{result.targetUrl || result.originalUrl}</div>
                </div>
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-none truncate">{result.foundryName}</h1>
            </motion.div>

            {/* Controls: Anchored but reacts to Left Pull */}
            <motion.div 
                className="flex border-[var(--line-strong)] h-12 divide-[var(--line-strong)] relative z-20 bg-[var(--paper)]"
                style={{ 
                    borderBottomWidth: '1px', borderBottomStyle: 'solid',
                    x: parallaxLeftX 
                }}
            >
                <button onClick={onReset} className="flex-1 flex items-center justify-center font-bold text-lg hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors tracking-wide" style={{ borderRightWidth: '1px', borderRightStyle: 'solid', borderColor: 'var(--line-strong)' }}>start over.</button>
                <button onClick={onDownload} disabled={isDownloading} className={cn("flex-1 flex items-center justify-center font-bold text-lg text-[var(--paper)] bg-[var(--ink)] transition-colors tracking-wide relative overflow-hidden", isDownloading && "opacity-80 pointer-events-none")}>
                    {isDownloading ? <span className="animate-pulse">pulling {progress.current} of {progress.total}.</span> : "get it."}
                    {isDownloading && progress.total > 0 && <div className="absolute bottom-0 left-0 h-1 bg-[var(--accent)] transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }} />}
                </button>
            </motion.div>

            {/* List: Reacts to Bottom Pull + Left Pull */}
            <div className="flex-1 flex flex-col overflow-hidden relative">
                <motion.div 
                    className="px-6 h-12 flex items-center border-[var(--line-strong)] z-10 relative" 
                    style={{ 
                        backgroundColor: 'var(--ink-soft)', 
                        color: 'var(--paper)',
                        x: parallaxLeftX 
                    }}
                >
                    <h3 className="text-xs font-mono font-bold text-[var(--ink-soft)]">{result.fonts.length} assets identified.</h3>
                </motion.div>
                
                <motion.div 
                    className="flex-1 overflow-y-auto p-0 min-h-0 overscroll-contain relative"
                    style={{ 
                        y: parallaxListY,
                        x: parallaxLeftX 
                    }}
                    variants={{ visible: { transition: { staggerChildren: 0.05 } } }}
                >
                    {result.fonts.map((font: any, i: number) => (
                        <motion.div key={i} className="group px-6 py-4 flex items-baseline justify-between hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors cursor-default" variants={{ hidden: { x: -10, opacity: 0 }, visible: { x: 0, opacity: 1 } }}>
                            <span className="text-xl font-bold truncate pr-4">{font.family}</span>
                            <span className="font-mono text-[10px] opacity-50 group-hover:opacity-100">{font.format}</span>
                        </motion.div>
                    ))}
                </motion.div>
            </div>
        </motion.div>

        {/* Right Pane (Terminal) */}
        <motion.div 
            className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--paper)] relative min-h-0"
            variants={{
                hidden: { x: 50, opacity: 0 },
                visible: { x: 0, opacity: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
            }}
        >
            <motion.div 
                className="bg-[var(--ink)] text-[var(--paper)] px-4 flex justify-between items-center h-12 border-[var(--line-strong)] relative z-10"
                style={{ 
                    borderBottomWidth: '1px', borderBottomStyle: 'solid',
                    y: parallaxHeaderY, // Reacts to top pull
                    x: parallaxRightX // Reacts to right pull
                }}
            >
                <h3 className="font-mono text-sm font-bold">Log</h3>
                <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-[var(--line-soft)]" />
                    <div className="w-3 h-3 rounded-full bg-[var(--line-soft)]" />
                </div>
            </motion.div>
            
            <motion.div 
                className="flex-1 p-4 font-mono text-xs md:text-sm overflow-y-auto bg-[var(--canvas)] text-[var(--ink)] min-h-0 overscroll-contain relative"
                style={{
                    y: parallaxListY, // Reacts to bottom pull
                    x: parallaxRightX
                }}
            >
                {logs.length === 0 && <div className="opacity-30">idle.</div>}
                {logs.map((log, i) => (
                    <div key={i} className="mb-1 break-all whitespace-pre-wrap"><span className="opacity-50 mr-2">{String(i + 1).padStart(3, '0')}</span>{log}</div>
                ))}
                <div ref={logEndRef} />
            </motion.div>
        </motion.div>
      </div>

      {/* Watermark Fix (Unified) */}
      <div 
        className="fixed left-0 right-0 w-full flex flex-col items-center justify-center pointer-events-none z-50"
        style={{ 
          bottom: 2, 
          height: 'var(--brutalist-offset-y)',
          paddingLeft: 'var(--brutalist-offset-x)',
          paddingRight: 'var(--brutalist-offset-x)'
        }}
      >
        <div 
          className="flex flex-col font-brand font-bold text-[12px] md:text-[14px] text-[var(--ink)] tracking-normal antialiased leading-[1.1]"
          style={{ width: 'min(var(--brutalist-footer-width, 400px), 100%)' }}
        >
          <div className="w-full text-left">Specimen</div>
          <div className="w-full text-left text-[10px] md:text-[11px] uppercase tracking-[0.08em] opacity-80">
            Saka Studio &amp; Engineering
          </div>
        </div>
      </div>
    </motion.div>
  );
}
