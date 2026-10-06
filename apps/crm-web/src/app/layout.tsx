import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Quantum CRM",
  description: "Interfaz interna del CRM",
};

// The proxy generates a per-request CSP nonce. Next.js requires this route
// option to be a static literal so it can attach that nonce to every script.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
