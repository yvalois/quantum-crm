"use client";

import type {
  ActivationDeliveryResponse,
  PlatformOperatorSelf,
  TenantProfileContract,
  TenantProfileListResponse,
  TenantProfileResponse,
  PlatformReleaseContract,
} from "@quantum-crm/contracts";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { TenantProvisioningDialog } from "./tenant-provisioning-dialog";

type DialogMode = "create" | "edit" | null;

const statusLabels: Readonly<Record<TenantProfileContract["status"], string>> = {
  PENDING: "Pendiente",
  PROVISIONING: "Aprovisionando",
  ACTIVE: "Activo",
  SUSPENDED: "Suspendido",
  ERROR: "Con error",
};

interface Filters {
  readonly search: string;
  readonly status: string;
  readonly serverId: string;
  readonly releaseId: string;
}

interface DeliveredAdministratorAccess {
  readonly profileName: string;
  readonly adminEmail: string;
  readonly crmUrl: string;
  readonly activationUrl: string;
  readonly expiresAt: string;
}

const emptyFilters: Filters = {
  search: "",
  status: "",
  serverId: "",
  releaseId: "",
};

async function errorTitle(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { readonly title?: unknown };
    return typeof body.title === "string" ? body.title : "No fue posible completar la operación";
  } catch {
    return "No fue posible completar la operación";
  }
}

function shortId(value: string | null): string {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "Sin asignar";
}

export default function TenantProfilesPage() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(emptyFilters);
  const [profiles, setProfiles] = useState<readonly TenantProfileContract[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<readonly (string | null)[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [canActivate, setCanActivate] = useState(false);
  const [canDeploy, setCanDeploy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [selected, setSelected] = useState<TenantProfileContract | null>(null);
  const [selectedEtag, setSelectedEtag] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [administratorAccess, setAdministratorAccess] =
    useState<DeliveredAdministratorAccess | null>(null);
  const [accessCopyStatus, setAccessCopyStatus] = useState<string | null>(null);
  const [activationPending, setActivationPending] = useState<string | null>(null);
  const [promotionReleaseId, setPromotionReleaseId] = useState("");
  const [promotionPending, setPromotionPending] = useState<string | null>(null);
  const [releases, setReleases] = useState<readonly PlatformReleaseContract[]>([]);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  const [releasePending, setReleasePending] = useState<string | null>(null);
  const [provisioningProfile, setProvisioningProfile] = useState<TenantProfileContract | null>(
    null,
  );

  const query = useMemo(() => {
    const params = new URLSearchParams({ pageSize: "25" });
    if (appliedFilters.search) params.set("search", appliedFilters.search);
    if (appliedFilters.status) params.set("status", appliedFilters.status);
    if (appliedFilters.serverId) params.set("serverId", appliedFilters.serverId);
    if (appliedFilters.releaseId) params.set("releaseId", appliedFilters.releaseId);
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [appliedFilters, cursor]);

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/tenant-profiles?${query}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign(
          `/api/auth/login?returnTo=${encodeURIComponent("/dashboard/tenants")}`,
        );
        return;
      }
      if (!response.ok) throw new Error(await errorTitle(response));
      const body = (await response.json()) as TenantProfileListResponse;
      setProfiles(body.data);
      setNextCursor(body.meta.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La plataforma no está disponible");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadReleases = useCallback(async () => {
    if (!canDeploy) return;
    setReleasesLoading(true);
    setReleasesError(null);
    try {
      const response = await fetch("/api/platform/releases?status=CANDIDATE&pageSize=20", {
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign(
          `/api/auth/login?returnTo=${encodeURIComponent("/dashboard/tenants")}`,
        );
        return;
      }
      if (!response.ok) throw new Error(await errorTitle(response));
      const body = (await response.json()) as {
        readonly data: readonly PlatformReleaseContract[];
      };
      setReleases(body.data);
    } catch (cause) {
      setReleasesError(
        cause instanceof Error ? cause.message : "No fue posible consultar las releases",
      );
    } finally {
      setReleasesLoading(false);
    }
  }, [canDeploy]);

  useEffect(() => {
    void Promise.all([
      loadProfiles(),
      fetch("/api/platform/operators/me", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const operator = (await response.json()) as PlatformOperatorSelf;
          setCanManage(operator.data.permissions.includes("tenants:manage"));
          setCanActivate(operator.data.permissions.includes("deployments:activate"));
          setCanDeploy(operator.data.permissions.includes("deployments:execute"));
        })
        .catch(() => undefined),
    ]);
  }, [loadProfiles]);

  useEffect(() => {
    void loadReleases();
  }, [loadReleases]);

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setCursor(null);
    setCursorHistory([]);
    setAppliedFilters({
      search: filters.search.trim(),
      status: filters.status,
      serverId: filters.serverId.trim(),
      releaseId: filters.releaseId.trim(),
    });
  }

  function clearFilters(): void {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setCursor(null);
    setCursorHistory([]);
  }

  async function csrfToken(): Promise<string> {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) throw new Error("La sesión expiró. Ingresa nuevamente.");
    const body = (await response.json()) as { readonly csrfToken?: string };
    if (!body.csrfToken) throw new Error("La sesión no puede autorizar cambios.");
    return body.csrfToken;
  }

  function openCreate(): void {
    setSelected(null);
    setSelectedEtag(null);
    setFormError(null);
    setDialog("create");
  }

  async function openEdit(profile: TenantProfileContract): Promise<void> {
    setFormError(null);
    try {
      const response = await fetch(`/api/platform/tenant-profiles/${profile.id}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await errorTitle(response));
      const body = (await response.json()) as TenantProfileResponse;
      setSelected(body.data);
      setSelectedEtag(response.headers.get("etag"));
      setDialog("edit");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible abrir el perfil");
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const data = new FormData(event.currentTarget);
    const payload = {
      name: String(data.get("name") ?? ""),
      slug: String(data.get("slug") ?? ""),
      adminContactName: String(data.get("adminContactName") ?? ""),
      adminContactEmail: String(data.get("adminContactEmail") ?? ""),
    };
    try {
      const csrf = await csrfToken();
      const editing = dialog === "edit" && selected;
      const response = await fetch(
        editing ? `/api/platform/tenant-profiles/${selected.id}` : "/api/platform/tenant-profiles",
        {
          method: editing ? "PATCH" : "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf,
            ...(editing && selectedEtag ? { "if-match": selectedEtag } : {}),
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error(await errorTitle(response));
      const result = (await response.json()) as TenantProfileResponse;
      setDialog(null);
      setSelected(null);
      await loadProfiles();
      if (!editing && canDeploy) setProvisioningProfile(result.data);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "No fue posible guardar el perfil");
    } finally {
      setSaving(false);
    }
  }

  async function requestActivation(profile: TenantProfileContract): Promise<void> {
    setAdministratorAccess(null);
    setAccessCopyStatus(null);
    setActivationPending(profile.id);
    setError(null);
    try {
      const current = await fetch(`/api/platform/tenant-profiles/${profile.id}`, {
        cache: "no-store",
      });
      if (!current.ok) throw new Error(await errorTitle(current));
      const csrf = await csrfToken();
      const response = await fetch(
        `/api/platform/tenant-profiles/${profile.id}/activation-deliveries`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf,
            "if-match": current.headers.get("etag") ?? "",
            "idempotency-key": `activation-${crypto.randomUUID()}`,
          },
          body: "{}",
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error(await errorTitle(response));
      const result = (await response.json()) as ActivationDeliveryResponse;
      const hostnameParts = window.location.hostname.split(".");
      const sharedDomain = hostnameParts.length > 1 ? hostnameParts.slice(1).join(".") : "";
      const crmUrl = sharedDomain
        ? `${window.location.protocol}//${profile.slug}.${sharedDomain}`
        : `${window.location.protocol}//${window.location.host}`;
      setAdministratorAccess({
        profileName: profile.name,
        adminEmail: profile.adminContactEmail,
        crmUrl,
        activationUrl: result.data.url,
        expiresAt: result.data.expiresAt,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible emitir la activaciÃ³n");
    } finally {
      setActivationPending(null);
    }
  }

  async function copyAdministratorAccess(): Promise<void> {
    if (!administratorAccess) return;
    const text = [
      `Empresa: ${administratorAccess.profileName}`,
      `CRM: ${administratorAccess.crmUrl}`,
      `Usuario: ${administratorAccess.adminEmail}`,
      `Configurar o recuperar acceso: ${administratorAccess.activationUrl}`,
      `Vence: ${new Date(administratorAccess.expiresAt).toLocaleString("es-CO")}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setAccessCopyStatus("Datos de acceso copiados.");
    } catch {
      setAccessCopyStatus("No fue posible copiar automáticamente. Copia el enlace visible.");
    }
  }

  async function requestReleasePromotion(profile: TenantProfileContract): Promise<void> {
    const targetReleaseId = promotionReleaseId.trim().toLowerCase();
    if (!targetReleaseId) {
      setError("Indica el UUID de una release VALIDATED antes de promover.");
      return;
    }
    setPromotionPending(profile.id);
    setError(null);
    try {
      const current = await fetch(`/api/platform/tenant-profiles/${profile.id}`, {
        cache: "no-store",
      });
      if (!current.ok) throw new Error(await errorTitle(current));
      const csrf = await csrfToken();
      const response = await fetch(
        `/api/platform/tenant-profiles/${profile.id}/release-promotions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf,
            "if-match": current.headers.get("etag") ?? "",
            "idempotency-key": `release-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ targetReleaseId }),
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error(await errorTitle(response));
      setPromotionReleaseId("");
      await loadProfiles();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible crear la promoción");
    } finally {
      setPromotionPending(null);
    }
  }

  async function validateRelease(release: PlatformReleaseContract): Promise<void> {
    if (release.status !== "CANDIDATE") return;
    setReleasePending(release.id);
    setReleasesError(null);
    try {
      const csrf = await csrfToken();
      const response = await fetch(`/api/platform/releases/${release.id}/status`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf,
          "if-match": `"${release.version}"`,
        },
        body: JSON.stringify({ status: "VALIDATED" }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await errorTitle(response));
      const body = (await response.json()) as {
        readonly data: PlatformReleaseContract;
      };
      setReleases((current) =>
        current.map((candidate) => (candidate.id === body.data.id ? body.data : candidate)),
      );
      setPromotionReleaseId(body.data.id);
    } catch (cause) {
      setReleasesError(
        cause instanceof Error ? cause.message : "No fue posible validar la release",
      );
    } finally {
      setReleasePending(null);
    }
  }

  return (
    <main className="admin-content tenants-page">
      <section className="page-heading tenants-heading">
        <div>
          <p className="eyebrow">PLATAFORMA QUANTUM / PERFILES</p>
          <h1>Empresas bajo control</h1>
          <p>
            Identidad administrativa de cada cliente. Los contactos comerciales permanecen dentro de
            su CRM.
          </p>
        </div>
        {canManage ? (
          <button className="primary-action" type="button" onClick={openCreate}>
            <span aria-hidden="true">＋</span> Nuevo perfil
          </button>
        ) : null}
      </section>

      <form className="filter-deck" onSubmit={applyFilters} aria-label="Filtrar perfiles">
        <label className="search-field">
          <span>Buscar</span>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            placeholder="Empresa, slug o correo"
            maxLength={160}
          />
        </label>
        <label>
          <span>Estado</span>
          <select
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">Todos</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Servidor</span>
          <input
            value={filters.serverId}
            onChange={(event) => setFilters({ ...filters, serverId: event.target.value })}
            placeholder="UUID exacto"
          />
        </label>
        <label>
          <span>Release</span>
          <input
            value={filters.releaseId}
            onChange={(event) => setFilters({ ...filters, releaseId: event.target.value })}
            placeholder="UUID exacto"
          />
        </label>
        <div className="filter-actions">
          <button type="submit">Aplicar</button>
          <button type="button" onClick={clearFilters} className="quiet-button">
            Limpiar
          </button>
        </div>
      </form>

      {canDeploy ? (
        <section
          id="release-controls"
          className="release-panel"
          aria-live="polite"
          aria-busy={releasesLoading}
        >
          <div className="panel-header">
            <div>
              <span className="section-code">ENTREGA / 01</span>
              <h2>Release candidata</h2>
            </div>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void loadReleases()}
              disabled={releasesLoading}
            >
              {releasesLoading ? "Consultando..." : "Actualizar"}
            </button>
          </div>
          {releasesError ? (
            <div className="release-state state-error" role="alert">
              <strong>No pudimos consultar las releases</strong>
              <span>{releasesError}</span>
            </div>
          ) : releasesLoading && releases.length === 0 ? (
            <div className="release-state">Consultando candidatas...</div>
          ) : releases.length === 0 ? (
            <div className="release-state">
              No hay releases candidatas disponibles para validar.
            </div>
          ) : (
            <div className="release-list">
              {releases.map((release) => (
                <div className="release-row" key={release.id}>
                  <div>
                    <strong>{release.semanticVersion}</strong>
                    <small>
                      commit {release.commitSha.slice(0, 12)} · versión {release.version}
                    </small>
                  </div>
                  <span className={`status status-${release.status.toLowerCase()}`}>
                    {release.status}
                  </span>
                  {release.status === "CANDIDATE" ? (
                    <button
                      type="button"
                      className="primary-action"
                      disabled={releasePending !== null}
                      onClick={() => void validateRelease(release)}
                    >
                      {releasePending === release.id ? "Validando..." : "Validar release"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => setPromotionReleaseId(release.id)}
                    >
                      Usar para promoción
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="release-help">
            Valida la candidata aquí. Después queda seleccionada como destino en la promoción del
            perfil piloto.
          </p>
        </section>
      ) : null}

      <section className="tenant-panel" aria-live="polite" aria-busy={loading}>
        <div className="panel-header">
          <div>
            <span className="section-code">REGISTRO / 01</span>
            <h2>Perfiles de plataforma</h2>
          </div>
          <span className="result-count">
            {loading ? "CONSULTANDO" : `${profiles.length} EN VISTA`}
          </span>
        </div>
        {canDeploy ? (
          <div className="promotion-toolbar">
            <label>
              <span>Release VALIDATED destino</span>
              <input
                value={promotionReleaseId}
                onChange={(event) => setPromotionReleaseId(event.target.value)}
                placeholder="UUID de release"
                inputMode="text"
              />
            </label>
            <small>
              La operación ejecuta migración, reconciliación, verificación y activación con lock por
              perfil.
            </small>
          </div>
        ) : null}

        {loading ? (
          <div className="loading-grid" aria-label="Cargando perfiles">
            {[0, 1, 2].map((item) => (
              <span key={item} />
            ))}
          </div>
        ) : error ? (
          <div className="state-block state-error" role="alert">
            <span aria-hidden="true">!</span>
            <h3>No pudimos consultar los perfiles</h3>
            <p>{error}</p>
            <button type="button" onClick={() => void loadProfiles()}>
              Reintentar
            </button>
          </div>
        ) : profiles.length === 0 ? (
          <div className="state-block">
            <span aria-hidden="true">◇</span>
            <h3>No hay perfiles en esta vista</h3>
            <p>Ajusta los filtros o registra la primera empresa cuando tengas permiso.</p>
            {canManage ? (
              <button type="button" onClick={openCreate}>
                Crear primer perfil
              </button>
            ) : null}
          </div>
        ) : (
          <div className="tenant-table-wrap">
            <table className="tenant-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Estado</th>
                  <th>Contacto administrativo</th>
                  <th>Servidor</th>
                  <th>Release</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td>
                      <strong>{profile.name}</strong>
                      <code>{profile.slug}</code>
                    </td>
                    <td>
                      <span className={`status status-${profile.status.toLowerCase()}`}>
                        {statusLabels[profile.status]}
                      </span>
                    </td>
                    <td>
                      <span>{profile.adminContactName}</span>
                      <small>{profile.adminContactEmail}</small>
                    </td>
                    <td>
                      <code {...(profile.serverId ? { title: profile.serverId } : {})}>
                        {shortId(profile.serverId)}
                      </code>
                    </td>
                    <td>
                      <code {...(profile.releaseId ? { title: profile.releaseId } : {})}>
                        {shortId(profile.releaseId)}
                      </code>
                    </td>
                    <td>
                      {canManage || canActivate || canDeploy ? (
                        <div className="row-actions">
                          {canManage ? (
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => void openEdit(profile)}
                              aria-label={`Editar ${profile.name}`}
                            >
                              Editar
                            </button>
                          ) : null}
                          {canDeploy && profile.status === "PENDING" ? (
                            <button
                              className="row-action row-action-primary"
                              type="button"
                              onClick={() => setProvisioningProfile(profile)}
                            >
                              Aprovisionar
                            </button>
                          ) : null}
                          {canActivate && profile.status === "ACTIVE" ? (
                            <button
                              className="row-action"
                              type="button"
                              disabled={activationPending !== null}
                              onClick={() => void requestActivation(profile)}
                            >
                              {activationPending === profile.id ? "Emitiendo..." : "Generar acceso"}
                            </button>
                          ) : null}
                          {canDeploy && profile.status === "ACTIVE" ? (
                            <button
                              className="row-action"
                              type="button"
                              disabled={promotionPending !== null || !promotionReleaseId.trim()}
                              onClick={() => void requestReleasePromotion(profile)}
                            >
                              {promotionPending === profile.id
                                ? "Promoviendo..."
                                : "Promover release"}
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="read-only">Solo lectura</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && profiles.length > 0 ? (
          <div className="pagination-bar">
            <button
              type="button"
              disabled={cursorHistory.length === 0}
              onClick={() => {
                const previous = cursorHistory.at(-1) ?? null;
                setCursorHistory((history) => history.slice(0, -1));
                setCursor(previous);
              }}
            >
              ← Anterior
            </button>
            <span>Página {cursorHistory.length + 1}</span>
            <button
              type="button"
              disabled={!nextCursor}
              onClick={() => {
                setCursorHistory((history) => [...history, cursor]);
                setCursor(nextCursor);
              }}
            >
              Siguiente →
            </button>
          </div>
        ) : null}
      </section>

      {administratorAccess ? (
        <section className="state-block activation-link" aria-live="assertive">
          <span className="section-code">ACCESO / UN SOLO USO</span>
          <h2>Acceso de {administratorAccess.profileName} listo</h2>
          <p>
            Quantum entrega este enlace solamente en la sesión actual. Permite definir una nueva
            contraseña y configurar el autenticador sin usar la terminal.
          </p>
          <dl className="activation-access-data">
            <div>
              <dt>CRM</dt>
              <dd>
                <a href={administratorAccess.crmUrl} target="_blank" rel="noreferrer noopener">
                  {administratorAccess.crmUrl}
                </a>
              </dd>
            </div>
            <div>
              <dt>Usuario</dt>
              <dd>{administratorAccess.adminEmail}</dd>
            </div>
            <div>
              <dt>Vigencia</dt>
              <dd>{new Date(administratorAccess.expiresAt).toLocaleString("es-CO")}</dd>
            </div>
          </dl>
          <label className="activation-url-field">
            Enlace seguro
            <textarea value={administratorAccess.activationUrl} readOnly rows={3} />
          </label>
          <div className="activation-access-actions">
            <a
              className="primary-action"
              href={administratorAccess.activationUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Configurar acceso ahora
            </a>
            <button
              type="button"
              className="quiet-button"
              onClick={() => void copyAdministratorAccess()}
            >
              Copiar datos de acceso
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => {
                setAdministratorAccess(null);
                setAccessCopyStatus(null);
              }}
            >
              Ocultar
            </button>
          </div>
          {accessCopyStatus ? <small role="status">{accessCopyStatus}</small> : null}
        </section>
      ) : null}

      {dialog ? (
        <dialog className="profile-dialog" open aria-labelledby="profile-dialog-title">
          <form method="dialog" className="dialog-dismiss">
            <button type="submit" onClick={() => setDialog(null)} aria-label="Cerrar formulario">
              ×
            </button>
          </form>
          <div className="dialog-kicker">
            {dialog === "create" ? "NUEVO REGISTRO" : "EDICIÓN SEGURA"}
          </div>
          <h2 id="profile-dialog-title">
            {dialog === "create"
              ? "Crear perfil de empresa"
              : `Editar ${selected?.name ?? "perfil"}`}
          </h2>
          <p>Este perfil identifica a la empresa en Quantum; no crea contactos dentro de su CRM.</p>
          <form className="profile-form" onSubmit={(event) => void saveProfile(event)}>
            <label>
              <span>Nombre de la empresa</span>
              <input name="name" defaultValue={selected?.name ?? ""} required maxLength={160} />
            </label>
            <label>
              <span>Slug operativo</span>
              <input
                name="slug"
                defaultValue={selected?.slug ?? ""}
                required
                maxLength={63}
                pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
                aria-describedby="slug-help"
              />
              <small id="slug-help">
                Minúsculas, números y guiones. Se usa como referencia estable.
              </small>
            </label>
            <div className="form-split">
              <label>
                <span>Contacto administrativo</span>
                <input
                  name="adminContactName"
                  defaultValue={selected?.adminContactName ?? ""}
                  required
                  maxLength={160}
                />
              </label>
              <label>
                <span>Correo administrativo</span>
                <input
                  name="adminContactEmail"
                  type="email"
                  defaultValue={selected?.adminContactEmail ?? ""}
                  required
                  maxLength={320}
                />
              </label>
            </div>
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button type="button" className="quiet-button" onClick={() => setDialog(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary-action" disabled={saving}>
                {saving ? "Guardando…" : dialog === "create" ? "Crear perfil" : "Guardar cambios"}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}

      {provisioningProfile ? (
        <TenantProvisioningDialog
          profile={provisioningProfile}
          onClose={() => setProvisioningProfile(null)}
          onUpdated={(updated) => {
            setProfiles((current) =>
              current.map((profile) => (profile.id === updated.id ? updated : profile)),
            );
            setProvisioningProfile(updated);
          }}
        />
      ) : null}
    </main>
  );
}
