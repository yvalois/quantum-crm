"use client";

import type {
  InfrastructureServerContract,
  PlatformReleaseContract,
  ProvisioningOperationContract,
  ProvisioningOperationResponse,
  TenantProfileContract,
  TenantProfileResponse,
} from "@quantum-crm/contracts";
import { useCallback, useEffect, useState, type FormEvent } from "react";

interface TenantProvisioningDialogProps {
  readonly profile: TenantProfileContract;
  readonly onClose: () => void;
  readonly onUpdated: (profile: TenantProfileContract) => void;
}

const defaultCapacity = Object.freeze({
  cpuMillicores: 500,
  memoryMiB: 1024,
  storageMiB: 10240,
});

const stepLabels: Readonly<Record<ProvisioningOperationContract["currentStep"], string>> = {
  VALIDATE: "Validando requisitos",
  CREATE_DATABASE: "Creando base de datos",
  CREATE_SECRETS: "Preparando credenciales",
  CREATE_STORAGE: "Preparando archivos",
  WRITE_CONFIGURATION: "Escribiendo configuración",
  MIGRATE_DATABASE: "Aplicando migraciones",
  START_CONTAINERS: "Iniciando servicios",
  CONFIGURE_HTTPS: "Configurando acceso HTTPS",
  CREATE_ADMINISTRATOR: "Creando administrador",
  VERIFY: "Verificando el perfil",
  ACTIVATE: "Activando la empresa",
};

async function errorTitle(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { readonly title?: unknown };
    return typeof body.title === "string" ? body.title : "No fue posible completar la operación";
  } catch {
    return "No fue posible completar la operación";
  }
}

async function csrfToken(): Promise<string> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (!response.ok) throw new Error("La sesión expiró. Ingresa nuevamente.");
  const body = (await response.json()) as { readonly csrfToken?: string };
  if (!body.csrfToken) throw new Error("La sesión no puede autorizar cambios.");
  return body.csrfToken;
}

function capacityLabel(value: number, unit: "cpu" | "memory" | "storage"): string {
  if (unit === "cpu") return `${value} mCPU`;
  if (unit === "memory") return value >= 1024 ? `${value / 1024} GiB` : `${value} MiB`;
  return `${Math.round((value / 1024) * 10) / 10} GiB`;
}

export function TenantProvisioningDialog({
  profile,
  onClose,
  onUpdated,
}: TenantProvisioningDialogProps) {
  const [servers, setServers] = useState<readonly InfrastructureServerContract[]>([]);
  const [releases, setReleases] = useState<readonly PlatformReleaseContract[]>([]);
  const [serverId, setServerId] = useState("");
  const [releaseId, setReleaseId] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<ProvisioningOperationContract | null>(null);
  const [currentProfile, setCurrentProfile] = useState(profile);

  const refreshProfile = useCallback(async () => {
    const response = await fetch(`/api/platform/tenant-profiles/${profile.id}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await errorTitle(response));
    const body = (await response.json()) as TenantProfileResponse;
    setCurrentProfile(body.data);
    onUpdated(body.data);
    return body.data;
  }, [onUpdated, profile.id]);

  useEffect(() => {
    let active = true;
    async function loadOptions(): Promise<void> {
      setLoadingOptions(true);
      setError(null);
      try {
        const [serversResponse, releasesResponse] = await Promise.all([
          fetch("/api/platform/infrastructure-servers?status=AVAILABLE&pageSize=25", {
            cache: "no-store",
          }),
          fetch("/api/platform/releases?status=VALIDATED&pageSize=25", { cache: "no-store" }),
        ]);
        if (!serversResponse.ok) throw new Error(await errorTitle(serversResponse));
        if (!releasesResponse.ok) throw new Error(await errorTitle(releasesResponse));
        const serversBody = (await serversResponse.json()) as {
          readonly data: readonly InfrastructureServerContract[];
        };
        const releasesBody = (await releasesResponse.json()) as {
          readonly data: readonly PlatformReleaseContract[];
        };
        if (!active) return;
        setServers(serversBody.data);
        setReleases(releasesBody.data);
        setServerId(serversBody.data[0]?.id ?? "");
        setReleaseId(releasesBody.data[0]?.id ?? "");
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "No fue posible preparar el alta");
        }
      } finally {
        if (active) setLoadingOptions(false);
      }
    }
    void loadOptions();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!operation || currentProfile.status !== "PROVISIONING") return;
    const interval = window.setInterval(() => {
      void refreshProfile().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "No fue posible actualizar el estado");
      });
    }, 4000);
    return () => window.clearInterval(interval);
  }, [currentProfile.status, operation, refreshProfile]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const profileResponse = await fetch(`/api/platform/tenant-profiles/${profile.id}`, {
        cache: "no-store",
      });
      if (!profileResponse.ok) throw new Error(await errorTitle(profileResponse));
      const token = await csrfToken();
      const response = await fetch(
        `/api/platform/tenant-profiles/${profile.id}/provisioning-operations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": token,
            "if-match": profileResponse.headers.get("etag") ?? "",
            "idempotency-key": `provision-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({
            serverId,
            releaseId,
            requestedCapacity: {
              cpuMillicores: Number(data.get("cpuMillicores")),
              memoryMiB: Number(data.get("memoryMiB")),
              storageMiB: Number(data.get("storageMiB")),
            },
          }),
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error(await errorTitle(response));
      const body = (await response.json()) as ProvisioningOperationResponse;
      setOperation(body.data);
      await refreshProfile();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No fue posible iniciar el aprovisionamiento",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const selectedServer = servers.find((server) => server.id === serverId);
  const completed = currentProfile.status === "ACTIVE";
  const failed = currentProfile.status === "ERROR";

  return (
    <dialog className="profile-dialog provisioning-dialog" open aria-labelledby="provision-title">
      <form method="dialog" className="dialog-dismiss">
        <button type="submit" onClick={onClose} aria-label="Cerrar aprovisionamiento">
          ×
        </button>
      </form>
      <div className="dialog-kicker">ALTA OPERATIVA / {profile.slug.toUpperCase()}</div>
      <h2 id="provision-title">Aprovisionar {profile.name}</h2>
      <p>
        Quantum reservará capacidad y preparará base de datos, archivos, identidad, servicios y
        HTTPS para esta empresa.
      </p>

      {completed ? (
        <div className="provision-result provision-success" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Perfil activo</strong>
            <p>La empresa ya está operativa. Puedes cerrar y emitir el acceso del administrador.</p>
          </div>
        </div>
      ) : failed ? (
        <div className="provision-result provision-failed" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <strong>El aprovisionamiento requiere atención</strong>
            <p>El estado durable quedó registrado como error para su recuperación segura.</p>
          </div>
        </div>
      ) : operation ? (
        <div className="provision-progress" role="status" aria-live="polite">
          <div className="provision-pulse" aria-hidden="true" />
          <div>
            <span>Aprovisionamiento en curso</span>
            <strong>{stepLabels[operation.currentStep]}</strong>
            <small>
              Operación {operation.id.slice(0, 8)} · intento {operation.attempt + 1}
            </small>
          </div>
        </div>
      ) : (
        <form className="profile-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Servidor disponible</span>
            <select
              value={serverId}
              onChange={(event) => setServerId(event.target.value)}
              required
              disabled={loadingOptions}
            >
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.displayName} · {server.region}
                </option>
              ))}
            </select>
            {selectedServer ? (
              <small>
                Libre: {capacityLabel(selectedServer.availableCapacity.cpuMillicores, "cpu")} ·{" "}
                {capacityLabel(selectedServer.availableCapacity.memoryMiB, "memory")} RAM ·{" "}
                {capacityLabel(selectedServer.availableCapacity.storageMiB, "storage")} disco
              </small>
            ) : null}
          </label>
          <label>
            <span>Release validada</span>
            <select
              value={releaseId}
              onChange={(event) => setReleaseId(event.target.value)}
              required
              disabled={loadingOptions}
            >
              {releases.map((release) => (
                <option key={release.id} value={release.id}>
                  {release.semanticVersion} · {release.commitSha.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="capacity-fields">
            <legend>Reserva inicial</legend>
            <label>
              <span>CPU (mCPU)</span>
              <input
                name="cpuMillicores"
                type="number"
                min="100"
                step="100"
                defaultValue={defaultCapacity.cpuMillicores}
                required
              />
            </label>
            <label>
              <span>Memoria (MiB)</span>
              <input
                name="memoryMiB"
                type="number"
                min="512"
                step="256"
                defaultValue={defaultCapacity.memoryMiB}
                required
              />
            </label>
            <label>
              <span>Disco (MiB)</span>
              <input
                name="storageMiB"
                type="number"
                min="5120"
                step="1024"
                defaultValue={defaultCapacity.storageMiB}
                required
              />
            </label>
          </fieldset>
          {!loadingOptions && servers.length === 0 ? (
            <p className="form-error" role="alert">
              No hay servidores disponibles.
            </p>
          ) : null}
          {!loadingOptions && releases.length === 0 ? (
            <p className="form-error" role="alert">
              No hay releases validadas para desplegar.
            </p>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="primary-action"
              disabled={submitting || loadingOptions || !serverId || !releaseId}
            >
              {submitting ? "Iniciando…" : "Aprovisionar perfil"}
            </button>
          </div>
        </form>
      )}

      {operation || completed || failed ? (
        <div className="dialog-actions">
          <button type="button" className="quiet-button" onClick={() => void refreshProfile()}>
            Actualizar estado
          </button>
          <button
            type="button"
            className="primary-action"
            onClick={onClose}
            disabled={!completed && !failed}
          >
            {completed ? "Finalizar" : failed ? "Cerrar" : "Esperando activación"}
          </button>
        </div>
      ) : null}
    </dialog>
  );
}
