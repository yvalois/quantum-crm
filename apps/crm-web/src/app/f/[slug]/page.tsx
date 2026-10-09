"use client";

import type { FormAnswerValue, FormContract, FormField } from "@quantum-crm/contracts";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
type PublicForm = Pick<
  FormContract,
  | "id"
  | "slug"
  | "title"
  | "description"
  | "definition"
  | "theme"
  | "publishedRevision"
  | "closesAt"
>;

interface UploadIntent {
  readonly data: {
    readonly file: { readonly id: string };
    readonly upload: { readonly url: string; readonly fields: Readonly<Record<string, string>> };
  };
}

async function sha256Base64(file: File): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function uploadVersionId(response: Response, body: string): string | null {
  return response.headers.get("x-amz-version-id") ?? body.match(/<VersionId>([^<]+)<\/VersionId>/u)?.[1] ?? null;
}

async function responseTitle(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "title" in body && typeof body.title === "string"
    ? body.title
    : "No fue posible enviar la respuesta.";
}

function visible(field: FormField, answers: Record<string, FormAnswerValue>): boolean {
  if (!field.condition) return true;
  const current = answers[field.condition.sourceFieldId];
  if (field.condition.operator === "NOT_EMPTY")
    return Array.isArray(current) ? current.length > 0 : String(current ?? "").trim().length > 0;
  const actual = Array.isArray(current) ? current.join("\u0000") : String(current ?? "");
  const expected = String(field.condition.value ?? "");
  return field.condition.operator === "EQUALS"
    ? actual === expected
    : field.condition.operator === "NOT_EQUALS"
      ? actual !== expected
      : Array.isArray(current)
        ? current.includes(expected)
        : actual.includes(expected);
}

export default function PublicFormPage(): React.JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, File[]>>({});
  const key = useRef(crypto.randomUUID());

  useEffect(() => {
    void fetch(`/api/public-forms/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 410
              ? "Este formulario esta cerrado."
              : await responseTitle(response),
          );
        return (await response.json()) as { data: PublicForm };
      })
      .then((payload) => setForm(payload.data))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "No fue posible abrir el formulario."),
      )
      .finally(() => setLoading(false));
  }, [slug]);

  function field(field: FormField): React.JSX.Element {
    const set = (value: FormAnswerValue) =>
      setAnswers((current) => ({ ...current, [field.id]: value }));
    if (field.type === "IMAGE_UPLOAD")
      return (
        <div className="public-form-upload">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            required={field.required}
            onChange={(event) =>
              setImages((current) => ({ ...current, [field.id]: Array.from(event.target.files ?? []) }))
            }
          />
          <small>PNG, JPG o WebP; hasta 20 MB por imagen. Se valida antes de guardarse.</small>
          {(images[field.id] ?? []).length ? (
            <em>{(images[field.id] ?? []).length} imagen(es) lista(s) para cargar.</em>
          ) : null}
        </div>
      );
    if (["LONG_TEXT", "ADDRESS"].includes(field.type))
      return (
        <textarea
          rows={5}
          value={String(answers[field.id] ?? "")}
          onChange={(event) => set(event.target.value)}
          required={field.required}
        />
      );
    if (field.type === "SINGLE_CHOICE")
      return (
        <div className="public-form-options">
          {field.options.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name={field.id}
                value={option}
                checked={answers[field.id] === option}
                onChange={() => set(option)}
                required={field.required}
              />{" "}
              {option}
            </label>
          ))}
        </div>
      );
    if (field.type === "MULTIPLE_CHOICE")
      return (
        <div className="public-form-options">
          {field.options.map((option) => {
            const current = answers[field.id];
            const selected: string[] = Array.isArray(current) ? current : [];
            return (
              <label key={option}>
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={(event) =>
                    set(
                      event.target.checked
                        ? [...selected, option]
                        : selected.filter((value) => value !== option),
                    )
                  }
                />{" "}
                {option}
              </label>
            );
          })}
        </div>
      );
    if (field.type === "DROPDOWN")
      return (
        <select
          value={String(answers[field.id] ?? "")}
          onChange={(event) => set(event.target.value)}
          required={field.required}
        >
          <option value="">Selecciona</option>
          {field.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    if (field.type === "CHECKBOX")
      return (
        <label className="public-form-check">
          <input
            type="checkbox"
            checked={answers[field.id] === true}
            onChange={(event) => set(event.target.checked)}
            required={field.required}
          />{" "}
          Confirmar
        </label>
      );
    if (["SCALE", "RATING"].includes(field.type))
      return (
        <div className="public-form-scale">
          {Array.from(
            { length: (field.maximum ?? 5) - (field.minimum ?? 1) + 1 },
            (_, index) => index + (field.minimum ?? 1),
          ).map((value) => (
            <label key={value}>
              <span>{field.type === "RATING" ? "★" : value}</span>
              <input
                type="radio"
                name={field.id}
                checked={answers[field.id] === value}
                onChange={() => set(value)}
                required={field.required}
              />
            </label>
          ))}
        </div>
      );
    const type =
      field.type === "EMAIL"
        ? "email"
        : field.type === "PHONE"
          ? "tel"
          : field.type === "URL"
            ? "url"
          : field.type === "DATE"
            ? "date"
            : field.type === "TIME"
              ? "time"
              : field.type === "NUMBER"
                ? "number"
                : "text";
    return (
      <input
        type={type}
        value={String(answers[field.id] ?? "")}
        min={field.minimum}
        max={field.maximum}
        onChange={(event) =>
          set(["NUMBER", "RATING"].includes(field.type) ? Number(event.target.value) : event.target.value)
        }
        required={field.required}
      />
    );
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const pendingImageFieldIds = Object.entries(images)
        .filter(([, files]) => files.length > 0)
        .map(([fieldId]) => fieldId);
      const response = await fetch(`/api/public-forms/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key.current },
        body: JSON.stringify({ answers, pendingImageFieldIds }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseTitle(response));
      const submitted = (await response.json()) as { data: { id: string } };
      for (const [fieldId, files] of Object.entries(images)) {
        for (const image of files) {
          const checksum = await sha256Base64(image);
          const intentResponse = await fetch(
            `/api/public-forms/${encodeURIComponent(slug)}/responses/${submitted.data.id}/image-upload-intents`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
              body: JSON.stringify({
                fieldId,
                originalName: image.name,
                declaredMime: image.type || "image/jpeg",
                declaredSize: image.size,
                expectedSha256: checksum,
              }),
            },
          );
          if (!intentResponse.ok) throw new Error(await responseTitle(intentResponse));
          const intent = (await intentResponse.json()) as UploadIntent;
          const uploadBody = new FormData();
          for (const [name, value] of Object.entries(intent.data.upload.fields)) uploadBody.append(name, value);
          uploadBody.append("qcrm-upload-url", intent.data.upload.url);
          uploadBody.append("file", image, image.name);
          const storage = await fetch("/api/public-forms/upload", { method: "POST", body: uploadBody });
          const storageBody = await storage.text();
          if (!storage.ok) throw new Error("El almacenamiento rechazo la imagen.");
          const versionId = uploadVersionId(storage, storageBody);
          const receipt = storage.headers.get("etag");
          const complete = await fetch(
            `/api/public-forms/${encodeURIComponent(slug)}/responses/${submitted.data.id}/files/${intent.data.file.id}/complete`,
            {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
              body: JSON.stringify({ checksum, ...(versionId ? { versionId } : {}), ...(receipt ? { receipt } : {}) }),
            },
          );
          if (!complete.ok) throw new Error(await responseTitle(complete));
          let available = false;
          for (let attempt = 0; attempt < 30; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 2_000));
            const status = await fetch(
              `/api/public-forms/${encodeURIComponent(slug)}/responses/${submitted.data.id}/files/${intent.data.file.id}`,
              { cache: "no-store" },
            );
            if (!status.ok) throw new Error(await responseTitle(status));
            const metadata = (await status.json()) as { data: { status: string } };
            if (metadata.data.status === "AVAILABLE") { available = true; break; }
            if (["REJECTED", "FAILED", "DELETED"].includes(metadata.data.status))
              throw new Error("La imagen no supero la validacion de seguridad.");
          }
          if (!available) throw new Error("La imagen sigue en validacion. Intenta nuevamente en un momento.");
          const attach = await fetch(
            `/api/public-forms/${encodeURIComponent(slug)}/responses/${submitted.data.id}/image-fields/${fieldId}/files/${intent.data.file.id}`,
            { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: "{}" },
          );
          if (!attach.ok) throw new Error(await responseTitle(attach));
        }
      }
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible enviar la respuesta.");
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="public-form-page">
        <p>Cargando formulario...</p>
      </main>
    );
  if (!form)
    return (
      <main className="public-form-page">
        <section className="public-form-message">
          <span>Q</span>
          <h1>Formulario no disponible</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  if (done)
    return (
      <main className="public-form-page" style={{ background: form.theme.backgroundColor }}>
        <section className="public-form-message">
          <span style={{ background: form.theme.accentColor }}>Q</span>
          <h1>Respuesta enviada</h1>
          <p>{form.theme.completionMessage}</p>
        </section>
      </main>
    );
  return (
    <main className="public-form-page" style={{ background: form.theme.backgroundColor }}>
      <form
        className="public-form-card"
        onSubmit={(event) => void submit(event)}
        style={{ borderTopColor: form.theme.accentColor }}
      >
        <header>
          <span style={{ background: form.theme.accentColor }}>Q</span>
          <p>FORMULARIO QUANTUM</p>
          {form.theme.heroImageUrl ? <img className="public-form-hero" src={form.theme.heroImageUrl} alt="Imagen de portada" /> : null}
          <h1>{form.title}</h1>
          <p>{form.description}</p>
          {form.theme.headerVideoUrl ? <a className="public-form-video" href={form.theme.headerVideoUrl} target="_blank" rel="noreferrer">Ver video de bienvenida ↗</a> : null}
        </header>
        {form.definition.sections.map((section, index) => (
          <section key={section.id}>
            <div className="public-form-section-title">
              <small>SECCION {index + 1}</small>
              <h2>{section.title}</h2>
              <p>{section.description}</p>
            </div>
            {section.fields
              .filter((item) => visible(item, answers))
              .map((item) => (
                <label className="public-form-field" key={item.id}>
                  <strong>
                    {item.label}
                    {item.required ? <em>*</em> : null}
                  </strong>
                  {item.description ? <small>{item.description}</small> : null}
                  {field(item)}
                </label>
              ))}
          </section>
        ))}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="public-form-submit"
          style={{ background: form.theme.accentColor }}
          disabled={saving}
        >
          {saving ? "Enviando..." : "Enviar respuesta"}
        </button>
      </form>
    </main>
  );
}
