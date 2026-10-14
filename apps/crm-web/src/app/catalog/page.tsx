"use client";

import type { CatalogItem } from "@quantum-crm/contracts";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { CrmShell } from "../crm-shell";

interface Category {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly active: boolean;
}
interface ItemType {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
}
interface FieldOption {
  readonly key: string;
  readonly label: string;
  readonly color?: string;
}
interface FieldDefinition {
  readonly id: string;
  readonly itemTypeId: string | null;
  readonly itemId: string | null;
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly valueType:
    "text" | "number" | "date" | "boolean" | "single_select" | "multi_select" | "color";
  readonly options: readonly FieldOption[];
  readonly required: boolean;
  readonly active: boolean;
  readonly sortOrder: number;
}
interface List<T> {
  readonly data: T[];
}
interface Session {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}
interface Capabilities {
  readonly canManageCatalog?: boolean;
  readonly canManageCatalogStock?: boolean;
}
type KindFilter = "all" | CatalogItem["kind"];

const modeLabel: Record<CatalogItem["availabilityMode"], string> = {
  unlimited: "Sin límite",
  stock: "Existencias",
  interval_capacity: "Cupo por fechas",
};
const valueTypeLabel: Record<FieldDefinition["valueType"], string> = {
  text: "Texto",
  number: "Número",
  date: "Fecha",
  boolean: "Sí / No",
  single_select: "Selección única",
  multi_select: "Selección múltiple",
  color: "Color",
};
const initialDraft = {
  kind: "product" as CatalogItem["kind"],
  name: "",
  description: "",
  sku: "",
  categoryId: "",
  itemTypeId: "",
  price: "0",
  currency: "GTQ",
  availabilityMode: "stock" as CatalogItem["availabilityMode"],
  tracksStock: true,
  capacity: "1",
  locksAdvisor: true,
  active: true,
};

async function responseError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    title?: string;
    message?: string;
  } | null;
  return payload?.title ?? payload?.message ?? `Error ${response.status}`;
}

export default function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [types, setTypes] = useState<ItemType[]>([]);
  const [calendars, setCalendars] = useState<
    { id: string; name: string; catalogItemId?: string | null }[]
  >([]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [draft, setDraft] = useState(initialDraft);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [dialog, setDialog] = useState<
    "item" | "category" | "type" | "field" | "stock" | "calendar" | null
  >(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (kind === "all" || item.kind === kind) &&
          (!categoryFilter || item.categoryId === categoryFilter) &&
          (!query ||
            `${item.name} ${item.sku ?? ""}`
              .toLocaleLowerCase("es")
              .includes(query.toLocaleLowerCase("es"))),
      ),
    [items, kind, categoryFilter, query],
  );

  const refresh = useCallback(async () => {
    const results = await Promise.all([
      fetch("/api/catalog/items?includeInactive=true&limit=100", { cache: "no-store" }),
      fetch("/api/catalog/categories", { cache: "no-store" }),
      fetch("/api/catalog/types", { cache: "no-store" }),
      fetch("/api/calendar/calendars", { cache: "no-store" }),
    ]);
    const failure = results.slice(0, 3).find((response) => !response.ok);
    if (failure) throw new Error(await responseError(failure));
    const [itemResponse, categoryResponse, typeResponse, calendarResponse] = results;
    if (!itemResponse || !categoryResponse || !typeResponse || !calendarResponse)
      throw new Error("No se pudo cargar el catálogo.");
    setItems(((await itemResponse.json()) as List<CatalogItem>).data);
    setCategories(((await categoryResponse.json()) as List<Category>).data);
    setTypes(((await typeResponse.json()) as List<ItemType>).data);
    setCalendars(
      calendarResponse.ok
        ? (
            (await calendarResponse.json()) as List<{
              id: string;
              name: string;
              catalogItemId?: string | null;
            }>
          ).data
        : [],
    );
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [sessionResponse, capabilityResponse] = await Promise.all([
          fetch("/api/auth/session", { cache: "no-store" }),
          fetch("/api/auth/capabilities", { cache: "no-store" }),
        ]);
        if (!sessionResponse.ok || !capabilityResponse.ok)
          throw new Error("La sesión no está disponible.");
        const session = (await sessionResponse.json()) as Session;
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no está lista.");
        const caps = (await capabilityResponse.json()) as { data: Capabilities };
        if (!active) return;
        setCsrf(session.csrfToken);
        setCapabilities(caps.data);
        await refresh();
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "No se pudo abrir el catálogo.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setFields([]);
      return;
    }
    const params = new URLSearchParams();
    if (selected.itemTypeId) params.set("itemTypeId", selected.itemTypeId);
    params.set("itemId", selected.id);
    void fetch(`/api/catalog/fields?${params}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<List<FieldDefinition>>;
      })
      .then((response) => setFields(response.data))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar los campos."),
      );
    setValues(selected.fields);
  }, [selected?.id, selected?.itemTypeId, selected?.version]);

  useEffect(() => {
    if (selected || dialog !== "item" || !draft.itemTypeId) return;
    void fetch(`/api/catalog/fields?itemTypeId=${encodeURIComponent(draft.itemTypeId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response));
        return response.json() as Promise<List<FieldDefinition>>;
      })
      .then((response) => {
        setFields(response.data);
        setValues({});
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar los campos."),
      );
  }, [dialog, draft.itemTypeId, selected]);

  async function mutate(
    path: string,
    body: unknown,
    method: "POST" | "PATCH" = "POST",
    version?: string,
  ) {
    if (!csrf) throw new Error("La sesión no está lista.");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
    };
    if (version) headers["if-match"] = `"${version}"`;
    const response = await fetch(path, {
      method,
      headers,
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await responseError(response));
    return response;
  }

  function openItem(item?: CatalogItem) {
    if (item) {
      setSelectedId(item.id);
      setDraft({
        kind: item.kind,
        name: item.name,
        description: item.description,
        sku: item.sku ?? "",
        categoryId: item.categoryId ?? "",
        itemTypeId: item.itemTypeId ?? "",
        price: item.price,
        currency: item.currency,
        availabilityMode: item.availabilityMode,
        tracksStock: item.tracksStock,
        capacity: String(item.capacity ?? 1),
        locksAdvisor: item.locksAdvisor,
        active: item.active,
      });
      setValues(item.fields);
    } else {
      setSelectedId(null);
      setDraft(initialDraft);
      setValues({});
      setFields([]);
    }
    setError(null);
    setDialog("item");
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        kind: draft.kind,
        name: draft.name.trim(),
        description: draft.description,
        sku: draft.sku.trim() || null,
        categoryId: draft.categoryId || null,
        itemTypeId: draft.itemTypeId || null,
        price: draft.price,
        currency: draft.currency,
        availabilityMode: draft.availabilityMode,
        tracksStock: draft.availabilityMode === "stock" || draft.tracksStock,
        capacity: draft.availabilityMode === "interval_capacity" ? Number(draft.capacity) : null,
        locksAdvisor: draft.locksAdvisor,
        fields: values,
        ...(selected ? { active: draft.active } : {}),
      };
      const response = await mutate(
        selected ? `/api/catalog/items/${selected.id}` : "/api/catalog/items",
        body,
        selected ? "PATCH" : "POST",
        selected?.version,
      );
      const saved = ((await response.json()) as { data: CatalogItem }).data;
      await refresh();
      setSelectedId(saved.id);
      setDialog(null);
      setNotice(
        selected
          ? "Ficha actualizada."
          : "Ítem creado. Ya puedes agregar campos específicos y existencias.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function createSimple(event: FormEvent<HTMLFormElement>, endpoint: "categories" | "types") {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await mutate(
        `/api/catalog/${endpoint}`,
        endpoint === "categories"
          ? {
              name: String(form.get("name") ?? ""),
              parentId: String(form.get("parentId") ?? "") || null,
            }
          : {
              name: String(form.get("name") ?? ""),
              description: String(form.get("description") ?? ""),
            },
      );
      await refresh();
      setDialog(null);
      setNotice(endpoint === "categories" ? "Categoría creada." : "Tipo creado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function createField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const fieldType = String(form.get("valueType")) as FieldDefinition["valueType"];
    const options = String(form.get("options") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((label) => ({
        key: label
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/gu, "")
          .replace(/[^a-z0-9]+/gu, "_")
          .replace(/^_|_$/gu, "")
          .slice(0, 80),
        label,
      }));
    try {
      await mutate("/api/catalog/fields", {
        ...(String(form.get("scope")) === "type"
          ? { itemTypeId: selected?.itemTypeId }
          : { itemId: selected?.id }),
        key: String(form.get("key") ?? ""),
        label: String(form.get("label") ?? ""),
        description: String(form.get("description") ?? ""),
        valueType: fieldType,
        options: ["single_select", "multi_select"].includes(fieldType) ? options : [],
        required: form.get("required") === "on",
        sortOrder: fields.length,
      });
      if (selected) {
        const params = new URLSearchParams({ itemId: selected.id });
        if (selected.itemTypeId) params.set("itemTypeId", selected.itemTypeId);
        const response = await fetch(`/api/catalog/fields?${params}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await responseError(response));
        setFields(((await response.json()) as List<FieldDefinition>).data);
      }
      setDialog(null);
      setNotice("Campo creado. Edita la ficha para asignarle un valor.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el campo.");
    } finally {
      setSaving(false);
    }
  }

  async function moveStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    const amount = Number(form.get("quantity"));
    try {
      await mutate(`/api/catalog/items/${selected.id}/stock-movements`, {
        delta: form.get("direction") === "out" ? -amount : amount,
        reason: String(form.get("reason") ?? ""),
      });
      await refresh();
      setDialog(null);
      setNotice("Movimiento registrado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el movimiento.");
    } finally {
      setSaving(false);
    }
  }

  async function createCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      await mutate("/api/calendar/calendars", {
        name: String(form.get("name") ?? ""),
        serviceName: selected.name,
        catalogItemId: selected.id,
        location: null,
        timeZone: String(form.get("timeZone") ?? "America/Bogota"),
        slotDurationMinutes: Number(form.get("duration")),
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      });
      await refresh();
      setDialog(null);
      setNotice("Calendario vinculado. Configura su disponibilidad en Calendario.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el calendario.");
    } finally {
      setSaving(false);
    }
  }

  function fieldControl(field: FieldDefinition) {
    const value = values[field.id];
    const change = (next: unknown) => setValues((previous) => ({ ...previous, [field.id]: next }));
    if (field.valueType === "boolean")
      return (
        <label className="catalog-field-check">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => change(event.target.checked)}
          />{" "}
          Sí
        </label>
      );
    if (field.valueType === "single_select")
      return (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => change(event.target.value)}
        >
          <option value="">Selecciona</option>
          {field.options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      );
    if (field.valueType === "multi_select")
      return (
        <div className="catalog-options">
          {field.options.map((option) => (
            <label key={option.key}>
              <input
                type="checkbox"
                checked={Array.isArray(value) && value.includes(option.key)}
                onChange={(event) =>
                  change(
                    event.target.checked
                      ? [...(Array.isArray(value) ? value : []), option.key]
                      : (Array.isArray(value) ? value : []).filter((key) => key !== option.key),
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      );
    return (
      <input
        type={
          field.valueType === "number"
            ? "number"
            : field.valueType === "date"
              ? "date"
              : field.valueType === "color"
                ? "color"
                : "text"
        }
        value={
          typeof value === "string" || typeof value === "number"
            ? value
            : field.valueType === "color"
              ? "#008d86"
              : ""
        }
        onChange={(event) =>
          change(field.valueType === "number" ? Number(event.target.value) : event.target.value)
        }
      />
    );
  }

  return (
    <CrmShell>
      <main className="catalog-page">
        <header className="catalog-heading">
          <div>
            <span className="catalog-kicker">VENTAS Y SERVICIOS</span>
            <h1>Catálogo</h1>
            <p>Todo lo que ofreces, con sus características y disponibilidad en un solo lugar.</p>
          </div>
          {capabilities.canManageCatalog && (
            <button className="catalog-primary" onClick={() => openItem()}>
              + Nuevo ítem
            </button>
          )}
        </header>
        {notice && (
          <div className="catalog-notice" role="status">
            {notice}
            <button onClick={() => setNotice(null)} aria-label="Cerrar aviso">
              ×
            </button>
          </div>
        )}
        {error && !dialog && (
          <div className="catalog-error" role="alert">
            {error}
          </div>
        )}
        <section className="catalog-toolbar">
          <div className="catalog-tabs" aria-label="Tipo de ítem">
            {(["all", "product", "service"] as const).map((filter) => (
              <button
                key={filter}
                className={kind === filter ? "active" : ""}
                onClick={() => setKind(filter)}
              >
                {filter === "all" ? "Todos" : filter === "product" ? "Productos" : "Servicios"}
              </button>
            ))}
          </div>
          <input
            aria-label="Buscar en catálogo"
            placeholder="Buscar por nombre o código"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="Filtrar categoría"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="">Todas las categorías</option>
            {categories
              .filter((category) => category.active)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </section>
        <div className="catalog-layout">
          <section className="catalog-list" aria-label="Ítems del catálogo">
            {loading ? (
              <div className="catalog-empty">Cargando catálogo…</div>
            ) : visible.length === 0 ? (
              <div className="catalog-empty">
                <strong>
                  {items.length ? "No hay coincidencias" : "Tu catálogo empieza aquí"}
                </strong>
                <p>
                  {items.length
                    ? "Prueba otro filtro o búsqueda."
                    : "Crea un producto o servicio y define cómo se controla su disponibilidad."}
                </p>
                {capabilities.canManageCatalog && !items.length && (
                  <button className="catalog-primary" onClick={() => openItem()}>
                    Crear primer ítem
                  </button>
                )}
              </div>
            ) : (
              <div className="catalog-table">
                <div className="catalog-table-head">
                  <span>Ítem</span>
                  <span>Categoría</span>
                  <span>Disponibilidad</span>
                  <span>Precio</span>
                </div>
                {visible.map((item) => (
                  <button
                    key={item.id}
                    className={`catalog-row ${selectedId === item.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span>
                      <span className="catalog-item-icon">
                        {item.kind === "product" ? "P" : "S"}
                      </span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          {item.kind === "product" ? "Producto" : "Servicio"}
                          {item.sku ? ` · ${item.sku}` : ""}
                          {!item.active ? " · Inactivo" : ""}
                        </small>
                      </span>
                    </span>
                    <span>
                      {categories.find((category) => category.id === item.categoryId)?.name ??
                        "Sin categoría"}
                    </span>
                    <span>
                      {item.availabilityMode === "stock"
                        ? `${item.stockOnHand} unidades`
                        : item.availabilityMode === "interval_capacity"
                          ? `${item.capacity} cupos simultáneos${item.tracksStock ? ` · ${item.stockOnHand} en stock` : ""}`
                          : modeLabel[item.availabilityMode]}
                    </span>
                    <span>
                      {new Intl.NumberFormat("es-GT", {
                        style: "currency",
                        currency: item.currency,
                      }).format(Number(item.price))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <aside className="catalog-side">
            <div className="catalog-side-title">
              <span>Organización</span>
            </div>
            <div className="catalog-side-group">
              <h3>
                Categorías <span>{categories.length}</span>
              </h3>
              {categories.slice(0, 8).map((category) => (
                <button key={category.id} onClick={() => setCategoryFilter(category.id)}>
                  {category.name}
                </button>
              ))}
              {capabilities.canManageCatalog && (
                <button className="catalog-link" onClick={() => setDialog("category")}>
                  + Crear categoría
                </button>
              )}
            </div>
            <div className="catalog-side-group">
              <h3>
                Tipos <span>{types.length}</span>
              </h3>
              {types.slice(0, 8).map((type) => (
                <span key={type.id}>{type.name}</span>
              ))}
              {capabilities.canManageCatalog && (
                <button className="catalog-link" onClick={() => setDialog("type")}>
                  + Crear tipo
                </button>
              )}
            </div>
          </aside>
        </div>
        {selected && (
          <section className="catalog-detail">
            <div className="catalog-detail-heading">
              <div>
                <span className="catalog-kicker">
                  FICHA DEL {selected.kind === "product" ? "PRODUCTO" : "SERVICIO"}
                </span>
                <h2>{selected.name}</h2>
                <p>{selected.description || "Sin descripción"}</p>
              </div>
              <div className="catalog-detail-actions">
                {capabilities.canManageCatalog && (
                  <button onClick={() => openItem(selected)}>Editar ficha</button>
                )}
                {capabilities.canManageCatalog && (
                  <button onClick={() => setDialog("field")}>+ Campo</button>
                )}
                {capabilities.canManageCatalogStock && selected.tracksStock && (
                  <button onClick={() => setDialog("stock")}>Movimiento de stock</button>
                )}
                {capabilities.canManageCatalog &&
                  selected.kind === "service" &&
                  selected.availabilityMode !== "stock" && (
                    <button onClick={() => setDialog("calendar")}>+ Calendario</button>
                  )}
              </div>
            </div>
            <div className="catalog-detail-grid">
              <div>
                <small>Disponibilidad</small>
                <strong>{modeLabel[selected.availabilityMode]}</strong>
                <p>
                  {selected.availabilityMode === "stock"
                    ? `${selected.stockOnHand} unidades disponibles`
                    : selected.availabilityMode === "interval_capacity"
                      ? `${selected.capacity} unidades simultáneas por período${selected.tracksStock ? ` · ${selected.stockOnHand} en stock` : ""}`
                      : "No requiere control de cupos"}
                </p>
              </div>
              <div>
                <small>Calendarios vinculados</small>
                <strong>
                  {calendars.filter((calendar) => calendar.catalogItemId === selected.id).length}
                </strong>
                {calendars
                  .filter((calendar) => calendar.catalogItemId === selected.id)
                  .map((calendar) => (
                    <a key={calendar.id} href="/calendar">
                      {calendar.name}
                    </a>
                  ))}
              </div>
              <div>
                <small>Características</small>
                <strong>{fields.length}</strong>
                {fields.map((field) => (
                  <p key={field.id}>
                    {field.label}: {String(selected.fields[field.id] ?? "—")}
                  </p>
                ))}
              </div>
            </div>
          </section>
        )}
        {dialog && (
          <div
            className="catalog-modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setDialog(null);
                setError(null);
              }
            }}
          >
            <div
              className="catalog-modal"
              role="dialog"
              aria-modal="true"
              aria-label={dialog === "item" ? "Ficha del catálogo" : dialog}
            >
              <div className="catalog-modal-head">
                <h2>
                  {dialog === "item"
                    ? selected
                      ? "Editar ficha"
                      : "Nuevo ítem"
                    : dialog === "category"
                      ? "Nueva categoría"
                      : dialog === "type"
                        ? "Nuevo tipo"
                        : dialog === "field"
                          ? "Nuevo campo"
                          : dialog === "stock"
                            ? "Movimiento de stock"
                            : "Calendario del servicio"}
                </h2>
                <button
                  onClick={() => {
                    setDialog(null);
                    setError(null);
                  }}
                  aria-label="Cerrar"
                >
                  ×
                </button>
              </div>
              {error && (
                <div className="catalog-error" role="alert">
                  {error}
                </div>
              )}
              {dialog === "item" && (
                <form onSubmit={saveItem} className="catalog-form">
                  <div className="catalog-form-grid">
                    <label>
                      Clase
                      <select
                        value={draft.kind}
                        onChange={(event) => {
                          const nextKind = event.target.value as CatalogItem["kind"];
                          setDraft({
                            ...draft,
                            kind: nextKind,
                            ...(nextKind === "service" && draft.kind !== "service" && !selected
                              ? {
                                  availabilityMode: "interval_capacity" as const,
                                  tracksStock: true,
                                }
                              : {}),
                          });
                        }}
                      >
                        <option value="product">Producto</option>
                        <option value="service">Servicio</option>
                      </select>
                    </label>
                    <label>
                      Nombre
                      <input
                        required
                        maxLength={180}
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </label>
                    <label className="full">
                      Descripción
                      <textarea
                        maxLength={10000}
                        rows={3}
                        value={draft.description}
                        onChange={(event) =>
                          setDraft({ ...draft, description: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Código / SKU
                      <input
                        maxLength={100}
                        value={draft.sku}
                        onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
                      />
                    </label>
                    <label>
                      Categoría
                      <select
                        value={draft.categoryId}
                        onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
                      >
                        <option value="">Sin categoría</option>
                        {categories
                          .filter((category) => category.active)
                          .map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Tipo
                      <select
                        value={draft.itemTypeId}
                        onChange={(event) => setDraft({ ...draft, itemTypeId: event.target.value })}
                      >
                        <option value="">Sin tipo</option>
                        {types
                          .filter((type) => type.active)
                          .map((type) => (
                            <option key={type.id} value={type.id}>
                              {type.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Precio
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.0001"
                        value={draft.price}
                        onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                      />
                    </label>
                    <label>
                      Moneda
                      <input
                        required
                        maxLength={3}
                        value={draft.currency}
                        onChange={(event) =>
                          setDraft({ ...draft, currency: event.target.value.toUpperCase() })
                        }
                      />
                    </label>
                    <label>
                      Disponibilidad
                      <select
                        value={draft.availabilityMode}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            availabilityMode: event.target.value as CatalogItem["availabilityMode"],
                          })
                        }
                      >
                        <option value="unlimited">Sin límite</option>
                        <option value="stock">Existencias consumibles</option>
                        <option value="interval_capacity">Cupo por fechas</option>
                      </select>
                    </label>
                    {draft.availabilityMode !== "stock" && (
                      <label className="catalog-field-check">
                        <input
                          type="checkbox"
                          checked={draft.tracksStock}
                          onChange={(event) =>
                            setDraft({ ...draft, tracksStock: event.target.checked })
                          }
                        />{" "}
                        Controlar también existencias físicas
                      </label>
                    )}
                    {draft.availabilityMode === "interval_capacity" && (
                      <>
                        <label>
                          Cupos simultáneos
                          <input
                            required
                            type="number"
                            min="1"
                            max="100000"
                            value={draft.capacity}
                            onChange={(event) =>
                              setDraft({ ...draft, capacity: event.target.value })
                            }
                          />
                        </label>
                        <label className="catalog-field-check">
                          <input
                            type="checkbox"
                            checked={draft.locksAdvisor}
                            onChange={(event) =>
                              setDraft({ ...draft, locksAdvisor: event.target.checked })
                            }
                          />{" "}
                          Bloquear también la agenda del asesor
                        </label>
                      </>
                    )}
                    {selected && (
                      <label className="catalog-field-check">
                        <input
                          type="checkbox"
                          checked={draft.active}
                          onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                        />{" "}
                        Activo
                      </label>
                    )}
                  </div>
                  {fields.length > 0 && (
                    <div className="catalog-custom-fields">
                      <h3>Características</h3>
                      <div className="catalog-form-grid">
                        {fields.map((field) => (
                          <label key={field.id}>
                            {field.label}
                            {field.required ? " *" : ""}
                            {fieldControl(field)}
                            <small>{field.description}</small>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <footer>
                    <button type="button" onClick={() => setDialog(null)}>
                      Cancelar
                    </button>
                    <button className="catalog-primary" disabled={saving}>
                      {saving ? "Guardando…" : "Guardar"}
                    </button>
                  </footer>
                </form>
              )}
              {dialog === "category" && (
                <form
                  className="catalog-form"
                  onSubmit={(event) => createSimple(event, "categories")}
                >
                  <label>
                    Nombre
                    <input name="name" required maxLength={120} />
                  </label>
                  <label>
                    Categoría superior
                    <select name="parentId">
                      <option value="">Ninguna</option>
                      {categories
                        .filter((category) => category.active)
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <footer>
                    <button type="button" onClick={() => setDialog(null)}>
                      Cancelar
                    </button>
                    <button className="catalog-primary" disabled={saving}>
                      Crear categoría
                    </button>
                  </footer>
                </form>
              )}
              {dialog === "type" && (
                <form className="catalog-form" onSubmit={(event) => createSimple(event, "types")}>
                  <label>
                    Nombre
                    <input name="name" required maxLength={120} placeholder="Por ejemplo, SUV" />
                  </label>
                  <label>
                    Descripción
                    <textarea name="description" maxLength={500} />
                  </label>
                  <footer>
                    <button type="button" onClick={() => setDialog(null)}>
                      Cancelar
                    </button>
                    <button className="catalog-primary" disabled={saving}>
                      Crear tipo
                    </button>
                  </footer>
                </form>
              )}
              {dialog === "field" && selected && (
                <form className="catalog-form" onSubmit={createField}>
                  <label>
                    Usar en
                    <select name="scope">
                      <option value="item">Solo {selected.name}</option>
                      {selected.itemTypeId && (
                        <option value="type">Todos los ítems de este tipo</option>
                      )}
                    </select>
                  </label>
                  <label>
                    Nombre visible
                    <input name="label" required maxLength={160} />
                  </label>
                  <label>
                    Clave estable
                    <input
                      name="key"
                      required
                      pattern="[a-z][a-z0-9_]*"
                      maxLength={80}
                      placeholder="por ejemplo: transmision"
                    />
                  </label>
                  <label>
                    Descripción para usuarios y agente
                    <textarea name="description" maxLength={500} />
                  </label>
                  <label>
                    Tipo de dato
                    <select name="valueType">
                      {Object.entries(valueTypeLabel).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Opciones (una por línea, para campos de selección)
                    <textarea name="options" rows={4} />
                  </label>
                  <label className="catalog-field-check">
                    <input type="checkbox" name="required" /> Obligatorio
                  </label>
                  <footer>
                    <button type="button" onClick={() => setDialog(null)}>
                      Cancelar
                    </button>
                    <button className="catalog-primary" disabled={saving}>
                      Crear campo
                    </button>
                  </footer>
                </form>
              )}
              {dialog === "stock" && selected && (
                <form className="catalog-form" onSubmit={moveStock}>
                  <p>
                    Saldo actual: <strong>{selected.stockOnHand}</strong> unidades.
                  </p>
                  <label>
                    Movimiento
                    <select name="direction">
                      <option value="in">Entrada</option>
                      <option value="out">Salida</option>
                    </select>
                  </label>
                  <label>
                    Cantidad
                    <input name="quantity" type="number" min="1" step="1" required />
                  </label>
                  <label>
                    Motivo
                    <input name="reason" required maxLength={500} />
                  </label>
                  <footer>
                    <button type="button" onClick={() => setDialog(null)}>
                      Cancelar
                    </button>
                    <button className="catalog-primary" disabled={saving}>
                      Registrar
                    </button>
                  </footer>
                </form>
              )}
              {dialog === "calendar" && selected && (
                <form className="catalog-form" onSubmit={createCalendar}>
                  <p>
                    Las reservas ocuparán una unidad del cupo durante todo el intervalo de la cita.
                    Si no deben bloquear al asesor durante ese período, desactiva esa opción en la
                    ficha del servicio.
                  </p>
                  <label>
                    Nombre del calendario
                    <input name="name" required defaultValue={selected.name} maxLength={160} />
                  </label>
                  <label>
                    Zona horaria
                    <input
                      name="timeZone"
                      required
                      defaultValue={
                        Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Bogota"
                      }
                    />
                  </label>
                  <label>
                    Duración inicial de cita (minutos)
                    <input
                      name="duration"
                      type="number"
                      min="5"
                      max="480"
                      defaultValue="30"
                      required
                    />
                  </label>
                  <footer>
                    <button type="button" onClick={() => setDialog(null)}>
                      Cancelar
                    </button>
                    <button className="catalog-primary" disabled={saving}>
                      Crear calendario vinculado
                    </button>
                  </footer>
                </form>
              )}
            </div>
          </div>
        )}
      </main>
    </CrmShell>
  );
}
