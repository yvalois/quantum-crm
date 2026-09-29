import { z } from "zod";

import { ConfigurationError } from "./configuration-error.js";
import type { QcrmEnvironment } from "./process-config.js";

export const githubActionsReleasePublisherEnvironmentKeys = Object.freeze([
  "QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE",
  "QCRM_GITHUB_ACTIONS_REPOSITORY",
  "QCRM_GITHUB_ACTIONS_REPOSITORY_ID",
  "QCRM_GITHUB_ACTIONS_REPOSITORY_OWNER_ID",
  "QCRM_GITHUB_ACTIONS_REPOSITORY_VISIBILITY",
] as const);

const githubActionsIssuer = "https://token.actions.githubusercontent.com";
const githubActionsJwksUrl = "http://github-actions-oidc:8081/.well-known/jwks";
const releaseCandidateWorkflow = ".github/workflows/release-candidate.yml";
const releaseCandidateRef = "refs/heads/main";
const releaseCandidateEvent = "workflow_run";
const repositoryVisibilitySchema = z.enum(["private", "public"]);

export interface GithubActionsReleasePublisherConfig {
  readonly schemaVersion: "github-actions-release-publisher-config/v1";
  readonly issuer: typeof githubActionsIssuer;
  readonly jwksUrl: typeof githubActionsJwksUrl;
  readonly audience: string;
  readonly repository: string;
  readonly repositoryId: string;
  readonly repositoryOwnerId: string;
  readonly ref: typeof releaseCandidateRef;
  readonly workflowRef: string;
  readonly subject: string;
  readonly eventName: typeof releaseCandidateEvent;
  readonly repositoryVisibility: z.infer<typeof repositoryVisibilitySchema>;
  readonly allowedAlgorithms: readonly ["RS256"];
  readonly clockToleranceSeconds: number;
  readonly jwksTimeoutMs: number;
  readonly jwksCooldownMs: number;
  readonly jwksCacheMaxAgeMs: number;
}

const repositorySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{0,38}\/[a-z0-9][a-z0-9_.-]{0,99}$/u);
const identifierSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{0,19}$/u);
const audienceSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);

function valuesFor(environment: QcrmEnvironment): Readonly<Record<string, string>> {
  if (environment !== "local" && environment !== "test") return {};

  return {
    QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE: "quantum-release-publisher",
    QCRM_GITHUB_ACTIONS_REPOSITORY: "example/quantum-crm",
    QCRM_GITHUB_ACTIONS_REPOSITORY_ID: "1",
    QCRM_GITHUB_ACTIONS_REPOSITORY_OWNER_ID: "1",
    QCRM_GITHUB_ACTIONS_REPOSITORY_VISIBILITY: "private",
  };
}

export function parseGithubActionsReleasePublisherConfig(
  serviceName: string,
  environmentName: QcrmEnvironment,
  environment: Readonly<Record<string, string | undefined>>,
): GithubActionsReleasePublisherConfig {
  const defaults = valuesFor(environmentName);
  const audience = audienceSchema.safeParse(
    environment.QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE ?? defaults.QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE,
  );
  const repository = repositorySchema.safeParse(
    environment.QCRM_GITHUB_ACTIONS_REPOSITORY ?? defaults.QCRM_GITHUB_ACTIONS_REPOSITORY,
  );
  const repositoryId = identifierSchema.safeParse(
    environment.QCRM_GITHUB_ACTIONS_REPOSITORY_ID ?? defaults.QCRM_GITHUB_ACTIONS_REPOSITORY_ID,
  );
  const repositoryOwnerId = identifierSchema.safeParse(
    environment.QCRM_GITHUB_ACTIONS_REPOSITORY_OWNER_ID ??
      defaults.QCRM_GITHUB_ACTIONS_REPOSITORY_OWNER_ID,
  );
  const repositoryVisibility = repositoryVisibilitySchema.safeParse(
    environment.QCRM_GITHUB_ACTIONS_REPOSITORY_VISIBILITY ??
      defaults.QCRM_GITHUB_ACTIONS_REPOSITORY_VISIBILITY,
  );
  const invalidKeys = [
    ...(audience.success ? [] : ["QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE"]),
    ...(repository.success ? [] : ["QCRM_GITHUB_ACTIONS_REPOSITORY"]),
    ...(repositoryId.success ? [] : ["QCRM_GITHUB_ACTIONS_REPOSITORY_ID"]),
    ...(repositoryOwnerId.success ? [] : ["QCRM_GITHUB_ACTIONS_REPOSITORY_OWNER_ID"]),
    ...(repositoryVisibility.success ? [] : ["QCRM_GITHUB_ACTIONS_REPOSITORY_VISIBILITY"]),
  ];
  if (invalidKeys.length > 0) throw new ConfigurationError(serviceName, invalidKeys);
  if (
    !audience.success ||
    !repository.success ||
    !repositoryId.success ||
    !repositoryOwnerId.success ||
    !repositoryVisibility.success
  ) {
    throw new ConfigurationError(serviceName, invalidKeys);
  }

  const repositorySeparator = repository.data.indexOf("/");
  const repositoryOwner = repository.data.slice(0, repositorySeparator);
  const repositoryName = repository.data.slice(repositorySeparator + 1);
  const workflowRef = `${repository.data}/${releaseCandidateWorkflow}@${releaseCandidateRef}`;
  return Object.freeze({
    schemaVersion: "github-actions-release-publisher-config/v1",
    issuer: githubActionsIssuer,
    jwksUrl: githubActionsJwksUrl,
    audience: audience.data,
    repository: repository.data,
    repositoryId: repositoryId.data,
    repositoryOwnerId: repositoryOwnerId.data,
    ref: releaseCandidateRef,
    workflowRef,
    subject:
      `repo:${repositoryOwner}@${repositoryOwnerId.data}/` +
      `${repositoryName}@${repositoryId.data}:ref:${releaseCandidateRef}`,
    eventName: releaseCandidateEvent,
    repositoryVisibility: repositoryVisibility.data,
    allowedAlgorithms: Object.freeze(["RS256"] as const),
    clockToleranceSeconds: 5,
    jwksTimeoutMs: 5_000,
    jwksCooldownMs: 30_000,
    jwksCacheMaxAgeMs: 600_000,
  });
}
