"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { SovereignRuntimeProps } from "@/runtime/runtime-dispatch";
import type { VFSNode } from "@/lib/os-config";
import { cn } from "@/lib/style-composer";

const SPECIMEN_MSDOS_BANNER = [
  "Specimen(R) Windows 95",
  "(C) Copyright Technical Standard 1995-2026.",
].join("\r\n");

const SPECIMEN_MSDOS_BANNER_DEV =
  `${SPECIMEN_MSDOS_BANNER}\r\n[Development build ${process.env.NEXT_PUBLIC_APP_BUILD || "unknown"}]`;

const SYSTEM_IDENTIFICATION_STRING =
  process.env.NEXT_PUBLIC_APP_ENV === "production"
    ? SPECIMEN_MSDOS_BANNER
    : SPECIMEN_MSDOS_BANNER_DEV;
const COMMAND_HISTORY_PERSISTENCE_KEY = "specimen_terminal_history";

/**
 * TerminalApp
 * A restrained operational instrument for runtime introspection.
 * Provides a procedural interface to the Virtual File System (VFS) 
 * and active citizen session management.
 */
export default function TerminalApp({
  isVisible,
  onClose,
  vfs = [],
  runtimeSnapshots = [],
  onOpenNode,
  onCloseApp,
  onUpdateVFS,
  runtimeLogs,
}: SovereignRuntimeProps) {
  const viewportContainerRef = useRef<HTMLDivElement>(null);
  const runtimeTerminalInstance = useRef<Terminal | null>(null);
  
  const [vfsPathStackState, setVfsPathStackState] = useState<VFSNode[]>([]);
  const vfsPathStack = useRef<VFSNode[]>([]);
  const terminalInputBuffer = useRef<string>("");
  const sessionCommandHistory = useRef<string[]>([]);
  const historyNavigationIndex = useRef<number>(-1);
  const runtimeInitializationState = useRef(false);

  const updateVfsPathStack = (newStack: VFSNode[]) => {
    vfsPathStack.current = newStack;
    setVfsPathStackState(newStack);
  };

  // Persistence: Restore historical commands for operational continuity
  useEffect(() => {
    try {
      const persistedData = localStorage.getItem(COMMAND_HISTORY_PERSISTENCE_KEY);
      if (persistedData) {
        sessionCommandHistory.current = JSON.parse(persistedData);
      }
    } catch (e) {
      // Non-fatal persistence failure
    }
  }, []);

  const persistCommandHistory = (history: string[]) => {
    try {
      localStorage.setItem(COMMAND_HISTORY_PERSISTENCE_KEY, JSON.stringify(history));
    } catch (e) {
      // Non-fatal persistence failure
    }
  };

  /**
   * resolvePromptString
   * Computes the current procedural prompt based on VFS location.
   */
  const resolvePromptString = useCallback(() => {
    const pathString = vfsPathStack.current.map(node => node.name).join("\\");
    return `C:${pathString ? "\\" + pathString : "\\"}>`;
  }, []);

  const findVfsNodeByName = (nodes: VFSNode[], name: string): VFSNode | undefined => {
    return nodes.find(node => node.name.toLowerCase() === name.toLowerCase());
  };

  const resolveCurrentDirectoryNodes = useCallback(() => {
    let cursorNodes = vfs;
    for (const segment of vfsPathStack.current) {
      const parentNode = cursorNodes.find(node => node.id === segment.id);
      if (parentNode && parentNode.children) {
        cursorNodes = parentNode.children;
      } else {
        return [];
      }
    }
    return cursorNodes;
  }, [vfs]);

  /**
   * simulate8dot3Filename
   * Enforces historical structural constraints on identifier presentation.
   */
  const simulate8dot3Filename = (name: string) => {
    const normalized = name.toUpperCase();
    if (normalized.length <= 12 && !normalized.includes(" ")) {
      const segments = normalized.split(".");
      if (segments.length === 1 && segments[0].length <= 8) return normalized;
      if (segments.length === 2 && segments[0].length <= 8 && segments[1].length <= 3) return normalized;
    }
    
    const parts = name.split(".");
    const extension = parts.length > 1 ? parts.pop()?.toUpperCase().slice(0, 3) : "";
    const baseIdentity = parts.join("").replace(/\s+/g, "").toUpperCase().slice(0, 6);
    return `${baseIdentity}~1${extension ? "." + extension : ""}`;
  };

  const [isMonitorActive, setIsMonitorActive] = useState(false);
  const lastProcessedLogIndex = useRef<number>(0);

  // System Monitor: Pipe runtime logs to terminal if active
  useEffect(() => {
    if (isMonitorActive && runtimeTerminalInstance.current && runtimeLogs) {
      const newLogs = runtimeLogs.slice(lastProcessedLogIndex.current);
      if (newLogs.length > 0) {
        // Break current prompt line if necessary
        if (terminalInputBuffer.current) {
          runtimeTerminalInstance.current.write("\r\n");
        }
        
        newLogs.forEach(log => {
          runtimeTerminalInstance.current?.writeln(`\x1b[32m[Monitor]\x1b[0m ${log}`);
        });
        
        // Restore prompt
        runtimeTerminalInstance.current.write(resolvePromptString() + terminalInputBuffer.current);
        lastProcessedLogIndex.current = runtimeLogs.length;
      }
    } else if (!isMonitorActive && runtimeLogs) {
      // Keep index synced even when not monitoring to avoid flood on toggle
      lastProcessedLogIndex.current = runtimeLogs.length;
    }
  }, [isMonitorActive, runtimeLogs, resolvePromptString]);

  /**
   * dispatchCommandExecution
   * Main operational loop for procedural instruction processing.
   */
  const dispatchCommandExecution = (rawCommandLine: string) => {
    const term = runtimeTerminalInstance.current;
    if (!term) return;

    const sanitizedLine = rawCommandLine.trim();
    if (sanitizedLine) {
      const updatedHistory = [sanitizedLine, ...sessionCommandHistory.current.filter(c => c !== sanitizedLine)].slice(0, 50);
      sessionCommandHistory.current = updatedHistory;
      persistCommandHistory(updatedHistory);
    }
    historyNavigationIndex.current = -1;

    const argumentTokens = sanitizedLine.split(/\s+/);
    const primaryInstruction = argumentTokens[0].toLowerCase();
    const instructionArguments = argumentTokens.slice(1);

    term.write("\r\n");

    switch (primaryInstruction) {
      case "":
        break;

      case "help":
        term.writeln("Specimen Procedural Instructions:");
        term.writeln(" Help      - List available instructions");
        term.writeln(" Cls       - Clear terminal display");
        term.writeln(" Ver       - Display runtime identification");
        term.writeln(" Dir       - List Vfs directory contents");
        term.writeln(" Cd        - Traverse Vfs path stack");
        term.writeln(" Mkdir     - Create Vfs directory node");
        term.writeln(" Del       - Remove Vfs node");
        term.writeln(" Type      - Stream Vfs node content to output");
        term.writeln(" Edit      - Launch editor citizen for node");
        term.writeln(" Tasks     - List active workstation tasks");
        term.writeln(" Kill      - Terminate a task by index");
        term.writeln(" Syslog    - View system activity logs");
        term.writeln(" Monitor   - Toggle real-time log monitoring");
        term.writeln(" Exit      - Terminate terminal session");
        break;

      case "cls":
        term.clear();
        break;

      case "ver":
        term.writeln(SYSTEM_IDENTIFICATION_STRING);
        break;

      case "exit":
        onClose?.();
        break;

      case "dir": {
        const nodes = resolveCurrentDirectoryNodes();
        term.writeln(" Volume in drive C is Specimen");
        term.writeln(` Directory of ${resolvePromptString().split(">")[0]}\r\n`);
        
        let fileCount = 0;
        let dirCount = 0;
        
        nodes.forEach(node => {
          const shortName = simulate8dot3Filename(node.name);
          if (node.type === "folder") {
            term.writeln(`${shortName.padEnd(12)} <DIR>          ${node.name}`);
            dirCount++;
          } else {
            const size = node.content?.length || 0;
            term.writeln(`${shortName.padEnd(12)} ${size.toString().padStart(14)} ${node.name}`);
            fileCount++;
          }
        });
        term.writeln(`\r\n         ${fileCount} File(s)`);
        term.writeln(`         ${dirCount} Dir(s)`);
        break;
      }

      case "cd": {
        if (instructionArguments.length === 0) {
          term.writeln(resolvePromptString().split(">")[0]);
          break;
        }

        const target = instructionArguments[0];
        if (target === "..") {
          if (vfsPathStack.current.length > 0) {
            updateVfsPathStack(vfsPathStack.current.slice(0, -1));
          }
        } else if (target === "\\") {
          updateVfsPathStack([]);
        } else {
          const nodes = resolveCurrentDirectoryNodes();
          const targetNode = findVfsNodeByName(nodes, target);
          if (targetNode && targetNode.type === "folder") {
            updateVfsPathStack([...vfsPathStack.current, targetNode]);
          } else {
            term.writeln(" The system cannot find the path specified.");
          }
        }
        break;
      }

      case "mkdir": {
        if (instructionArguments.length === 0) {
          term.writeln(" Usage: MKDIR <identifier>");
          break;
        }
        const nodeName = instructionArguments[0];
        if (onUpdateVFS) {
          onUpdateVFS(prev => {
            const mountNode = (nodes: VFSNode[], stack: VFSNode[]): VFSNode[] => {
              if (stack.length === 0) {
                if (nodes.some(n => n.name.toLowerCase() === nodeName.toLowerCase())) return nodes;
                return [...nodes, {
                  id: `node-${Date.now()}`,
                  name: nodeName,
                  type: "folder",
                  icon: "📁",
                  children: []
                }];
              }
              const [head, ...tail] = stack;
              return nodes.map(node => {
                if (node.id === head.id) {
                  return { ...node, children: mountNode(node.children || [], tail) };
                }
                return node;
              });
            };
            return mountNode(prev, vfsPathStack.current);
          });
        }
        break;
      }

      case "del": {
        if (instructionArguments.length === 0) {
          term.writeln(" Usage: DEL <identifier>");
          break;
        }
        const nodeName = instructionArguments[0];
        if (onUpdateVFS) {
          onUpdateVFS(prev => {
            const deallocateNode = (nodes: VFSNode[], stack: VFSNode[]): VFSNode[] => {
              if (stack.length === 0) {
                return nodes.filter(n => n.name.toLowerCase() !== nodeName.toLowerCase());
              }
              const [head, ...tail] = stack;
              return nodes.map(node => {
                if (node.id === head.id) {
                  return { ...node, children: deallocateNode(node.children || [], tail) };
                }
                return node;
              });
            };
            return deallocateNode(prev, vfsPathStack.current);
          });
        }
        break;
      }

      case "type": {
        if (instructionArguments.length === 0) {
          term.writeln(" Specify target node for streaming.");
          break;
        }
        const nodes = resolveCurrentDirectoryNodes();
        const targetNode = findVfsNodeByName(nodes, instructionArguments[0]);
        if (targetNode && targetNode.type === "file") {
          if (targetNode.content) {
            term.writeln(targetNode.content);
          }
        } else {
          term.writeln(" File not found.");
        }
        break;
      }

      case "edit": {
        if (instructionArguments.length === 0) {
          term.writeln(" Specify target node for editing.");
          break;
        }
        const nodes = resolveCurrentDirectoryNodes();
        const targetNode = findVfsNodeByName(nodes, instructionArguments[0]);
        if (targetNode && targetNode.type === "file") {
          onOpenNode?.(targetNode);
        } else {
          term.writeln(" File not found.");
        }
        break;
      }

      case "tasks": {
        if (runtimeSnapshots.length === 0) {
          term.writeln(" No active tasks.");
        } else {
          term.writeln("Index Type        Status / Identity");
          term.writeln("----- ----        -----------------");
          runtimeSnapshots.forEach((snap, i) => {
            const index = (i + 1).toString().padEnd(5);
            const type = snap.type.padEnd(11);
            const label = snap.subtitle || snap.title;
            term.writeln(`${index} ${type} ${label}`);
          });
        }
        break;
      }

      case "kill": {
        if (instructionArguments.length === 0) {
          term.writeln(" Usage: KILL <INDEX>");
          break;
        }
        const index = parseInt(instructionArguments[0]);
        const target = runtimeSnapshots[index - 1];
        if (target && onCloseApp) {
          onCloseApp(target.id);
        } else {
          term.writeln(" Invalid task index.");
        }
        break;
      }

      case "syslog": {
        if (!runtimeLogs || runtimeLogs.length === 0) {
          term.writeln(" System activity log is currently empty.");
        } else {
          runtimeLogs.forEach((log, i) => {
            term.writeln(`${(i + 1).toString().padStart(3, "0")} ${log}`);
          });
        }
        break;
      }

      case "monitor": {
        const nextState = !isMonitorActive;
        setIsMonitorActive(nextState);
        lastProcessedLogIndex.current = runtimeLogs?.length || 0;
        term.writeln(` Monitor mode: ${nextState ? "ON" : "OFF"}`);
        break;
      }

      default:
        term.writeln(` Bad command or file name.`);
        break;
    }

    // Restore operational prompt (Actual OS Behavior)
    term.write(`\r\n${resolvePromptString()}`);
  };

  /**
   * handleIdentifierCompletion
   * Provides deterministic tab-completion based on current directory state.
   */
  const handleIdentifierCompletion = useCallback(() => {
    const term = runtimeTerminalInstance.current;
    if (!term) return;

    const currentLine = terminalInputBuffer.current;
    const tokens = currentLine.split(/\s+/);
    const lastToken = tokens[tokens.length - 1].toLowerCase();
    
    if (!lastToken) return;

    const nodes = resolveCurrentDirectoryNodes();
    const potentialMatches = nodes.filter(node => node.name.toLowerCase().startsWith(lastToken));

    if (potentialMatches.length === 1) {
      const completionSuffix = potentialMatches[0].name.slice(lastToken.length);
      terminalInputBuffer.current += completionSuffix;
      term.write(completionSuffix);
    } else if (potentialMatches.length > 1) {
      term.write("\r\n");
      potentialMatches.forEach(match => term.write(match.name + "  "));
      term.write(`\r\n${resolvePromptString()}${terminalInputBuffer.current}`);
    }
  }, [resolveCurrentDirectoryNodes, resolvePromptString]);


  // Terminal Lifecycle Management
  useEffect(() => {
    if (!viewportContainerRef.current || runtimeInitializationState.current) return;

    const terminalInstance = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "block",
      theme: {
        background: "#000000",
        foreground: "#C0C0C0",
        cursor: "#C0C0C0",
        selectionBackground: "rgba(192, 192, 192, 0.3)",
      },
      fontFamily: "W95FA, 'MS Sans Serif', Tahoma, monospace",
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 1000,
      allowTransparency: true,
    });

    const terminalFitAddon = new FitAddon();
    terminalInstance.loadAddon(terminalFitAddon);
    terminalInstance.open(viewportContainerRef.current);
    terminalFitAddon.fit();

    runtimeTerminalInstance.current = terminalInstance;
    runtimeInitializationState.current = true;
    terminalInstance.focus();

    terminalInstance.writeln(SYSTEM_IDENTIFICATION_STRING);
    terminalInstance.write(`\r\n${resolvePromptString()}`);

    terminalInstance.onData((inputData) => {
      const inputCharCode = inputData.charCodeAt(0);

      if (inputCharCode === 13) { // Enter
        dispatchCommandExecution(terminalInputBuffer.current);
        terminalInputBuffer.current = "";
      } else if (inputCharCode === 127 || inputCharCode === 8) { // Backspace
        if (terminalInputBuffer.current.length > 0) {
          terminalInputBuffer.current = terminalInputBuffer.current.slice(0, -1);
          terminalInstance.write("\b \b");
        }
      } else if (inputCharCode === 9) { // Tab
        handleIdentifierCompletion();
      } else if (inputData === "\u001b[A") { // Up Arrow
        if (sessionCommandHistory.current.length > 0) {
          for (let i = 0; i < terminalInputBuffer.current.length; i++) terminalInstance.write("\b \b");
          
          historyNavigationIndex.current = Math.min(historyNavigationIndex.current + 1, sessionCommandHistory.current.length - 1);
          const historicalCommand = sessionCommandHistory.current[historyNavigationIndex.current];
          terminalInputBuffer.current = historicalCommand;
          terminalInstance.write(historicalCommand);
        }
      } else if (inputData === "\u001b[B") { // Down Arrow
        for (let i = 0; i < terminalInputBuffer.current.length; i++) terminalInstance.write("\b \b");
        
        if (historyNavigationIndex.current > 0) {
          historyNavigationIndex.current--;
          const historicalCommand = sessionCommandHistory.current[historyNavigationIndex.current];
          terminalInputBuffer.current = historicalCommand;
          terminalInstance.write(historicalCommand);
        } else {
          historyNavigationIndex.current = -1;
          terminalInputBuffer.current = "";
        }
      } else if (inputCharCode < 32) {
        // Suppress non-printable control characters
      } else {
        terminalInputBuffer.current += inputData;
        terminalInstance.write(inputData);
      }
    });

    const viewportResizeObserver = new ResizeObserver(() => {
      terminalFitAddon.fit();
    });
    viewportResizeObserver.observe(viewportContainerRef.current);

    return () => {
      viewportResizeObserver.disconnect();
      terminalInstance.dispose();
      runtimeInitializationState.current = false;
    };
  }, [handleIdentifierCompletion, resolvePromptString]);

  // Focus Synchronization
  useEffect(() => {
    if (isVisible && runtimeTerminalInstance.current) {
      setTimeout(() => {
        const terminalFitAddon = new FitAddon();
        runtimeTerminalInstance.current?.loadAddon(terminalFitAddon);
        terminalFitAddon.fit();
      }, 50);
    }
  }, [isVisible]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-black">
      <div className="flex-1 m-0.5 p-1 win-sunken overflow-hidden relative border-none bg-black">
        <div ref={viewportContainerRef} className="w-full h-full overflow-hidden" />
      </div>

      <style jsx global>{`
        .xterm-viewport {
          background-color: transparent !important;
        }
        .xterm-rows {
          font-smoothing: none;
        }
        .xterm-viewport::-webkit-scrollbar {
          width: 8px;
        }
        .xterm-viewport::-webkit-scrollbar-track {
          background: #000;
        }
        .xterm-viewport::-webkit-scrollbar-thumb {
          background: #333;
          border: 1px solid #000;
        }
      `}</style>
    </div>
  );
}
