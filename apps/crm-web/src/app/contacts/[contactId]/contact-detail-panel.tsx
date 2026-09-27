"use client";

import type { Contact } from "@quantum-crm/contracts";
import { useEffect, useState } from "react";

interface ContactPayload { readonly data: Contact; }

async function problemTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible cargar el contacto.";
}

export function ContactDetailPanel({ contactId }: { readonly contactId: string }): React.JSX.Element {
  const [contact, setContact] = useState<Contact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/contacts/${contactId}`, { cache: "no-store", credentials: "same-origin" });
        if (response.status === 401) {
          window.location.assign(`/api/auth/login?returnTo=/contacts/${contactId}`);
          return;
        }
        if (!response.ok) throw new Error(await problemTitle(response));
        if (active) setContact((await response.json() as ContactPayload).data);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "No fue posible cargar el contacto.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [contactId]);

  return <main className="crm-shell"><aside className="crm-sidebar" aria-label="Navegación principal"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">Q</span><span>Quantum</span></a><nav><a href="/">Equipo</a><a href="/contacts" aria-current="page">Contactos</a><a href="/pipeline">Pipeline</a><a href="/tasks">Tareas</a></nav></aside><section className="crm-content" aria-busy={loading}><header className="page-header"><div><p className="eyebrow">CRM</p><h1>Detalle de contacto</h1><p>Información persistida en el perfil activo.</p></div><a className="secondary-action" href="/contacts">Volver a contactos</a></header>{error ? <p className="feedback feedback-error" role="alert">{error}</p> : null}{loading ? <p className="state-message">Cargando contacto…</p> : null}{contact ? <section className="member-card"><div className="card-heading"><h2>{contact.displayName}</h2><p>Contacto registrado en Quantum CRM.</p></div><div className="member-row"><div className="member-details"><strong>Correo</strong><span>{contact.email ?? "Sin correo registrado"}</span></div></div><div className="member-row"><div className="member-details"><strong>Teléfono</strong><span>{contact.phone ?? "Sin teléfono registrado"}</span></div></div><div className="member-row"><div className="member-details"><strong>Actualizado</strong><span>{new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(contact.updatedAt))}</span></div></div></section> : null}</section></main>;
}
