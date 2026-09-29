import { parseGithubActionsReleasePublisherConfig, SecretValue } from "@quantum-crm/config";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createGithubActionsReleasePublisherVerifier,
  GithubActionsReleasePublisherVerificationError,
} from "./github-actions-release-publisher-verifier.js";

const now = new Date("2026-09-22T17:15:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);
const config = parseGithubActionsReleasePublisherConfig("admin-api", "staging", {
  QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE: "quantum-release-publisher",
  QCRM_GITHUB_ACTIONS_REPOSITORY: "yvalois/quantum-crm",
  QCRM_GITHUB_ACTIONS_REPOSITORY_ID: "1378875885",
  QCRM_GITHUB_ACTIONS_REPOSITORY_OWNER_ID: "90980150",
  QCRM_GITHUB_ACTIONS_REPOSITORY_VISIBILITY: "public",
});

let privateKey: CryptoKey;
let trustedJwk: JWK;

beforeAll(async () => {
  const trusted = await generateKeyPair("RS256");
  privateKey = trusted.privateKey;
  trustedJwk = {
    ...(await exportJWK(trusted.publicKey)),
    kid: "github-actions",
    alg: "RS256",
  };
});

function verifier() {
  return createGithubActionsReleasePublisherVerifier(config, {
    keyResolver: createLocalJWKSet({ keys: [trustedJwk] }),
    currentDate: () => now,
  });
}

async function token(
  input: Readonly<{
    readonly claims?: Readonly<Record<string, unknown>>;
    readonly subject?: string;
  }> = {},
): Promise<SecretValue> {
  const claims = {
    jti: "test-jti",
    repository: config.repository,
    repository_id: config.repositoryId,
    repository_owner_id: config.repositoryOwnerId,
    repository_visibility: config.repositoryVisibility,
    ref: config.ref,
    event_name: config.eventName,
    workflow_ref: config.workflowRef,
    sha: "a".repeat(40),
    run_id: "35759155797",
    run_attempt: "1",
    ...input.claims,
  };
  const jwt = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "github-actions", typ: "JWT" })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(input.subject ?? config.subject)
    .setIssuedAt(nowSeconds - 30)
    .setExpirationTime(nowSeconds + 120)
    .sign(privateKey);
  return new SecretValue(jwt);
}

describe("GitHub Actions release publisher verifier", () => {
  it("accepts only the exact workload identity", async () => {
    await expect(verifier().verify(await token())).resolves.toEqual({
      verification: "github-actions-release-publisher/v1",
      repository: "yvalois/quantum-crm",
      repositoryId: "1378875885",
      repositoryOwnerId: "90980150",
      workflowRef: "yvalois/quantum-crm/.github/workflows/release-candidate.yml@refs/heads/main",
      commitSha: "a".repeat(40),
      runId: "35759155797",
      runAttempt: "1",
      jti: "test-jti",
    });
  });

  it.each([
    ["repository", { repository: "attacker/quantum-crm" }],
    ["repository id", { repository_id: "1" }],
    ["owner id", { repository_owner_id: "1" }],
    [
      "visibility",
      { repository_visibility: config.repositoryVisibility === "public" ? "private" : "public" },
    ],
    ["pull request ref", { ref: "refs/pull/25/merge" }],
    ["event", { event_name: "pull_request" }],
    [
      "workflow",
      { workflow_ref: "yvalois/quantum-crm/.github/workflows/quality.yml@refs/heads/main" },
    ],
    ["commit", { sha: "not-a-sha" }],
  ])("rejects an invalid %s claim", async (_case, claims) => {
    const signed = await token({ claims });
    await expect(verifier().verify(signed)).rejects.toEqual(
      new GithubActionsReleasePublisherVerificationError(),
    );
  });

  it("rejects a subject outside main", async () => {
    await expect(
      verifier().verify(await token({ subject: "repo:yvalois/quantum-crm:pull_request" })),
    ).rejects.toEqual(new GithubActionsReleasePublisherVerificationError());
  });

  it("does not reveal a malformed bearer value", async () => {
    const secret = "github-actions-sensitive-token";
    try {
      await verifier().verify(new SecretValue(secret));
    } catch (error) {
      expect(error).toEqual(new GithubActionsReleasePublisherVerificationError());
      expect(String(error)).not.toContain(secret);
    }
  });
});
