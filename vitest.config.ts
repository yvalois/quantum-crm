import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

function workspaceSource(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@quantum-crm/config": workspaceSource("./packages/config/src/index.ts"),
      "@quantum-crm/contracts": workspaceSource("./packages/contracts/src/index.ts"),
      "@quantum-crm/database": workspaceSource("./packages/database/src/index.ts"),
      "@quantum-crm/observability": workspaceSource("./packages/observability/src/index.ts"),
    },
  },
  test: {
    clearMocks: true,
    exclude: [...configDefaults.exclude, "**/dist/**", "**/.next/**"],
    restoreMocks: true,
  },
});
