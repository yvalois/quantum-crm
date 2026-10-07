"use client";

import type {
  DecommissioningOperationContract,
  DecommissioningOperationResponse,
  TenantProfileContract,
  TenantProfileResponse,
} from "@quantum-crm/contracts";
import { useCallback, useEffect, useState } from "react";

interface TenantDecommissioningDialogProps {
  readonly profile: TenantProfileContract;
  readonly onClose: () => void;
  readonly onFinished: () => Promise<void>;
}

const stepLabels: Readonly<Record<DecommissioningOperationContract["currentStep"], string>> = {
  VALIDATE: "Validando el perfil",
  STOP_CONTAINERS: "Deteniendo servicios",
  REMOVE_HTTPS: "Retirando acceso HTTPS",
  REMOVE_IDENTITY: "Retirando identidad",
  REMOVE_CONFIGURATION: "Retirando configuración",
  REMOVE_STORAGE: "Retirando archivos",
  REMOVE_DATABASE: "Retirando base de datos",
  RELEASE_CAPACITY: "Liberando capacidad",
  TOMBSTONE: "Finalizando eliminación",
};

const stepOrder = Object.keys(
  stepLabels,
) as readonly DecommissioningOperationContract["currentStep"][];

function progressFor(operation: DecommissioningOperationContract): number {
  if (operation.status === "SUCCEEDED") return 100;
  const index = stepOrder.indexOf(operation.currentStep);
  return Math.max(5, Math.round(((index + 0.35) / stepOrder.length) * 100));
}

function estimateFor(operation: DecommissioningOperationContract): string {
  if (operation.status === "FAILED") return "Detenida: puedes reintentar desde este mismo panel";
  if (operation.status === "SUCCEEDED") return "Eliminación completada";
  const remaining = Math.max(1, stepOrder.length - stepOrder.indexOf(operation.currentStep) - 1);
  const seconds = remaining * 15;
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

export function TenantDecommissioningDialog({
  profile,
  onClose,
  onFinished,
}: TenantDecommissioningDialogProps) {
  const [operation, setOperation] = useState<DecommissioningOperationContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/platform/tenant-profiles/${profile.id}/decommissioning-operations/latest`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(await errorTitle(response));
    const body = (await response.json()) as DecommissioningOperationResponse;
    setOperation(body.data);
    if (body.data.status === "SUCCEEDED") await onFinished();
    return body.data;
  }, [onFinished, profile.id]);

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "No fue posible consultar la eliminación");
    });
  }, [refresh]);

  useEffect(() => {
    if (!operation || !["PENDING", "RUNNING"].includes(operation.status)) return;
    const interval = window.setInterval(() => {
      void refresh().catch((cause: unknown) => {
        setError(
          cause instanceof Error ? cause.message : "No fue posible actualizar la eliminación",
        );
      });
    }, 2000);
    return () => window.clearInterval(interval);
  }, [operation, refresh]);

  async function retry(): Promise<void> {
    setRetrying(true);
    setError(null);
    try {
      const current = await fetch(`/api/platform/tenant-profiles/${profile.id}`, {
        cache: "no-store",
      });
      if (!current.ok) throw new Error(await errorTitle(current));
      const currentBody = (await current.json()) as TenantProfileResponse;
      const token = await csrfToken();
      const response = await fetch(
        `/api/platform/tenant-profiles/${profile.id}/decommissioning-operations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": token,
            "if-match": current.headers.get("etag") ?? "",
            "idempotency-key": `decommission-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ confirmationSlug: currentBody.data.slug }),
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error(await errorTitle(response));
      const body = (await response.json()) as DecommissioningOperationResponse;
      setOperation(body.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No fue posible reintentar la eliminación");
    } finally {
      setRetrying(false);
    }
  }

  const progress = operation ? progressFor(operation) : 0;

  return (
    <dialog
      className="profile-dialog provisioning-dialog"
      open
      aria-labelledby="decommission-title"
    >
      <form method="dialog" className="dialog-dismiss">
        <button type="submit" onClick={onClose} aria-label="Cerrar eliminación">
          ×
        </button>
      </form>
      <div className="dialog-kicker">ELIMINACIÓN / {profile.slug.toUpperCase()}</div>
      <h2 id="decommission-title">Eliminar {profile.name}</h2>
      <p>
        El proceso retira los recursos del perfil de forma ordenada y conserva su registro técnico.
      </p>

      {operation ? (
        <div className="operation-progress-panel" role="status" aria-live="polite">
          <div
            className={`provision-progress ${operation.status === "FAILED" ? "provision-failed" : ""}`}
          >
            <div className="provision-pulse" aria-hidden="true" />
            <div>
              <span>
                {operation.status === "FAILED"
                  ? "Eliminación detenida"
                  : operation.status === "SUCCEEDED"
                    ? "Eliminación completada"
                    : "Eliminación en curso"}
              </span>
              <strong>{stepLabels[operation.currentStep]}</strong>
              <small>
                Operación {operation.id.slice(0, 8)} · intento {operation.attempt}
              </small>
            </div>
          </div>
          <div className="operation-meter" aria-label={`Progreso ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="operation-summary">
            <strong>{progress}%</strong>
            <span>{estimateFor(operation)}</span>
            <small>Actualizado {new Date(operation.updatedAt).toLocaleTimeString("es-CO")}</small>
          </div>
          <ol className="operation-log" aria-label="Registro de pasos de eliminación">
            {stepOrder.map((step, index) => {
              const currentIndex = stepOrder.indexOf(operation.currentStep);
              const state =
                index < currentIndex
                  ? "Completado"
                  : index === currentIndex
                    ? operation.status === "FAILED"
                      ? "Falló"
                      : operation.status === "SUCCEEDED"
                        ? "Completado"
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
          {operation.failureCode ? (
            <p className="form-error" role="alert">
              Código: {operation.failureCode}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="loading-grid" aria-label="Consultando eliminación">
          <span />
          <span />
          <span />
        </div>
      )}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="quiet-button" onClick={() => void refresh()}>
          Actualizar estado
        </button>
        {operation?.status === "FAILED" ? (
          <button
            type="button"
            className="primary-action"
            onClick={() => void retry()}
            disabled={retrying}
          >
            {retrying ? "Reintentando…" : "Reintentar eliminación"}
          </button>
        ) : (
          <button
            type="button"
            className="primary-action"
            onClick={onClose}
            disabled={operation?.status !== "SUCCEEDED"}
          >
            {operation?.status === "SUCCEEDED" ? "Cerrar" : "Eliminando…"}
          </button>
        )}
      </div>
    </dialog>
  );
}
