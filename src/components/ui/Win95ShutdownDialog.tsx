"use client";

import { useState } from "react";
import { AnimatePresence } from "framer-motion";
import Win95Window from "./Win95Window";
import Win95Icon from "./Win95Icon";
import Win95Notification from "./Win95Notification";
import { cn } from "@/lib/style-composer";

interface Win95ShutdownDialogProps {
  onClose: () => void;
  onConfirm: (mode: "shutdown" | "restart") => void;
}

export default function Win95ShutdownDialog({ onClose, onConfirm }: Win95ShutdownDialogProps) {
  const [selectedMode, setSelectedMode] = useState<"shutdown" | "restart">("shutdown");
  const [showHelp, setShowHelp] = useState(false);

  const handleHelpClick = () => {
    setShowHelp(true);
    setTimeout(() => setShowHelp(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/20">
      <Win95Window
        title="Shut Down Windows"
        icon="ShutDown"
        onClose={onClose}
        active={true}
        className="w-[340px]"
        hideMinimize
        hideMaximize
      >
        <div className="p-4 flex gap-4">
          <div className="shrink-0 mt-1">
            <Win95Icon icon="ShutDown" size={32} />
          </div>
          
          <div className="flex flex-col gap-3 flex-1">
            <p className="text-[11px]">Are you sure you want to:</p>
            
            <div className="flex flex-col gap-1.5 pl-2 mb-2">
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative flex items-center justify-center w-3 h-3">
                    <input 
                        type="radio" 
                        className="sr-only" 
                        name="shutdown-mode" 
                        checked={selectedMode === "shutdown"} 
                        onChange={() => setSelectedMode("shutdown")} 
                    />
                    <div className="w-3 h-3 rounded-full border border-[var(--win-dk-shadow)] shadow-[inset_-1px_-1px_white,inset_1px_1px_var(--win-shadow)] bg-white flex items-center justify-center">
                        {selectedMode === "shutdown" && (
                            <div className="w-1.5 h-1.5 bg-black rounded-full" />
                        )}
                    </div>
                </div>
                <span className="text-[11px]">Shut down the computer?</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer group">
                <div className="relative flex items-center justify-center w-3 h-3">
                    <input 
                        type="radio" 
                        className="sr-only" 
                        name="shutdown-mode" 
                        checked={selectedMode === "restart"} 
                        onChange={() => setSelectedMode("restart")} 
                    />
                    <div className="w-3 h-3 rounded-full border border-[var(--win-dk-shadow)] shadow-[inset_-1px_-1px_white,inset_1px_1px_var(--win-shadow)] bg-white flex items-center justify-center">
                        {selectedMode === "restart" && (
                            <div className="w-1.5 h-1.5 bg-black rounded-full" />
                        )}
                    </div>
                </div>
                <span className="text-[11px]">Restart the computer?</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 mt-1">
              <button 
                className="win-btn px-4 py-1 text-[11px] font-bold"
                onClick={() => onConfirm(selectedMode)}
              >
                Yes
              </button>
              <button 
                className="win-btn px-4 py-1 text-[11px]"
                onClick={onClose}
              >
                No
              </button>
              <button 
                className="win-btn px-4 py-1 text-[11px]"
                onClick={handleHelpClick}
              >
                Help
              </button>
            </div>
          </div>
        </div>
      </Win95Window>

      <AnimatePresence>
        {showHelp && (
          <div className="fixed top-8 right-8 z-[6000]">
            <Win95Notification type="info" message="Help context is not configured for this environment." />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
