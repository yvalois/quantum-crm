"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

interface CrmShellProps {
  readonly children: ReactNode;
  readonly className?: string;
}

interface NavigationItem {
  readonly href?: string;
  readonly icon: string;
  readonly label: string;
}

interface NavigationGroup {
  readonly label: string;
  readonly items: readonly NavigationItem[];
}

const navigation: readonly NavigationGroup[] = [
  {
    label: "Espacio de trabajo",
    items: [
      { href: "/", icon: "⌂", label: "Resumen" },
      { href: "/inbox", icon: "◫", label: "Conversaciones" },
      { href: "/contacts", icon: "◎", label: "Contactos" },
      { href: "/pipeline", icon: "◇", label: "Oportunidades" },
      { href: "/tasks", icon: "✓", label: "Tareas" },
      { icon: "▦", label: "Calendario" },
    ],
  },
  {
    label: "Crecimiento",
    items: [
      { icon: "▤", label: "Formularios" },
      { icon: "▧", label: "Catálogo" },
      { icon: "▱", label: "Documentos" },
      { icon: "⌁", label: "Automatizaciones" },
      { icon: "↗", label: "Reportes" },
      { icon: "✦", label: "Agente Quantum" },
    ],
  },
  {
    label: "Administración",
    items: [
      { href: "/team", icon: "♙", label: "Equipo y acceso" },
      { icon: "⚙", label: "Configuración" },
    ],
  },
];

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CrmShell({ children, className = "" }: CrmShellProps): React.JSX.Element {
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout(): Promise<void> {
    setLoggingOut(true);
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!sessionResponse.ok) {
        window.location.assign("/signed-out");
        return;
      }
      const session = (await sessionResponse.json()) as { readonly csrfToken?: string };
      if (!session.csrfToken) {
        window.location.assign("/signed-out");
        return;
      }
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "x-csrf-token": session.csrfToken },
        redirect: "manual",
      });
      window.location.assign(response.headers.get("location") ?? "/signed-out");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className={`crm-shell crm-shell-stitch ${className}`.trim()}>
      <aside className="crm-sidebar" aria-label="Navegación principal">
        <a className="brand" href="/" aria-label="Quantum CRM, resumen">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>
          <span className="brand-copy">
            <strong>Quantum</strong>
            <small>CRM</small>
          </span>
        </a>
        <div className="workspace-chip">
          <span className="workspace-avatar" aria-hidden="true">
            QD
          </span>
          <span>
            <strong>Quantum Demo</strong>
            <small>Espacio piloto</small>
          </span>
          <span className="workspace-chevron" aria-hidden="true">
            ⌄
          </span>
        </div>
        <nav>
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) =>
                item.href ? (
                  <a
                    href={item.href}
                    key={item.label}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </a>
                ) : (
                  <span className="nav-pending" key={item.label} aria-disabled="true">
                    <span className="nav-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                    <small>Pronto</small>
                  </span>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-environment">
          <span className="pulse-dot" aria-hidden="true" />
          <span>
            <strong>Entorno conectado</strong>
            <small>Perfil de desarrollo</small>
          </span>
        </div>
        <div className="sidebar-footer">
          <span className="operator-avatar" aria-hidden="true">
            QA
          </span>
          <span className="operator-copy">
            <strong>Administrador</strong>
            <small>Sesión protegida</small>
          </span>
          <button type="button" onClick={() => void logout()} disabled={loggingOut}>
            {loggingOut ? "…" : "Salir"}
          </button>
        </div>
      </aside>
      {children}
    </main>
  );
}
