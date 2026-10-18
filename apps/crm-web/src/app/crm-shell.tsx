"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

import brandArtwork from "./business-assistant-brand.jpeg";

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
  | "media"
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
    label: "Trabajo diario",
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
    label: "Contenido y recursos",
    items: [
      { href: "/forms", icon: "forms", label: "Formularios" },
      { href: "/catalog", icon: "catalog", label: "Catálogo" },
      { href: "/documents", icon: "documents", label: "Documentos" },
      { href: "/media", icon: "media", label: "Multimedia" },
    ],
  },
  {
    label: "Administración",
    items: [
      { href: "/pipelines", icon: "pipeline", label: "Pipelines" },
      { href: "/team", icon: "team", label: "Equipo y acceso" },
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
  media: ["M4 5h16v14H4z", "m4 15 3-3 3 2 3-4 3 5", "M16 9h.01"],
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
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem("business-assistant:sidebar-collapsed") === "true");
    } catch {
      // Storage may be unavailable in private browsing; the navigation still works.
    }
  }, []);

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileCloseButtonRef.current?.focus();
    const handleNavigationKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMobileNavigationOpen(false);
      if (event.key !== "Tab") return;
      const focusable = navigationRef.current?.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>(
        "a[href], button:not([disabled])",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleNavigationKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleNavigationKey);
      mobileMenuButtonRef.current?.focus();
    };
  }, [mobileNavigationOpen]);

  const currentPage =
    navigation.flatMap((group) => group.items).find((item) => item.href && isCurrent(pathname, item.href))
      ?.label ?? "Espacio de trabajo";

  function toggleSidebar(): void {
    setSidebarCollapsed((collapsed) => {
      try {
        window.localStorage.setItem("business-assistant:sidebar-collapsed", String(!collapsed));
      } catch {
        // Keep the current page usable even when storage is disabled.
      }
      return !collapsed;
    });
  }

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
    mobileNavigationOpen ? "mobile-navigation-open" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClassName}>
      <div className="crm-mobile-bar">
        <button
          ref={mobileMenuButtonRef}
          className="crm-mobile-menu-button"
          type="button"
          onClick={() => setMobileNavigationOpen(true)}
          aria-label="Abrir menú"
          aria-controls="crm-navigation"
          aria-expanded={mobileNavigationOpen}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </button>
        <div className="crm-mobile-location">
          <strong>Business Assistant</strong>
          <span>{currentPage}</span>
        </div>
      </div>
      {mobileNavigationOpen && (
        <button
          className="crm-mobile-backdrop"
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}
      <aside
        ref={navigationRef}
        id="crm-navigation"
        className="crm-sidebar"
        aria-label="Navegación principal"
      >
        <div className="sidebar-brand-row">
          <a className="brand" href="/" aria-label="Business Assistant, resumen">
            <span className="brand-mark" aria-hidden="true">
              <Image
                className="brand-artwork"
                src={brandArtwork}
                alt=""
                width={1600}
                height={870}
                unoptimized
              />
            </span>
          </a>
          <button
            className="sidebar-collapse"
            type="button"
            onClick={toggleSidebar}
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
          <button
            ref={mobileCloseButtonRef}
            className="sidebar-mobile-close"
            type="button"
            onClick={() => setMobileNavigationOpen(false)}
            aria-label="Cerrar menú"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
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
                    onClick={() => setMobileNavigationOpen(false)}
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

        <div className="sidebar-footer">
          <span className="operator-avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="8" r="3.4" />
              <path d="M5.2 20c.4-3.4 2.7-5.2 6.8-5.2s6.4 1.8 6.8 5.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="operator-copy">
            <strong>Mi sesión</strong>
            <small>Business Assistant</small>
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
