"use client";

import type { Contact, ContactImportPreviewRow } from "@quantum-crm/contracts";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";

interface ContactListPayload {
  readonly data: Contact[];
}
interface SessionPayload {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
}

async function responseMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible completar la solicitud.";
}

export function ContactsPanel(): React.JSX.Element {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [importFile, setImportFile] = useState<{ fileName: string; contentBase64: string } | null>(
    null,
  );
  const [importRows, setImportRows] = useState<ContactImportPreviewRow[]>([]);
  const [importBusy, setImportBusy] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/contacts", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 401) {
      window.location.assign("/api/auth/login?returnTo=/contacts");
      return;
    }
    if (!response.ok) throw new Error(await responseMessage(response));
    setContacts(((await response.json()) as ContactListPayload).data);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.status === 401) {
          window.location.assign("/api/auth/login?returnTo=/contacts");
          return;
        }
        const session = (await response.json()) as SessionPayload;
        if (!session.authenticated || !session.csrfToken)
          throw new Error("La sesión no es válida.");
        if (active) setCsrfToken(session.csrfToken);
        await load();
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : "No fue posible cargar contactos.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!csrfToken) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const isUpdate = editing !== null;
      const key = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = key;
      const body = isUpdate
        ? {
            displayName: form.get("displayName"),
            email: form.get("email") || null,
            phone: form.get("phone") || null,
          }
        : {
            displayName: form.get("displayName"),
            ...(form.get("email") ? { email: form.get("email") } : {}),
            ...(form.get("phone") ? { phone: form.get("phone") } : {}),
          };
      const response = await fetch(isUpdate ? `/api/contacts/${editing.id}` : "/api/contacts", {
        method: isUpdate ? "PATCH" : "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          ...(isUpdate ? { "if-match": `\"${editing.version}\"` } : { "idempotency-key": key }),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      event.currentTarget.reset();
      setEditing(null);
      idempotencyKey.current = null;
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible guardar el contacto.");
    } finally {
      setSaving(false);
    }
  }

  async function selectImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
      }
      setImportFile({ fileName: file.name, contentBase64: btoa(binary) });
      setImportRows([]);
      setError(null);
    } catch {
      setError("No fue posible leer el archivo.");
    }
  }

  async function previewImport(): Promise<void> {
    if (!csrfToken || !importFile) return;
    setImportBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/contacts/import/preview", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(importFile),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setImportRows(
        ((await response.json()) as { data: { rows: ContactImportPreviewRow[] } }).data.rows,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible previsualizar la importación.",
      );
    } finally {
      setImportBusy(false);
    }
  }

  async function applyImport(): Promise<void> {
    if (!csrfToken || !importFile || importRows.length === 0) return;
    setImportBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/contacts/import", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(importFile),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setImportRows([]);
      setImportFile(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible aplicar la importación.");
    } finally {
      setImportBusy(false);
    }
  }

  async function exportContacts(): Promise<void> {
    const response = await fetch("/api/contacts/export", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      setError(await responseMessage(response));
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "contacts.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

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
        </nav>
      </aside>
      <section className="crm-content" aria-busy={loading}>
        <header className="page-header">
          <div>
            <p className="eyebrow">CRM</p>
            <h1>Contactos</h1>
            <p>Gestiona los contactos persistentes de tu perfil.</p>
          </div>
          <button
            className="secondary-action"
            type="button"
            onClick={() => void load()}
            disabled={loading}
          >
            Actualizar
          </button>
          <button className="secondary-action" type="button" onClick={() => void exportContacts()}>
            Exportar CSV
          </button>
        </header>
        {error ? (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        ) : null}
        <section className="member-card import-card" aria-busy={importBusy}>
          <div className="card-heading">
            <div>
              <p className="eyebrow">Importación</p>
              <h2>CSV o XLSX</h2>
            </div>
            <label className="secondary-action">
              Seleccionar archivo
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={(event) => void selectImport(event)}
                hidden
              />
            </label>
          </div>
          <p className="state-message">
            {importFile ? importFile.fileName : "Revisa las filas antes de aplicar cambios."}
          </p>
          {importFile ? (
            <div className="form-actions">
              <button
                type="button"
                disabled={importBusy || !csrfToken}
                onClick={() => void previewImport()}
              >
                {importBusy ? "Procesando…" : "Previsualizar"}
              </button>
              {importRows.length > 0 ? (
                <button
                  className="primary-action"
                  type="button"
                  disabled={importBusy || importRows.some((row) => row.status === "ERROR")}
                  onClick={() => void applyImport()}
                >
                  Aplicar importación
                </button>
              ) : null}
            </div>
          ) : null}
          {importRows.length > 0 ? (
            <ul className="member-list import-preview-list">
              {importRows.map((row) => (
                <li className="member-row" key={row.rowNumber}>
                  <div className="member-details">
                    <strong>
                      Fila {row.rowNumber}: {row.displayName || "Sin nombre"}
                    </strong>
                    <span>{row.email ?? row.phone ?? "Sin canal"}</span>
                  </div>
                  <span className={row.status === "ERROR" ? "feedback-error" : "feedback-success"}>
                    {row.status === "ERROR"
                      ? row.errors.join(", ")
                      : row.status === "MATCH"
                        ? "Coincide"
                        : "Nueva"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        <div className="member-layout">
          <section className="member-card">
            <div className="card-heading">
              <h2>Lista</h2>
            </div>
            {loading ? <p className="state-message">Cargando contactos…</p> : null}
            {!loading && contacts.length === 0 ? (
              <p className="state-message">Aún no hay contactos.</p>
            ) : null}
            {!loading && contacts.length > 0 ? (
              <ul className="member-list">
                {contacts.map((contact) => (
                  <li className="member-row" key={contact.id}>
                    <div className="member-avatar" aria-hidden="true">
                      {contact.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="member-details">
                      <strong>{contact.displayName}</strong>
                      <span>{contact.email ?? contact.phone ?? "Sin datos de contacto"}</span>
                    </div>
                    <div className="member-actions">
                      <a className="secondary-action" href={`/contacts/${contact.id}`}>
                        Ver
                      </a>
                      <button type="button" disabled={saving} onClick={() => setEditing(contact)}>
                        Editar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <aside className="member-card member-form-card">
            <form onSubmit={(event) => void submit(event)}>
              <p className="eyebrow">{editing ? "Editar" : "Nuevo"}</p>
              <h2>{editing ? editing.displayName : "Crear contacto"}</h2>
              <label>
                Nombre
                <input
                  name="displayName"
                  key={`name-${editing?.id ?? "new"}`}
                  required
                  maxLength={160}
                  defaultValue={editing?.displayName ?? ""}
                />
              </label>
              <label>
                Correo
                <input
                  name="email"
                  key={`email-${editing?.id ?? "new"}`}
                  type="email"
                  maxLength={320}
                  defaultValue={editing?.email ?? ""}
                />
              </label>
              <label>
                Teléfono
                <input
                  name="phone"
                  key={`phone-${editing?.id ?? "new"}`}
                  maxLength={40}
                  defaultValue={editing?.phone ?? ""}
                />
              </label>
              <div className="form-actions">
                {editing ? (
                  <button className="text-action" type="button" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                ) : null}
                <button className="primary-action" type="submit" disabled={!csrfToken || saving}>
                  {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear contacto"}
                </button>
              </div>
            </form>
          </aside>
        </div>
      </section>
    </main>
  );
}
