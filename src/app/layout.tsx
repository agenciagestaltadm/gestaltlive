import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toast";

const lato = localFont({
  src: [
    { path: "../fonts/lato-light.ttf", weight: "300", style: "normal" },
    { path: "../fonts/lato-regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/lato-italic.ttf", weight: "400", style: "italic" },
    { path: "../fonts/lato-bold.ttf", weight: "700", style: "normal" },
    { path: "../fonts/lato-black.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-lato",
  display: "swap",
});

const diora = localFont({
  src: [{ path: "../fonts/diora-sunbright.otf", weight: "400", style: "normal" }],
  variable: "--font-diora",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Gestalt Live", template: "%s · Gestalt Live" },
  description: "Interação ao vivo, gamificação e satisfação para palestras e treinamentos — Gestalt Marketing, Tecnologia e Educação.",
  applicationName: "Gestalt Live",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B1736",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${lato.variable} ${diora.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
