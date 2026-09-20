import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), "utf8");

function serviceNames(compose: string): string[] {
  const services = compose.split("\nservices:\n")[1]?.split("\nnetworks:\n")[0] ?? "";
  return [...services.matchAll(/^  ([a-z][a-z0-9-]+):$/gm)].map((match) => match[1] ?? "");
}

describe("container manifests", () => {
  it("pins the toolchain and runs both runtime images without root", () => {
    for (const dockerfile of ["infra/docker/Dockerfile.web", "infra/docker/Dockerfile.node"]) {
      const source = read(dockerfile);

      expect(source).toContain("node:24.21.0-bookworm-slim@sha256:");
      expect(source).toContain("pnpm@9.13.2");
      expect(source).toContain("USER node");
      expect(source).not.toContain(":latest");
    }
  });

  it("builds workspace dependencies before each application image", () => {
    expect(read("infra/docker/Dockerfile.web")).toContain(
      'pnpm --filter "@quantum-crm/${APP}..." build',
    );
    expect(read("infra/docker/Dockerfile.node")).toContain(
      'pnpm --filter "@quantum-crm/${APP}..." build',
    );
  });

  it("keeps secrets, dependencies and build outputs outside the context", () => {
    const ignore = read(".dockerignore");

    for (const entry of [".git", ".env", "**/node_modules", "**/dist", "**/.next", "secrets"]) {
      expect(ignore).toContain(entry);
    }
  });

  it("declares the eight local processes and limits published ports to loopback", () => {
    const compose = read("infra/compose/local.yaml");

    expect(serviceNames(compose).sort()).toEqual(
      [
        "admin-api",
        "admin-web",
        "agent-runtime",
        "api",
        "crm-web",
        "deploy-executor",
        "portal-web",
        "worker",
      ].sort(),
    );
    expect(compose.match(/^      - 127\.0\.0\.1:/gm)).toHaveLength(8);
    expect(compose).not.toMatch(/^      - 0\.0\.0\.0:/m);
  });

  it("uses digest references and no direct host ports in deployment templates", () => {
    for (const path of ["infra/compose/platform.yaml", "infra/compose/tenant.yaml"]) {
      const compose = read(path);

      expect(compose).toContain("@sha256:${QCRM_");
      expect(compose).not.toMatch(/:\s*latest\b/);
      expect(compose).not.toMatch(/^    ports:/m);
      expect(compose).toContain("read_only: true");
      expect(compose).toContain("no-new-privileges:true");
      expect(compose).toContain("cap_drop:");
    }
  });
});
