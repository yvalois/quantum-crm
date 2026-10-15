import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";
import { loadSecretFile, SecretValue, type SecretFileSystem } from "./secret-value.js";

export const ycloudBindingEnvironmentKey = "QCRM_YCLOUD_BINDING_FILE" as const;

export interface YCloudBindingConfig {
  readonly wabaId: string;
  readonly businessPhone: string;
  readonly signingSecret: SecretValue;
  readonly advisorRouting?: "interamerican-v54";
}

const bindingSchema = z
  .object({
    wabaId: z.string().regex(/^[0-9]{5,30}$/u),
    businessPhone: z.string().regex(/^[0-9]{8,20}$/u),
    signingSecret: z.string().min(24).max(512),
    advisorRouting: z.literal("interamerican-v54").optional(),
  })
  .strict();

export function parseYCloudBindingConfig(
  serviceName: string,
  environment: QcrmEnvironment,
  path: string | undefined,
  fileSystem?: SecretFileSystem,
): YCloudBindingConfig | undefined {
  if (!path) return undefined;
  try {
    const content = loadSecretFile("YCloud binding", path, {
      environment,
      expectedProtectedPath: "/run/secrets/qcrm_ycloud_binding",
      ...(fileSystem ? { fileSystem } : {}),
      maxBytes: 2_048,
    }).expose();
    const parsed = bindingSchema.parse(JSON.parse(content));
    return Object.freeze({
      wabaId: parsed.wabaId,
      businessPhone: parsed.businessPhone,
      signingSecret: new SecretValue(parsed.signingSecret),
      ...(parsed.advisorRouting ? { advisorRouting: parsed.advisorRouting } : {}),
    });
  } catch {
    throw new ConfigurationError(serviceName, [ycloudBindingEnvironmentKey]);
  }
}
