"use client";

import { createContext, useContext, ReactNode } from "react";
import { MotionValue, useMotionValue } from "framer-motion";

interface GridContextType {
  pullTop: MotionValue<number>;
  pullBottom: MotionValue<number>;
  pullLeft: MotionValue<number>;
  pullRight: MotionValue<number>;
  mousePos: { x: MotionValue<number>; y: MotionValue<number> };
}

const GridContext = createContext<GridContextType | null>(null);

export function GridProvider({ children }: { children: ReactNode }) {
  const pullTop = useMotionValue(0);
  const pullBottom = useMotionValue(0);
  const pullLeft = useMotionValue(0);
  const pullRight = useMotionValue(0);
  
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  return (
    <GridContext.Provider value={{ 
      pullTop, 
      pullBottom, 
      pullLeft, 
      pullRight,
      mousePos: { x: mouseX, y: mouseY }
    }}>
      {children}
    </GridContext.Provider>
  );
}

export function useGrid() {
  const context = useContext(GridContext);
  if (!context) {
    throw new Error("useGrid must be used within a GridProvider");
  }
  return context;
}
