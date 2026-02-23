"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import { useGrid } from "@/context/GridContext";

const HIT_SLOP = 40; 
const ELASTIC_LIMIT = 250;
const SYMPATHETIC_FACTOR = 0.25;

type LineID = "top" | "bottom" | "left" | "right" | "none";

export default function ElasticGrid() {
  const { pullTop, pullBottom, pullLeft, pullRight, mousePos } = useGrid();
  const [winSize, setWinSize] = useState({ w: 0, h: 0 });
  const [activeLine, setActiveLine] = useState<LineID>("none");

  // High-end spring physics for visual lines
  const springConfig = { stiffness: 450, damping: 14 };
  const springTop = useSpring(pullTop, springConfig);
  const springBottom = useSpring(pullBottom, springConfig);
  const springLeft = useSpring(pullLeft, springConfig);
  const springRight = useSpring(pullRight, springConfig);

  useEffect(() => {
    const handleResize = () => setWinSize({ w: window.innerWidth, h: window.innerHeight });
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const ox = winSize.w * 0.1;
  const oy = winSize.h * 0.1;

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      mousePos.x.set(e.clientX);
      mousePos.y.set(e.clientY);
      
      if (activeLine === "none") return;

      let primaryDelta = 0;
      if (activeLine === "top") primaryDelta = e.clientY - oy;
      else if (activeLine === "bottom") primaryDelta = e.clientY - (winSize.h - oy);
      else if (activeLine === "left") primaryDelta = e.clientX - ox;
      else if (activeLine === "right") primaryDelta = e.clientX - (winSize.w - ox);

      const clampedDelta = Math.sign(primaryDelta) * Math.min(Math.abs(primaryDelta), ELASTIC_LIMIT);
      const secondaryDelta = clampedDelta * SYMPATHETIC_FACTOR;

      pullTop.set(activeLine === "top" ? clampedDelta : secondaryDelta);
      pullBottom.set(activeLine === "bottom" ? clampedDelta : secondaryDelta);
      pullLeft.set(activeLine === "left" ? clampedDelta : secondaryDelta);
      pullRight.set(activeLine === "right" ? clampedDelta : secondaryDelta);
    };

    const handlePointerUp = () => {
      if (activeLine !== "none") {
        setActiveLine("none");
        pullTop.set(0);
        pullBottom.set(0);
        pullLeft.set(0);
        pullRight.set(0);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeLine, ox, oy, winSize.h, winSize.w, pullTop, pullBottom, pullLeft, pullRight, mousePos.x, mousePos.y]);

  const topPath = useTransform([springTop, mousePos.x], ([v, mx]) => `M 0 ${oy} Q ${mx as number} ${(oy + (v as number))} ${winSize.w} ${oy}`);
  const bottomPath = useTransform([springBottom, mousePos.x], ([v, mx]) => `M 0 ${winSize.h - oy} Q ${mx as number} ${(winSize.h - oy + (v as number))} ${winSize.w} ${winSize.h - oy}`);
  const leftPath = useTransform([springLeft, mousePos.y], ([v, my]) => `M ${ox} 0 Q ${(ox + (v as number))} ${my as number} ${ox} ${winSize.h}`);
  const rightPath = useTransform([springRight, mousePos.y], ([v, my]) => `M ${winSize.w - ox} 0 Q ${(winSize.w - ox + (v as number))} ${my as number} ${winSize.w - ox} ${winSize.h}`);

  const handleStartDrag = (id: LineID) => (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    setActiveLine(id);
  };

  return (
    <div className="fixed inset-0 z-50 pointer-events-none select-none overflow-hidden touch-none mix-blend-difference">
      <svg className="w-full h-full">
        <motion.path d={topPath} stroke="#dedede" strokeWidth="var(--brutalist-line)" fill="none" />
        <motion.path d={bottomPath} stroke="#dedede" strokeWidth="var(--brutalist-line)" fill="none" />
        <motion.path d={leftPath} stroke="#dedede" strokeWidth="var(--brutalist-line)" fill="none" />
        <motion.path d={rightPath} stroke="#dedede" strokeWidth="var(--brutalist-line)" fill="none" />

        <path d={`M 0 ${oy} L ${winSize.w} ${oy}`} stroke="transparent" strokeWidth={HIT_SLOP} fill="none" className="pointer-events-auto cursor-grab active:cursor-grabbing" onPointerDown={handleStartDrag("top")} />
        <path d={`M 0 ${winSize.h - oy} L ${winSize.w} ${winSize.h - oy}`} stroke="transparent" strokeWidth={HIT_SLOP} fill="none" className="pointer-events-auto cursor-grab active:cursor-grabbing" onPointerDown={handleStartDrag("bottom")} />
        <path d={`M ${ox} 0 L ${ox} ${winSize.h}`} stroke="transparent" strokeWidth={HIT_SLOP} fill="none" className="pointer-events-auto cursor-grab active:cursor-grabbing" onPointerDown={handleStartDrag("left")} />
        <path d={`M ${winSize.w - ox} 0 L ${winSize.w - ox} ${winSize.h}`} stroke="transparent" strokeWidth={HIT_SLOP} fill="none" className="pointer-events-auto cursor-grab active:cursor-grabbing" onPointerDown={handleStartDrag("right")} />
      </svg>
    </div>
  );
}
