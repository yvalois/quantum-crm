import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Quantum Admin",
  description: "Administracion central de la plataforma",
};

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-interface",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${instrumentSans.variable} ${ibmPlexMono.variable}`}>{children}</body>
    </html>
  );
}
