import type { ActivationDeliveryCallback } from "./activation-delivery-executor.js";

export interface AdminApiActivationDeliveryCallbackOptions {
  readonly origin: string;
  readonly principal: "deploy-executor";
  readonly audience: "quantum-admin-api-activation-callback";
  readonly token: string;
}

/** Fixed private callback; the caller never controls host, path or audience. */
export function createAdminApiActivationDeliveryCallback(
  options: AdminApiActivationDeliveryCallbackOptions,
): ActivationDeliveryCallback {
  const origin = new URL(options.origin);
  if (
    origin.protocol !== "http:" ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password
  ) {
    throw new Error("invalid activation callback origin");
  }
  if (options.token.length < 32 || options.token.length > 512) {
    throw new Error("invalid activation callback token");
  }
  return Object.freeze({
    deliver: async (input) => {
      const response = await fetch(
        new URL("/api/v1/internal/activation-deliveries/callback", origin),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
            "x-qcrm-internal-principal": options.principal,
            "x-qcrm-internal-audience": options.audience,
          },
          body: JSON.stringify(input),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (response.status !== 202) return Object.freeze({ accepted: false });
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        typeof (body as { readonly accepted?: unknown }).accepted !== "boolean"
      ) {
        return Object.freeze({ accepted: false });
      }
      return Object.freeze({ accepted: (body as { readonly accepted: boolean }).accepted });
    },
  });
}
