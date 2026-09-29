import type { GithubActionsReleasePublisherConfig, SecretValue } from "@quantum-crm/config";
import {
  createRemoteJWKSet,
  jwtVerify,
  type CryptoKey,
  type FlattenedJWSInput,
  type JWSHeaderParameters,
} from "jose";

type JwksResolver = (
  protectedHeader?: JWSHeaderParameters,
  token?: FlattenedJWSInput,
) => Promise<CryptoKey>;

export interface VerifiedGithubActionsReleasePublisher {
  readonly verification: "github-actions-release-publisher/v1";
  readonly repository: string;
  readonly repositoryId: string;
  readonly repositoryOwnerId: string;
  readonly workflowRef: string;
  readonly commitSha: string;
  readonly runId: string;
  readonly runAttempt: string;
  readonly jti: string;
}

export interface GithubActionsReleasePublisherVerifier {
  verify(token: SecretValue): Promise<VerifiedGithubActionsReleasePublisher>;
}

export interface GithubActionsReleasePublisherVerifierOptions {
  readonly keyResolver?: JwksResolver;
  readonly currentDate?: () => Date;
}

export class GithubActionsReleasePublisherVerificationError extends Error {
  public constructor() {
    super("GitHub Actions release publisher token verification failed");
    this.name = "GithubActionsReleasePublisherVerificationError";
  }
}

function requiredString(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new GithubActionsReleasePublisherVerificationError();
  }
  return value;
}

const opaqueClaimPattern = /^[A-Za-z0-9._:-]{1,255}$/u;
const shaPattern = /^[0-9a-f]{40}$/u;
const workflowRefPattern = new RegExp(
  [
    "^",
    "[a-z0-9][a-z0-9_.-]{0,38}/",
    "[a-z0-9][a-z0-9_.-]{0,99}/",
    "\\.github/workflows/release-candidate\\.yml@refs/heads/main$",
  ].join(""),
  "u",
);

export function createGithubActionsReleasePublisherVerifier(
  config: GithubActionsReleasePublisherConfig,
  options: GithubActionsReleasePublisherVerifierOptions = {},
): GithubActionsReleasePublisherVerifier {
  const keyResolver =
    options.keyResolver ??
    createRemoteJWKSet(new URL(config.jwksUrl), {
      timeoutDuration: config.jwksTimeoutMs,
      cooldownDuration: config.jwksCooldownMs,
      cacheMaxAge: config.jwksCacheMaxAgeMs,
    });

  return Object.freeze({
    verify: async (token: SecretValue): Promise<VerifiedGithubActionsReleasePublisher> => {
      try {
        const compactToken = token.expose();
        if (compactToken.length < 1 || compactToken.length > 16_384 || /\s/u.test(compactToken)) {
          throw new GithubActionsReleasePublisherVerificationError();
        }

        const { payload, protectedHeader } = await jwtVerify(compactToken, keyResolver, {
          algorithms: [...config.allowedAlgorithms],
          issuer: config.issuer,
          audience: config.audience,
          requiredClaims: [
            "sub",
            "iat",
            "exp",
            "jti",
            "repository",
            "repository_id",
            "repository_owner_id",
            "repository_visibility",
            "ref",
            "event_name",
            "workflow_ref",
            "sha",
            "run_id",
            "run_attempt",
          ],
          clockTolerance: config.clockToleranceSeconds,
          ...(options.currentDate ? { currentDate: options.currentDate() } : {}),
        });

        const subject = requiredString(
          payload.sub,
          /^repo:[a-z0-9][a-z0-9_.-]{0,38}@[1-9][0-9]{0,19}\/[a-z0-9][a-z0-9_.-]{0,99}@[1-9][0-9]{0,19}:ref:refs\/heads\/main$/u,
        );
        const repository = requiredString(
          payload.repository,
          /^[a-z0-9][a-z0-9_.-]{0,38}\/[a-z0-9][a-z0-9_.-]{0,99}$/u,
        ).toLowerCase();
        const repositoryId = requiredString(payload.repository_id, /^[1-9][0-9]{0,19}$/u);
        const repositoryOwnerId = requiredString(
          payload.repository_owner_id,
          /^[1-9][0-9]{0,19}$/u,
        );
        const visibility = requiredString(payload.repository_visibility, /^(?:private|public)$/u);
        const ref = requiredString(payload.ref, /^refs\/heads\/main$/u);
        const eventName = requiredString(payload.event_name, /^workflow_run$/u);
        const workflowRef = requiredString(payload.workflow_ref, workflowRefPattern).toLowerCase();
        const commitSha = requiredString(payload.sha, shaPattern);
        const runId = requiredString(payload.run_id, opaqueClaimPattern);
        const runAttempt = requiredString(payload.run_attempt, opaqueClaimPattern);
        const jti = requiredString(payload.jti, opaqueClaimPattern);

        if (
          protectedHeader.alg !== "RS256" ||
          typeof protectedHeader.kid !== "string" ||
          protectedHeader.kid.length < 1 ||
          protectedHeader.kid.length > 128 ||
          protectedHeader.jku !== undefined ||
          protectedHeader.jwk !== undefined ||
          protectedHeader.x5u !== undefined ||
          protectedHeader.x5c !== undefined ||
          subject !== config.subject ||
          repository !== config.repository ||
          repositoryId !== config.repositoryId ||
          repositoryOwnerId !== config.repositoryOwnerId ||
          visibility !== config.repositoryVisibility ||
          ref !== config.ref ||
          eventName !== config.eventName ||
          workflowRef !== config.workflowRef ||
          !shaPattern.test(commitSha)
        ) {
          throw new GithubActionsReleasePublisherVerificationError();
        }

        return Object.freeze({
          verification: "github-actions-release-publisher/v1",
          repository,
          repositoryId,
          repositoryOwnerId,
          workflowRef,
          commitSha,
          runId,
          runAttempt,
          jti,
        });
      } catch {
        throw new GithubActionsReleasePublisherVerificationError();
      }
    },
  });
}
