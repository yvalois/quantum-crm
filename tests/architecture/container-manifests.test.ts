import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), "utf8");

function serviceNames(compose: string): string[] {
  const services = compose.split("\nservices:\n")[1]?.split("\nnetworks:\n")[0] ?? "";
  return [...services.matchAll(/^  ([a-z][a-z0-9-]+):$/gm)].map((match) => match[1] ?? "");
}

function serviceBlock(compose: string, serviceName: string): string {
  const match = new RegExp(
    `^  ${serviceName}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]+:\\n|^networks:\\n|^secrets:\\n)`,
    "m",
  ).exec(compose);

  return match?.[0] ?? "";
}

describe("container manifests", () => {
  it("keeps generated build artifacts out of Docker contexts", () => {
    const dockerIgnore = read(".dockerignore");

    for (const pattern of ["**/node_modules", "**/dist", "**/.next", "**/generated"]) {
      expect(dockerIgnore).toContain(pattern);
    }
  });

  it("pins Trixie Node bases, removes package managers and runs without root", () => {
    for (const dockerfile of ["infra/docker/Dockerfile.web", "infra/docker/Dockerfile.node"]) {
      const source = read(dockerfile);

      expect(source).toContain("node:24.21.0-trixie-slim@sha256:");
      expect(source).toContain("pnpm@9.13.2");
      expect(source).toContain("rm -rf /usr/local/lib/node_modules/npm");
      expect(source).toContain("rm -f /usr/local/bin/npm");
      expect(source).toContain("USER node");
      expect(source).not.toContain(":latest");
    }

    const migrator = read("infra/docker/Dockerfile.migrator");
    expect(migrator).toContain("node:24.21.0-trixie@sha256:");
    expect(migrator).toContain("rm -rf /usr/local/lib/node_modules/npm");
    expect(migrator).toContain("USER node");
  });

  it("builds workspace dependencies before each application image", () => {
    const webDockerfile = read("infra/docker/Dockerfile.web");

    expect(webDockerfile).toContain('pnpm --filter "@quantum-crm/${APP}..." build');
    expect(webDockerfile).toContain("/.next/standalone ./");
    expect(webDockerfile).toContain('ln -s "apps/${APP}" runtime');
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
    for (const path of [
      "infra/compose/platform-foundation.yaml",
      "infra/compose/platform.yaml",
      "infra/compose/tenant.yaml",
    ]) {
      const compose = read(path);

      expect(compose).toContain("@sha256:${QCRM_");
      expect(compose).not.toMatch(/:\s*latest\b/);
      expect(compose).not.toMatch(/^    ports:/m);
      expect(compose).toContain("read_only: true");
      expect(compose).toContain("no-new-privileges:true");
      expect(compose).toContain("cap_drop:");
    }
  });

  it("separates persistent platform dependencies by private network and volume", () => {
    const foundation = read("infra/compose/platform-foundation.yaml");
    const platform = read("infra/compose/platform.yaml");

    expect(serviceNames(foundation).sort()).toEqual(
      [
        "platform-keycloak",
        "platform-migrator",
        "platform-postgres",
        "platform-redis",
        "platform-storage",
      ].sort(),
    );
    expect(foundation).not.toMatch(/^    ports:/m);
    expect(foundation).not.toContain("start-dev");
    expect(serviceBlock(foundation, "platform-postgres")).toContain(
      "platform-postgres-data:/var/lib/postgresql",
    );
    expect(serviceBlock(foundation, "platform-redis")).toContain("platform-redis-data:/data");
    expect(serviceBlock(foundation, "platform-storage")).toContain("platform-storage-data:/data");
    expect(serviceBlock(foundation, "platform-postgres")).toContain(
      "networks: [platform-database]",
    );
    expect(serviceBlock(foundation, "platform-postgres")).toContain("DAC_OVERRIDE");
    expect(serviceBlock(foundation, "platform-redis")).toContain("networks: [platform-session]");
    expect(serviceBlock(foundation, "platform-redis")).toContain("DAC_OVERRIDE");
    expect(serviceBlock(foundation, "platform-storage")).toContain("networks: [platform-storage]");
    expect(serviceBlock(foundation, "platform-keycloak")).toContain(
      "networks: [platform-edge, platform-database]",
    );
    expect(serviceBlock(foundation, "platform-keycloak")).not.toContain("cap_add:");
    expect(serviceBlock(platform, "admin-web")).toContain("platform-session");
    expect(serviceBlock(platform, "admin-web")).not.toContain("platform-database");
    expect(serviceBlock(platform, "admin-api")).toContain("platform-database");
    expect(serviceBlock(platform, "admin-api")).not.toContain("platform-session");
    expect(serviceBlock(foundation, "platform-migrator")).toContain("profiles: [tools]");
    expect(serviceBlock(foundation, "platform-migrator")).toContain(
      "QCRM_MIGRATION_DATABASE_URL_FILE: /run/secrets/qcrm_migration_database_url",
    );
  });

  it("adapts vendor credentials from mounted files without secret command arguments", () => {
    const foundation = read("infra/compose/platform-foundation.yaml");
    const redisEntrypoint = read("infra/redis/platform-entrypoint.sh");
    const keycloakEntrypoint = read("infra/keycloak/platform-entrypoint.sh");
    const keycloakBootstrap = read("infra/keycloak/bootstrap-provisioner.sh");
    const provisionOperator = read("infra/platform/provision-operator.sh");

    expect(foundation).not.toMatch(/PASSWORD:\s*[^/\s]/);
    expect(foundation).not.toContain("--requirepass");
    expect(foundation).not.toContain("--db-password");
    expect(redisEntrypoint).toContain("/run/secrets/qcrm_redis_password");
    expect(redisEntrypoint).toContain("--aclfile /tmp/users.acl");
    expect(keycloakEntrypoint).toContain("QCRM_KEYCLOAK_DB_PASSWORD_FILE");
    expect(keycloakEntrypoint).toContain("QCRM_KEYCLOAK_PROVISIONER_CLIENT_SECRET_FILE");
    expect(keycloakEntrypoint).not.toContain("set -x");
    expect(foundation).toContain("KC_BOOTSTRAP_ADMIN_CLIENT_ID: quantum-provisioner");
    expect(foundation).not.toContain("KC_BOOTSTRAP_ADMIN_PASSWORD");
    expect(keycloakBootstrap).toContain("QCRM_KEYCLOAK_ALL_NODES_STOPPED=confirmed");
    expect(keycloakBootstrap).toContain("--client-secret:env=QCRM_KEYCLOAK_PROVISIONER_CLIENT_SECRET");
    expect(keycloakBootstrap).not.toContain("set -x");
    expect(provisionOperator).toContain("grant_type=client_credentials");
    expect(provisionOperator).not.toContain("grant_type=password");
    expect(provisionOperator).not.toContain("keycloak-bootstrap-admin-password");
  });

  it("provisions platform secrets without overwriting or printing their values", () => {
    const provisioner = read("infra/platform/provision-secrets.sh");

    expect(provisioner).toContain("openssl rand -hex 32");
    expect(provisioner).toContain('if [[ ! -e "$path" ]]');
    expect(provisioner).toContain("platform-migration-database-url");
    expect(provisioner).toContain("platform-database-url");
    expect(provisioner).toContain("admin-web-session-redis-url");
    expect(provisioner).toContain("keycloak-provisioner-client-secret");
    expect(provisioner).not.toContain("set -x");
  });

  it("declares the Redis host memory prerequisite", () => {
    expect(read("infra/redis/99-quantum-redis.conf")).toContain("vm.overcommit_memory = 1");
  });

  it("declares a hardened Caddy edge that preserves existing sites", () => {
    const edge = read("infra/compose/edge.yaml");
    const platform = read("infra/compose/platform.yaml");
    const caddyfile = read("infra/caddy/Caddyfile");
    const dockerfile = read("infra/docker/Dockerfile.caddy");

    expect(serviceNames(edge)).toEqual(["edge-proxy"]);
    expect(edge).toContain("caddy@sha256:${QCRM_CADDY_IMAGE_DIGEST");
    expect(edge).toContain('user: "1000:1000"');
    expect(edge).toContain("NET_BIND_SERVICE");
    expect(edge).toContain("/var/www/quantum:/srv/quantum:ro");
    expect(edge).toContain("/var/www/mr-business:/srv/mr-business:ro");
    expect(edge).toContain("edge-caddy-data:/data");
    expect(edge).toContain("platform-oidc:");
    expect(edge).toContain("platform-github-actions-oidc:");
    expect(edge).toContain("QCRM_IDENTITY_HOST");
    expect(serviceBlock(platform, "admin-api")).toContain("platform-oidc");
    expect(serviceBlock(platform, "admin-api")).toContain("platform-github-actions-oidc");
    expect(serviceBlock(platform, "admin-api")).toContain("QCRM_GITHUB_ACTIONS_OIDC_AUDIENCE");
    expect(dockerfile).toContain("caddy:2.11.4-alpine@sha256:");
    expect(dockerfile).toContain("USER caddy-runtime");
    expect(caddyfile).toContain("reverse_proxy admin-web:3000");
    expect(caddyfile).toContain("reverse_proxy platform-keycloak:8080");
    expect(caddyfile).toContain("http://github-actions-oidc:8081");
    expect(caddyfile).toContain("https://token.actions.githubusercontent.com");
    expect(caddyfile).toContain("@github_actions_jwks path /.well-known/jwks");
    expect(caddyfile).toContain("root * /srv/quantum");
    expect(caddyfile).toContain("root * /srv/mr-business");
    expect(caddyfile).not.toContain("tls_insecure_skip_verify");
  });

  it("mounts each database URL only in an authorized process", () => {
    const tenant = read("infra/compose/tenant.yaml");
    const platform = read("infra/compose/platform.yaml");

    for (const service of ["api", "worker"]) {
      expect(serviceBlock(tenant, service)).toContain(
        "QCRM_DATABASE_URL_FILE: /run/secrets/qcrm_database_url",
      );
    }
    for (const service of ["crm-web", "portal-web", "agent-runtime"]) {
      expect(serviceBlock(tenant, service)).not.toContain("QCRM_DATABASE_URL_FILE");
    }

    for (const service of ["admin-api", "deploy-executor"]) {
      expect(serviceBlock(platform, service)).toContain(
        "QCRM_DATABASE_URL_FILE: /run/secrets/qcrm_database_url",
      );
      expect(serviceBlock(platform, service)).toContain("source: platform-database-url");
      expect(serviceBlock(platform, service)).toContain("platform-database");
    }
    for (const service of ["admin-web"]) {
      expect(serviceBlock(platform, service)).not.toContain("QCRM_DATABASE_URL_FILE");
    }
  });

  it("mounts platform web session secrets only in admin-web", () => {
    const platform = read("infra/compose/platform.yaml");
    const adminWeb = serviceBlock(platform, "admin-web");

    expect(adminWeb).toContain(
      "QCRM_OIDC_CLIENT_SECRET_FILE: /run/secrets/qcrm_oidc_client_secret",
    );
    expect(adminWeb).toContain("QCRM_SESSION_REDIS_URL_FILE: /run/secrets/qcrm_session_redis_url");
    expect(adminWeb).toContain("source: admin-web-oidc-client-secret");
    expect(adminWeb).toContain("source: admin-web-session-redis-url");
    for (const service of ["admin-api", "deploy-executor"]) {
      expect(serviceBlock(platform, service)).not.toContain("qcrm_oidc_client_secret");
      expect(serviceBlock(platform, service)).not.toContain("qcrm_session_redis_url");
    }
  });
});
