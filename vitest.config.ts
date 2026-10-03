import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

function workspaceSource(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      "@quantum-crm/auth": workspaceSource("./packages/auth/src/index.ts"),
      "@quantum-crm/config": workspaceSource("./packages/config/src/index.ts"),
      "@quantum-crm/contracts": workspaceSource("./packages/contracts/src/index.ts"),
      "@quantum-crm/database": workspaceSource("./packages/database/src/index.ts"),
      "@quantum-crm/domain": workspaceSource("./packages/domain/src/index.ts"),
      "@quantum-crm/files-infrastructure": workspaceSource(
        "./packages/files-infrastructure/src/index.ts",
      ),
      "@quantum-crm/observability": workspaceSource("./packages/observability/src/index.ts"),
      "@quantum-crm/platform-domain": workspaceSource("./packages/platform-domain/src/index.ts"),
    },
  },
  test: {
    clearMocks: true,
    exclude: [...configDefaults.exclude, "**/dist/**", "**/.next/**", "**/generated/**"],
    restoreMocks: true,
  },
});
