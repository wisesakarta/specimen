"use client";

import { motion } from "framer-motion";
import { type InputHTMLAttributes, useState } from "react";
import { cn } from "@/lib/utils";

interface MinimalInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export default function MinimalInput({ label, className, ...props }: MinimalInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className={cn("relative flex flex-col gap-1.5 group", className)}>
      <label className={cn(
        "text-[10px] uppercase tracking-[0.2em] font-medium transition-colors duration-300",
        isFocused ? "text-black" : "text-black/40"
      )}>
        {label}
      </label>
      <div className="relative">
        <input
          {...props}
          onFocus={(e) => {
            setIsFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            props.onBlur?.(e);
          }}
          className="w-full bg-transparent border-b border-black/5 py-4 text-xl outline-none rounded-none placeholder:text-black/10 transition-colors z-10 relative font-medium text-black/90 focus:border-transparent"
        />
        {/* Animated Underline */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: isFocused ? 1 : 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="absolute bottom-0 left-0 w-full h-[1.5px] bg-black origin-left z-20 pointer-events-none"
        />
        {/* Hover Underline */}
        <div className="absolute bottom-0 left-0 w-full h-[1px] bg-black/20 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500 ease-out z-10 pointer-events-none" />
      </div>
    </div>
  );
}
