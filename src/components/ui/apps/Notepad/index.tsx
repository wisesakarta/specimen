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
        className="flex-1 w-full p-1 outline-none resize-none border-0 cursor-text scrollbar-win95"
        style={{
          backgroundColor: "var(--win-window)",
          color: "var(--win-text)",
          fontFamily: "var(--font-shell)",
          fontSize: 12,
          lineHeight: 1.35,
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

      {/* Status Bar — canonical Win95 sunken panels */}
      <div
        className="flex items-center border-t select-none"
        style={{
          borderTopColor: "var(--win-shadow)",
          background: "var(--win-face)",
          fontFamily: "var(--font-shell)",
          fontSize: 11,
          height: 20,
          gap: 2,
          padding: "1px 2px",
        }}
      >
        <div
          className="flex-1 px-2 flex items-center"
          style={{ boxShadow: "var(--bevel-sunken)", height: 16 }}
        >
          <span style={{ color: isSaving ? "var(--win-text)" : "var(--win-text-muted)" }}>
            {isSaving ? "Saving..." : "Ready"}
          </span>
        </div>
        <div
          className="px-2 flex items-center tabular-nums"
          style={{ boxShadow: "var(--bevel-sunken)", height: 16, width: 120 }}
        >
          <span style={{ color: "var(--win-text-muted)" }}>
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
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
        <div className="absolute inset-0 z-[200] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.15)" }}>
          <div
            className="flex flex-col"
            style={{
              width: 320,
              background: "var(--win-face)",
              boxShadow: "var(--bevel-raised)",
              border: "1px solid var(--win-dk-shadow)",
              fontFamily: "var(--font-shell)",
            }}
          >
            <div
              className="flex items-center justify-between px-1 select-none"
              style={{
                height: "var(--win-titlebar-height)",
                background: "var(--win-title-active)",
                color: "var(--win-title-text)",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, paddingLeft: 4 }}>About Notepad</span>
              <button
                type="button"
                className="win-ctrl-btn"
                onClick={() => setIsAboutOpen(false)}
                aria-label="Close"
              >
                <svg width="7" height="7" viewBox="0 0 7 7" style={{ display: "block", shapeRendering: "crispEdges" }}>
                  <line x1="0" y1="0" x2="7" y2="7" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="7" y1="0" x2="0" y2="7" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </div>
            <div className="flex gap-4 p-4">
              <Win95Icon icon="📝" size={32} />
              <div className="flex flex-col gap-1" style={{ fontSize: 12, color: "var(--win-text)" }}>
                <span style={{ fontWeight: 700 }}>Specimen Notepad</span>
                <span>Version 2.1.0 (Build 950)</span>
                <span style={{ marginTop: 8, color: "var(--win-text-muted)" }}>
                  Copyright &copy; 1995-2026 Technical Standard.
                </span>
              </div>
            </div>
            <div className="flex justify-end px-4 pb-4">
              <button type="button" className="win-btn" onClick={() => setIsAboutOpen(false)}>
                OK
              </button>
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
