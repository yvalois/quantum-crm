"use client";

import type { DashboardLayout, DashboardPeriod, DashboardSnapshot } from "@quantum-crm/contracts";
import { useEffect, useState } from "react";
import { CrmShell } from "./crm-shell";

type Widget = DashboardLayout["widgets"][number];
type Metric = Widget["metric"];
type Chart = Widget["chart"];
interface Envelope<T> {
  readonly data: T;
}
interface Preferences {
  readonly layout: DashboardLayout;
  readonly version: string;
  readonly updatedAt: string | null;
}

const metricNames: Record<Metric, string> = {
  contacts: "Contactos creados",
  conversations: "Conversaciones registradas",
  openOpportunities: "Oportunidades abiertas",
  wonOpportunities: "Oportunidades ganadas",
  pipelineValue: "Valor del pipeline abierto",
  overdueTasks: "Seguimientos vencidos",
};
const metricDescriptions: Record<Metric, string> = {
  contacts: "Contactos activos creados en el período",
  conversations: "Hilos actuales e históricos iniciados en el período",
  openOpportunities: "Oportunidades que siguen abiertas y se crearon en el período",
  wonOpportunities: "Oportunidades cerradas como ganadas en el período",
  pipelineValue: "Suma de oportunidades abiertas creadas en el período, separada por moneda",
  overdueTasks: "Tareas no completadas cuyo vencimiento cae en el período",
};
const periodNames: Record<DashboardPeriod, string> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  all: "Todo el historial",
};
const chartNames: Record<Chart, string> = {
  number: "Indicador",
  bar: "Barras",
  line: "Línea",
  donut: "Circular",
};
const accents = ["#5749d7", "#258b9a", "#dd9d48", "#7695ce", "#ba779c", "#718297", "#9cac72"];
const channelNames: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  CALL: "Llamadas",
  FORM_SUBMISSION: "Formularios",
  EMAIL: "Correo",
  SMS: "SMS",
};

function chartsFor(metric: Metric): readonly Chart[] {
  if (metric === "contacts") return ["number", "line"];
  if (metric === "conversations" || metric === "openOpportunities")
    return ["number", "bar", "donut"];
  return ["number"];
}

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) {
    window.location.assign("/api/auth/login?returnTo=/");
    throw new Error("La sesión expiró.");
  }
  if (!response.ok) throw new Error("No se pudo cargar el tablero.");
  return ((await response.json()) as Envelope<T>).data;
}

function formattedMoney(amountMinor: string, currency: string): string {
  const whole = BigInt(amountMinor) / 100n;
  const fraction = BigInt(amountMinor) % 100n;
  return `${currency} ${new Intl.NumberFormat("es-CO").format(whole)}${fraction === 0n ? "" : `,${fraction.toString().padStart(2, "0")}`}`;
}

function metricValue(snapshot: DashboardSnapshot, metric: Metric): string | null {
  const value = snapshot.metrics[metric];
  if (value === null) return null;
  if (metric === "pipelineValue") {
    const money = snapshot.metrics.pipelineValue;
    return money && money.length
      ? money.map((item) => formattedMoney(item.amountMinor, item.currency)).join(" · ")
      : "Sin valor";
  }
  return new Intl.NumberFormat("es-CO").format(value as number);
}

function chartItems(
  snapshot: DashboardSnapshot,
  metric: Metric,
): readonly { label: string; value: number }[] {
  if (metric === "contacts")
    return snapshot.contactsTrend.map((item) => ({
      ...item,
      label: new Intl.DateTimeFormat("es-CO", { month: "short", year: "numeric", timeZone: "UTC" })
        .format(new Date(`${item.label}-01T00:00:00Z`))
        .replace(" de ", " "),
    }));
  if (metric === "openOpportunities") return snapshot.opportunityStages;
  if (metric === "conversations")
    return snapshot.conversationChannels.map((item) => ({
      ...item,
      label: channelNames[item.label] ?? item.label.replaceAll("_", " ").toLowerCase(),
    }));
  return [];
}

function chartLabel(metric: Metric): string {
  return metric === "contacts"
    ? "Contactos por mes"
    : metric === "openOpportunities"
      ? "Oportunidades por etapa"
      : "Conversaciones por canal";
}

function LineChart({
  items,
}: {
  readonly items: readonly { label: string; value: number }[];
}): React.JSX.Element {
  if (!items.length) return <p className="report-no-data">Aún no hay datos para este período.</p>;
  const max = Math.max(...items.map((item) => item.value), 1);
  const coordinates = items.map((item, index) => ({
    x: items.length === 1 ? 50 : (index / (items.length - 1)) * 100,
    y: 86 - (item.value / max) * 70,
    ...item,
  }));
  return (
    <div className="report-line-chart">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Tendencia: ${items.map((item) => `${item.label} ${item.value}`).join(", ")}`}
      >
        <line x1="0" x2="100" y1="86" y2="86" className="report-chart-grid" />
        <line x1="0" x2="100" y1="51" y2="51" className="report-chart-grid" />
        <line x1="0" x2="100" y1="16" y2="16" className="report-chart-grid" />
        <polyline
          points={coordinates.map((item) => `${item.x},${item.y}`).join(" ")}
          className="report-chart-line"
        />
        {coordinates.map((item) => (
          <circle key={item.label} cx={item.x} cy={item.y} r="1.2" className="report-chart-point">
            <title>{`${item.label}: ${item.value}`}</title>
          </circle>
        ))}
      </svg>
      <div className="report-chart-axis">
        <span>{items[0]?.label}</span>
        <span>{items.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function BarChart({
  items,
}: {
  readonly items: readonly { label: string; value: number }[];
}): React.JSX.Element {
  if (!items.length) return <p className="report-no-data">Aún no hay datos para este período.</p>;
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div
      className="report-bars"
      role="img"
      aria-label={items.map((item) => `${item.label}: ${item.value}`).join(", ")}
    >
      {items.slice(0, 8).map((item, index) => (
        <div className="report-bar-row" key={item.label}>
          <span title={item.label}>{item.label}</span>
          <div className="report-bar-track">
            <span
              style={{
                width: `${(item.value / max) * 100}%`,
                background: accents[index % accents.length],
              }}
            />
          </div>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function DonutChart({
  items,
  metric,
}: {
  readonly items: readonly { label: string; value: number }[];
  readonly metric: Metric;
}): React.JSX.Element {
  if (!items.length) return <p className="report-no-data">Aún no hay datos para este período.</p>;
  const top = items.slice(0, 6);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const stops = top.map((item, index) => {
    const start = cursor;
    cursor += total ? (item.value / total) * 100 : 0;
    return `${accents[index % accents.length]} ${start}% ${cursor}%`;
  });
  if (cursor < 100) stops.push(`${accents[6]} ${cursor}% 100%`);
  return (
    <div className="report-donut-layout">
      <div
        className="report-donut"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
        role="img"
        aria-label={items.map((item) => `${item.label}: ${item.value}`).join(", ")}
      >
        <span>
          {new Intl.NumberFormat("es-CO").format(total)}
          <small>{metric === "conversations" ? "hilos" : "oportunidades"}</small>
        </span>
      </div>
      <div className="report-donut-legend">
        {top.map((item, index) => (
          <div key={item.label}>
            <i style={{ background: accents[index % accents.length] }} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardWidget({
  widget,
  snapshot,
  editing,
  onChange,
  onRemove,
  onMove,
}: {
  readonly widget: Widget;
  readonly snapshot: DashboardSnapshot;
  readonly editing: boolean;
  readonly onChange: (next: Widget) => void;
  readonly onRemove: () => void;
  readonly onMove: (delta: number) => void;
}): React.JSX.Element {
  const value = metricValue(snapshot, widget.metric);
  const items = chartItems(snapshot, widget.metric);
  return (
    <article
      className={`report-widget report-widget-${widget.width} report-widget-${widget.chart} report-metric-${widget.metric}`}
      title={widget.chart === "number" ? metricDescriptions[widget.metric] : undefined}
    >
      <div className="report-widget-head">
        <div>
          {widget.chart !== "number" && <p>ANÁLISIS</p>}
          <h2>
            {widget.chart === "number" ? metricNames[widget.metric] : chartLabel(widget.metric)}
          </h2>
        </div>
        {editing && (
          <div className="report-widget-order">
            <button
              type="button"
              onClick={() => onMove(-1)}
              aria-label={`Mover ${metricNames[widget.metric]} antes`}
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              aria-label={`Mover ${metricNames[widget.metric]} después`}
            >
              →
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Quitar ${metricNames[widget.metric]}`}
            >
              ×
            </button>
          </div>
        )}
      </div>
      {value === null ? (
        <p className="report-no-data">Sin permiso para consultar esta métrica.</p>
      ) : widget.chart === "number" ? (
        <>
          <strong className="report-big-value">{value}</strong>
        </>
      ) : widget.chart === "line" ? (
        <LineChart items={items} />
      ) : widget.chart === "donut" ? (
        <DonutChart items={items} metric={widget.metric} />
      ) : (
        <BarChart items={items} />
      )}
      {editing && (
        <div className="report-widget-settings">
          <label>
            Gráfico
            <select
              value={widget.chart}
              onChange={(event) => onChange({ ...widget, chart: event.target.value as Chart })}
            >
              {chartsFor(widget.metric).map((chart) => (
                <option value={chart} key={chart}>
                  {chartNames[chart]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ancho
            <select
              value={widget.width}
              onChange={(event) =>
                onChange({ ...widget, width: event.target.value as Widget["width"] })
              }
            >
              <option value="half">Media fila</option>
              <option value="full">Fila completa</option>
            </select>
          </label>
        </div>
      )}
    </article>
  );
}

export function CrmDashboard(): React.JSX.Element {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newMetric, setNewMetric] = useState<Metric>("contacts");

  async function refresh(period: DashboardPeriod): Promise<void> {
    setLoading(true);
    try {
      setSnapshot(await read<DashboardSnapshot>(`/api/dashboard/snapshot?period=${period}`));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el tablero.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [sessionResponse, saved] = await Promise.all([
          fetch("/api/auth/session", { cache: "no-store" }),
          read<Preferences>("/api/dashboard/preferences"),
        ]);
        const session = (await sessionResponse.json()) as {
          authenticated?: boolean;
          csrfToken?: string;
        };
        if (!session.authenticated || !session.csrfToken) throw new Error("La sesión expiró.");
        if (!active) return;
        setCsrf(session.csrfToken);
        setPreferences(saved);
        setLayout(saved.layout);
        await refresh(saved.layout.period);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "No se pudo cargar el tablero.");
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save(next: DashboardLayout): Promise<void> {
    if (!preferences || !csrf || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/dashboard/preferences", {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf,
          "if-match": `"${preferences.version}"`,
        },
        body: JSON.stringify(next),
      });
      if (response.status === 412)
        throw new Error("El tablero cambió en otra pestaña. Recarga antes de guardar.");
      if (!response.ok) throw new Error("No se pudo guardar la configuración.");
      const saved = ((await response.json()) as Envelope<Preferences>).data;
      setPreferences(saved);
      setLayout(saved.layout);
      setEditing(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el tablero.");
    } finally {
      setSaving(false);
    }
  }

  function updateWidget(id: string, updater: (widget: Widget) => Widget): void {
    setLayout(
      (current) =>
        current && {
          ...current,
          widgets: current.widgets.map((widget) => (widget.id === id ? updater(widget) : widget)),
        },
    );
  }
  function moveWidget(id: string, delta: number): void {
    setLayout((current) => {
      if (!current) return current;
      const widgets = [...current.widgets];
      const from = widgets.findIndex((item) => item.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= widgets.length) return current;
      const [item] = widgets.splice(from, 1);
      if (item) widgets.splice(to, 0, item);
      return { ...current, widgets };
    });
  }
  function addWidget(): void {
    if (!snapshot || snapshot.metrics[newMetric] === null) return;
    setLayout((current) =>
      current && current.widgets.length < 12
        ? {
            ...current,
            widgets: [
              ...current.widgets,
              { id: crypto.randomUUID(), metric: newMetric, chart: "number", width: "half" },
            ],
          }
        : current,
    );
  }

  return (
    <CrmShell>
      <section className="crm-content report-page" aria-busy={loading}>
        <header className="report-header">
          <div>
            <h1>Resumen</h1>
            <p>Contactos, conversaciones y oportunidades de tu equipo.</p>
          </div>
          <div className="report-header-actions">
            <button
              type="button"
              className="secondary-action"
              onClick={() => layout && void refresh(layout.period)}
              disabled={!layout || loading}
            >
              Actualizar
            </button>
            {editing ? (
              <>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => {
                    setLayout(preferences?.layout ?? null);
                    setEditing(false);
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => layout && void save(layout)}
                  disabled={!layout || saving}
                >
                  {saving ? "Guardando…" : "Guardar tablero"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary-action"
                onClick={() => setEditing(true)}
                disabled={!layout || !snapshot}
              >
                Personalizar
              </button>
            )}
          </div>
        </header>
        <div className="report-toolbar">
          <div>
            <span className="report-live-dot" />{" "}
            {snapshot
              ? `Actualizado ${new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.generatedAt))}`
              : "Cargando datos"}
          </div>
          <label>
            Período
            <select
              value={layout?.period ?? "all"}
              disabled={!layout || loading || saving}
              onChange={(event) => {
                const period = event.target.value as DashboardPeriod;
                const next = layout && { ...layout, period };
                if (next) {
                  setLayout(next);
                  if (!editing) void save(next);
                }
                void refresh(period);
              }}
            >
              {(Object.keys(periodNames) as DashboardPeriod[]).map((period) => (
                <option key={period} value={period}>
                  {periodNames[period]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        )}
        {editing && (
          <aside className="report-editor">
            <div>
              <strong>Diseña tu tablero</strong>
              <p>
                Agrega indicadores o cambia el gráfico, ancho y orden de cada bloque. Los cambios se
                guardan solo para tu usuario.
              </p>
            </div>
            <div className="report-add">
              <label>
                Nueva métrica
                <select
                  value={newMetric}
                  onChange={(event) => setNewMetric(event.target.value as Metric)}
                >
                  {(Object.keys(metricNames) as Metric[])
                    .filter((metric) => snapshot?.metrics[metric] !== null)
                    .map((metric) => (
                      <option key={metric} value={metric}>
                        {metricNames[metric]}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                onClick={addWidget}
                disabled={(layout?.widgets.length ?? 0) >= 12}
              >
                + Agregar bloque
              </button>
            </div>
          </aside>
        )}
        {!snapshot && loading ? (
          <p className="report-loading">Preparando tus indicadores…</p>
        ) : null}
        {snapshot && layout && (
          <div className="report-grid">
            {layout.widgets.map((widget) => (
              <DashboardWidget
                key={widget.id}
                widget={widget}
                snapshot={snapshot}
                editing={editing}
                onChange={(next) => updateWidget(widget.id, () => next)}
                onRemove={() =>
                  setLayout(
                    (current) =>
                      current && {
                        ...current,
                        widgets: current.widgets.filter((item) => item.id !== widget.id),
                      },
                  )
                }
                onMove={(delta) => moveWidget(widget.id, delta)}
              />
            ))}
            {layout.widgets.length === 0 && (
              <div className="report-empty">
                Este tablero está vacío. Pulsa «Personalizar» para agregar un indicador.
              </div>
            )}
          </div>
        )}
        <p className="report-footnote">
          Las cifras se calculan en el servidor según tus permisos y asignaciones. El período se
          aplica a la fecha indicada en cada indicador; las monedas nunca se mezclan.
        </p>
      </section>
    </CrmShell>
  );
}
