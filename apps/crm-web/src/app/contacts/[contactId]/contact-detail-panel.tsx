"use client";

import type { Contact, Opportunity, Task } from "@quantum-crm/contracts";
import { useEffect, useState } from "react";

interface ContactPayload {
  readonly data: Contact;
}

async function problemTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible cargar el contacto.";
}

export function ContactDetailPanel({
  contactId,
}: {
  readonly contactId: string;
}): React.JSX.Element {
  const [contact, setContact] = useState<Contact | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [response, opportunityResponse, taskResponse] = await Promise.all([
          fetch(`/api/contacts/${contactId}`, {
            cache: "no-store",
            credentials: "same-origin",
          }),
          fetch(`/api/opportunities?contactId=${encodeURIComponent(contactId)}`, {
            cache: "no-store",
            credentials: "same-origin",
          }),
          fetch(`/api/tasks?contactId=${encodeURIComponent(contactId)}`, {
            cache: "no-store",
            credentials: "same-origin",
          }),
        ]);
        if (response.status === 401) {
          window.location.assign(`/api/auth/login?returnTo=/contacts/${contactId}`);
          return;
        }
        if (!response.ok) throw new Error(await problemTitle(response));
        if (!opportunityResponse.ok) throw new Error(await problemTitle(opportunityResponse));
        if (!taskResponse.ok) throw new Error(await problemTitle(taskResponse));
        if (active) {
          setContact(((await response.json()) as ContactPayload).data);
          setOpportunities(
            ((await opportunityResponse.json()) as { readonly data: Opportunity[] }).data,
          );
          setTasks(
            ((await taskResponse.json()) as { readonly data: Task[] }).data
              .filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status))
              .sort((left, right) => {
                if (left.dueAt === null) return 1;
                if (right.dueAt === null) return -1;
                return Date.parse(left.dueAt) - Date.parse(right.dueAt);
              }),
          );
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "No fue posible cargar el contacto.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [contactId]);

  return (
    <main className="crm-shell">
      <aside className="crm-sidebar" aria-label="Navegación principal">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>
          <span>Quantum</span>
        </a>
        <nav>
          <a href="/">Equipo</a>
          <a href="/contacts" aria-current="page">
            Contactos
          </a>
          <a href="/pipeline">Pipeline</a>
          <a href="/tasks">Tareas</a>
          <a href="/inbox">Conversaciones</a>
          <a href="/tasks">Tareas</a>
        </nav>
      </aside>
      <section className="crm-content" aria-busy={loading}>
        <header className="page-header">
          <div>
            <p className="eyebrow">CRM</p>
            <h1>Detalle de contacto</h1>
            <p>Información persistida en el perfil activo.</p>
          </div>
          <a className="secondary-action" href="/contacts">
            Volver a contactos
          </a>
        </header>
        {error ? (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        ) : null}
        {loading ? <p className="state-message">Cargando contacto…</p> : null}
        {contact ? (
          <div className="contact-detail-grid">
            <section className="member-card">
              <div className="card-heading">
                <h2>{contact.displayName}</h2>
                <p>Contacto registrado en Quantum CRM.</p>
              </div>
              <div className="member-row">
                <div className="member-details">
                  <strong>Correo</strong>
                  <span>{contact.email ?? "Sin correo registrado"}</span>
                </div>
              </div>
              <div className="member-row">
                <div className="member-details">
                  <strong>Teléfono</strong>
                  <span>{contact.phone ?? "Sin teléfono registrado"}</span>
                </div>
              </div>
              <div className="member-row">
                <div className="member-details">
                  <strong>Actualizado</strong>
                  <span>
                    {new Intl.DateTimeFormat("es-CO", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(contact.updatedAt))}
                  </span>
                </div>
              </div>
            </section>
            <section className="member-card contact-opportunities-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Negociaciones</p>
                  <h2>Oportunidades vinculadas</h2>
                </div>
                <a className="secondary-action" href="/pipeline">
                  Abrir pipeline
                </a>
              </div>
              {opportunities.length === 0 ? (
                <p className="state-message">Este contacto todavía no tiene oportunidades.</p>
              ) : (
                <ul className="member-list">
                  {opportunities.map((opportunity) => (
                    <li className="member-row" key={opportunity.id}>
                      <div className="member-details">
                        <strong>{opportunity.title}</strong>
                        <span>
                          {new Intl.NumberFormat("es-CO", {
                            style: "currency",
                            currency: opportunity.currency,
                          }).format(Number(opportunity.amountMinor) / 100)}
                        </span>
                      </div>
                      <span className={`deal-status status-${opportunity.status.toLowerCase()}`}>
                        {opportunity.status === "OPEN"
                          ? "Abierta"
                          : opportunity.status === "WON"
                            ? "Ganada"
                            : opportunity.status === "LOST"
                              ? "Perdida"
                              : "Abandonada"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="member-card contact-opportunities-card contact-task-list">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Seguimientos</p>
                  <h2>Tareas abiertas</h2>
                </div>
                <a className="secondary-action" href="/tasks">
                  Abrir centro de tareas
                </a>
              </div>
              {tasks.length === 0 ? (
                <p className="state-message">Este contacto no tiene tareas abiertas.</p>
              ) : (
                <ul className="member-list">
                  {tasks.map((task) => (
                    <li className="member-row" key={task.id}>
                      <div className="member-details">
                        <strong>{task.title}</strong>
                        <span>
                          {task.status === "EXPIRED"
                            ? "Vencida"
                            : task.status === "IN_PROGRESS"
                              ? "En curso"
                              : "Pendiente"}
                          {" · "}
                          {task.dueAt
                            ? new Intl.DateTimeFormat("es-CO", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }).format(new Date(task.dueAt))
                            : "Sin vencimiento"}
                        </span>
                      </div>
                      <a className="contact-task-link" href="/tasks">
                        Gestionar
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
