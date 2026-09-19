import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceRoots = [join(root, "apps"), join(root, "packages")];

function collectTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "dist" || entry.name === "node_modules"
        ? []
        : collectTypeScriptFiles(path);
    }

    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

function importsFrom(source: string): string[] {
  const matches = source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g);
  return [...matches]
    .map((match) => match[2])
    .filter((value): value is string => value !== undefined);
}

describe("architectural import boundaries", () => {
  it("blocks infrastructure imports from domain and direct database access from web apps", () => {
    const violations: string[] = [];

    for (const file of sourceRoots.flatMap(collectTypeScriptFiles)) {
      const path = relative(root, file).replaceAll("\\", "/");
      const imports = importsFrom(readFileSync(file, "utf8"));

      for (const imported of imports) {
        if (
          path.startsWith("packages/domain/") &&
          /(?:@nestjs|next|prisma|redis|bullmq|@quantum-crm\/database)/.test(imported)
        ) {
          violations.push(`${path} -> ${imported}`);
        }

        if (
          /apps\/(?:crm-web|portal-web|admin-web)\//.test(path) &&
          /@quantum-crm\/(?:database|platform-domain)/.test(imported)
        ) {
          violations.push(`${path} -> ${imported}`);
        }

        if (imported.includes("/src/") || imported.startsWith("../../packages/")) {
          violations.push(`${path} -> ${imported}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
