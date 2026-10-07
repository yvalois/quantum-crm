import type { ProfileOperatorCallback } from "./profile-operator-executor.js";
import type { AdminApiActivationDeliveryCallbackOptions } from "./admin-api-activation-delivery-callback.js";

export function createAdminApiProfileOperatorCallback(
  options: AdminApiActivationDeliveryCallbackOptions,
): ProfileOperatorCallback {
  const origin = new URL(options.origin);
  if (
    origin.protocol !== "http:" ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password
  ) {
    throw new Error("invalid profile operator callback origin");
  }
  if (options.token.length < 32 || options.token.length > 512) {
    throw new Error("invalid profile operator callback token");
  }
  return Object.freeze({
    deliver: async (input: Parameters<ProfileOperatorCallback["deliver"]>[0]) => {
      const response = await fetch(new URL("/api/v1/internal/profile-operators/callback", origin), {
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
      });
      if (response.status !== 202) return Object.freeze({ accepted: false });
      const body: unknown = await response.json();
      return Object.freeze({
        accepted:
          typeof body === "object" &&
          body !== null &&
          (body as { readonly accepted?: unknown }).accepted === true,
      });
    },
  });
}
