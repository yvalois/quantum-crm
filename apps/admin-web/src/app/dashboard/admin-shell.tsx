"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

const navigation = [
  {
    href: "/dashboard",
    label: "Resumen de plataforma",
    glyph: "01",
    enabled: true,
  },
  {
    href: "/dashboard/tenants",
    label: "Tenants y entornos",
    glyph: "02",
    enabled: true,
  },
  {
    href: "/dashboard/tenants#release-controls",
    label: "Releases y artefactos",
    glyph: "03",
    enabled: true,
  },
  {
    href: "#",
    label: "Despliegues y operaciones",
    glyph: "04",
    enabled: false,
  },
  { href: "#", label: "Infraestructura y VPS", glyph: "05", enabled: false },
  { href: "#", label: "Backups y recuperación", glyph: "06", enabled: false },
  {
    href: "#",
    label: "Incidentes y mantenimiento",
    glyph: "07",
    enabled: false,
  },
  { href: "#", label: "Operadores y roles", glyph: "08", enabled: false },
  { href: "#", label: "Auditoría inmutable", glyph: "09", enabled: false },
  { href: "#", label: "Configuración global", glyph: "10", enabled: false },
] as const;

export function AdminShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      const session = await fetch("/api/auth/session", { cache: "no-store" });
      if (!session.ok) {
        router.replace("/signed-out");
        return;
      }
      const body = (await session.json()) as { readonly csrfToken?: string };
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": body.csrfToken ?? "" },
        redirect: "manual",
      });
      router.replace(response.headers.get("location") ?? "/signed-out");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="admin-frame">
      <button
        className="mobile-menu"
        type="button"
        aria-label={menuOpen ? "Cerrar navegación" : "Abrir navegación"}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span />
        <span />
      </button>
      <aside className={`admin-sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>
          <span>
            <strong>QUANTUM</strong>
            <small>CONTROL PLANE / INTERNAL</small>
          </span>
        </div>
        <div className="environment-chip">
          <span aria-hidden="true" /> Entorno de desarrollo
        </div>
        <nav aria-label="Navegación principal" className="admin-nav">
          <p>MODULES / CONTROL PLANE</p>
          {navigation.map((item) =>
            item.enabled ? (
              <Link
                key={item.label}
                href={item.href}
                className={pathname === item.href.split("#")[0] ? "is-active" : ""}
                onClick={() => setMenuOpen(false)}
              >
                <span aria-hidden="true">{item.glyph}</span>
                {item.label}
              </Link>
            ) : (
              <span className="nav-disabled" key={item.label} aria-disabled="true">
                <span aria-hidden="true">{item.glyph}</span>
                {item.label}
                <small>próximamente</small>
              </span>
            ),
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="operator-avatar" aria-hidden="true">
            OP
          </div>
          <div>
            <strong>Operador Quantum</strong>
            <span>Sesión protegida · MFA</span>
          </div>
          <button type="button" onClick={signOut} disabled={signingOut}>
            {signingOut ? "…" : "Salir"}
          </button>
        </div>
      </aside>
      <div className="admin-stage">
        <header className="admin-topbar">
          <div className="topbar-path">
            <span>CORE-VPS</span>
            <b>/</b>
            <strong>CONTROL-PLANE</strong>
          </div>
          <span className="system-pulse">
            <i aria-hidden="true" /> Servicios conectados
          </span>
          <span className="topbar-divider" />
          <span className="topbar-mode">MODO SEGURO</span>
        </header>
        {children}
      </div>
    </div>
  );
}
