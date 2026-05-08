"use client";

import { useEffect } from "react";

export default function ConsoleGraffiti() {
  useEffect(() => {
    // SPECIMEN GRAFFITI
    console.log(
      `%c
    _    _  __  _____    _    ____      _
   / \\  | |/ / / ___|   / \\  |  _ \\    / \\
  / _ \\ | ' /  \\___ \\  / _ \\ | |_) |  / _ \\
 / ___ \\| . \\   ___) |/ ___ \\|  _ <  / ___ \\
/_/   \\_\\_|\\_\\ |____//_/   \\_\\_| \\_\\/_/   \\
                                 
 %c nothing here worth taking. %c
everything worth taking is in the UI.

Specimen — Technical Standard.
`,
      "font-weight: bold; font-size: 20px; color: #000;",
      "font-weight: bold; font-size: 14px; background: #000; color: #fff; padding: 4px 8px; border-radius: 2px;",
      "color: #666; font-size: 12px;"
    );
  }, []);

  return null;
}
