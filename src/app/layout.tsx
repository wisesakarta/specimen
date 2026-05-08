import "@/app/globals.css";
import ConsoleGraffiti from "@/components/ui/Win95ConsoleGraffiti";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Specimen",
  applicationName: "Specimen",
  description: "Specimen by Technical Standard"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="flex min-h-screen w-full flex-col overflow-hidden" style={{ background: "var(--win-desktop)", color: "var(--win-text)" }}>
        <ConsoleGraffiti />
        
        <main className="relative flex-1 w-full flex items-center justify-center overflow-hidden">
            {children}
        </main>
      </body>
    </html>
  );
}
