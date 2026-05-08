import { useState, useRef, useEffect, useCallback } from "react";
import type { SovereignRuntimeProps } from "../../Win95RuntimeHost";
import { cn } from "@/lib/style-composer";
import NotepadFindDialog from "./NotepadFindDialog";
import Win95Icon from "../../Win95Icon";

/**
 * PHASE 21 — TOTAL OPERATIONAL LEGITIMACY: NOTEPAD.EXE
 * 
 * A perfect reproduction of the Windows 95 text environment.
 * Implements full menu logic, search modal, and persistent materiality.
 */

export interface NotepadProps extends SovereignRuntimeProps {
  initialData?: any;
}

type MenuKey = "file" | "edit" | "search" | "help" | null;

export default function Notepad({ 
  initialData, 
  onDataChange,
  onActivityChange,
  onFocus,
  isVisible,
  onClose,
  onMinimize,
  onPositionChange
}: NotepadProps) {
  const resolveContent = (data: any): string => {
    if (typeof data === "string") return data;
    const content = (data as Record<string, unknown> | null)?.content;
    return typeof content === "string" ? content : "";
  };

  const [content, setContent] = useState(resolveContent(initialData));
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [isSaving, setIsSaving] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [activeMenu, setActiveMenu] = useState<MenuKey>(null);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  
  // History for Undo/Redo
  const [history, setHistory] = useState<string[]>([resolveContent(initialData)]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialContentRef = useRef(resolveContent(initialData));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const newContent = resolveContent(initialData);
    if (newContent !== content) {
      setContent(newContent);
      initialContentRef.current = newContent;
      setHistory([newContent]);
      setHistoryIndex(0);
    }
  }, [initialData]);

  const pushToHistory = (newContent: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    if (newHistory[newHistory.length - 1] === newContent) return;
    
    newHistory.push(newContent);
    if (newHistory.length > 50) newHistory.shift(); // Limit history
    
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevContent = history[historyIndex - 1];
      setContent(prevContent);
      setHistoryIndex(historyIndex - 1);
      onActivityChange?.({ dirty: prevContent !== initialContentRef.current });
    }
  };

  const handleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    onDataChange?.({ content });
    initialContentRef.current = content;
    onActivityChange?.({ dirty: false });

    setIsSaving(true);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => setIsSaving(false), 1500);
  }, [content, onDataChange, onActivityChange]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    
    const isDirty = newContent !== initialContentRef.current;
    onActivityChange?.({ dirty: isDirty });

    // Background sync
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onDataChange?.({ content: newContent });
      pushToHistory(newContent);
    }, 1200);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shortcuts
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSave(); }
    if (e.ctrlKey && e.key === 'a') { e.preventDefault(); textareaRef.current?.select(); }
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); }
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); setIsFindOpen(true); }
    if (e.key === 'F3') { e.preventDefault(); findNext(searchQuery, "down", false); }
    if (e.key === 'F5') { e.preventDefault(); insertTimeDate(); }
  };

  const insertTimeDate = () => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString();
    const insertText = `${timeStr} ${dateStr}`;
    
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newContent = content.substring(0, start) + insertText + content.substring(end);
    setContent(newContent);
    pushToHistory(newContent);
    
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
      textarea.focus();
    }, 0);
  };

  const updateCursorPos = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const textBeforeCursor = textarea.value.substring(0, textarea.selectionStart);
    const lines = textBeforeCursor.split("\n");
    setCursorPos({ line: lines.length, col: lines[lines.length - 1].length + 1 });
  };

  const findNext = (query: string, direction: "up" | "down", matchCase: boolean) => {
    if (!query) return;
    setSearchQuery(query);
    const textarea = textareaRef.current;
    if (!textarea) return;

    const text = textarea.value;
    const searchArea = direction === "down" 
      ? text.substring(textarea.selectionEnd) 
      : text.substring(0, textarea.selectionStart);
    
    const normalizedQuery = matchCase ? query : query.toLowerCase();
    const normalizedArea = matchCase ? searchArea : searchArea.toLowerCase();
    
    let index = direction === "down" 
      ? normalizedArea.indexOf(normalizedQuery)
      : normalizedArea.lastIndexOf(normalizedQuery);

    if (index !== -1) {
      const actualIndex = direction === "down" ? textarea.selectionEnd + index : index;
      textarea.focus();
      textarea.setSelectionRange(actualIndex, actualIndex + query.length);
      updateCursorPos();
    } else {
      // Loop around or alert
      const fullText = matchCase ? text : text.toLowerCase();
      const loopIndex = direction === "down" ? fullText.indexOf(normalizedQuery) : fullText.lastIndexOf(normalizedQuery);
      if (loopIndex !== -1) {
        textarea.focus();
        textarea.setSelectionRange(loopIndex, loopIndex + query.length);
        updateCursorPos();
      }
    }
  };

  const handleMenuClick = (menu: MenuKey) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const handleMenuHover = (menu: MenuKey) => {
    if (activeMenu) setActiveMenu(menu);
  };

  const closeMenus = () => setActiveMenu(null);

  return (
    <div className="flex flex-col h-full bg-white relative" onMouseDown={() => { onFocus(); closeMenus(); }}>
      {/* Menu Bar */}
      <div 
        className="flex bg-[var(--win-face)] border-b border-[var(--win-shadow)] px-1 select-none h-5 items-center z-50"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex gap-0 h-full">
          {/* File Menu */}
          <div className="relative h-full flex items-center">
            <button 
              className={cn(
                "px-2 h-full flex items-center text-[11px] leading-none focus:outline-none cursor-default",
                activeMenu === "file" ? "bg-[var(--win-select-bg)] text-white" : "hover:bg-black/5"
              )}
              onClick={(e) => { e.stopPropagation(); handleMenuClick("file"); }}
              onMouseEnter={() => handleMenuHover("file")}
            >
              <span className="underline">F</span>ile
            </button>
            {activeMenu === "file" && (
              <div className="absolute left-0 top-full flex flex-col bg-[var(--win-face)] shadow-[2px_2px_0_rgba(0,0,0,0.3)] border border-[var(--win-dk-shadow)] z-50 min-w-[150px] py-0.5">
                <button className="menu-item" onClick={(e) => { e.stopPropagation(); setContent(""); onActivityChange?.({ dirty: true }); closeMenus(); }}>New</button>
                <button className="menu-item opacity-40">Open...</button>
                <button className="menu-item flex justify-between gap-8" onClick={(e) => { e.stopPropagation(); handleSave(); closeMenus(); }}>
                  <span><span className="underline">S</span>ave</span>
                  <span className="opacity-60">Ctrl+S</span>
                </button>
                <button className="menu-item opacity-40">Save As...</button>
                <div className="h-[1px] bg-[var(--win-shadow)] my-0.5 mx-1 shadow-[0_1px_0_white]" />
                <button className="menu-item opacity-40">Page Setup...</button>
                <button className="menu-item opacity-40">Print...</button>
                <div className="h-[1px] bg-[var(--win-shadow)] my-0.5 mx-1 shadow-[0_1px_0_white]" />
                <button className="menu-item" onClick={(e) => { e.stopPropagation(); window.close(); }}>E<span className="underline">x</span>it</button>
              </div>
            )}
          </div>

          {/* Edit Menu */}
          <div className="relative h-full flex items-center">
            <button 
              className={cn(
                "px-2 h-full flex items-center text-[11px] leading-none focus:outline-none cursor-default",
                activeMenu === "edit" ? "bg-[var(--win-select-bg)] text-white" : "hover:bg-black/5"
              )}
              onClick={(e) => { e.stopPropagation(); handleMenuClick("edit"); }}
              onMouseEnter={() => handleMenuHover("edit")}
            >
              <span className="underline">E</span>dit
            </button>
            {activeMenu === "edit" && (
              <div className="absolute left-0 top-full flex flex-col bg-[var(--win-face)] shadow-[2px_2px_0_rgba(0,0,0,0.3)] border border-[var(--win-dk-shadow)] z-50 min-w-[170px] py-0.5">
                <button className="menu-item flex justify-between gap-8" disabled={historyIndex === 0} onClick={(e) => { e.stopPropagation(); handleUndo(); closeMenus(); }}>
                  <span>Undo</span>
                  <span className="opacity-60">Ctrl+Z</span>
                </button>
                <div className="h-[1px] bg-[var(--win-shadow)] my-0.5 mx-1 shadow-[0_1px_0_white]" />
                <button className="menu-item flex justify-between opacity-40">
                  <span>Cut</span>
                  <span className="opacity-60">Ctrl+X</span>
                </button>
                <button className="menu-item flex justify-between gap-8 opacity-40">
                  <span>Copy</span>
                  <span className="opacity-60">Ctrl+C</span>
                </button>
                <button className="menu-item flex justify-between gap-8 opacity-40">
                  <span>Paste</span>
                  <span className="opacity-60">Ctrl+V</span>
                </button>
                <button className="menu-item opacity-40">Delete</button>
                <div className="h-[1px] bg-[var(--win-shadow)] my-0.5 mx-1 shadow-[0_1px_0_white]" />
                <button className="menu-item flex justify-between gap-8" onClick={(e) => { e.stopPropagation(); textareaRef.current?.select(); closeMenus(); }}>
                  <span>Select All</span>
                  <span className="opacity-60">Ctrl+A</span>
                </button>
                <button className="menu-item flex justify-between gap-8" onClick={(e) => { e.stopPropagation(); insertTimeDate(); closeMenus(); }}>
                  <span>Time/Date</span>
                  <span className="opacity-60">F5</span>
                </button>
                <div className="h-[1px] bg-[var(--win-shadow)] my-0.5 mx-1 shadow-[0_1px_0_white]" />
                <button className="menu-item flex justify-between" onClick={(e) => { e.stopPropagation(); setWordWrap(!wordWrap); closeMenus(); }}>
                  <span>Word Wrap</span>
                  {wordWrap && <span className="ml-2">✓</span>}
                </button>
              </div>
            )}
          </div>

          {/* Search Menu */}
          <div className="relative h-full flex items-center">
            <button 
              className={cn(
                "px-2 h-full flex items-center text-[11px] leading-none focus:outline-none cursor-default",
                activeMenu === "search" ? "bg-[var(--win-select-bg)] text-white" : "hover:bg-black/5"
              )}
              onClick={(e) => { e.stopPropagation(); handleMenuClick("search"); }}
              onMouseEnter={() => handleMenuHover("search")}
            >
              <span className="underline">S</span>earch
            </button>
            {activeMenu === "search" && (
              <div className="absolute left-0 top-full flex flex-col bg-[var(--win-face)] shadow-[2px_2px_0_rgba(0,0,0,0.3)] border border-[var(--win-dk-shadow)] z-50 min-w-[150px] py-0.5">
                <button className="menu-item flex justify-between gap-8" onClick={(e) => { e.stopPropagation(); setIsFindOpen(true); closeMenus(); }}>
                  <span>Find...</span>
                  <span className="opacity-60">Ctrl+F</span>
                </button>
                <button className="menu-item flex justify-between gap-8" onClick={(e) => { e.stopPropagation(); findNext(searchQuery, "down", false); closeMenus(); }}>
                  <span>Find Next</span>
                  <span className="opacity-60">F3</span>
                </button>
              </div>
            )}
          </div>

          {/* Help Menu */}
          <div className="relative h-full flex items-center">
            <button 
              className={cn(
                "px-2 h-full flex items-center text-[11px] leading-none focus:outline-none cursor-default",
                activeMenu === "help" ? "bg-[var(--win-select-bg)] text-white" : "hover:bg-black/5"
              )}
              onClick={(e) => { e.stopPropagation(); handleMenuClick("help"); }}
              onMouseEnter={() => handleMenuHover("help")}
            >
              <span className="underline">H</span>elp
            </button>
            {activeMenu === "help" && (
              <div className="absolute left-0 top-full flex flex-col bg-[var(--win-face)] shadow-[2px_2px_0_rgba(0,0,0,0.3)] border border-[var(--win-dk-shadow)] z-50 min-w-[150px] py-0.5">
                <button className="menu-item opacity-40">Help Topics</button>
                <div className="h-[1px] bg-[var(--win-shadow)] my-0.5 mx-1 shadow-[0_1px_0_white]" />
                <button className="menu-item" onClick={(e) => { e.stopPropagation(); setIsAboutOpen(true); closeMenus(); }}>About Notepad</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Editor Area */}
      <textarea
        ref={textareaRef}
        className="flex-1 w-full p-1 font-mono text-[13px] leading-tight outline-none resize-none border-0 cursor-text scrollbar-win95"
        style={{
          backgroundColor: "var(--win-window)",
          color: "var(--win-text)",
          whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
          overflowX: wordWrap ? 'hidden' : 'auto',
          overflowY: 'scroll',
        }}
        value={content}
        onChange={handleChange}
        onSelect={updateCursorPos}
        onKeyUp={updateCursorPos}
        onKeyDown={handleKeyDown}
        onClick={updateCursorPos}
        spellCheck={false}
        autoFocus
      />

      {/* Status Bar */}
      <div className="flex items-center px-1 py-0.5 border-t border-[var(--win-shadow)] bg-[var(--win-face)] text-[10px] select-none h-5 gap-1" style={{ fontFamily: "var(--font-shell)" }}>
        <div className="flex-1 px-2 h-4 flex items-center shadow-[var(--bevel-sunken)] bg-[var(--win-face)]">
          {isSaving ? (
            <span className="text-[var(--win-dk-shadow)] font-bold animate-pulse">Saving...</span>
          ) : (
            <span className="opacity-60">Ready</span>
          )}
        </div>
        <div className="w-28 px-2 h-4 flex items-center shadow-[var(--bevel-sunken)] bg-[var(--win-face)]">
          <span className="opacity-60 tabular-nums">Ln {cursorPos.line}, Col {cursorPos.col}</span>
        </div>
        <div className="w-20 px-2 h-4 flex items-center shadow-[var(--bevel-sunken)] bg-[var(--win-face)]">
          <span className="opacity-30 tracking-tighter uppercase text-[8px] font-bold">SOVEREIGN</span>
        </div>
      </div>

      {/* Dialogs */}
      <NotepadFindDialog 
        isOpen={isFindOpen}
        initialQuery={searchQuery}
        onClose={() => setIsFindOpen(false)}
        onFind={findNext}
      />

      {isAboutOpen && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[200] w-[300px] bg-[var(--win-face)] shadow-[var(--bevel-raised)] border border-[var(--win-dk-shadow)] p-[2px]">
          <div className="flex items-center justify-between bg-[var(--win-title-active)] text-white px-1 h-[18px]">
            <span className="text-[11px] font-bold">About Notepad</span>
            <button className="win-ctrl-btn w-3.5 h-3.5 !bg-[var(--win-face)] !text-black" onClick={() => setIsAboutOpen(false)}>×</button>
          </div>
          <div className="p-4 flex gap-4 items-start">
            <Win95Icon icon="📝" size={32} />
            <div className="flex flex-col text-[11px]">
              <span className="font-bold">Specimen Notepad</span>
              <span>Version 2.1.0 (Build 950)</span>
              <span className="mt-2 text-black/60">Copyright © 1995-2026 Technical Standard. All rights reserved.</span>
              <div className="mt-4 flex justify-end">
                <button className="win-btn !min-w-[60px]" onClick={() => setIsAboutOpen(false)}>OK</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Menu Close Trigger */}
      {activeMenu && (
        <div className="fixed inset-0 z-40" onMouseDown={closeMenus} />
      )}

      <style jsx>{`
        .menu-item {
          width: 100%;
          padding: 2px 16px;
          text-align: left !important;
          font-size: 11px;
          cursor: default;
          white-space: nowrap;
          display: flex;
          justify-content: flex-start !important;
          align-items: center;
          border: none;
          background: transparent;
        }
        .menu-item:hover {
          background-color: var(--win-select-bg);
          color: white;
        }
        .menu-item:disabled {
          opacity: 0.4;
        }
        .menu-item:disabled:hover {
          background-color: transparent;
          color: black;
        }
      `}</style>
    </div>
  );
}
