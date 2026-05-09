import { useState, useRef, useEffect, useCallback } from "react";
import { SovereignRuntimeProps, extractRuntimeTextPayload } from "@/runtime/runtime-dispatch";
import { cn } from "@/lib/style-composer";
import NotepadFindDialog from "./NotepadFindDialog";
import Win95Icon from "../../Win95Icon";
import { Win95MenuBar, Win95MenuDropdown, Win95MenuAction, Win95MenuSeparator } from "../../Win95Menu";
import type { WindowData } from "@/lib/os-config";

/**
 * PHASE 21 — TOTAL OPERATIONAL LEGITIMACY: NOTEPAD.EXE
 * 
 * A perfect reproduction of the Windows 95 text environment.
 * Implements full menu logic, search modal, and persistent materiality.
 */

export interface NotepadProps extends SovereignRuntimeProps {
  initialData?: WindowData;
}

type MenuKey = "file" | "edit" | "search" | "help" | null;

export default function Notepad({ 
  initialData, 
  onDataChange,
  onActivityChange,
  onFocus,
  onMaximize,
  isVisible,
  onClose,
  onMinimize,
  onPositionChange
}: NotepadProps) {
  const resolveContent = (data: WindowData | undefined): string => {
    return extractRuntimeTextPayload(data);
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

  const onActivityChangeRef = useRef(onActivityChange);
  onActivityChangeRef.current = onActivityChange;

  // Centralized Activity State — Sovereign Subtitle & Dirty derivation
  useEffect(() => {
    const isDirty = content !== initialContentRef.current;
    const firstLine = content.split("\n").find(l => l.trim());
    const subtitle = firstLine?.trim().slice(0, 40) || undefined;
    
    onActivityChangeRef.current?.({ 
      dirty: isDirty, 
      subtitle 
    });
  }, [content]); // Pure content-driven emission

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
    }
  };

  const handleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    onDataChange?.({ content });
    initialContentRef.current = content;

    setIsSaving(true);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => setIsSaving(false), 1500);
  }, [content, onDataChange]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    
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
      <Win95MenuBar>
        <Win95MenuDropdown 
          label={<span><span className="underline">F</span>ile</span>}
          isOpen={activeMenu === "file"}
          onOpen={() => handleMenuClick("file")}
          onHover={() => handleMenuHover("file")}
        >
          <Win95MenuAction label="New" onClick={() => { setContent(""); onActivityChange?.({ dirty: true }); closeMenus(); }} />
          <Win95MenuAction label="Open..." disabled />
          <Win95MenuAction 
            label={<span><span className="underline">S</span>ave</span>} 
            shortcut="Ctrl+S" 
            onClick={() => { handleSave(); closeMenus(); }} 
          />
          <Win95MenuAction label="Save As..." disabled />
          <Win95MenuSeparator />
          <Win95MenuAction label="Page Setup..." disabled />
          <Win95MenuAction label="Print..." disabled />
          <Win95MenuSeparator />
          <Win95MenuAction label={<span>E<span className="underline">x</span>it</span>} onClick={() => window.close()} />
        </Win95MenuDropdown>

        <Win95MenuDropdown 
          label={<span><span className="underline">E</span>dit</span>}
          isOpen={activeMenu === "edit"}
          onOpen={() => handleMenuClick("edit")}
          onHover={() => handleMenuHover("edit")}
        >
          <Win95MenuAction 
            label="Undo" 
            shortcut="Ctrl+Z" 
            disabled={historyIndex === 0} 
            onClick={() => { handleUndo(); closeMenus(); }} 
          />
          <Win95MenuSeparator />
          <Win95MenuAction label="Cut" shortcut="Ctrl+X" disabled />
          <Win95MenuAction label="Copy" shortcut="Ctrl+C" disabled />
          <Win95MenuAction label="Paste" shortcut="Ctrl+V" disabled />
          <Win95MenuAction label="Delete" disabled />
          <Win95MenuSeparator />
          <Win95MenuAction 
            label="Select All" 
            shortcut="Ctrl+A" 
            onClick={() => { textareaRef.current?.select(); closeMenus(); }} 
          />
          <Win95MenuAction 
            label="Time/Date" 
            shortcut="F5" 
            onClick={() => { insertTimeDate(); closeMenus(); }} 
          />
          <Win95MenuSeparator />
          <Win95MenuAction 
            label="Word Wrap" 
            checked={wordWrap} 
            onClick={() => { setWordWrap(!wordWrap); closeMenus(); }} 
          />
        </Win95MenuDropdown>

        <Win95MenuDropdown 
          label={<span><span className="underline">S</span>earch</span>}
          isOpen={activeMenu === "search"}
          onOpen={() => handleMenuClick("search")}
          onHover={() => handleMenuHover("search")}
        >
          <Win95MenuAction 
            label="Find..." 
            shortcut="Ctrl+F" 
            onClick={() => { setIsFindOpen(true); closeMenus(); }} 
          />
          <Win95MenuAction 
            label="Find Next" 
            shortcut="F3" 
            onClick={() => { findNext(searchQuery, "down", false); closeMenus(); }} 
          />
        </Win95MenuDropdown>

        <Win95MenuDropdown 
          label={<span><span className="underline">H</span>elp</span>}
          isOpen={activeMenu === "help"}
          onOpen={() => handleMenuClick("help")}
          onHover={() => handleMenuHover("help")}
        >
          <Win95MenuAction label="Help Topics" disabled />
          <Win95MenuSeparator />
          <Win95MenuAction label="About Notepad" onClick={() => { setIsAboutOpen(true); closeMenus(); }} />
        </Win95MenuDropdown>
      </Win95MenuBar>

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

    </div>
  );
}
