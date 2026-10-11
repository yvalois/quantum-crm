import { describe, expect, it, vi } from "vitest";

import {
  attachmentStorageCompose,
  attachmentStorageOverride,
  tuneAttachmentStorageResources,
  attachmentStorageTempOverride,
  tuneAttachmentStorageTemporary,
} from "./ghl-attachment-storage-tuning.js";
import type { CandidateDockerApi, ContainerInspection } from "./ghl-candidate-operations.js";
import { HostAdapterError } from "./host-adapter.js";

const image =
  "sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d2441336af84bbb63c7e70b76fc00601774358412b42ed186";
const storageImage = "sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882";
const base = `/opt/quantum/builds/${"a".repeat(40)}/infra/compose/platform-foundation.yaml`;
const override = "/opt/quantum/tmp/doc14-foundation.override.yaml";
const networkName = "qcrm-staging-platform-storage";
const initialCompose =
  "services:\n  platform-storage:\n    mem_limit: 768m\n    cpus: 0.5\n  platform-clamav:\n    mem_limit: 3072m\nnetworks:\n  platform-storage:\n    external: true\n";
const initialOverride =
  "services:\n  platform-storage:\n    pull_policy: never\n  platform-clamav:\n    pull_policy: never\n";
const memory = 3 * 1024 ** 3;
const network = {
  Id: "f".repeat(64),
  Name: networkName,
  Driver: "bridge",
  Scope: "local",
  Internal: true,
};
const before: ContainerInspection = {
  Id: "c".repeat(64),
  Name: "/quantum-platform-foundation-platform-storage-1",
  Image: storageImage,
  Config: {
    Image: `qcrm-foundation/seaweedfs@${storageImage}`,
    Env: [],
    Labels: {
      "com.docker.compose.project": "quantum-platform-foundation",
      "com.docker.compose.service": "platform-storage",
      "com.docker.compose.container-number": "1",
      "com.docker.compose.oneoff": "False",
      "com.docker.compose.project.config_files": `${base},${override}`,
      "com.docker.compose.project.working_dir": base.slice(0, base.lastIndexOf("/")),
    },
  },
  HostConfig: {
    Memory: 768 * 1024 ** 2,
    MemorySwap: 1536 * 1024 ** 2,
    NanoCpus: 500000000,
    NetworkMode: networkName,
    PortBindings: {},
    Binds: ["unchanged-secret:ro"],
  },
  NetworkSettings: {
    Networks: { [networkName]: { NetworkID: network.Id, IPAddress: "172.23.0.2" } },
  },
  State: { Running: true, StartedAt: "2026-10-11T17:00:00Z" },
};

function harness(
  container = before,
  inspectedNetwork = network,
  compose = initialCompose,
  overrideText = initialOverride,
) {
  let current = structuredClone(container);
  let persisted = overrideText;
  const sequence: string[] = [];
  const api = vi.fn<CandidateDockerApi>(async (method, path, body) => {
    if (path.startsWith("/networks/")) return inspectedNetwork;
    if (method === "GET") return structuredClone(current);
    sequence.push("update");
    current = { ...current, HostConfig: { ...current.HostConfig, ...(body as object) } };
    return { Warnings: [] };
  });
  const files = {
    read: vi.fn(async (path: string) => (path === base ? compose : persisted)),
    replace: vi.fn(async (_path: string, original: string, next: string) => {
      expect(persisted).toBe(original);
      sequence.push("persist");
      persisted = next;
    }),
    availableMemory: vi.fn(async () => 16 * 1024 ** 3),
  };
  return { api, files, sequence };
}

describe("GHL attachment storage memory tuning", () => {
  it("changes only the storage limit in future base YAML, not ClamAV or network blocks", () => {
    expect(attachmentStorageCompose(initialCompose)).toBe(
      initialCompose.replace("mem_limit: 768m", "mem_limit: 3072m"),
    );
    for (const text of [
      initialCompose.replace("768m", "2048m"),
      initialCompose.replace("    cpus:", "    mem_limit: 768m\n    cpus:"),
      initialCompose.replace("    cpus:", "    memswap_limit: 6g\n    cpus:"),
    ])
      expect(() => attachmentStorageCompose(text)).toThrow(HostAdapterError);
  });

  it("permits only the exact known override and its old or target storage limit", () => {
    const updated = attachmentStorageOverride(initialOverride);
    expect(attachmentStorageOverride(updated)).toBe(updated);
    expect(attachmentStorageOverride(updated.replace("3072m", "768m"))).toBe(updated);
    expect(() => attachmentStorageOverride(updated.replace("3072m", "4096m"))).toThrow(
      HostAdapterError,
    );
    expect(() => attachmentStorageOverride(initialOverride + "    privileged: true\n")).toThrow(
      HostAdapterError,
    );
  });

  it("persists only the operative override then updates memory without restart or replacement", async () => {
    const { api, files, sequence } = harness();
    await expect(tuneAttachmentStorageResources(api, files)).resolves.toMatchObject({
      state: "APPLIED",
      memoryBytes: memory,
      memorySwapBytes: memory * 2,
      restarted: false,
    });
    expect(sequence).toEqual(["persist", "update"]);
    expect(files.replace).toHaveBeenCalledWith(
      override,
      initialOverride,
      attachmentStorageOverride(initialOverride),
    );
    expect(api.mock.calls.filter(([method]) => method === "POST")).toEqual([
      ["POST", `/containers/${before.Id}/update`, { Memory: memory, MemorySwap: memory * 2 }],
    ]);
  });

  it.each([-1, 0, memory * 2])("preserves a compatible MemorySwap value %s", async (swap) => {
    const { api, files } = harness({
      ...before,
      HostConfig: { ...before.HostConfig, MemorySwap: swap },
    });
    await tuneAttachmentStorageResources(api, files);
    expect(api.mock.calls.find(([method]) => method === "POST")?.[2]).toEqual({ Memory: memory });
  });

  it("is idempotent after the declarative and runtime limits agree", async () => {
    const { api, files } = harness(
      { ...before, HostConfig: { ...before.HostConfig, Memory: memory, MemorySwap: memory * 2 } },
      network,
      initialCompose,
      attachmentStorageOverride(initialOverride),
    );
    await expect(tuneAttachmentStorageResources(api, files)).resolves.toMatchObject({
      reused: true,
    });
    expect(files.replace).not.toHaveBeenCalled();
    expect(api.mock.calls.some(([method]) => method !== "GET")).toBe(false);
  });

  it("rejects foreign containers, images, config paths, networks and larger existing limits before writes", async () => {
    for (const container of [
      { ...before, Image: image },
      { ...before, Name: "/another-storage-1" },
      { ...before, HostConfig: { ...before.HostConfig, Memory: 4 * 1024 ** 3 } },
      { ...before, HostConfig: { ...before.HostConfig, PortBindings: { "8333/tcp": [{}] } } },
      {
        ...before,
        Config: {
          ...before.Config,
          Labels: {
            ...before.Config.Labels,
            "com.docker.compose.project.config_files": `/etc/config.yaml,${override}`,
          },
        },
      },
      { ...before, State: { ...before.State, Running: false } },
    ]) {
      const { api, files } = harness(container);
      await expect(tuneAttachmentStorageResources(api, files)).rejects.toBeInstanceOf(
        HostAdapterError,
      );
      expect(files.replace).not.toHaveBeenCalled();
      expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
    }
    const { api, files } = harness(before, { ...network, Internal: false });
    await expect(tuneAttachmentStorageResources(api, files)).rejects.toBeInstanceOf(
      HostAdapterError,
    );
    expect(files.replace).not.toHaveBeenCalled();
  });

  it("fails before mutation when host headroom is insufficient or persistence conflicts", async () => {
    const low = harness();
    low.files.availableMemory.mockResolvedValue(1024 ** 3);
    await expect(tuneAttachmentStorageResources(low.api, low.files)).rejects.toBeInstanceOf(
      HostAdapterError,
    );
    expect(low.files.replace).not.toHaveBeenCalled();
    const conflict = harness();
    conflict.files.replace.mockRejectedValue(new HostAdapterError("TARGET_CONFLICT"));
    await expect(
      tuneAttachmentStorageResources(conflict.api, conflict.files),
    ).rejects.toBeInstanceOf(HostAdapterError);
    expect(conflict.api.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("does not report success or reduce memory when update fails after persistence", async () => {
    const { api, files } = harness();
    api.mockImplementation(async (method, path) => {
      if (method === "POST") throw new HostAdapterError("UNAVAILABLE");
      return path.startsWith("/networks/") ? network : before;
    });
    await expect(tuneAttachmentStorageResources(api, files)).rejects.toBeInstanceOf(
      HostAdapterError,
    );
    expect(files.replace).toHaveBeenCalledOnce();
    expect(api.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
  });
});

describe("GHL attachment storage temporary upload capacity", () => {
  const original = {
    ...before,
    HostConfig: {
      ...before.HostConfig,
      Memory: memory,
      MemorySwap: memory * 2,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=64m" },
    },
    Mounts: [
      { Type: "volume", Name: "qcrm-staging-platform-storage", Destination: "/data", RW: true },
    ],
    State: { ...before.State, Health: { Status: "healthy" } },
  };
  const newId = "d".repeat(64);
  function temporaryHarness(
    failStart = false,
    active: readonly unknown[] = [],
    container = original,
  ) {
    let predecessor: ContainerInspection = structuredClone(container);
    let candidate: ContainerInspection | undefined;
    const h = harness(
      container,
      network,
      initialCompose,
      attachmentStorageOverride(initialOverride),
    );
    h.api.mockImplementation(async (method, path, body) => {
      if (path.startsWith("/containers/json?all=false")) return active;
      if (path.startsWith("/containers/json?all=true")) {
        const filter = JSON.parse(decodeURIComponent(path.split("filters=")[1]!)) as {
          id?: string[];
          name?: string[];
        };
        return [predecessor, ...(candidate ? [candidate] : [])]
          .filter((entry) =>
            filter.id ? filter.id.includes(entry.Id) : entry.Name === original.Name,
          )
          .map((entry) => ({ Id: entry.Id, Names: [entry.Name] }));
      }
      if (path === `/networks/${networkName}`) return network;
      if (method === "GET")
        return path.includes(before.Id) ? predecessor : (candidate ?? predecessor);
      if (path.startsWith("/containers/create?")) {
        const input = body as {
          HostConfig: ContainerInspection["HostConfig"];
          Labels: Record<string, string>;
        };
        candidate = {
          ...original,
          Id: newId,
          Config: { ...original.Config, Labels: input.Labels },
          HostConfig: input.HostConfig,
        };
        return { Id: newId };
      }
      if (path === `/containers/${before.Id}/stop?t=30`)
        predecessor = { ...predecessor, State: { ...predecessor.State, Running: false } };
      if (path.startsWith(`/containers/${before.Id}/rename?`))
        predecessor = { ...predecessor, Name: `/${decodeURIComponent(path.split("name=")[1]!)}` };
      if (path.endsWith("/disconnect"))
        predecessor = { ...predecessor, NetworkSettings: { Networks: {} } };
      if (path.endsWith("/connect"))
        predecessor = { ...predecessor, NetworkSettings: original.NetworkSettings };
      if (path === `/containers/${before.Id}/start`)
        predecessor = { ...predecessor, State: { ...predecessor.State, Running: true } };
      if (method === "DELETE") candidate = undefined;
      if (failStart && path === `/containers/${newId}/start`)
        throw new HostAdapterError("UNAVAILABLE");
      return undefined;
    });
    return h;
  }

  it("changes only the known storage tmpfs override with memory and ClamAV unchanged", () => {
    const old = attachmentStorageOverride(initialOverride);
    const next = attachmentStorageTempOverride(old);
    expect(next).toBe(
      old.replace(
        "    mem_limit: 3072m\n",
        "    mem_limit: 3072m\n    tmpfs:\n      - /tmp:rw,noexec,nosuid,size=512m\n",
      ),
    );
    expect(attachmentStorageTempOverride(next)).toBe(next);
    expect(() => attachmentStorageTempOverride(next.replace("512m", "1024m"))).toThrow(
      HostAdapterError,
    );
  });

  it("preserves the image, volume, credentials, address and limits while replacing only tmpfs", async () => {
    const { api, files } = temporaryHarness();
    await expect(tuneAttachmentStorageTemporary(api, files)).resolves.toMatchObject({
      state: "APPLIED",
      tmpfsBytes: 512 * 1024 ** 2,
      reused: false,
    });
    const created = api.mock.calls.find(([, path]) =>
      path.startsWith("/containers/create?"),
    )?.[2] as {
      Image: string;
      HostConfig: Record<string, unknown>;
      NetworkingConfig: {
        EndpointsConfig: Record<string, { IPAMConfig: { IPv4Address: string } }>;
      };
    };
    expect(created.Image).toBe(original.Config.Image);
    expect(created.HostConfig).toEqual({
      ...original.HostConfig,
      AutoRemove: false,
      Tmpfs: { "/tmp": "rw,noexec,nosuid,size=512m" },
    });
    expect(created.NetworkingConfig.EndpointsConfig[networkName]?.IPAMConfig.IPv4Address).toBe(
      "172.23.0.2",
    );
    expect(api).toHaveBeenCalledWith("POST", `/networks/${network.Id}/disconnect`, {
      Container: before.Id,
      Force: false,
    });
    expect(api.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
    expect(files.replace).toHaveBeenCalledWith(
      override,
      attachmentStorageOverride(initialOverride),
      attachmentStorageTempOverride(attachmentStorageOverride(initialOverride)),
      "temp",
    );
  });

  it("refuses mutation while any tenant attachment import is active", async () => {
    const { api, files } = temporaryHarness(false, [{ Id: "e".repeat(64) }]);
    await expect(tuneAttachmentStorageTemporary(api, files)).rejects.toEqual(
      new HostAdapterError("TARGET_CONFLICT"),
    );
    expect(files.replace).not.toHaveBeenCalled();
    expect(api.mock.calls.some(([method]) => method !== "GET")).toBe(false);
  });

  it("restores the disconnected predecessor without deleting data volumes when start fails", async () => {
    const { api, files } = temporaryHarness(true);
    await expect(tuneAttachmentStorageTemporary(api, files)).rejects.toBeInstanceOf(
      HostAdapterError,
    );
    expect(api).toHaveBeenCalledWith("DELETE", `/containers/${newId}?force=true&v=false`);
    expect(
      api.mock.calls.some(
        ([method, path, body]) =>
          method === "POST" &&
          path === `/networks/${network.Id}/connect` &&
          (body as { Container: string }).Container === before.Id,
      ),
    ).toBe(true);
    expect(api).toHaveBeenCalledWith("POST", `/containers/${before.Id}/start`);
    expect(files.replace).toHaveBeenLastCalledWith(
      override,
      attachmentStorageTempOverride(attachmentStorageOverride(initialOverride)),
      attachmentStorageOverride(initialOverride),
      "temp-rollback",
    );
  });

  it("reconciles an already healthy 512MiB container without another restart", async () => {
    const { api, files } = temporaryHarness(false, [], {
      ...original,
      HostConfig: { ...original.HostConfig, Tmpfs: { "/tmp": "rw,noexec,nosuid,size=512m" } },
    });
    await expect(tuneAttachmentStorageTemporary(api, files)).resolves.toMatchObject({
      reused: true,
    });
    expect(api.mock.calls.some(([method]) => method !== "GET")).toBe(false);
  });

  it("fails closed for an unrelated data volume or unexpected tmpfs configuration", async () => {
    for (const container of [
      {
        ...original,
        Mounts: [{ Type: "volume", Name: "foreign-data", Destination: "/data", RW: true }],
      },
      { ...original, HostConfig: { ...original.HostConfig, Tmpfs: { "/tmp": "rw,size=512m" } } },
    ]) {
      const { api, files } = temporaryHarness(false, [], container);
      await expect(tuneAttachmentStorageTemporary(api, files)).rejects.toBeInstanceOf(
        HostAdapterError,
      );
      expect(files.replace).not.toHaveBeenCalled();
      expect(api.mock.calls.some(([method]) => method !== "GET")).toBe(false);
    }
  });

  it.each(["/rename?", "/disconnect", "/containers/create?"])(
    "reconciles a lost Docker response after applying %s",
    async (suffix) => {
      const { api, files } = temporaryHarness();
      const implementation = api.getMockImplementation()!;
      let failed = false;
      api.mockImplementation(async (method, path, body) => {
        const result = await implementation(method, path, body);
        if (!failed && path.includes(suffix)) {
          failed = true;
          throw new HostAdapterError("UNAVAILABLE");
        }
        return result;
      });
      await expect(tuneAttachmentStorageTemporary(api, files)).rejects.toBeInstanceOf(
        HostAdapterError,
      );
      expect(api).toHaveBeenCalledWith("POST", `/containers/${before.Id}/start`);
      expect(files.replace).toHaveBeenLastCalledWith(
        override,
        attachmentStorageTempOverride(attachmentStorageOverride(initialOverride)),
        attachmentStorageOverride(initialOverride),
        "temp-rollback",
      );
    },
  );

  it("continues safe rollback when candidate deletion succeeded but its response was lost", async () => {
    const { api, files } = temporaryHarness(true);
    const implementation = api.getMockImplementation()!;
    api.mockImplementation(async (method, path, body) => {
      const result = await implementation(method, path, body);
      if (method === "DELETE") throw new HostAdapterError("UNAVAILABLE");
      return result;
    });
    await expect(tuneAttachmentStorageTemporary(api, files)).rejects.toBeInstanceOf(
      HostAdapterError,
    );
    expect(api).toHaveBeenCalledWith("POST", `/containers/${before.Id}/start`);
  });

  it("never restarts the predecessor while candidate deletion remains unconfirmed", async () => {
    const { api, files } = temporaryHarness(true);
    const implementation = api.getMockImplementation()!;
    api.mockImplementation(async (method, path, body) => {
      if (method === "DELETE") throw new HostAdapterError("UNAVAILABLE");
      return implementation(method, path, body);
    });
    await expect(tuneAttachmentStorageTemporary(api, files)).rejects.toEqual(
      new HostAdapterError("TARGET_CONFLICT"),
    );
    expect(api).not.toHaveBeenCalledWith("POST", `/containers/${before.Id}/start`);
    expect(files.replace).toHaveBeenCalledOnce();
  });
});
