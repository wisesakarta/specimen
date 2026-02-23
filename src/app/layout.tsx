import "@/app/globals.css";
import ConsoleGraffiti from "@/components/ui/ConsoleGraffiti";
import ElasticGrid from "@/components/ui/ElasticGrid";
import { GridProvider } from "@/context/GridContext";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Aksara",
  applicationName: "Aksara",
  description: "Aksara by Saka Studio & Engineering"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen w-full flex-col bg-[var(--canvas)] text-[var(--ink)] overflow-hidden">
        <GridProvider>
          <ConsoleGraffiti />
          <ElasticGrid />
          
          <main className="relative flex-1 w-full flex items-center justify-center overflow-hidden">
              {children}
          </main>
        </GridProvider>
      </body>
    </html>
  );
}
