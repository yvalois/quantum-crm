import { describe, expect, it, vi } from "vitest";

import { attachmentStorageCompose, attachmentStorageOverride, tuneAttachmentStorageResources } from "./ghl-attachment-storage-tuning.js";
import type { CandidateDockerApi, ContainerInspection } from "./ghl-candidate-operations.js";
import { HostAdapterError } from "./host-adapter.js";

const image = "sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d2441336af84bbb63c7e70b76fc00601774358412b42ed186";
const storageImage = "sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882";
const base = `/opt/quantum/builds/${"a".repeat(40)}/infra/compose/platform-foundation.yaml`;
const override = "/opt/quantum/tmp/doc14-foundation.override.yaml";
const networkName = "qcrm-staging-platform-storage";
const initialCompose = "services:\n  platform-storage:\n    mem_limit: 768m\n    cpus: 0.5\n  platform-clamav:\n    mem_limit: 3072m\nnetworks:\n  platform-storage:\n    external: true\n";
const initialOverride = "services:\n  platform-storage:\n    pull_policy: never\n  platform-clamav:\n    pull_policy: never\n";
const memory = 3 * 1024 ** 3;
const network = { Id: "f".repeat(64), Name: networkName, Driver: "bridge", Scope: "local", Internal: true };
const before: ContainerInspection = {
  Id: "c".repeat(64), Name: "/quantum-platform-foundation-platform-storage-1", Image: storageImage,
  Config: { Image: `qcrm-foundation/seaweedfs@${storageImage}`, Env: [], Labels: {
    "com.docker.compose.project": "quantum-platform-foundation",
    "com.docker.compose.service": "platform-storage",
    "com.docker.compose.container-number": "1",
    "com.docker.compose.oneoff": "False",
    "com.docker.compose.project.config_files": `${base},${override}`,
    "com.docker.compose.project.working_dir": base.slice(0, base.lastIndexOf("/")),
  } },
  HostConfig: { Memory: 768 * 1024 ** 2, MemorySwap: 1536 * 1024 ** 2, NanoCpus: 500000000, NetworkMode: networkName, PortBindings: {}, Binds: ["unchanged-secret:ro"] },
  NetworkSettings: { Networks: { [networkName]: { NetworkID: network.Id, IPAddress: "172.23.0.2" } } },
  State: { Running: true, StartedAt: "2026-10-11T17:00:00Z" },
};

function harness(container = before, inspectedNetwork = network, compose = initialCompose, overrideText = initialOverride) {
  let current = structuredClone(container);
  let persisted = overrideText;
  const sequence: string[] = [];
  const api = vi.fn<CandidateDockerApi>(async (method, path, body) => {
    if (path.startsWith("/networks/")) return inspectedNetwork;
    if (method === "GET") return structuredClone(current);
    sequence.push("update");
    current = { ...current, HostConfig: { ...current.HostConfig, ...body as object } };
    return { Warnings: [] };
  });
  const files = {
    read: vi.fn(async (path: string) => path === base ? compose : persisted),
    replace: vi.fn(async (_path: string, original: string, next: string) => {
      expect(persisted).toBe(original); sequence.push("persist"); persisted = next;
    }),
    availableMemory: vi.fn(async () => 16 * 1024 ** 3),
  };
  return { api, files, sequence };
}

describe("GHL attachment storage memory tuning", () => {
  it("changes only the storage limit in future base YAML, not ClamAV or network blocks", () => {
    expect(attachmentStorageCompose(initialCompose)).toBe(initialCompose.replace("mem_limit: 768m", "mem_limit: 3072m"));
    for (const text of [initialCompose.replace("768m", "2048m"), initialCompose.replace("    cpus:", "    mem_limit: 768m\n    cpus:"), initialCompose.replace("    cpus:", "    memswap_limit: 6g\n    cpus:")])
      expect(() => attachmentStorageCompose(text)).toThrow(HostAdapterError);
  });

  it("permits only the exact known override and its old or target storage limit", () => {
    const updated = attachmentStorageOverride(initialOverride);
    expect(attachmentStorageOverride(updated)).toBe(updated);
    expect(attachmentStorageOverride(updated.replace("3072m", "768m"))).toBe(updated);
    expect(() => attachmentStorageOverride(updated.replace("3072m", "4096m"))).toThrow(HostAdapterError);
    expect(() => attachmentStorageOverride(initialOverride + "    privileged: true\n")).toThrow(HostAdapterError);
  });

  it("persists only the operative override then updates memory without restart or replacement", async () => {
    const { api, files, sequence } = harness();
    await expect(tuneAttachmentStorageResources(api, files)).resolves.toMatchObject({ state: "APPLIED", memoryBytes: memory, memorySwapBytes: memory * 2, restarted: false });
    expect(sequence).toEqual(["persist", "update"]);
    expect(files.replace).toHaveBeenCalledWith(override, initialOverride, attachmentStorageOverride(initialOverride));
    expect(api.mock.calls.filter(([method]) => method === "POST")).toEqual([["POST", `/containers/${before.Id}/update`, { Memory: memory, MemorySwap: memory * 2 }]]);
  });

  it.each([-1, 0, memory * 2])("preserves a compatible MemorySwap value %s", async (swap) => {
    const { api, files } = harness({ ...before, HostConfig: { ...before.HostConfig, MemorySwap: swap } });
    await tuneAttachmentStorageResources(api, files);
    expect(api.mock.calls.find(([method]) => method === "POST")?.[2]).toEqual({ Memory: memory });
  });

  it("is idempotent after the declarative and runtime limits agree", async () => {
    const { api, files } = harness({ ...before, HostConfig: { ...before.HostConfig, Memory: memory, MemorySwap: memory * 2 } }, network, initialCompose, attachmentStorageOverride(initialOverride));
    await expect(tuneAttachmentStorageResources(api, files)).resolves.toMatchObject({ reused: true });
    expect(files.replace).not.toHaveBeenCalled();
    expect(api.mock.calls.some(([method]) => method !== "GET")).toBe(false);
  });

  it("rejects foreign containers, images, config paths, networks and larger existing limits before writes", async () => {
    for (const container of [
      { ...before, Image: image },
      { ...before, Name: "/another-storage-1" },
      { ...before, HostConfig: { ...before.HostConfig, Memory: 4 * 1024 ** 3 } },
      { ...before, HostConfig: { ...before.HostConfig, PortBindings: { "8333/tcp": [{}] } } },
      { ...before, Config: { ...before.Config, Labels: { ...before.Config.Labels, "com.docker.compose.project.config_files": `/etc/config.yaml,${override}` } } },
      { ...before, State: { ...before.State, Running: false } },
    ]) {
      const { api, files } = harness(container);
      await expect(tuneAttachmentStorageResources(api, files)).rejects.toBeInstanceOf(HostAdapterError);
      expect(files.replace).not.toHaveBeenCalled();
      expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
    }
    const { api, files } = harness(before, { ...network, Internal: false });
    await expect(tuneAttachmentStorageResources(api, files)).rejects.toBeInstanceOf(HostAdapterError);
    expect(files.replace).not.toHaveBeenCalled();
  });

  it("fails before mutation when host headroom is insufficient or persistence conflicts", async () => {
    const low = harness(); low.files.availableMemory.mockResolvedValue(1024 ** 3);
    await expect(tuneAttachmentStorageResources(low.api, low.files)).rejects.toBeInstanceOf(HostAdapterError);
    expect(low.files.replace).not.toHaveBeenCalled();
    const conflict = harness(); conflict.files.replace.mockRejectedValue(new HostAdapterError("TARGET_CONFLICT"));
    await expect(tuneAttachmentStorageResources(conflict.api, conflict.files)).rejects.toBeInstanceOf(HostAdapterError);
    expect(conflict.api.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("does not report success or reduce memory when update fails after persistence", async () => {
    const { api, files } = harness();
    api.mockImplementation(async (method, path) => {
      if (method === "POST") throw new HostAdapterError("UNAVAILABLE");
      return path.startsWith("/networks/") ? network : before;
    });
    await expect(tuneAttachmentStorageResources(api, files)).rejects.toBeInstanceOf(HostAdapterError);
    expect(files.replace).toHaveBeenCalledOnce();
    expect(api.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
  });
});
