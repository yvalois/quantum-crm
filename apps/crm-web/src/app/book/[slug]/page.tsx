"use client";

import type { AvailableCalendarSlot } from "@quantum-crm/contracts";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

interface PublicCalendar {
  readonly name: string;
  readonly serviceName: string;
  readonly location: string | null;
  readonly timeZone: string;
  readonly slotDurationMinutes: number;
  readonly bookingSlug: string;
}

interface AvailabilityPayload {
  readonly data: {
    readonly calendar: PublicCalendar;
    readonly slots: AvailableCalendarSlot[];
  };
}

async function responseTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

export default function BookingPage(): React.JSX.Element {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [calendar, setCalendar] = useState<PublicCalendar | null>(null);
  const [slots, setSlots] = useState<AvailableCalendarSlot[]>([]);
  const [selected, setSelected] = useState<AvailableCalendarSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const bookingKey = useRef(crypto.randomUUID());

  useEffect(() => {
    const from = new Date();
    from.setMinutes(0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 14);
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    void fetch(`/api/booking/${encodeURIComponent(slug)}?${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseTitle(response));
        return (await response.json()) as AvailabilityPayload;
      })
      .then((payload) => {
        setCalendar(payload.data.calendar);
        setSlots(payload.data.slots);
      })
      .catch((cause: unknown) =>
        setError(
          cause instanceof Error ? cause.message : "No fue posible cargar la disponibilidad.",
        ),
      )
      .finally(() => setLoading(false));
  }, [slug]);

  const groupedSlots = useMemo(() => {
    const groups = new Map<string, AvailableCalendarSlot[]>();
    for (const slot of slots) {
      const day = slot.startsAt.slice(0, 10);
      groups.set(day, [...(groups.get(day) ?? []), slot]);
    }
    return [...groups.entries()];
  }, [slots]);

  async function book(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/booking/${encodeURIComponent(slug)}`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "idempotency-key": bookingKey.current,
        },
        body: JSON.stringify({
          advisorMemberId: selected.advisorMemberId,
          startsAt: selected.startsAt,
          endsAt: selected.endsAt,
          guestName: form.get("guestName"),
          guestEmail: form.get("guestEmail"),
          notes: form.get("notes"),
        }),
      });
      if (!response.ok) throw new Error(await responseTitle(response));
      setConfirmed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible confirmar la reserva.");
    } finally {
      setSaving(false);
    }
  }

  if (confirmed && selected && calendar) {
    return (
      <main className="booking-page">
        <section className="booking-confirmation">
          <span className="booking-logo">Q</span>
          <span className="booking-check">✓</span>
          <p className="eyebrow">RESERVA CONFIRMADA</p>
          <h1>Tu cita quedó agendada</h1>
          <p>{calendar.serviceName}</p>
          <strong>
            {new Intl.DateTimeFormat("es-CO", {
              dateStyle: "full",
              timeStyle: "short",
              timeZone: calendar.timeZone,
            }).format(new Date(selected.startsAt))}
          </strong>
          <small>
            {calendar.location ?? "Los detalles de conexión estarán disponibles con tu cita."}
          </small>
        </section>
      </main>
    );
  }

  return (
    <main className="booking-page">
      <section className="booking-card">
        <aside className="booking-intro">
          <span className="booking-logo">Q</span>
          <p className="eyebrow">AGENDA QUANTUM</p>
          <h1>{calendar?.serviceName ?? "Reserva una cita"}</h1>
          <p>
            Elige el horario que mejor te funcione. La disponibilidad se actualiza en tiempo real.
          </p>
          {calendar ? (
            <dl>
              <div>
                <dt>Duración</dt>
                <dd>{calendar.slotDurationMinutes} minutos</dd>
              </div>
              <div>
                <dt>Zona horaria</dt>
                <dd>{calendar.timeZone}</dd>
              </div>
              <div>
                <dt>Ubicación</dt>
                <dd>{calendar.location ?? "Por confirmar"}</dd>
              </div>
            </dl>
          ) : null}
        </aside>
        <section className="booking-content">
          {loading ? (
            <div className="booking-loading">Consultando horarios disponibles…</div>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && !selected ? (
            <>
              <header>
                <span>PASO 1 DE 2</span>
                <h2>Selecciona día y hora</h2>
              </header>
              <div className="booking-days">
                {groupedSlots.map(([day, daySlots]) => (
                  <article key={day}>
                    <h3>
                      {new Intl.DateTimeFormat("es-CO", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        timeZone: calendar?.timeZone,
                      }).format(new Date(`${day}T12:00:00Z`))}
                    </h3>
                    <div>
                      {daySlots.map((slot) => (
                        <button
                          key={`${slot.advisorMemberId}-${slot.startsAt}`}
                          type="button"
                          onClick={() => setSelected(slot)}
                        >
                          {new Intl.DateTimeFormat("es-CO", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: calendar?.timeZone,
                          }).format(new Date(slot.startsAt))}
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
              {groupedSlots.length === 0 ? (
                <div className="dashboard-empty">
                  <span>◌</span>
                  <strong>No hay horarios en los próximos 14 días</strong>
                  <p>Vuelve pronto para consultar nueva disponibilidad.</p>
                </div>
              ) : null}
            </>
          ) : null}
          {selected ? (
            <form className="booking-form" onSubmit={(event) => void book(event)}>
              <header>
                <button type="button" onClick={() => setSelected(null)}>
                  ← Cambiar horario
                </button>
                <span>PASO 2 DE 2</span>
                <h2>Completa tus datos</h2>
                <p>
                  {new Intl.DateTimeFormat("es-CO", {
                    dateStyle: "full",
                    timeStyle: "short",
                    timeZone: calendar?.timeZone,
                  }).format(new Date(selected.startsAt))}
                </p>
              </header>
              <label>
                Nombre completo
                <input name="guestName" autoComplete="name" required />
              </label>
              <label>
                Correo electrónico
                <input name="guestEmail" type="email" autoComplete="email" required />
              </label>
              <label>
                ¿Qué quieres conversar?
                <textarea
                  name="notes"
                  rows={4}
                  placeholder="Cuéntanos brevemente cómo podemos ayudarte"
                />
              </label>
              <button className="primary-action" disabled={saving}>
                {saving ? "Confirmando…" : "Confirmar reserva"}
              </button>
              <small>Al confirmar, este horario quedará reservado exclusivamente para ti.</small>
            </form>
          ) : null}
        </section>
      </section>
    </main>
  );
}
