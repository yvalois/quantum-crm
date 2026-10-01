"use client";

import type {
  CalendarDefinition,
  CalendarEvent,
  Contact,
  Opportunity,
  TaskAssignee,
} from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { CrmShell } from "../crm-shell";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}

interface List<T> {
  readonly data: T[];
}

const statusLabels: Record<CalendarEvent["status"], string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmada",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No asistió",
};

const typeLabels: Record<CalendarEvent["type"], string> = {
  APPOINTMENT: "Cita",
  MEETING: "Reunión",
  EVENT: "Evento",
};

const weekdayLabels = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

async function responseTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

function toLocalInput(value: string): string {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function suggestedStart(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() + (30 - (date.getMinutes() % 30)), 0, 0);
  return toLocalInput(date.toISOString());
}

export default function CalendarPage(): React.JSX.Element {
  const [csrf, setCsrf] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<CalendarDefinition[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [advisors, setAdvisors] = useState<TaskAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCalendarForm, setShowCalendarForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  const [rescheduling, setRescheduling] = useState<CalendarEvent | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [advisorFilter, setAdvisorFilter] = useState("");

  const currentCalendar = calendars.find((calendar) => calendar.id === calendarId) ?? null;
  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );
  const advisorById = useMemo(
    () => new Map(advisors.map((advisor) => [advisor.id, advisor])),
    [advisors],
  );

  const loadEvents = useCallback(async (selectedCalendarId: string): Promise<void> => {
    if (!selectedCalendarId) {
      setEvents([]);
      return;
    }
    const from = new Date();
    from.setDate(from.getDate() - 14);
    const to = new Date();
    to.setDate(to.getDate() + 90);
    const query = new URLSearchParams({
      calendarId: selectedCalendarId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const response = await fetch(`/api/calendar/events?${query}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(await responseTitle(response));
    setEvents(((await response.json()) as List<CalendarEvent>).data);
  }, []);

  const loadWorkspace = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (sessionResponse.status === 401) {
        window.location.assign("/api/auth/login?returnTo=/calendar");
        return;
      }
      const session = (await sessionResponse.json()) as SessionPayload;
      if (!session.authenticated || !session.csrfToken) throw new Error("La sesión no es válida.");
      setCsrf(session.csrfToken);
      const [calendarResponse, contactResponse, opportunityResponse, advisorResponse] =
        await Promise.all([
          fetch("/api/calendar/calendars", { cache: "no-store", credentials: "same-origin" }),
          fetch("/api/contacts", { cache: "no-store", credentials: "same-origin" }),
          fetch("/api/opportunities", { cache: "no-store", credentials: "same-origin" }),
          fetch("/api/tasks/assignees", { cache: "no-store", credentials: "same-origin" }),
        ]);
      for (const response of [
        calendarResponse,
        contactResponse,
        opportunityResponse,
        advisorResponse,
      ]) {
        if (!response.ok) throw new Error(await responseTitle(response));
      }
      const nextCalendars = ((await calendarResponse.json()) as List<CalendarDefinition>).data;
      setCalendars(nextCalendars);
      setContacts(((await contactResponse.json()) as List<Contact>).data);
      setOpportunities(((await opportunityResponse.json()) as List<Opportunity>).data);
      setAdvisors(((await advisorResponse.json()) as List<TaskAssignee>).data);
      const selected = calendarId || nextCalendars[0]?.id || "";
      setCalendarId(selected);
      await loadEvents(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar la agenda.");
    } finally {
      setLoading(false);
    }
  }, [calendarId, loadEvents]);

  useEffect(() => {
    void loadWorkspace();
  }, []);

  async function mutate(
    url: string,
    body: unknown,
    options: { readonly method?: "POST" | "PATCH" | "PUT"; readonly version?: string } = {},
  ): Promise<Response> {
    if (!csrf) throw new Error("La sesión no está lista.");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
    };
    if (options.version) headers["if-match"] = `"${options.version}"`;
    const response = await fetch(url, {
      method: options.method ?? "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await responseTitle(response));
    return response;
  }

  async function createCalendar(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const response = await mutate("/api/calendar/calendars", {
        name: form.get("name"),
        serviceName: form.get("serviceName"),
        location: String(form.get("location") || "") || null,
        timeZone: form.get("timeZone"),
        slotDurationMinutes: Number(form.get("duration")),
        bufferBeforeMinutes: Number(form.get("bufferBefore")),
        bufferAfterMinutes: Number(form.get("bufferAfter")),
      });
      const created = ((await response.json()) as { data: CalendarDefinition }).data;
      setCalendars((current) => [...current, created]);
      setCalendarId(created.id);
      setShowCalendarForm(false);
      setShowAvailability(true);
      setNotice("Calendario creado. Configura ahora la disponibilidad del equipo.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el calendario.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAvailability(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!calendarId) return;
    const form = new FormData(event.currentTarget);
    const selectedDays = form.getAll("weekday").map(Number);
    const [startHour = "09", startMinute = "00"] = String(form.get("start")).split(":");
    const [endHour = "17", endMinute = "00"] = String(form.get("end")).split(":");
    setSaving(true);
    setError(null);
    try {
      await mutate(
        `/api/calendar/calendars/${calendarId}/availability`,
        {
          rules: selectedDays.map((weekday) => ({
            advisorMemberId: form.get("advisorMemberId"),
            weekday,
            startMinute: Number(startHour) * 60 + Number(startMinute),
            endMinute: Number(endHour) * 60 + Number(endMinute),
          })),
          exceptions: [],
        },
        { method: "PUT" },
      );
      setShowAvailability(false);
      setNotice("Disponibilidad semanal actualizada.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible guardar la disponibilidad.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createEvent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!currentCalendar) return;
    const form = new FormData(event.currentTarget);
    const startsAt = new Date(String(form.get("startsAt")));
    const duration = Number(form.get("duration"));
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    setSaving(true);
    setError(null);
    try {
      await mutate("/api/calendar/events", {
        calendarId: currentCalendar.id,
        ...(form.get("contactId") ? { contactId: form.get("contactId") } : {}),
        ...(form.get("opportunityId") ? { opportunityId: form.get("opportunityId") } : {}),
        advisorMemberId: form.get("advisorMemberId"),
        type: form.get("type"),
        title: form.get("title"),
        description: form.get("description"),
        location: String(form.get("location") || "") || null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timeZone: currentCalendar.timeZone,
        origin: "MANUAL",
      });
      setShowEventForm(false);
      setNotice("Cita creada y recordatorios programados.");
      await loadEvents(currentCalendar.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la cita.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(item: CalendarEvent, status: CalendarEvent["status"]): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await mutate(
        `/api/calendar/events/${item.id}/status`,
        { status },
        { method: "PATCH", version: item.version },
      );
      await loadEvents(item.calendarId);
      setNotice(`Cita marcada como ${statusLabels[status].toLowerCase()}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cambiar el estado.");
    } finally {
      setSaving(false);
    }
  }

  async function rescheduleEvent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!rescheduling) return;
    const form = new FormData(event.currentTarget);
    const startsAt = new Date(String(form.get("startsAt")));
    const duration = Number(form.get("duration"));
    setSaving(true);
    setError(null);
    try {
      await mutate(
        `/api/calendar/events/${rescheduling.id}`,
        {
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + duration * 60_000).toISOString(),
        },
        { method: "PATCH", version: rescheduling.version },
      );
      setRescheduling(null);
      await loadEvents(rescheduling.calendarId);
      setNotice("Cita reprogramada y recordatorios actualizados.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible reprogramar la cita.");
    } finally {
      setSaving(false);
    }
  }

  const visibleEvents = events.filter(
    (item) =>
      (!statusFilter || item.status === statusFilter) &&
      (!advisorFilter || item.advisorMemberId === advisorFilter),
  );

  return (
    <CrmShell>
      <section className="crm-content calendar-page">
        <header className="stitch-page-header">
          <div>
            <span className="eyebrow">OPERACIÓN COMERCIAL</span>
            <h1>Calendario y reservas</h1>
            <p>Coordina al equipo, comparte disponibilidad y evita cruces de agenda.</p>
          </div>
          <div className="calendar-header-actions">
            <button
              className="secondary-action"
              type="button"
              onClick={() => setShowCalendarForm(true)}
            >
              Nuevo calendario
            </button>
            <button
              className="primary-action"
              type="button"
              onClick={() => setShowEventForm(true)}
              disabled={!currentCalendar}
            >
              + Nueva cita
            </button>
          </div>
        </header>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}

        <section className="calendar-toolbar">
          <label>
            Calendario
            <select
              value={calendarId}
              onChange={(event) => {
                setCalendarId(event.target.value);
                void loadEvents(event.target.value);
              }}
            >
              <option value="">Selecciona un calendario</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">Todos</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Asesor
            <select
              value={advisorFilter}
              onChange={(event) => setAdvisorFilter(event.target.value)}
            >
              <option value="">Todo el equipo</option>
              {advisors.map((advisor) => (
                <option key={advisor.id} value={advisor.id}>
                  {advisor.displayName}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-action"
            type="button"
            onClick={() => setShowAvailability(true)}
            disabled={!currentCalendar}
          >
            Disponibilidad
          </button>
          {currentCalendar ? (
            <a
              className="booking-link"
              href={`/book/${currentCalendar.bookingSlug}`}
              target="_blank"
              rel="noreferrer"
            >
              Abrir enlace de reserva ↗
            </a>
          ) : null}
        </section>

        <section className="calendar-summary">
          <article>
            <span>Próximas</span>
            <strong>
              {
                events.filter(
                  (item) => new Date(item.startsAt) >= new Date() && item.status !== "CANCELLED",
                ).length
              }
            </strong>
          </article>
          <article>
            <span>Confirmadas</span>
            <strong>{events.filter((item) => item.status === "CONFIRMED").length}</strong>
          </article>
          <article>
            <span>Completadas</span>
            <strong>{events.filter((item) => item.status === "COMPLETED").length}</strong>
          </article>
          <article>
            <span>Reservas web</span>
            <strong>{events.filter((item) => item.origin === "BOOKING").length}</strong>
          </article>
        </section>

        <section className="agenda-panel">
          <div className="agenda-heading">
            <div>
              <span className="eyebrow">AGENDA</span>
              <h2>Actividad programada</h2>
            </div>
            <small>{visibleEvents.length} eventos</small>
          </div>
          {loading ? (
            <div className="dashboard-empty">
              <span>◌</span>
              <p>Cargando agenda…</p>
            </div>
          ) : null}
          {!loading && visibleEvents.length === 0 ? (
            <div className="dashboard-empty">
              <span>▦</span>
              <strong>Aún no hay citas</strong>
              <p>Crea una cita o comparte el enlace público de reserva.</p>
            </div>
          ) : null}
          <ol className="calendar-event-list">
            {visibleEvents.map((item) => (
              <li key={item.id}>
                <time dateTime={item.startsAt}>
                  <strong>
                    {new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short" }).format(
                      new Date(item.startsAt),
                    )}
                  </strong>
                  <span>
                    {new Intl.DateTimeFormat("es-CO", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(item.startsAt))}
                  </span>
                </time>
                <div className="calendar-event-copy">
                  <div>
                    <span
                      className={`calendar-status calendar-status-${item.status.toLowerCase()}`}
                    >
                      {statusLabels[item.status]}
                    </span>
                    <small>
                      {typeLabels[item.type]} ·{" "}
                      {item.origin === "BOOKING" ? "Reserva web" : "Interna"}
                    </small>
                  </div>
                  <h3>{item.title}</h3>
                  <p>
                    {item.guestName ??
                      (item.contactId ? contactById.get(item.contactId)?.displayName : null) ??
                      "Sin contacto"}{" "}
                    · {advisorById.get(item.advisorMemberId)?.displayName ?? "Asesor"}
                  </p>
                </div>
                <div className="calendar-event-actions">
                  <button type="button" onClick={() => setRescheduling(item)}>
                    Reprogramar
                  </button>
                  <select
                    aria-label={`Estado de ${item.title}`}
                    value={item.status}
                    disabled={saving}
                    onChange={(event) =>
                      void changeStatus(item, event.target.value as CalendarEvent["status"])
                    }
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {showCalendarForm ? (
          <div className="modal-backdrop">
            <form className="calendar-modal" onSubmit={(event) => void createCalendar(event)}>
              <div className="modal-title">
                <div>
                  <span className="eyebrow">CONFIGURACIÓN</span>
                  <h2>Nuevo calendario</h2>
                </div>
                <button type="button" onClick={() => setShowCalendarForm(false)}>
                  ×
                </button>
              </div>
              <label>
                Nombre
                <input name="name" required placeholder="Consultas comerciales" />
              </label>
              <label>
                Servicio
                <input name="serviceName" required placeholder="Diagnóstico inicial" />
              </label>
              <label>
                Ubicación
                <input name="location" placeholder="Videollamada o dirección" />
              </label>
              <label>
                Zona horaria
                <input name="timeZone" defaultValue="America/Bogota" required />
              </label>
              <div className="form-grid-3">
                <label>
                  Duración
                  <input
                    name="duration"
                    type="number"
                    min="5"
                    max="480"
                    defaultValue="30"
                    required
                  />
                </label>
                <label>
                  Margen antes
                  <input
                    name="bufferBefore"
                    type="number"
                    min="0"
                    max="240"
                    defaultValue="0"
                    required
                  />
                </label>
                <label>
                  Margen después
                  <input
                    name="bufferAfter"
                    type="number"
                    min="0"
                    max="240"
                    defaultValue="10"
                    required
                  />
                </label>
              </div>
              <button className="primary-action" disabled={saving}>
                {saving ? "Guardando…" : "Crear calendario"}
              </button>
            </form>
          </div>
        ) : null}

        {showAvailability ? (
          <div className="modal-backdrop">
            <form className="calendar-modal" onSubmit={(event) => void saveAvailability(event)}>
              <div className="modal-title">
                <div>
                  <span className="eyebrow">DISPONIBILIDAD</span>
                  <h2>Horario semanal</h2>
                </div>
                <button type="button" onClick={() => setShowAvailability(false)}>
                  ×
                </button>
              </div>
              <label>
                Asesor
                <select name="advisorMemberId" required>
                  <option value="">Selecciona</option>
                  {advisors.map((advisor) => (
                    <option key={advisor.id} value={advisor.id}>
                      {advisor.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="weekday-picker">
                <legend>Días disponibles</legend>
                {weekdayLabels.map((label, index) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      name="weekday"
                      value={index}
                      defaultChecked={index >= 1 && index <= 5}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="form-grid-2">
                <label>
                  Desde
                  <input name="start" type="time" defaultValue="09:00" required />
                </label>
                <label>
                  Hasta
                  <input name="end" type="time" defaultValue="17:00" required />
                </label>
              </div>
              <p className="form-hint">
                Guardar reemplaza la configuración semanal actual de este calendario.
              </p>
              <button className="primary-action" disabled={saving}>
                {saving ? "Guardando…" : "Guardar disponibilidad"}
              </button>
            </form>
          </div>
        ) : null}

        {showEventForm && currentCalendar ? (
          <div className="modal-backdrop">
            <form
              className="calendar-modal calendar-modal-wide"
              onSubmit={(event) => void createEvent(event)}
            >
              <div className="modal-title">
                <div>
                  <span className="eyebrow">AGENDA</span>
                  <h2>Nueva cita</h2>
                </div>
                <button type="button" onClick={() => setShowEventForm(false)}>
                  ×
                </button>
              </div>
              <div className="form-grid-2">
                <label>
                  Título
                  <input name="title" required placeholder="Reunión de diagnóstico" />
                </label>
                <label>
                  Tipo
                  <select name="type" defaultValue="APPOINTMENT">
                    {Object.entries(typeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Asesor
                  <select name="advisorMemberId" required>
                    <option value="">Selecciona</option>
                    {advisors.map((advisor) => (
                      <option key={advisor.id} value={advisor.id}>
                        {advisor.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Contacto
                  <select name="contactId">
                    <option value="">Sin contacto</option>
                    {contacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Oportunidad
                  <select name="opportunityId">
                    <option value="">Sin oportunidad</option>
                    {opportunities.map((opportunity) => (
                      <option key={opportunity.id} value={opportunity.id}>
                        {opportunity.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Inicio
                  <input
                    name="startsAt"
                    type="datetime-local"
                    defaultValue={suggestedStart()}
                    required
                  />
                </label>
                <label>
                  Duración (min)
                  <input
                    name="duration"
                    type="number"
                    min="5"
                    max="480"
                    defaultValue={currentCalendar.slotDurationMinutes}
                    required
                  />
                </label>
                <label>
                  Ubicación
                  <input name="location" defaultValue={currentCalendar.location ?? ""} />
                </label>
              </div>
              <label>
                Notas
                <textarea name="description" rows={3} />
              </label>
              <button className="primary-action" disabled={saving}>
                {saving ? "Guardando…" : "Crear cita"}
              </button>
            </form>
          </div>
        ) : null}

        {rescheduling ? (
          <div className="modal-backdrop">
            <form className="calendar-modal" onSubmit={(event) => void rescheduleEvent(event)}>
              <div className="modal-title">
                <div>
                  <span className="eyebrow">REPROGRAMAR</span>
                  <h2>{rescheduling.title}</h2>
                </div>
                <button type="button" onClick={() => setRescheduling(null)}>
                  ×
                </button>
              </div>
              <label>
                Nuevo inicio
                <input
                  name="startsAt"
                  type="datetime-local"
                  defaultValue={toLocalInput(rescheduling.startsAt)}
                  required
                />
              </label>
              <label>
                Duración (min)
                <input
                  name="duration"
                  type="number"
                  min="5"
                  max="480"
                  defaultValue={Math.round(
                    (Date.parse(rescheduling.endsAt) - Date.parse(rescheduling.startsAt)) / 60_000,
                  )}
                  required
                />
              </label>
              <button className="primary-action" disabled={saving}>
                {saving ? "Guardando…" : "Confirmar cambio"}
              </button>
            </form>
          </div>
        ) : null}
      </section>
    </CrmShell>
  );
}
