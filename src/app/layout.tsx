import "@/app/globals.css";
import ConsoleGraffiti from "@/components/ui/Win95ConsoleGraffiti";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Specimen 95",
  applicationName: "Specimen 95",
  description: "Specimen 95 — an operating system in the browser. Every pixel authored with intent.",
  keywords: ["operating system", "windows 95", "browser os", "sovereign runtime", "technical standard", "specimen"],
  authors: [{ name: "Technical Standard" }],
  creator: "Technical Standard",
  publisher: "Technical Standard",
  metadataBase: new URL("https://specimen.krtalabs.xyz"),
  openGraph: {
    title: "Specimen 95",
    description: "An operating system in the browser. Every pixel authored with intent.",
    url: "https://specimen.krtalabs.xyz",
    siteName: "Specimen 95",
    locale: "en_US",
    type: "website",
    images: [{ url: "/brand/specimen-logo.svg", width: 512, height: 512, alt: "Specimen 95" }],
  },
  twitter: {
    card: "summary",
    title: "Specimen 95",
    description: "An operating system in the browser. Every pixel authored with intent.",
    images: ["/brand/specimen-logo.svg"],
  },
  icons: {
    icon: "/brand/specimen-logo.svg",
    apple: "/brand/specimen-logo.svg",
  },
  robots: {
    index: true,
    follow: true,
  },
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
