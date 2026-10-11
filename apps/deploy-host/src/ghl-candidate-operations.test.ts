import { describe, expect, it, vi } from "vitest";

import { candidateContainerBody, replaceGhlCandidateComponent, type CandidateDockerApi } from "./ghl-candidate-operations.js";
import { HostAdapterError } from "./host-adapter.js";

const tenantId = "01995f7e-7b52-7000-8000-000000000201";
const commit = "a".repeat(40);
const imageId = `sha256:${"b".repeat(64)}`;
const originalId = "c".repeat(64);
const newId = "d".repeat(64);
const name = `qcrm-t-${tenantId}-api-1`;
const previous = {
  Id: originalId, Name: `/${name}`, Image: `sha256:${"e".repeat(64)}`,
  Config: { Image: "historical-api", Env: ["QCRM_DATABASE_URL_FILE=/run/secrets/qcrm_database_url"],
    Labels: { "com.docker.compose.project": `qcrm-t-${tenantId}`, "com.docker.compose.service": "api" },
    Healthcheck: { Test: ["CMD", "node", "health.js"] }, WorkingDir: "/app", User: "node", Cmd: ["node", "dist/main.js"] },
  HostConfig: { Binds: ["/profile/runtime-url:/run/secrets/qcrm_database_url:ro"], ReadonlyRootfs: true,
    CapDrop: ["ALL"], RestartPolicy: { Name: "unless-stopped" } },
  NetworkSettings: { Networks: { "private-db": { Aliases: ["api", "qcrm-tenant-api", originalId.slice(0, 12)] } } },
  State: { Running: true, Health: { Status: "healthy" } },
};

describe("GHL candidate component promotion", () => {
  it("keeps the exact secrets, binds, command, policy and DNS aliases while replacing only the image", () => {
    const body = candidateContainerBody(previous, imageId);
    expect(body.Image).toBe(imageId);
    expect(body.Env).toEqual(previous.Config.Env);
    expect(body.HostConfig.Binds).toEqual(previous.HostConfig.Binds);
    expect(body.HostConfig.ReadonlyRootfs).toBe(true);
    expect(body.HostConfig.AutoRemove).toBe(false);
    expect(body.Cmd).toEqual(["node", "dist/main.js"]);
    expect(body.NetworkingConfig.EndpointsConfig["private-db"]?.Aliases).toEqual(["api", "qcrm-tenant-api"]);
  });

  it("restarts the original container when renaming fails after stop", async () => {
    const api = vi.fn<CandidateDockerApi>(async (method, path) => {
      if (method === "GET") return previous;
      if (path.includes("/rename?")) throw new HostAdapterError("TARGET_CONFLICT");
      return undefined;
    });
    await expect(replaceGhlCandidateComponent(tenantId, "api", commit, imageId, api)).rejects.toEqual(new HostAdapterError("TARGET_CONFLICT"));
    expect(api).toHaveBeenCalledWith("POST", `/containers/${originalId}/start`);
    expect(api.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    expect(api.mock.calls.some(([, path]) => path.startsWith("/containers/create"))).toBe(false);
  });

  it("removes only the failed candidate without deleting volumes and restores its predecessor", async () => {
    const api = vi.fn<CandidateDockerApi>(async (method, path) => {
      if (method === "GET") return previous;
      if (path.startsWith("/containers/create")) return { Id: newId };
      if (path === `/containers/${newId}/start`) throw new HostAdapterError("UNAVAILABLE");
      return undefined;
    });
    await expect(replaceGhlCandidateComponent(tenantId, "api", commit, imageId, api)).rejects.toEqual(new HostAdapterError("UNAVAILABLE"));
    expect(api).toHaveBeenCalledWith("DELETE", `/containers/${newId}?force=true&v=false`);
    expect(api).toHaveBeenCalledWith("POST", `/containers/${originalId}/start`);
    expect(api.mock.calls.filter(([method]) => method === "DELETE")).toHaveLength(1);
  });

  it("does not touch a container whose compose identity belongs to a different profile", async () => {
    const api = vi.fn<CandidateDockerApi>(async () => ({ ...previous, Config: { ...previous.Config,
      Labels: { ...previous.Config.Labels, "com.docker.compose.project": "another-profile" } } }));
    await expect(replaceGhlCandidateComponent(tenantId, "api", commit, imageId, api)).rejects.toEqual(new HostAdapterError("IDENTITY_MISMATCH"));
    expect(api).toHaveBeenCalledOnce();
  });
});
