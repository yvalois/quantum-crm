import { z } from "zod";

const qcrmEnvironmentSchema = z.enum(["local", "test", "preview", "staging", "production"]);
const allowedKeys = new Set(["QCRM_ENV", "QCRM_HOST", "QCRM_PORT", "QCRM_SHUTDOWN_TIMEOUT_MS"]);

export interface ProcessDefinition {
  readonly serviceName: string;
  readonly defaultHost: string;
  readonly defaultPort: number;
}

export interface ProcessConfig {
  readonly serviceName: string;
  readonly environment: z.infer<typeof qcrmEnvironmentSchema>;
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

  const schema = z.object({
    QCRM_ENV: qcrmEnvironmentSchema.default("local"),
    QCRM_HOST: z.string().min(1).default(definition.defaultHost),
    QCRM_PORT: z.coerce.number().int().min(1).max(65_535).default(definition.defaultPort),
    QCRM_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(10_000),
  });
  const result = schema.safeParse(environment);

  if (!result.success) {
    const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))]
      .filter((key) => key !== "undefined")
      .sort();
    throw new ConfigurationError(definition.serviceName, invalidKeys);
  }

  return {
    serviceName: definition.serviceName,
    environment: result.data.QCRM_ENV,
    host: result.data.QCRM_HOST,
    port: result.data.QCRM_PORT,
    shutdownTimeoutMs: result.data.QCRM_SHUTDOWN_TIMEOUT_MS,
  };
}
