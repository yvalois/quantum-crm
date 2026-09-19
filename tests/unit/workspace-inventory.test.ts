import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

const applications = [
  "crm-web",
  "portal-web",
  "admin-web",
  "api",
  "worker",
  "agent-runtime",
  "admin-api",
  "deploy-executor",
] as const;

const packages = [
  "domain",
  "platform-domain",
  "contracts",
  "database",
  "auth",
  "ui",
  "config",
  "observability",
  "testing",
] as const;

function readPackageName(group: "apps" | "packages", name: string): string {
  const manifestPath = join(root, group, name, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown };

  if (typeof manifest.name !== "string") {
    throw new TypeError(`Missing package name in ${manifestPath}`);
  }

  return manifest.name;
}

describe("workspace inventory", () => {
  it("declares the eight approved applications", () => {
    expect(applications.map((name) => readPackageName("apps", name))).toEqual(
      applications.map((name) => `@quantum-crm/${name}`),
    );
  });

  it("declares the nine approved packages", () => {
    expect(packages.map((name) => readPackageName("packages", name))).toEqual(
      packages.map((name) => `@quantum-crm/${name}`),
    );
  });
});
