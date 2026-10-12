import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";
import { loadSecretFile, SecretValue, type SecretFileSystem } from "./secret-value.js";

export const ycloudApiKeyEnvironmentKey = "QCRM_YCLOUD_API_KEY_FILE" as const;

export function parseYCloudApiKeyConfig(
  serviceName: string,
  environment: QcrmEnvironment,
  path: string | undefined,
  fileSystem?: SecretFileSystem,
): SecretValue | undefined {
  if (!path) return undefined;
  try {
    const key = loadSecretFile("YCloud API key", path, {
      environment,
      expectedProtectedPath: "/run/secrets/qcrm_ycloud_api_key",
      ...(fileSystem ? { fileSystem } : {}),
      maxBytes: 256,
    });
    z.string()
      .regex(/^[a-f0-9]{32}$/u)
      .parse(key.expose());
    return key;
  } catch {
    throw new ConfigurationError(serviceName, [ycloudApiKeyEnvironmentKey]);
  }
}
