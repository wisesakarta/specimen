"use client";

import { motion, useMotionTemplate, useMotionValue, useSpring } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type MagneticButtonProps = {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
};

export default function MagneticButton({
  children,
  className,
  onClick,
  type = "button",
  disabled
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springConfig = { damping: 15, stiffness: 150, mass: 0.1 };
  const mobileX = useSpring(x, springConfig);
  const mobileY = useSpring(y, springConfig);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    const { clientX, clientY } = e;
    const { height, width, left, top } = ref.current!.getBoundingClientRect();
    const middleX = clientX - (left + width / 2);
    const middleY = clientY - (top + height / 2);

    x.set(middleX * 0.15); // Reduced intensity for subtlety
    y.set(middleY * 0.15);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.button
      ref={ref}
      style={{ x: mobileX, y: mobileY }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      type={type}
      disabled={disabled}
      className={cn(
        "relative px-8 py-4 rounded-full bg-[var(--saka-fg-1)] text-[var(--saka-bg-1)] font-medium text-sm uppercase tracking-widest overflow-hidden group",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
    >
      <span className="relative z-10 flex items-center justify-center gap-2 group-hover:scale-105 transition-transform duration-300">
        {children}
      </span>
      <div className="absolute inset-0 z-0 bg-[var(--saka-border)] rounded-full scale-0 group-hover:scale-150 transition-transform duration-500 ease-out" />
    </motion.button>
  );
}
