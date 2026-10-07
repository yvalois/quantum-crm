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
      setError(
        cause instanceof Error
          ? cause.message
          : "No fue posible preparar el acceso del administrador",
      );
    } finally {
      setIssuingAccess(false);
    }
  }

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
          <div className="provision-result" role="status">
            <div>
              <strong>Asignación automática</strong>
              <p>
                Quantum elegirá una versión validada, un servidor disponible y los recursos
                necesarios para este CRM. No necesitas configurar infraestructura.
              </p>
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
          <button type="button" className="quiet-button" onClick={() => void refreshProfile()}>
            Actualizar estado
          </button>
          {currentProfile.status === "PROVISIONING" && canActivate ? (
            <button
              type="button"
              className="primary-action"
              onClick={() => void requestAdministratorAccess()}
              disabled={issuingAccess}
            >
              {issuingAccess ? "Preparando acceso..." : "Configurar administrador"}
            </button>
          ) : (
            <button
              type="button"
              className="primary-action"
              onClick={onClose}
              disabled={!completed && !failed}
            >
              {completed ? "Finalizar" : failed ? "Cerrar" : "Esperando activación"}
            </button>
          )}
        </div>
      ) : null}
    </dialog>
  );
}
