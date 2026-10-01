"use client";

import type { Contact, Conversation, Opportunity, Task } from "@quantum-crm/contracts";
import { useEffect, useMemo, useState } from "react";

import { CrmShell } from "./crm-shell";

interface List<T> {
  readonly data: T[];
}

interface DashboardData {
  readonly contacts: Contact[];
  readonly conversations: Conversation[];
  readonly opportunities: Opportunity[];
  readonly tasks: Task[];
}

const emptyData: DashboardData = {
  contacts: [],
  conversations: [],
  opportunities: [],
  tasks: [],
};

function money(value: bigint, currency: string): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value) / 100);
}

function dateLabel(value: string | null): string {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readList<T>(path: string): Promise<T[]> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  if (response.status === 401) {
    window.location.assign("/api/auth/login?returnTo=/");
    return [];
  }
  if (!response.ok) throw new Error("No fue posible cargar el resumen operativo.");
  return ((await response.json()) as List<T>).data;
}

export function CrmDashboard(): React.JSX.Element {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [contacts, conversations, opportunities, tasks] = await Promise.all([
        readList<Contact>("/api/contacts"),
        readList<Conversation>("/api/conversations?limit=100"),
        readList<Opportunity>("/api/opportunities"),
        readList<Task>("/api/tasks"),
      ]);
      setData({ contacts, conversations, opportunities, tasks });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar el resumen.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const openOpportunities = data.opportunities.filter((item) => item.status === "OPEN");
  const currency = openOpportunities[0]?.currency ?? "COP";
  const pipelineValue = openOpportunities
    .filter((item) => item.currency === currency)
    .reduce((total, item) => total + BigInt(item.amountMinor), 0n);
  const openConversations = data.conversations.filter((item) => item.status !== "CLOSED");
  const pendingTasks = data.tasks.filter(
    (item) =>
      item.status === "PENDING" || item.status === "IN_PROGRESS" || item.status === "EXPIRED",
  );
  const contactName = useMemo(
    () => new Map(data.contacts.map((contact) => [contact.id, contact.displayName])),
    [data.contacts],
  );

  return (
    <CrmShell>
      <section className="crm-content dashboard-content" aria-busy={loading}>
        <header className="stitch-page-header">
          <div>
            <p className="eyebrow">Operación del negocio</p>
            <h1>Resumen</h1>
            <p>Tu actividad comercial, conversaciones y trabajo pendiente en un solo lugar.</p>
          </div>
          <div className="header-actions">
            <span className="live-indicator">
              <span aria-hidden="true" /> Datos en vivo
            </span>
            <button className="secondary-action" type="button" onClick={() => void load()}>
              Actualizar
            </button>
          </div>
        </header>

        {error ? (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="dashboard-metrics" aria-label="Indicadores principales">
          <article>
            <span className="metric-icon metric-icon-indigo" aria-hidden="true">
              ◇
            </span>
            <div>
              <p>Pipeline abierto</p>
              <strong>{loading ? "—" : money(pipelineValue, currency)}</strong>
              <small>{openOpportunities.length} oportunidades activas</small>
            </div>
          </article>
          <article>
            <span className="metric-icon metric-icon-cyan" aria-hidden="true">
              ◫
            </span>
            <div>
              <p>Conversaciones</p>
              <strong>{loading ? "—" : openConversations.length}</strong>
              <small>Pendientes de cierre</small>
            </div>
          </article>
          <article>
            <span className="metric-icon metric-icon-amber" aria-hidden="true">
              ✓
            </span>
            <div>
              <p>Seguimientos</p>
              <strong>{loading ? "—" : pendingTasks.length}</strong>
              <small>Tareas abiertas o vencidas</small>
            </div>
          </article>
          <article>
            <span className="metric-icon metric-icon-emerald" aria-hidden="true">
              ◎
            </span>
            <div>
              <p>Contactos</p>
              <strong>{loading ? "—" : data.contacts.length}</strong>
              <small>Registros en este perfil</small>
            </div>
          </article>
        </section>

        <div className="dashboard-grid">
          <section className="dashboard-card dashboard-card-wide">
            <div className="dashboard-card-heading">
              <div>
                <p className="eyebrow">Ventas</p>
                <h2>Oportunidades recientes</h2>
              </div>
              <a href="/pipeline">
                Ver pipeline <span aria-hidden="true">→</span>
              </a>
            </div>
            {loading ? <p className="state-message">Cargando oportunidades…</p> : null}
            {!loading && openOpportunities.length === 0 ? (
              <div className="dashboard-empty">
                <span aria-hidden="true">◇</span>
                <p>No hay oportunidades abiertas.</p>
                <a href="/pipeline">Crear la primera</a>
              </div>
            ) : null}
            {!loading && openOpportunities.length > 0 ? (
              <div className="dashboard-deals">
                {openOpportunities.slice(0, 5).map((opportunity) => (
                  <a href="/pipeline" key={opportunity.id}>
                    <span className="deal-avatar" aria-hidden="true">
                      {(contactName.get(opportunity.contactId) ?? opportunity.title).slice(0, 1)}
                    </span>
                    <span>
                      <strong>{opportunity.title}</strong>
                      <small>{contactName.get(opportunity.contactId) ?? "Contacto"}</small>
                    </span>
                    <strong>{money(BigInt(opportunity.amountMinor), opportunity.currency)}</strong>
                  </a>
                ))}
              </div>
            ) : null}
          </section>

          <section className="dashboard-card">
            <div className="dashboard-card-heading">
              <div>
                <p className="eyebrow">Hoy</p>
                <h2>Próximas tareas</h2>
              </div>
              <a href="/tasks">Ver todas</a>
            </div>
            {pendingTasks.length === 0 && !loading ? (
              <div className="dashboard-empty compact">
                <span aria-hidden="true">✓</span>
                <p>No hay tareas pendientes.</p>
              </div>
            ) : (
              <ol className="dashboard-task-list">
                {pendingTasks.slice(0, 5).map((task) => (
                  <li key={task.id}>
                    <span className={`task-dot priority-${task.priority.toLowerCase()}`} />
                    <span>
                      <strong>{task.title}</strong>
                      <small>{dateLabel(task.dueAt)}</small>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="dashboard-card dashboard-card-wide">
            <div className="dashboard-card-heading">
              <div>
                <p className="eyebrow">Atención</p>
                <h2>Bandeja omnicanal</h2>
              </div>
              <a href="/inbox">
                Abrir conversaciones <span aria-hidden="true">→</span>
              </a>
            </div>
            <div className="channel-overview">
              {(["WHATSAPP", "EMAIL", "WEBCHAT", "SMS"] as const).map((channel) => {
                const count = openConversations.filter((item) => item.channel === channel).length;
                const labels = {
                  WHATSAPP: "WhatsApp",
                  EMAIL: "Correo",
                  WEBCHAT: "Chat web",
                  SMS: "SMS",
                };
                return (
                  <div key={channel}>
                    <span>{labels[channel]}</span>
                    <strong>{count}</strong>
                    <small>activas</small>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="dashboard-card dashboard-quick-actions">
            <div className="dashboard-card-heading">
              <div>
                <p className="eyebrow">Acciones rápidas</p>
                <h2>Continuar trabajando</h2>
              </div>
            </div>
            <a href="/contacts">
              Nuevo contacto <span aria-hidden="true">+</span>
            </a>
            <a href="/pipeline">
              Nueva oportunidad <span aria-hidden="true">+</span>
            </a>
            <a href="/inbox">
              Nueva conversación <span aria-hidden="true">+</span>
            </a>
          </section>
        </div>
      </section>
    </CrmShell>
  );
}
