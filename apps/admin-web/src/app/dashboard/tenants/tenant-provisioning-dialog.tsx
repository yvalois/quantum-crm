"use client";

import type {
  ProvisioningOperationContract,
  ProvisioningOperationResponse,
  TenantProfileContract,
  TenantProfileResponse,
} from "@quantum-crm/contracts";
import { useCallback, useEffect, useState, type FormEvent } from "react";

interface TenantProvisioningDialogProps {
  readonly profile: TenantProfileContract;
  readonly canActivate: boolean;
  readonly onClose: () => void;
  readonly onUpdated: (profile: TenantProfileContract) => void;
  readonly onRequestAdministratorAccess: (profile: TenantProfileContract) => Promise<void>;
}

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
  VERIFY: "Esperando activación del administrador",
  ACTIVATE: "Activando la empresa",
};

const stepOrder = Object.keys(
  stepLabels,
) as readonly ProvisioningOperationContract["currentStep"][];

function progressFor(operation: ProvisioningOperationContract): number {
  if (operation.status === "SUCCEEDED") return 100;
  const index = stepOrder.indexOf(operation.currentStep);
  return Math.max(4, Math.round(((index + 0.35) / stepOrder.length) * 100));
}

function estimateFor(operation: ProvisioningOperationContract): string {
  if (operation.status === "FAILED") return "Detenido: requiere atención";
  if (operation.status === "CANCELLED") return "Operación cancelada";
  if (operation.status === "SUCCEEDED") return "Completado";
  if (operation.currentStep === "VERIFY") {
    return "Esperando que el administrador configure su acceso; sin tiempo automático";
  }
  const remaining = Math.max(1, stepOrder.length - stepOrder.indexOf(operation.currentStep) - 1);
  const seconds = remaining * 30;
  return seconds < 60
    ? `Aproximadamente ${seconds} segundos`
    : `Aproximadamente ${Math.ceil(seconds / 60)} minutos`;
}

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

export function TenantProvisioningDialog({
  profile,
  canActivate,
  onClose,
  onUpdated,
  onRequestAdministratorAccess,
}: TenantProvisioningDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<ProvisioningOperationContract | null>(null);
  const [currentProfile, setCurrentProfile] = useState(profile);
  const [issuingAccess, setIssuingAccess] = useState(false);

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

  const refreshOperation = useCallback(async () => {
    const response = await fetch(
      `/api/platform/tenant-profiles/${profile.id}/provisioning-operations/latest`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(await errorTitle(response));
    const body = (await response.json()) as ProvisioningOperationResponse;
    setOperation(body.data);
    return body.data;
  }, [profile.id]);

  useEffect(() => {
    if (profile.status !== "PROVISIONING") return;
    void Promise.all([refreshOperation(), refreshProfile()]).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "No fue posible consultar la operación");
    });
  }, [profile.status, refreshOperation, refreshProfile]);

  useEffect(() => {
    if (!operation || !["PENDING", "RUNNING"].includes(operation.status)) return;
    const interval = window.setInterval(() => {
      void Promise.all([refreshOperation(), refreshProfile()]).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "No fue posible actualizar el estado");
      });
    }, 2000);
    return () => window.clearInterval(interval);
  }, [operation, refreshOperation, refreshProfile]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const profileResponse = await fetch(`/api/platform/tenant-profiles/${profile.id}`, {
        cache: "no-store",
      });
      if (!profileResponse.ok) throw new Error(await errorTitle(profileResponse));
      const token = await csrfToken();
      const response = await fetch(
        `/api/platform/tenant-profiles/${profile.id}/provisioning-operations/automatic`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": token,
            "if-match": profileResponse.headers.get("etag") ?? "",
            "idempotency-key": `provision-${crypto.randomUUID()}`,
          },
          body: "{}",
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

  async function requestAdministratorAccess(): Promise<void> {
    setIssuingAccess(true);
    setError(null);
    try {
      await onRequestAdministratorAccess(currentProfile);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible preparar el acceso");
    } finally {
      setIssuingAccess(false);
    }
  }

  const completed = currentProfile.status === "ACTIVE" || operation?.status === "SUCCEEDED";
  const failed = currentProfile.status === "ERROR" || operation?.status === "FAILED";

  return (
    <dialog className="profile-dialog provisioning-dialog" open aria-labelledby="provision-title">
      <form method="dialog" className="dialog-dismiss">
        <button type="submit" onClick={onClose} aria-label="Cerrar aprovisionamiento">
          ×
        </button>
      </form>
      <div className="dialog-kicker">ALTA OPERATIVA / {profile.slug.toUpperCase()}</div>
      <h2 id="provision-title">Aprovisionar {profile.name}</h2>
      <p>Quantum preparará base de datos, archivos, identidad, servicios y HTTPS.</p>

      {completed ? (
        <div className="provision-result provision-success" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Perfil activo</strong>
            <p>La empresa ya está operativa.</p>
          </div>
        </div>
      ) : failed ? (
        <div className="provision-result provision-failed" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <strong>El aprovisionamiento requiere atención</strong>
            <p>{operation?.failureCode ?? "El detalle quedó registrado para recuperación."}</p>
          </div>
        </div>
      ) : operation ? (
        <div className="operation-progress-panel" role="status" aria-live="polite">
          <div className="provision-progress">
            <div className="provision-pulse" aria-hidden="true" />
            <div>
              <span>Aprovisionamiento en curso</span>
              <strong>{stepLabels[operation.currentStep]}</strong>
              <small>
                Operación {operation.id.slice(0, 8)} · intento {operation.attempt}
              </small>
            </div>
          </div>
          <div className="operation-meter" aria-label={`Progreso ${progressFor(operation)}%`}>
            <span style={{ width: `${progressFor(operation)}%` }} />
          </div>
          <div className="operation-summary">
            <strong>{progressFor(operation)}%</strong>
            <span>{estimateFor(operation)}</span>
            <small>Actualizado {new Date(operation.updatedAt).toLocaleTimeString("es-CO")}</small>
          </div>
          <ol className="operation-log" aria-label="Registro de pasos del aprovisionamiento">
            {stepOrder.map((step, index) => {
              const currentIndex = stepOrder.indexOf(operation.currentStep);
              const state =
                index < currentIndex
                  ? "Completado"
                  : index === currentIndex
                    ? operation.status === "FAILED"
                      ? "Falló"
                      : "En curso"
                    : "Pendiente";
              return (
                <li key={step} data-state={state}>
                  <span>{stepLabels[step]}</span>
                  <small>{state}</small>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <form className="profile-form" onSubmit={(event) => void submit(event)}>
          <div className="provision-result" role="status">
            <div>
              <strong>Asignación automática</strong>
              <p>Quantum elegirá versión, servidor y recursos.</p>
            </div>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button type="button" className="quiet-button" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="primary-action" disabled={submitting}>
              {submitting ? "Iniciando…" : "Aprovisionar perfil"}
            </button>
          </div>
        </form>
      )}

      {error && (operation || completed || failed) ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {operation || completed || failed ? (
        <div className="dialog-actions">
          <button
            type="button"
            className="quiet-button"
            onClick={() => void Promise.all([refreshOperation(), refreshProfile()])}
          >
            Actualizar estado
          </button>
          {currentProfile.status === "PROVISIONING" && canActivate ? (
            <button
              type="button"
              className="primary-action"
              onClick={() => void requestAdministratorAccess()}
              disabled={issuingAccess}
            >
              {issuingAccess ? "Preparando acceso…" : "Configurar administrador"}
            </button>
          ) : (
            <button
              type="button"
              className="primary-action"
              onClick={onClose}
              disabled={!completed && !failed}
            >
              {completed ? "Finalizar" : failed ? "Cerrar" : "Esperando"}
            </button>
          )}
        </div>
      ) : null}
    </dialog>
  );
}
