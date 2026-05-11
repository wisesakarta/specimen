"use client";

import { useEffect } from "react";

export default function ConsoleGraffiti() {
  useEffect(() => {
    // figlet "Standard" font — SPECIMEN
    // Backslashes doubled for template-literal escape.
    console.log(
      `%c
  ____  ____  _____ ____ ___ __  __ _____ _   _
 / ___||  _ \\| ____/ ___|_ _|  \\/  | ____| \\ | |
 \\___ \\| |_) |  _|| |    | || |\\/| |  _| |  \\| |
  ___) |  __/| |__| |___ | || |  | | |___| |\\  |
 |____/|_|   |_____\\____|___|_|  |_|_____|_| \\_|
%c  Specimen 95  ·  Sovereign Runtime  ·  Technical Standard

%c nothing here worth taking. %c everything worth taking is in the UI.

%cSpecimen — Technical Standard.`,

      // ASCII art — Win95 active title navy (#000080), bold monospace
      "font-family: monospace; font-size: 12px; font-weight: bold; color: #000080; line-height: 1.4;",

      // Subtitle — Win95 gray, italic, subordinate weight
      "font-family: monospace; font-size: 10px; color: #808080; font-style: italic;",

      // Badge — Win95 title bar: white on navy, zero border-radius
      "font-family: monospace; font-size: 11px; font-weight: bold; background: #000080; color: #ffffff; padding: 2px 8px; border-radius: 0;",

      // Message body — near-black, consistent monospace
      "font-family: monospace; font-size: 11px; color: #1a1a1a;",

      // Credit — Win95 gray (#808080), smallest weight
      "font-family: monospace; font-size: 10px; color: #808080;"
    );
  }, []);

  return null;
}
