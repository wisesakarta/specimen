import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount, loader } from "@monaco-editor/react";
import { motion, AnimatePresence } from "framer-motion";
import type { SovereignRuntimeProps } from "../Win95RuntimeHost";
import type { RuntimeActivityState } from "@/lib/runtime";
import { cn } from "@/lib/style-composer";

// Define Specimen Coding Civilization Theme
if (typeof window !== "undefined") {
  loader.init().then((monaco) => {
    monaco.editor.defineTheme("specimen-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#000015", // Deep technical navy
        "editor.lineHighlightBackground": "#000033",
        "editorCursor.foreground": "#00ff00",
        "editor.selectionBackground": "#000080",
        "editorLineNumber.foreground": "#444466",
        "editorLineNumber.activeForeground": "#8888aa",
      },
    });
  });
}

const DEFAULT_CONTENT = `// Specimen OS — Monaco Editor\n// Vessel sovereign: shell-positioned, keyboard-sovereign\n\nfunction greet(name: string): string {\n  return \`Hello, \${name}!\`;\n}\n`;

interface MonacoEditorProps extends SovereignRuntimeProps {
  onActivityChange?: (state: RuntimeActivityState) => void;
  onDataChange?: (data: unknown) => void;
  initialData?: unknown;
}

export default function MonacoEditorApp({
  isVisible,
  onFocus,
  onActivityChange,
  onDataChange,
  initialData,
}: MonacoEditorProps) {
  const editorRef = useRef<any>(null);
  const onFocusRef = useRef(onFocus);
  const onActivityChangeRef = useRef(onActivityChange);
  const onDataChangeRef = useRef(onDataChange);
  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<"stable" | "pushing">("stable");

  onFocusRef.current = onFocus;
  onActivityChangeRef.current = onActivityChange;
  onDataChangeRef.current = onDataChange;

  const resolveContent = (data: any): string => {
    if (typeof data === "string") return data;
    const content = (data as Record<string, unknown> | null)?.content;
    return typeof content === "string" ? content : DEFAULT_CONTENT;
  };

  const defaultValue = useRef(resolveContent(initialData)).current;

  useEffect(() => {
    if (isVisible && editorRef.current) {
      const t = setTimeout(() => editorRef.current?.layout(), 50);
      return () => clearTimeout(t);
    }
  }, [isVisible]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.onDidFocusEditorText(() => onFocusRef.current());
    editor.onDidChangeModelContent(() => {
      if (!dirtyRef.current) {
        dirtyRef.current = true;
        onActivityChangeRef.current?.({ dirty: true });
      }
      
      setSaveStatus("pushing");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const content = editorRef.current?.getValue();
        if (content !== undefined) {
          onDataChangeRef.current?.({ content });
          setSaveStatus("stable");
        }
      }, 1000);
    });
  };

  return (
    <div className="w-full h-full flex flex-col bg-[var(--win-face)] p-1 overflow-hidden">
      {/* Technical Artifact Header — Restrained & Infrastructural */}
      <div className="flex items-center gap-4 px-2 py-0.5 bg-[var(--win-face)] border-b border-[var(--win-dk-shadow)] select-none h-5">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <span className="text-[9px] opacity-40 whitespace-nowrap" style={{ fontFamily: "var(--font-shell)" }}>Artifact:</span>
          <span className="text-[9px] truncate font-mono opacity-80 tracking-tight lowercase">source/main.ts</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-hidden ml-auto">
          <span className="text-[9px] opacity-40 whitespace-nowrap" style={{ fontFamily: "var(--font-shell)" }}>Language:</span>
          <span className="text-[9px] font-mono opacity-80 lowercase">typescript</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 pl-2">
          <span className="text-[9px] opacity-40" style={{ fontFamily: "var(--font-shell)" }}>Encoding:</span>
          <span className="text-[9px] font-mono opacity-80 lowercase">utf-8</span>
        </div>
      </div>

      {/* Editor Container with Sunken Depth */}
      <div className="flex-1 min-h-0 win-input relative overflow-hidden mt-0.5">
        <Editor
          height="100%"
          defaultLanguage="typescript"
          defaultValue={defaultValue}
          theme="specimen-dark"
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            wordWrap: "on",
            scrollbar: {
              vertical: "visible",
              horizontal: "visible",
              useShadows: false,
              verticalScrollbarSize: 12,
              horizontalScrollbarSize: 12,
            },
            padding: { top: 8 },
            fontFamily: "var(--font-mono)",
            renderLineHighlight: "all",
          }}
        />
      </div>

      {/* Internal Status Bar — Infrastructural Calmness */}
      <div className="flex items-center gap-3 px-2 py-0.5 bg-[var(--win-face)] text-[9px] select-none h-4" style={{ fontFamily: "var(--font-shell)" }}>
        <div className="flex items-center gap-1.5 shrink-0">
          <motion.div 
            animate={{ opacity: [0.4, 0.8, 0.4] }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            style={{ width: 2, height: 2, background: "#00aa00" }}
          />
        </div>
        
        <div className="flex items-center gap-1 truncate">
          <span className="opacity-40">State:</span>
          <span className={cn(
            "transition-opacity duration-300",
            saveStatus === "pushing" ? "opacity-100" : "opacity-60"
          )}>
            {saveStatus === "pushing" ? "pushing snapshot..." : "stable"}
          </span>
        </div>

        <div className="ml-auto opacity-30 text-[8px] font-mono lowercase tracking-widest">
          rntm.sovereign
        </div>
      </div>
    </div>
  );
}
