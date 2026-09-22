import { describe, expect, it } from "vitest";

import { ConfigurationError } from "./configuration-error.js";
import { parseGithubActionsReleasePublisherConfig } from "./github-actions-release-publisher-config.js";

const environment = {
  QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE: "quantum-release-publisher",
  QCRM_GITHUB_ACTIONS_REPOSITORY: "yvalois/quantum-crm",
  QCRM_GITHUB_ACTIONS_REPOSITORY_ID: "1378875885",
  QCRM_GITHUB_ACTIONS_REPOSITORY_OWNER_ID: "90980150",
};

describe("GitHub Actions release publisher configuration", () => {
  it("derives an exact immutable workload policy", () => {
    expect(
      parseGithubActionsReleasePublisherConfig("admin-api", "staging", environment),
    ).toMatchObject({
      issuer: "https://token.actions.githubusercontent.com",
      jwksUrl: "http://github-actions-oidc:8081/.well-known/jwks",
      audience: "quantum-release-publisher",
      repository: "yvalois/quantum-crm",
      repositoryId: "1378875885",
      repositoryOwnerId: "90980150",
      ref: "refs/heads/main",
      workflowRef: "yvalois/quantum-crm/.github/workflows/release-candidate.yml@refs/heads/main",
      subject: "repo:yvalois/quantum-crm:ref:refs/heads/main",
      eventName: "workflow_run",
      repositoryVisibility: "private",
    });
  });

  it("uses synthetic defaults only in local and test", () => {
    expect(parseGithubActionsReleasePublisherConfig("admin-api", "test", {})).toMatchObject({
      repository: "example/quantum-crm",
      repositoryId: "1",
    });
    expect(() => parseGithubActionsReleasePublisherConfig("admin-api", "staging", {})).toThrow(
      new ConfigurationError("admin-api", [
        "QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE",
        "QCRM_GITHUB_ACTIONS_REPOSITORY",
        "QCRM_GITHUB_ACTIONS_REPOSITORY_ID",
        "QCRM_GITHUB_ACTIONS_REPOSITORY_OWNER_ID",
      ]),
    );
  });

  it.each([
    ["repository", { ...environment, QCRM_GITHUB_ACTIONS_REPOSITORY: "other repository" }],
    ["repository identifier", { ...environment, QCRM_GITHUB_ACTIONS_REPOSITORY_ID: "0" }],
    ["owner identifier", { ...environment, QCRM_GITHUB_ACTIONS_REPOSITORY_OWNER_ID: "x" }],
    ["audience", { ...environment, QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE: "invalid value" }],
  ])("rejects an invalid %s", (_case, invalid) => {
    expect(() => parseGithubActionsReleasePublisherConfig("admin-api", "staging", invalid)).toThrow(
      ConfigurationError,
    );
  });
});
