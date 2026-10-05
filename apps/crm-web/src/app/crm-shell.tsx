"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

interface CrmShellProps {
  readonly children: ReactNode;
  readonly className?: string;
}

type NavigationIconName =
  | "agent"
  | "automation"
  | "calendar"
  | "catalog"
  | "contacts"
  | "documents"
  | "forms"
  | "home"
  | "inbox"
  | "pipeline"
  | "reports"
  | "settings"
  | "tasks"
  | "team";

interface NavigationItem {
  readonly href?: string;
  readonly icon: NavigationIconName;
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
      { href: "/", icon: "home", label: "Resumen" },
      { href: "/inbox", icon: "inbox", label: "Conversaciones" },
      { href: "/contacts", icon: "contacts", label: "Contactos" },
      { href: "/pipeline", icon: "pipeline", label: "Oportunidades" },
      { href: "/tasks", icon: "tasks", label: "Tareas" },
      { href: "/calendar", icon: "calendar", label: "Calendario" },
    ],
  },
  {
    label: "Crecimiento",
    items: [
      { href: "/forms", icon: "forms", label: "Formularios" },
      { icon: "catalog", label: "Catálogo" },
      { href: "/documents", icon: "documents", label: "Documentos" },
      { icon: "automation", label: "Automatizaciones" },
      { icon: "reports", label: "Reportes" },
      { icon: "agent", label: "Agente Quantum" },
    ],
  },
  {
    label: "Administración",
    items: [
      { href: "/team", icon: "team", label: "Equipo y acceso" },
      { icon: "settings", label: "Configuración" },
    ],
  },
];

const iconPaths: Readonly<Record<NavigationIconName, readonly string[]>> = {
  agent: [
    "M12 3l1.25 3.25L16.5 7.5l-3.25 1.25L12 12l-1.25-3.25L7.5 7.5l3.25-1.25L12 3Z",
    "M18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z",
  ],
  automation: ["M7 7h10v4H7z", "M5 13h6v4H5z", "M15 13h4v4h-4z", "M12 11v2", "M8 17v2h10v-2"],
  calendar: ["M5 5h14v14H5z", "M8 3v4", "M16 3v4", "M5 9h14", "M8 12h2", "M14 12h2", "M8 15h2"],
  catalog: ["M4 5h6v6H4z", "M14 5h6v6h-6z", "M4 15h6v4H4z", "M14 15h6v4h-6z"],
  contacts: [
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M3.5 19c.4-3.2 2.2-5 5.5-5s5.1 1.8 5.5 5",
    "M16 7a2.5 2.5 0 0 1 0 5",
    "M16 14c2.8 0 4.2 1.5 4.5 4",
  ],
  documents: ["M6 3h8l4 4v14H6z", "M14 3v5h4", "M9 12h6", "M9 16h6"],
  forms: ["M6 3h12v18H6z", "M9 8h6", "M9 12h6", "M9 16h3"],
  home: ["M4 10.5 12 4l8 6.5", "M6.5 9.5V20h11V9.5", "M9.5 20v-6h5v6"],
  inbox: ["M4 5h16v14H4z", "M4 13h4l2 3h4l2-3h4"],
  pipeline: ["M5 6h14", "M5 12h10", "M5 18h6", "m16 16 2 2 3-4"],
  reports: ["M5 20V10h4v10", "M10 20V4h4v16", "M15 20v-7h4v7", "M3 20h18"],
  settings: [
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
    "M19 13.5l2 1-2 3.5-2.1-1a8 8 0 0 1-2.4 1.4L14.3 21h-4.1L10 18.4A8 8 0 0 1 7.7 17L5.5 18 3.5 14.5l2-1a8 8 0 0 1 0-3l-2-1L5.5 6l2.2 1A8 8 0 0 1 10 5.6L10.2 3h4.1l.2 2.6A8 8 0 0 1 16.8 7L19 6l2 3.5-2 1a8 8 0 0 1 0 3Z",
  ],
  tasks: ["M5 4h14v16H5z", "m8 9 1.5 1.5L13 7", "M8 15h8"],
  team: [
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M3.5 19c.4-3.2 2.2-5 5.5-5s5.1 1.8 5.5 5",
    "M17 8v5",
    "M14.5 10.5h5",
  ],
};

function NavigationIcon({ name }: { readonly name: NavigationIconName }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  );
}

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CrmShell({ children, className = "" }: CrmShellProps): React.JSX.Element {
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  const shellClassName = [
    "crm-shell",
    "crm-shell-stitch",
    sidebarCollapsed ? "sidebar-collapsed" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClassName}>
      <aside className="crm-sidebar" aria-label="Navegación principal">
        <div className="sidebar-brand-row">
          <a className="brand" href="/" aria-label="Quantum CRM, resumen">
            <span className="brand-mark" aria-hidden="true">
              Q
            </span>
            <span className="brand-copy">
              <strong>Quantum</strong>
              <small>CRM</small>
            </span>
          </a>
          <button
            className="sidebar-collapse"
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? "Expandir navegación" : "Contraer navegación"}
            aria-expanded={!sidebarCollapsed}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m14 7-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div
          className="workspace-chip"
          title={sidebarCollapsed ? "Quantum Demo — Espacio piloto" : undefined}
        >
          <span className="workspace-avatar" aria-hidden="true">
            QD
          </span>
          <span className="workspace-copy">
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
              {group.items.map((item) => {
                const itemContent = (
                  <>
                    <span className="nav-icon">
                      <NavigationIcon name={item.icon} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                  </>
                );

                return item.href ? (
                  <a
                    href={item.href}
                    key={item.label}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    {itemContent}
                  </a>
                ) : (
                  <span
                    className="nav-pending"
                    key={item.label}
                    aria-disabled="true"
                    title={sidebarCollapsed ? `${item.label} — Próximamente` : undefined}
                  >
                    {itemContent}
                    <small aria-label="Próximamente">Próximo</small>
                  </span>
                );
              })}
            </div>
          ))}
        </nav>

        <div
          className="sidebar-environment"
          title={sidebarCollapsed ? "Entorno conectado" : undefined}
        >
          <span className="pulse-dot" aria-hidden="true" />
          <span className="environment-copy">
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
          <button
            className="sidebar-logout"
            type="button"
            onClick={() => void logout()}
            disabled={loggingOut}
            title="Cerrar sesión"
          >
            {loggingOut ? (
              <span aria-hidden="true">…</span>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path
                  d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span className="sr-only">Cerrar sesión</span>
          </button>
        </div>
      </aside>
      {children}
    </main>
  );
}
