import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";
import { loadSecretFile, type SecretFileSystem, type SecretValue } from "./secret-value.js";

export const agentGatewaySecretEnvironmentKey = "QCRM_AGENT_GATEWAY_SECRET_FILE" as const;
export const agentRuntimeSecretEnvironmentKey = "QCRM_AGENT_RUNTIME_SECRET_FILE" as const;
export const openAiApiKeyEnvironmentKey = "QCRM_OPENAI_API_KEY_FILE" as const;

function optionalSecret(
  serviceName: string,
  environment: QcrmEnvironment,
  name: string,
  path: string | undefined,
  expectedPath: string,
  pattern: RegExp,
  fileSystem?: SecretFileSystem,
): SecretValue | undefined {
  if (!path) return undefined;
  try {
    const value = loadSecretFile(name, path, {
      environment,
      expectedProtectedPath: expectedPath,
      maxBytes: 512,
      ...(fileSystem ? { fileSystem } : {}),
    });
    z.string().regex(pattern).parse(value.expose());
    return value;
  } catch {
    throw new ConfigurationError(serviceName, [name]);
  }
}

export function parseAgentGatewaySecret(
  serviceName: string,
  environment: QcrmEnvironment,
  path: string | undefined,
  fileSystem?: SecretFileSystem,
): SecretValue | undefined {
  return optionalSecret(
    serviceName,
    environment,
    agentGatewaySecretEnvironmentKey,
    path,
    "/run/secrets/qcrm_agent_gateway_client_secret",
    /^[A-Za-z0-9_-]{20,256}$/u,
    fileSystem,
  );
}

export function parseAgentRuntimeSecret(
  serviceName: string,
  environment: QcrmEnvironment,
  path: string | undefined,
  fileSystem?: SecretFileSystem,
): SecretValue | undefined {
  return optionalSecret(
    serviceName,
    environment,
    agentRuntimeSecretEnvironmentKey,
    path,
    "/run/secrets/qcrm_agent_runtime_client_secret",
    /^[A-Za-z0-9_-]{20,256}$/u,
    fileSystem,
  );
}

export function parseOpenAiApiKey(
  serviceName: string,
  environment: QcrmEnvironment,
  path: string | undefined,
  fileSystem?: SecretFileSystem,
): SecretValue | undefined {
  return optionalSecret(
    serviceName,
    environment,
    openAiApiKeyEnvironmentKey,
    path,
    "/run/secrets/qcrm_openai_api_key",
    /^sk-[A-Za-z0-9_-]{20,500}$/u,
    fileSystem,
  );
}
