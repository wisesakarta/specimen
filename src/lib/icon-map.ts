/**
 * Win95 Icon Map
 *
 * Maps SPECIMEN's VFS emoji identifiers to React95-sourced pixel-art PNG icons.
 * Shell components use this to replace emoji with authentic Win95 iconography.
 * Unknown emoji fall back to text rendering — no icon is ever hidden.
 */

export interface Win95IconEntry {
  /** 16×16 PNG path served from public/win95-icons/ */
  src16: string;
  /** 32×32 PNG path served from public/win95-icons/ — optional */
  src32?: string;
}

export const WIN95_ICON_MAP: Record<string, Win95IconEntry> = {
  "🔍": { src16: "/win95-icons/FileFind_16x16_4.png",        src32: "/win95-icons/FileFind_32x32_4.png" },
  "📁": { src16: "/win95-icons/Folder_16x16_4.png",          src32: "/win95-icons/Folder_32x32_4.png" },
  "📂": { src16: "/win95-icons/FolderOpen_16x16_4.png" },
  "🖥️": { src16: "/win95-icons/Computer_16x16_4.png",        src32: "/win95-icons/Computer_32x32_4.png" },
  "🗂️": { src16: "/win95-icons/WindowsExplorer_16x16_4.png" },
  "🌐": { src16: "/win95-icons/Globe_16x16_4.png",           src32: "/win95-icons/Globe_32x32_4.png" },
  "⚡": { src16: "/win95-icons/Mmsys100_16x16_4.png",        src32: "/win95-icons/Mmsys100_32x32_4.png" },
  "📝": { src16: "/win95-icons/Notepad_16x16_4.png",         src32: "/win95-icons/Notepad_32x32_4.png" },
  "📄": { src16: "/win95-icons/FileText_16x16_4.png",        src32: "/win95-icons/FileText_32x32_4.png" },
  "📦": { src16: "/win95-icons/Doc_16x16_4.png" },
  "🔡": { src16: "/win95-icons/FolderFont_16x16_4.png",      src32: "/win95-icons/FolderFont_32x32_4.png" },
  "🔊": { src16: "/win95-icons/MediaAudio_16x16_4.png",      src32: "/win95-icons/MediaAudio_32x32_4.png" },
  "🗑️": { src16: "/win95-icons/RecycleEmpty_16x16_4.png",    src32: "/win95-icons/RecycleEmpty_32x32_4.png" },
  "🎨": { src16: "/win95-icons/Mspaint_16x16_4.png",        src32: "/win95-icons/Mspaint_32x32_4.png" },
  "📻": { src16: "/win95-icons/Mmsys100_16x16_4.png",        src32: "/win95-icons/Mmsys100_32x32_4.png" },
  "ShutDown": { 
    src16: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAm0lEQVR4AaXBgY3CMBBFwWe0fWU789/O1pUZIxLJ8uVEAjOFiaTORZIKg7GT1N2dT7ZtIyIYOlCMQVKvtXJFRDAzJq013J3/ZCYr41Tnr+DMgx89+JFxKrjKWGQmdxi7iOAqSUhCEoW3zg2SeJGESeq1Vu6ICA7GrrXGyt1ZZSYzY+Kbky05ZCaHzMTdWRVJnS9IYiiFt859heEJdTQ7t5rT7/4AAAAASUVORK5CYII=", 
    src32: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABQ0lEQVR4AcXBAW6DMBBFwedo78XezH9vtj6ZS5pURSgECoTOFN6Q1DmZpMKEsUBSd3fOMgwDEcGoA4WnGy9I6u7OWYZhICJ4xZiR1GutnCkiWGJMSOq1VlprXMVYkJkcVWultcY7xgJJHCNqZZXxVme/YIsbazofZWxWWNbZy1hT+CaJWitzpRSOMHYoJfglIHgQ0PkLYwcJaq3MlSL+ythIEpK4k8RZjM06v4KzGDtIQhJnMHbpnMVYJCD4NGNB75UrGAtaa5xNEpIYdUaSijETEXyCJCRx5+5kJqNuTEjiUyRx5+5kJj+MkaTOBdydzGTKJPVaK1eICOaMp9Ya/8E4IDPZwt1ZYsz44NxlS9ZIYovMZIkxFzw4qzKTVzITd2cLYyY9OcrdWSOJUbnxDyQxKoyMUURwFUmMCk+Fh851ChNfhxx7+xF1KZkAAAAASUVORK5CYII=" 
  },
};

export function resolveWin95Icon(emoji: string, size: 16 | 32 = 16): string | null {
  const entry = WIN95_ICON_MAP[emoji];
  if (!entry) return null;
  if (size === 32) return entry.src32 ?? entry.src16;
  return entry.src16;
}
