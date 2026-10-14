"use client";

import type {
  CalendarAppointmentType,
  CalendarDefinition,
  CalendarEvent,
  Contact,
  Opportunity,
  TaskAssignee,
} from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CrmShell } from "../crm-shell";
import {
  calendarDays,
  calendarRange,
  dayEventSegments,
  localDayKey,
  moveCalendar,
  type CalendarView,
} from "./calendar-view-model";

interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}

interface CalendarCapabilities {
  readonly memberId: string;
  readonly canViewAllCalendarEvents: boolean;
  readonly canConfigureCalendar: boolean;
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

const calendarWeekdayLabels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;
const calendarHours = Array.from({ length: 24 }, (_, hour) => hour);
const hourHeight = 64;

function formatHour(value: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function formatCalendarTitle(days: Date[], view: CalendarView): string {
  if (view === "month") {
    return new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" }).format(
      days[Math.floor(days.length / 2)]!,
    );
  }
  const first = days[0]!;
  const last = days[6]!;
  const month = new Intl.DateTimeFormat("es-CO", { month: "long" }).format(last);
  return first.getMonth() === last.getMonth()
    ? `${first.getDate()}–${last.getDate()} de ${month} de ${last.getFullYear()}`
    : `${new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(first)} – ${new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" }).format(last)}`;
}

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
  const [appointmentTypes, setAppointmentTypes] = useState<CalendarAppointmentType[]>([]);
  const [capabilities, setCapabilities] = useState<CalendarCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCalendarForm, setShowCalendarForm] = useState(false);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showAppointmentTypeForm, setShowAppointmentTypeForm] = useState(false);
  const [eventDuration, setEventDuration] = useState(30);
  const [showAvailability, setShowAvailability] = useState(false);
  const [rescheduling, setRescheduling] = useState<CalendarEvent | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [advisorFilter, setAdvisorFilter] = useState("");
  const [viewDate, setViewDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<CalendarView>("week");
  const [eventsLoading, setEventsLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [draftStart, setDraftStart] = useState(suggestedStart);
  const weekScrollRef = useRef<HTMLDivElement>(null);
  const eventRequestRef = useRef(0);

  const currentCalendar = calendars.find((calendar) => calendar.id === calendarId) ?? null;
  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );
  const advisorById = useMemo(
    () => new Map(advisors.map((advisor) => [advisor.id, advisor])),
    [advisors],
  );
  const appointmentTypeById = useMemo(
    () => new Map(appointmentTypes.map((type) => [type.id, type])),
    [appointmentTypes],
  );
  const viewDays = useMemo(() => calendarDays(viewDate, viewMode), [viewDate, viewMode]);

  const loadEvents = useCallback(
    async (
      selectedCalendarId: string,
      selectedAdvisorId = advisorFilter,
      selectedStatus = statusFilter,
    ): Promise<void> => {
      const request = ++eventRequestRef.current;
      const { from, to } = calendarRange(viewDate, viewMode);
      const query = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      if (selectedCalendarId) query.set("calendarId", selectedCalendarId);
      if (selectedAdvisorId && capabilities?.canViewAllCalendarEvents)
        query.set("advisorMemberId", selectedAdvisorId);
      if (selectedStatus) query.set("status", selectedStatus);
      setEventsLoading(true);
      try {
        const response = await fetch(`/api/calendar/events?${query}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error(await responseTitle(response));
        const loaded = ((await response.json()) as List<CalendarEvent>).data;
        if (request === eventRequestRef.current) setEvents(loaded);
      } catch (cause) {
        if (request === eventRequestRef.current)
          setError(cause instanceof Error ? cause.message : "No fue posible cargar las citas.");
      } finally {
        if (request === eventRequestRef.current) setEventsLoading(false);
      }
    },
    [advisorFilter, statusFilter, capabilities?.canViewAllCalendarEvents, viewDate, viewMode],
  );

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
      const [
        calendarResponse,
        contactResponse,
        opportunityResponse,
        advisorResponse,
        typeResponse,
        capabilityResponse,
      ] = await Promise.all([
        fetch("/api/calendar/calendars", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/contacts", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/opportunities", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/tasks/assignees", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/calendar/appointment-types", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/auth/capabilities", { cache: "no-store", credentials: "same-origin" }),
      ]);
      for (const response of [
        calendarResponse,
        contactResponse,
        opportunityResponse,
        advisorResponse,
        typeResponse,
        capabilityResponse,
      ]) {
        if (!response.ok) throw new Error(await responseTitle(response));
      }
      const nextCalendars = ((await calendarResponse.json()) as List<CalendarDefinition>).data;
      setCalendars(nextCalendars);
      setContacts(((await contactResponse.json()) as List<Contact>).data);
      setOpportunities(((await opportunityResponse.json()) as List<Opportunity>).data);
      setAdvisors(((await advisorResponse.json()) as List<TaskAssignee>).data);
      setAppointmentTypes(((await typeResponse.json()) as List<CalendarAppointmentType>).data);
      setCapabilities(((await capabilityResponse.json()) as { data: CalendarCapabilities }).data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible cargar la agenda.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (capabilities) void loadEvents(calendarId);
  }, [calendarId, capabilities, loadEvents]);

  useEffect(() => {
    if (viewMode === "week" && weekScrollRef.current) {
      weekScrollRef.current.scrollTop = 7 * hourHeight;
    }
  }, [viewMode]);

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

  async function createAppointmentType(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const response = await mutate("/api/calendar/appointment-types", {
        name: form.get("name"),
        durationMinutes: Number(form.get("durationMinutes")),
      });
      const created = ((await response.json()) as { data: CalendarAppointmentType }).data;
      setAppointmentTypes((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setShowAppointmentTypeForm(false);
      setNotice(`Tipo de cita «${created.name}» disponible.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear el tipo de cita.");
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

  function openEventForm(startsAt?: Date): void {
    if (calendars.length === 0) {
      if (capabilities?.canConfigureCalendar) setShowCalendarForm(true);
      return;
    }
    setEventDuration(
      currentCalendar?.slotDurationMinutes ?? calendars[0]?.slotDurationMinutes ?? 30,
    );
    setDraftStart(startsAt ? toLocalInput(startsAt.toISOString()) : suggestedStart());
    setShowEventForm(true);
  }

  async function createEvent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedCalendar = calendars.find((item) => item.id === String(form.get("calendarId")));
    if (!selectedCalendar) return;
    const startsAt = new Date(String(form.get("startsAt")));
    const duration = Number(form.get("duration"));
    const endsAt = new Date(startsAt.getTime() + duration * 60_000);
    setSaving(true);
    setError(null);
    try {
      await mutate("/api/calendar/events", {
        calendarId: selectedCalendar.id,
        ...(form.get("contactId") ? { contactId: form.get("contactId") } : {}),
        ...(form.get("opportunityId") ? { opportunityId: form.get("opportunityId") } : {}),
        advisorMemberId: capabilities?.canConfigureCalendar
          ? form.get("advisorMemberId")
          : capabilities?.memberId,
        ...(form.get("appointmentTypeId")
          ? { appointmentTypeId: form.get("appointmentTypeId") }
          : {}),
        type: form.get("type"),
        title: form.get("title"),
        description: form.get("description"),
        location: String(form.get("location") || "") || null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        timeZone: selectedCalendar.timeZone,
        origin: "MANUAL",
      });
      setShowEventForm(false);
      setNotice("Cita creada y recordatorios programados.");
      await loadEvents(calendarId);
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
      await loadEvents(calendarId);
      setSelectedEvent(null);
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
      setSelectedEvent(null);
      await loadEvents(calendarId);
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
            {capabilities?.canConfigureCalendar ? (
              <button
                className="secondary-action"
                type="button"
                onClick={() => setShowCalendarForm(true)}
              >
                Nuevo calendario
              </button>
            ) : null}
            {capabilities?.canConfigureCalendar ? (
              <button
                className="secondary-action"
                type="button"
                onClick={() => setShowAppointmentTypeForm(true)}
              >
                Tipos de citas
              </button>
            ) : null}
            <button
              className="primary-action"
              type="button"
              onClick={() => openEventForm()}
              disabled={calendars.length === 0 && !capabilities?.canConfigureCalendar}
            >
              {calendars.length === 0 ? "Configurar calendario" : "+ Nueva cita"}
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
              }}
            >
              <option value="">Todos los calendarios</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
              }}
            >
              <option value="">Todos</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {capabilities?.canViewAllCalendarEvents ? (
            <label>
              Asesor
              <select
                value={advisorFilter}
                onChange={(event) => {
                  setAdvisorFilter(event.target.value);
                }}
              >
                <option value="">Todo el equipo</option>
                {advisors.map((advisor) => (
                  <option key={advisor.id} value={advisor.id}>
                    {advisor.displayName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {capabilities?.canConfigureCalendar ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => setShowAvailability(true)}
              disabled={!currentCalendar}
            >
              Disponibilidad
            </button>
          ) : null}
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

        <section className="calendar-board" aria-label="Agenda visual">
          <div className="calendar-board-toolbar">
            <div className="calendar-board-title">
              <span className="eyebrow">AGENDA DEL EQUIPO</span>
              <h2>{formatCalendarTitle(viewDays, viewMode)}</h2>
              <p>
                {eventsLoading
                  ? "Actualizando citas…"
                  : `${visibleEvents.length} citas en este periodo`}
              </p>
            </div>
            <div className="calendar-board-controls">
              <div className="calendar-date-navigation" aria-label="Navegar fechas">
                <button type="button" onClick={() => setViewDate(new Date())}>
                  Hoy
                </button>
                <button
                  type="button"
                  aria-label="Periodo anterior"
                  onClick={() => setViewDate((current) => moveCalendar(current, viewMode, -1))}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Periodo siguiente"
                  onClick={() => setViewDate((current) => moveCalendar(current, viewMode, 1))}
                >
                  ›
                </button>
              </div>
              <div className="calendar-view-switch" aria-label="Vista del calendario">
                <button
                  type="button"
                  aria-pressed={viewMode === "week"}
                  onClick={() => setViewMode("week")}
                >
                  Semana
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "month"}
                  onClick={() => setViewMode("month")}
                >
                  Mes
                </button>
              </div>
            </div>
          </div>

          {!loading && calendars.length === 0 ? (
            <div className="calendar-setup-callout" role="status">
              <span aria-hidden="true">▦</span>
              <div>
                <strong>Tu agenda está lista para configurarse</strong>
                <p>
                  {capabilities?.canConfigureCalendar
                    ? "Crea el primer calendario para habilitar citas y enlaces de reserva. La cuadrícula seguirá visible mientras lo configuras."
                    : "Un administrador debe crear el primer calendario antes de que puedas agendar citas."}
                </p>
              </div>
              {capabilities?.canConfigureCalendar ? (
                <button type="button" onClick={() => setShowCalendarForm(true)}>
                  Crear calendario
                </button>
              ) : null}
            </div>
          ) : null}

          {viewMode === "week" ? (
            <div className="calendar-week-scroll" ref={weekScrollRef}>
              <div className="calendar-week-grid">
                <div className="calendar-week-corner">HORA</div>
                {viewDays.map((day) => {
                  const dayKey = localDayKey(day);
                  return (
                    <div
                      key={dayKey}
                      className={`calendar-week-day-heading${dayKey === localDayKey(new Date()) ? " is-today" : ""}`}
                    >
                      <span>{calendarWeekdayLabels[(day.getDay() + 6) % 7]}</span>
                      <strong>{day.getDate()}</strong>
                    </div>
                  );
                })}
                <div className="calendar-hour-axis" aria-hidden="true">
                  {calendarHours.map((hour) => (
                    <span key={hour} style={{ top: hour * hourHeight }}>
                      {String(hour).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
                {viewDays.map((day) => {
                  const dayKey = localDayKey(day);
                  const isToday = dayKey === localDayKey(new Date());
                  const now = new Date();
                  return (
                    <div key={dayKey} className={`calendar-day-track${isToday ? " is-today" : ""}`}>
                      {calendarHours.map((hour) => {
                        const startsAt = new Date(day);
                        startsAt.setHours(hour, 0, 0, 0);
                        return (
                          <button
                            key={hour}
                            className="calendar-hour-slot"
                            type="button"
                            style={{ top: hour * hourHeight, height: hourHeight }}
                            aria-label={`Agendar el ${new Intl.DateTimeFormat("es-CO", { dateStyle: "full" }).format(day)} a las ${String(hour).padStart(2, "0")}:00`}
                            disabled={calendars.length === 0 && !capabilities?.canConfigureCalendar}
                            onClick={() => openEventForm(startsAt)}
                          />
                        );
                      })}
                      {isToday ? (
                        <div
                          className="calendar-now-line"
                          aria-hidden="true"
                          style={{ top: (now.getHours() + now.getMinutes() / 60) * hourHeight }}
                        />
                      ) : null}
                      {dayEventSegments(visibleEvents, day).map((segment) => (
                        <button
                          key={segment.event.id}
                          className={`calendar-event-block calendar-event-block-${segment.event.status.toLowerCase()}`}
                          type="button"
                          title={`${segment.event.title} · ${formatHour(new Date(segment.event.startsAt))}`}
                          style={{
                            top: (segment.startMinute / 60) * hourHeight + 2,
                            height: Math.max(
                              22,
                              ((segment.endMinute - segment.startMinute) / 60) * hourHeight - 4,
                            ),
                            left: `${(segment.column / segment.columns) * 100}%`,
                            width: `calc(${100 / segment.columns}% - 4px)`,
                          }}
                          onClick={() => setSelectedEvent(segment.event)}
                        >
                          <time dateTime={segment.event.startsAt}>
                            {formatHour(new Date(segment.event.startsAt))}
                          </time>
                          <strong>{segment.event.title}</strong>
                          <small>
                            {advisorById.get(segment.event.advisorMemberId)?.displayName}
                          </small>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="calendar-month-wrap">
              <div className="calendar-month-weekdays" aria-hidden="true">
                {calendarWeekdayLabels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className="calendar-month-grid">
                {viewDays.map((day) => {
                  const segments = dayEventSegments(visibleEvents, day);
                  const dayKey = localDayKey(day);
                  return (
                    <div
                      key={dayKey}
                      className={`calendar-month-day${day.getMonth() !== viewDate.getMonth() ? " is-outside" : ""}${dayKey === localDayKey(new Date()) ? " is-today" : ""}`}
                    >
                      <button
                        className="calendar-month-date"
                        type="button"
                        aria-label={`Ver semana del ${new Intl.DateTimeFormat("es-CO", { dateStyle: "full" }).format(day)}`}
                        onClick={() => {
                          setViewDate(day);
                          setViewMode("week");
                        }}
                      >
                        {day.getDate()}
                      </button>
                      <div className="calendar-month-events">
                        {segments.slice(0, 3).map((segment) => (
                          <button
                            key={segment.event.id}
                            type="button"
                            className={`calendar-month-event calendar-event-block-${segment.event.status.toLowerCase()}`}
                            onClick={() => setSelectedEvent(segment.event)}
                          >
                            <span>{formatHour(new Date(segment.event.startsAt))}</span>{" "}
                            {segment.event.title}
                          </button>
                        ))}
                        {segments.length > 3 ? (
                          <button
                            type="button"
                            className="calendar-month-more"
                            onClick={() => {
                              setViewDate(day);
                              setViewMode("week");
                            }}
                          >
                            +{segments.length - 3} más
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {selectedEvent ? (
          <aside className="calendar-event-detail" aria-label="Detalle de la cita">
            <div>
              <span
                className={`calendar-status calendar-status-${selectedEvent.status.toLowerCase()}`}
              >
                {statusLabels[selectedEvent.status]}
              </span>
              <h2>{selectedEvent.title}</h2>
              <p>
                {new Intl.DateTimeFormat("es-CO", { dateStyle: "full", timeStyle: "short" }).format(
                  new Date(selectedEvent.startsAt),
                )}
                {" · "}
                {advisorById.get(selectedEvent.advisorMemberId)?.displayName ?? "Asesor"}
              </p>
              <p>
                {selectedEvent.guestName ??
                  (selectedEvent.contactId
                    ? contactById.get(selectedEvent.contactId)?.displayName
                    : null) ??
                  "Sin contacto asociado"}
                {selectedEvent.location ? ` · ${selectedEvent.location}` : ""}
              </p>
            </div>
            <div className="calendar-event-detail-actions">
              <button type="button" onClick={() => setRescheduling(selectedEvent)}>
                Reprogramar
              </button>
              <select
                aria-label={`Estado de ${selectedEvent.title}`}
                value={selectedEvent.status}
                disabled={saving}
                onChange={(event) =>
                  void changeStatus(selectedEvent, event.target.value as CalendarEvent["status"])
                }
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Cerrar detalle"
                onClick={() => setSelectedEvent(null)}
              >
                ×
              </button>
            </div>
          </aside>
        ) : null}

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
          {loading || eventsLoading ? (
            <div className="dashboard-empty">
              <span>◌</span>
              <p>Cargando agenda…</p>
            </div>
          ) : null}
          {!loading && !eventsLoading && visibleEvents.length === 0 ? (
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
                      {item.appointmentTypeId
                        ? (appointmentTypeById.get(item.appointmentTypeId)?.name ??
                          typeLabels[item.type])
                        : typeLabels[item.type]}{" "}
                      · {item.origin === "BOOKING" ? "Reserva web" : "Interna"}
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

        {showAppointmentTypeForm ? (
          <div className="modal-backdrop">
            <form
              className="calendar-modal"
              onSubmit={(event) => void createAppointmentType(event)}
            >
              <div className="modal-title">
                <div>
                  <span className="eyebrow">CONFIGURACIÓN</span>
                  <h2>Nuevo tipo de cita</h2>
                </div>
                <button type="button" onClick={() => setShowAppointmentTypeForm(false)}>
                  ×
                </button>
              </div>
              <p>Define los servicios que el equipo puede seleccionar al agendar.</p>
              {appointmentTypes.length > 0 ? (
                <div className="calendar-type-list" aria-label="Tipos existentes">
                  {appointmentTypes.map((type) => (
                    <span key={type.id}>
                      {type.name} · {type.durationMinutes} min
                    </span>
                  ))}
                </div>
              ) : null}
              <label>
                Nombre
                <input name="name" required maxLength={160} placeholder="Entrega de vehículo" />
              </label>
              <label>
                Duración habitual (minutos)
                <input
                  name="durationMinutes"
                  type="number"
                  min="5"
                  max="480"
                  defaultValue="30"
                  required
                />
              </label>
              <button className="primary-action" disabled={saving}>
                {saving ? "Guardando…" : "Crear tipo de cita"}
              </button>
            </form>
          </div>
        ) : null}

        {showEventForm && calendars.length > 0 ? (
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
                  Calendario
                  <select
                    name="calendarId"
                    defaultValue={currentCalendar?.id ?? calendars[0]?.id}
                    required
                  >
                    {calendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.name}
                      </option>
                    ))}
                  </select>
                </label>
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
                  Tipo de cita configurado
                  <select
                    name="appointmentTypeId"
                    defaultValue=""
                    onChange={(event) => {
                      const selected = appointmentTypeById.get(event.target.value);
                      if (selected) setEventDuration(selected.durationMinutes);
                    }}
                  >
                    <option value="">Sin tipo específico</option>
                    {appointmentTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name} · {type.durationMinutes} min
                      </option>
                    ))}
                  </select>
                </label>
                {capabilities?.canConfigureCalendar ? (
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
                ) : null}
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
                  <input name="startsAt" type="datetime-local" defaultValue={draftStart} required />
                </label>
                <label>
                  Duración (min)
                  <input
                    name="duration"
                    type="number"
                    min="5"
                    max="480"
                    value={eventDuration}
                    onChange={(event) => setEventDuration(Number(event.target.value))}
                    required
                  />
                </label>
                <label>
                  Ubicación
                  <input name="location" defaultValue={currentCalendar?.location ?? ""} />
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
