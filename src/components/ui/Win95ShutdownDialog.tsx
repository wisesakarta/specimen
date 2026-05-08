"use client";

import { useState } from "react";
import Win95Window from "./Win95Window";
import Win95Icon from "./Win95Icon";
import { cn } from "@/lib/style-composer";

interface Win95ShutdownDialogProps {
  onClose: () => void;
  onConfirm: (mode: "shutdown" | "restart") => void;
}

export default function Win95ShutdownDialog({ onClose, onConfirm }: Win95ShutdownDialogProps) {
  const [selectedMode, setSelectedMode] = useState<"shutdown" | "restart">("shutdown");

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/20">
      <Win95Window
        title="Shut Down"
        icon="ShutDown"
        onClose={onClose}
        active={true}
        className="w-[320px]"
        hideMinimize
        hideMaximize
      >
        <div className="p-4 flex gap-4">
          <div className="shrink-0">
            <Win95Icon icon="ShutDown" size={32} />
          </div>
          
          <div className="flex flex-col gap-4 flex-1">
            <p className="text-[11px] font-bold">What do you want the system to do?</p>
            
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative flex items-center justify-center">
                    <input 
                        type="radio" 
                        className="sr-only" 
                        name="shutdown-mode" 
                        checked={selectedMode === "shutdown"} 
                        onChange={() => setSelectedMode("shutdown")} 
                    />
                    <div className={cn(
                        "w-3 h-3 rounded-full border border-[var(--win-dk-shadow)] shadow-[inset_-1px_-1px_white,inset_1px_1px_var(--win-shadow)]",
                        selectedMode === "shutdown" ? "bg-white" : "bg-white"
                    )}>
                        {selectedMode === "shutdown" && (
                            <div className="absolute inset-1 bg-black rounded-full" />
                        )}
                    </div>
                </div>
                <span className="text-[11px]">Shut down?</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative flex items-center justify-center">
                    <input 
                        type="radio" 
                        className="sr-only" 
                        name="shutdown-mode" 
                        checked={selectedMode === "restart"} 
                        onChange={() => setSelectedMode("restart")} 
                    />
                    <div className={cn(
                        "w-3 h-3 rounded-full border border-[var(--win-dk-shadow)] shadow-[inset_-1px_-1px_white,inset_1px_1px_var(--win-shadow)]",
                        selectedMode === "restart" ? "bg-white" : "bg-white"
                    )}>
                        {selectedMode === "restart" && (
                            <div className="absolute inset-1 bg-black rounded-full" />
                        )}
                    </div>
                </div>
                <span className="text-[11px]">Restart?</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 mt-2">
              <button 
                className="win-btn px-6 py-1 text-[11px] font-bold"
                onClick={() => onConfirm(selectedMode)}
              >
                Yes
              </button>
              <button 
                className="win-btn px-6 py-1 text-[11px]"
                onClick={onClose}
              >
                No
              </button>
            </div>
          </div>
        </div>
      </Win95Window>
    </div>
  );
}
