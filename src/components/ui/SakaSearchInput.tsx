"use client";

import { motion, Variants } from "framer-motion";
import { type InputHTMLAttributes, useState } from "react";
import { cn } from "@/lib/utils";

interface SakaSearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  onAnalyze: () => void;
}

export default function SakaSearchInput({
  value,
  onChange,
  onAnalyze,
  className,
  ...props
}: SakaSearchInputProps) {
  /* Smirk Factor: Cheeky Placeholders */
  const [isFocused, setIsFocused] = useState(false);
  const PLACEHOLDER = "wanna steal a font?";

  /* Animation Variants */
  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.1,
        delayChildren: 0.2
      }
    },
    exit: {
      opacity: 0,
      transition: {
        staggerChildren: 0.05,
        staggerDirection: -1,
        when: "afterChildren"
      }
    }
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: {
        type: "spring",
        stiffness: 100,
        damping: 20
      }
    },
    exit: {
      opacity: 0,
      scale: 1.5, // Explode outwards
      filter: "blur(10px)",
      transition: { duration: 0.4 }
    }
  };

  const footerVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: { 
      opacity: 1, 
      y: 0,
      transition: {
        duration: 0.8,
        ease: [0.16, 1, 0.3, 1]
      }
    },
    exit: {
      y: 100, // Drop down
      opacity: 0,
      transition: { duration: 0.4, ease: "easeIn" }
    }
  };

  return (
    <motion.div 
      className={cn("relative flex flex-col items-center justify-center w-full h-full", className)}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      
      {/* 4-Square Markers Container - Perfectly Centered */}
      <motion.div 
        className="relative flex items-center justify-center transition-colors duration-300"
        style={{ width: 'var(--brutalist-input-width)', height: 'var(--brutalist-input-height)' }}
        initial={false} 
        animate={isFocused ? "focused" : "visible"}
        variants={itemVariants}
      >
        
        {/* Markers - Configurable Size with Nano-Physics */}
        <motion.div 
            variants={{
                visible: { x: 0, y: 0 },
                focused: { x: -6, y: -6 }
            }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="absolute top-0 left-0 bg-[var(--ink)]"
            style={{ width: 'var(--brutalist-marker)', height: 'var(--brutalist-marker)' }} 
        />
        <motion.div 
            variants={{
                visible: { x: 0, y: 0 },
                focused: { x: 6, y: -6 }
            }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="absolute top-0 right-0 bg-[var(--ink)]"
            style={{ width: 'var(--brutalist-marker)', height: 'var(--brutalist-marker)' }} 
        />
        <motion.div 
            variants={{
                visible: { x: 0, y: 0 },
                focused: { x: -6, y: 6 }
            }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="absolute bottom-0 left-0 bg-[var(--ink)]"
            style={{ width: 'var(--brutalist-marker)', height: 'var(--brutalist-marker)' }} 
        />
        <motion.div 
            variants={{
                visible: { x: 0, y: 0 },
                focused: { x: 6, y: 6 }
            }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="absolute bottom-0 right-0 bg-[var(--ink)]"
            style={{ width: 'var(--brutalist-marker)', height: 'var(--brutalist-marker)' }} 
        />

        {/* Input Field */}
        <input
          {...props}
          value={value}
          onChange={onChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={(e) => e.key === "Enter" && onAnalyze()}
          placeholder={isFocused ? "" : PLACEHOLDER}
          spellCheck={false}
          className="relative z-20 w-full bg-transparent text-center text-[16px] md:text-[20px] font-bold tracking-normal antialiased outline-none placeholder:text-[var(--muted)] text-[var(--ink)] placeholder:transition-all placeholder:duration-500"
        />

    </motion.div>


      <motion.div 
        className="fixed left-0 right-0 w-full flex flex-col items-center justify-center pointer-events-none"
        style={{ 
          bottom: 2, // Slight lift from the very bottom
          height: 'var(--brutalist-offset-y)',
          paddingLeft: 'var(--brutalist-offset-x)',
          paddingRight: 'var(--brutalist-offset-x)'
        }}
        variants={footerVariants}
      >
        <div
          className="flex flex-col font-brand font-bold text-[12px] md:text-[14px] text-[var(--ink)] tracking-normal antialiased leading-[1.1]"
          style={{ width: "min(var(--brutalist-footer-width, 400px), 100%)" }}
        >
          <div className="w-full text-left">
            Aksara
          </div>
          <div className="w-full text-left text-[10px] md:text-[11px] uppercase tracking-[0.08em] opacity-80">
            Developed by Saka Studio &amp; Engineering
          </div>
        </div>
      </motion.div>

    </motion.div>
  );
}
