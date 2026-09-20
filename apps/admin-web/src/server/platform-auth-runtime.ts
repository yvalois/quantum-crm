import {
  createRedisPlatformSessionStore,
  KeycloakPlatformOidcProvider,
  PlatformWebAuthService,
} from "@quantum-crm/auth";
import { loadAdminWebAuthConfig } from "@quantum-crm/config";

import type { PlatformAuthRuntime } from "./platform-auth-http.js";

let runtimePromise: Promise<PlatformAuthRuntime> | undefined;

async function createRuntime(): Promise<PlatformAuthRuntime> {
  const config = loadAdminWebAuthConfig();
  const { store } = await createRedisPlatformSessionStore(config);
  const provider = new KeycloakPlatformOidcProvider(config);
  return Object.freeze({
    config,
    auth: new PlatformWebAuthService(config, store, provider),
  });
}

export function getPlatformAuthRuntime(): Promise<PlatformAuthRuntime> {
  runtimePromise ??= createRuntime().catch((error: unknown) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}

export async function withPlatformAuthRuntime(
  handler: (runtime: PlatformAuthRuntime) => Promise<Response>,
): Promise<Response> {
  try {
    return await handler(await getPlatformAuthRuntime());
  } catch {
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
}
