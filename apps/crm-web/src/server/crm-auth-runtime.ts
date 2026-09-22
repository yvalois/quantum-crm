import {
  createRedisPlatformSessionStore,
  KeycloakOidcProvider,
  WebAuthService,
} from "@quantum-crm/auth";
import { loadCrmWebAuthConfig } from "@quantum-crm/config";

import type { CrmAuthRuntime } from "./crm-auth-http.js";

let runtimePromise: Promise<CrmAuthRuntime> | undefined;

async function createRuntime(): Promise<CrmAuthRuntime> {
  const config = loadCrmWebAuthConfig();
  const { store } = await createRedisPlatformSessionStore(config);
  return Object.freeze({
    config,
    auth: new WebAuthService(config, store, new KeycloakOidcProvider(config)),
    crmApiFetch: fetch,
  });
}

export function getCrmAuthRuntime(): Promise<CrmAuthRuntime> {
  runtimePromise ??= createRuntime().catch((error: unknown) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

export async function withCrmAuthRuntime(
  handler: (runtime: CrmAuthRuntime) => Promise<Response>,
): Promise<Response> {
  try {
    return await handler(await getCrmAuthRuntime());
  } catch {
    return crmUnavailable();
  }
}

function crmUnavailable(): Response {
  return Response.json(
    {
      type: "about:blank",
      title: "Authentication temporarily unavailable",
      status: 503,
    },
    {
      status: 503,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "application/problem+json",
      },
    },
  );
}
