import { z } from "zod";

const qcrmEnvironmentSchema = z.enum(["local", "test", "preview", "staging", "production"]);
const allowedKeys = new Set(["QCRM_ENV", "QCRM_HOST", "QCRM_PORT", "QCRM_SHUTDOWN_TIMEOUT_MS"]);
const safeDefaultEnvironments = new Set<QcrmEnvironment>(["local", "test"]);
const placeholderPattern = /^(?:change[_-]?me|example|placeholder|todo)$/i;

export type QcrmEnvironment = z.infer<typeof qcrmEnvironmentSchema>;

export const processDefinitions = Object.freeze({
  api: Object.freeze({ serviceName: "api", defaultHost: "0.0.0.0", defaultPort: 3001 }),
  "admin-api": Object.freeze({
    serviceName: "admin-api",
    defaultHost: "0.0.0.0",
    defaultPort: 3002,
  }),
  worker: Object.freeze({
    serviceName: "worker",
    defaultHost: "127.0.0.1",
    defaultPort: 3101,
  }),
  "deploy-executor": Object.freeze({
    serviceName: "deploy-executor",
    defaultHost: "127.0.0.1",
    defaultPort: 3102,
  }),
  "agent-runtime": Object.freeze({
    serviceName: "agent-runtime",
    defaultHost: "127.0.0.1",
    defaultPort: 3103,
  }),
});

export type ProcessName = keyof typeof processDefinitions;

export interface ProcessDefinition {
  readonly serviceName: string;
  readonly defaultHost: string;
  readonly defaultPort: number;
}

export interface ProcessConfig {
  readonly schemaVersion: "process-config/v1";
  readonly serviceName: string;
  readonly environment: QcrmEnvironment;
  readonly host: string;
  readonly port: number;
  readonly shutdownTimeoutMs: number;
}

export class ConfigurationError extends Error {
  public constructor(serviceName: string, invalidKeys: readonly string[]) {
    super(`Invalid configuration for ${serviceName}: ${invalidKeys.join(", ")}`);
    this.name = "ConfigurationError";
  }
}

function readEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}

export function loadProcessConfig(definition: ProcessDefinition): ProcessConfig {
  return parseProcessConfig(definition, readEnvironment());
}

export function loadServiceConfig(serviceName: ProcessName): ProcessConfig {
  return parseServiceConfig(serviceName, readEnvironment());
}

export function parseServiceConfig(
  serviceName: ProcessName,
  environment: Readonly<Record<string, string | undefined>>,
): ProcessConfig {
  return parseProcessConfig(processDefinitions[serviceName], environment);
}

export function parseProcessConfig(
  definition: ProcessDefinition,
  environment: Readonly<Record<string, string | undefined>>,
): ProcessConfig {
  const unknownKeys = Object.keys(environment)
    .filter((key) => key.startsWith("QCRM_") && !allowedKeys.has(key))
    .sort();

  if (unknownKeys.length > 0) {
    throw new ConfigurationError(definition.serviceName, unknownKeys);
  }

  const parsedEnvironment = qcrmEnvironmentSchema.safeParse(environment.QCRM_ENV ?? "local");
  if (!parsedEnvironment.success) {
    throw new ConfigurationError(definition.serviceName, ["QCRM_ENV"]);
  }

  const allowSafeDefaults = safeDefaultEnvironments.has(parsedEnvironment.data);
  const hostSchema = z
    .string()
    .trim()
    .min(1)
    .refine((value) => !placeholderPattern.test(value));

  const schema = z.object({
    QCRM_ENV: qcrmEnvironmentSchema,
    QCRM_HOST: hostSchema,
    QCRM_PORT: z.coerce.number().int().min(1).max(65_535),
    QCRM_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  });
  const result = schema.safeParse({
    ...environment,
    QCRM_ENV: parsedEnvironment.data,
    QCRM_HOST: environment.QCRM_HOST ?? (allowSafeDefaults ? definition.defaultHost : undefined),
    QCRM_PORT: environment.QCRM_PORT ?? (allowSafeDefaults ? definition.defaultPort : undefined),
  });

  if (!result.success) {
    const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
      .filter((key) => key !== "undefined")
      .sort();
    throw new ConfigurationError(definition.serviceName, invalidKeys);
  }

  return Object.freeze({
    schemaVersion: "process-config/v1",
    serviceName: definition.serviceName,
    environment: result.data.QCRM_ENV,
    host: result.data.QCRM_HOST,
    port: result.data.QCRM_PORT,
    shutdownTimeoutMs: result.data.QCRM_SHUTDOWN_TIMEOUT_MS,
  });
}
