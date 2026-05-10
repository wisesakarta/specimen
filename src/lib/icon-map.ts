/**
 * Win95 Icon Map
 *
 * Maps Specimen's VFS emoji identifiers to icon PNG files.
 * App/desktop icons: React95 library (vivid, high-quality Win95 extraction).
 * Start menu large icons: trapd00r shell32.dll extraction (authentic).
 * These are two separate icon sources — NOT single source of truth.
 */

export interface Win95IconEntry {
  src16: string;
  src32?: string;
}

export const WIN95_ICON_MAP: Record<string, Win95IconEntry> = {
  // React95 library icons — used for desktop, taskbar, explorer, window chrome
  "🔍": { src16: "/win95-icons/Specimen_16x16.png",           src32: "/win95-icons/Specimen_32x32.png" },
  "📁": { src16: "/win95-icons/Folder_16x16_4.png",          src32: "/win95-icons/Folder_32x32_4.png" },
  "📂": { src16: "/win95-icons/FolderOpen_16x16_4.png",      src32: "/win95-icons/FolderOpen_32x32_4.png" },
  "🖥️": { src16: "/win95-icons/Computer_16x16_4.png",        src32: "/win95-icons/Computer_32x32_4.png" },
  "🗂️": { src16: "/win95-icons/WindowsExplorer_16x16_4.png", src32: "/win95-icons/WindowsExplorer_32x32_4.png" },
  "📋": { src16: "/win95-icons/MonacoEditor_16x16.png",      src32: "/win95-icons/MonacoEditor_32x32.png" },
  "🌐": { src16: "/win95-icons/Globe_16x16_4.png",           src32: "/win95-icons/Globe_32x32_4.png" },
  "📝": { src16: "/win95-icons/Notepad_16x16_4.png",         src32: "/win95-icons/Notepad_32x32_4.png" },
  "📄": { src16: "/win95-icons/FileText_16x16_4.png",        src32: "/win95-icons/FileText_32x32_4.png" },
  "🗑️": { src16: "/win95-icons/RecycleEmpty_16x16_4.png",    src32: "/win95-icons/RecycleEmpty_32x32_4.png" },
  "🔊": { src16: "/win95-icons/MediaAudio_16x16_4.png",      src32: "/win95-icons/MediaAudio_32x32_4.png" },
  "🎨": { src16: "/win95-icons/Mspaint_16x16_4.png",         src32: "/win95-icons/Mspaint_32x32_4.png" },
  "📻": { src16: "/win95-icons/webamp.png",                   src32: "/win95-icons/webamp.png" },
  "⚡": { src16: "/win95-icons/webamp.png",                   src32: "/win95-icons/webamp.png" },
  "⌨️": { src16: "/win95-icons/MsDos_16x16_32.png",          src32: "/win95-icons/MsDos_32x32_32.png" },
  "ShutDown": { src16: "/win95-icons/start-shutdown-32x32.png", src32: "/win95-icons/start-shutdown-32x32.png" },
};

export function resolveWin95Icon(emoji: string, size: 16 | 32 = 16): string | null {
  const entry = WIN95_ICON_MAP[emoji];
  if (!entry) return null;
  if (size === 32) return entry.src32 ?? entry.src16;
  return entry.src16;
}
