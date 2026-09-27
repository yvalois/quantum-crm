import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";
import {
  loadSecretFile,
  SecretFileError,
  type SecretFileSystem,
  type SecretValue,
} from "./secret-value.js";

const callbackTokenPath = "/run/secrets/qcrm_activation_callback_token";

export const activationDeliveryCallbackEnvironmentKeys = Object.freeze([
  "QCRM_ACTIVATION_CALLBACK_ORIGIN",
  "QCRM_ACTIVATION_CALLBACK_PRINCIPAL",
  "QCRM_ACTIVATION_CALLBACK_AUDIENCE",
  "QCRM_ACTIVATION_CALLBACK_TOKEN_FILE",
] as const);

export interface ActivationDeliveryCallbackConfig {
  readonly schemaVersion: "activation-delivery-callback-config/v1";
  readonly origin: string;
  readonly principal: "deploy-executor";
  readonly audience: "quantum-admin-api-activation-callback";
  readonly token: SecretValue;
}

function exactHttpOrigin(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? "");
    if (
      url.protocol !== "http:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function parseActivationDeliveryCallbackConfig(
  serviceName: string,
  environmentName: QcrmEnvironment,
  environment: Readonly<Record<string, string | undefined>>,
  fileSystem?: SecretFileSystem,
): ActivationDeliveryCallbackConfig {
  const origin = exactHttpOrigin(environment.QCRM_ACTIVATION_CALLBACK_ORIGIN);
  if (!origin) throw new ConfigurationError(serviceName, ["QCRM_ACTIVATION_CALLBACK_ORIGIN"]);
  if (environment.QCRM_ACTIVATION_CALLBACK_PRINCIPAL !== "deploy-executor") {
    throw new ConfigurationError(serviceName, ["QCRM_ACTIVATION_CALLBACK_PRINCIPAL"]);
  }
  if (environment.QCRM_ACTIVATION_CALLBACK_AUDIENCE !== "quantum-admin-api-activation-callback") {
    throw new ConfigurationError(serviceName, ["QCRM_ACTIVATION_CALLBACK_AUDIENCE"]);
  }
  const tokenFile = z
    .string()
    .trim()
    .min(1)
    .safeParse(environment.QCRM_ACTIVATION_CALLBACK_TOKEN_FILE);
  if (!tokenFile.success) {
    throw new ConfigurationError(serviceName, ["QCRM_ACTIVATION_CALLBACK_TOKEN_FILE"]);
  }
  try {
    const token = loadSecretFile("activation callback token", tokenFile.data, {
      environment: environmentName,
      expectedProtectedPath: callbackTokenPath,
      ...(fileSystem ? { fileSystem } : {}),
    });
    if (token.expose().length < 32 || token.expose().length > 512) {
      throw new Error("invalid callback token");
    }
    return Object.freeze({
      schemaVersion: "activation-delivery-callback-config/v1",
      origin,
      principal: "deploy-executor",
      audience: "quantum-admin-api-activation-callback",
      token,
    });
  } catch (error) {
    if (error instanceof SecretFileError || error instanceof Error) {
      throw new ConfigurationError(serviceName, ["QCRM_ACTIVATION_CALLBACK_TOKEN_FILE"]);
    }
    throw error;
  }
}
