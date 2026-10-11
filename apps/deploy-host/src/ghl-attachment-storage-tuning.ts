import { constants } from "node:fs";
import {
  chown,
  chmod,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  candidateContainerBody,
  type CandidateDockerApi,
  type ContainerInspection,
} from "./ghl-candidate-operations.js";
import { HostAdapterError } from "./host-adapter.js";

const storageName = "quantum-platform-foundation-platform-storage-1";
const storageNetwork = "qcrm-staging-platform-storage";
const storageImage = "sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882";
const targetMemory = 3 * 1024 ** 3;
const previousMemory = 768 * 1024 ** 2;
const overridePath = "/opt/quantum/tmp/doc14-foundation.override.yaml";
const overrideContent =
  "services:\n  platform-storage:\n    pull_policy: never\n  platform-clamav:\n    pull_policy: never\n";
const lockPath = "/opt/quantum/config/staging/ghl-attachment-storage-tune.lock";

interface TuningFiles {
  readonly read: (path: string) => Promise<string>;
  readonly replace: (
    path: string,
    previous: string,
    next: string,
    kind?: "memory" | "temp" | "temp-rollback",
  ) => Promise<void>;
  readonly availableMemory: () => Promise<number>;
  readonly recordPredecessor?: (receipt: Readonly<Record<string, unknown>>) => Promise<void>;
}

async function checkedFile(path: string) {
  const metadata = await lstat(path);
  if (
    (await realpath(path)) !== path ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    ![0, 1000].includes(metadata.uid) ||
    (metadata.mode & 0o002) !== 0 ||
    metadata.size < 1 ||
    metadata.size > 65_536
  )
    throw new HostAdapterError("IDENTITY_MISMATCH");
  return metadata;
}

const tuningFiles: TuningFiles = {
  async read(path) {
    await checkedFile(path);
    return readFile(path, "utf8");
  },
  async replace(path, previous, next, kind = "memory") {
    if (path !== overridePath) throw new HostAdapterError("IDENTITY_MISMATCH");
    const before = await checkedFile(path);
    const predecessor = `${path}.before-ghl-storage-${kind}`;
    try {
      await writeFile(predecessor, previous, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      await checkedFile(predecessor);
      if ((await readFile(predecessor, "utf8")) !== previous)
        throw new HostAdapterError("TARGET_CONFLICT");
    }
    const temporary = `${path}.ghl-${kind}-update`;
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      before.mode & 0o777,
    );
    try {
      await file.writeFile(next, "utf8");
      await file.sync();
      await chown(temporary, before.uid, before.gid);
      await chmod(temporary, before.mode & 0o777);
      const current = await checkedFile(path);
      if (
        current.ino !== before.ino ||
        current.dev !== before.dev ||
        (await readFile(path, "utf8")) !== previous
      )
        throw new HostAdapterError("TARGET_CONFLICT");
      await rename(temporary, path);
    } finally {
      await file.close();
      await unlink(temporary).catch((error: unknown) => {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      });
    }
  },
  async availableMemory() {
    const memory = await readFile("/proc/meminfo", "utf8");
    const available = /^MemAvailable:\s+(\d+) kB$/mu.exec(memory)?.[1];
    if (!available) throw new HostAdapterError("UNAVAILABLE");
    return Number(available) * 1024;
  },
  async recordPredecessor(receipt) {
    const path = "/opt/quantum/config/staging/ghl-storage-temp512-predecessor.json";
    const content = `${JSON.stringify(receipt)}\n`;
    try {
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      await checkedFile(path);
      if ((await readFile(path, "utf8")) !== content) throw new HostAdapterError("TARGET_CONFLICT");
    }
  },
};

/** Change one known service limit only; never reserialize unrelated operational YAML. */
export function attachmentStorageCompose(content: string): string {
  if (content.includes("\r")) throw new HostAdapterError("IDENTITY_MISMATCH");
  const lines = content.split("\n");
  const services = lines.indexOf("services:");
  const end = lines.findIndex((line, index) => index > services && /^[A-Za-z][\w-]*:/u.test(line));
  if (services < 0 || end < 0) throw new HostAdapterError("IDENTITY_MISMATCH");
  const starts = lines.flatMap((line, index) =>
    index > services && index < end && line === "  platform-storage:" ? [index] : [],
  );
  const start = starts[0];
  if (starts.length !== 1 || start === undefined) throw new HostAdapterError("IDENTITY_MISMATCH");
  const following = lines.findIndex(
    (line, index) => index > start && index < end && /^  [A-Za-z][\w-]*:/u.test(line),
  );
  const service = lines.slice(start, following < 0 ? end : following);
  const limits = service.filter((line) => /^    mem_limit:/u.test(line));
  if (
    limits.length !== 1 ||
    !["    mem_limit: 768m", "    mem_limit: 3072m"].includes(limits[0] ?? "") ||
    service.some((line) => /^    (?:deploy|memswap_limit|mem_reservation):/u.test(line))
  )
    throw new HostAdapterError("IDENTITY_MISMATCH");
  const limit = start + service.indexOf(limits[0]!);
  lines[limit] = "    mem_limit: 3072m";
  return lines.join("\n");
}

export function attachmentStorageOverride(content: string): string {
  const insertion = "    pull_policy: never\n";
  const next = overrideContent.replace(insertion, `${insertion}    mem_limit: 3072m\n`);
  const old = overrideContent.replace(insertion, `${insertion}    mem_limit: 768m\n`);
  if (![overrideContent, old, next].includes(content))
    throw new HostAdapterError("IDENTITY_MISMATCH");
  return next;
}

export function attachmentStorageTempOverride(content: string): string {
  const memoryOverride = attachmentStorageOverride(overrideContent);
  const tmp = "    tmpfs:\n      - /tmp:rw,noexec,nosuid,size=512m\n";
  const next = memoryOverride.replace("    mem_limit: 3072m\n", `    mem_limit: 3072m\n${tmp}`);
  if (![memoryOverride, next, next.replace("size=512m", "size=64m")].includes(content))
    throw new HostAdapterError("IDENTITY_MISMATCH");
  return next;
}

function validateStorage(container: ContainerInspection, network: Record<string, unknown>): string {
  const labels = container.Config.Labels;
  const files = labels["com.docker.compose.project.config_files"]?.split(",");
  const base = files?.[0];
  if (
    container.Name !== `/${storageName}` ||
    !/^[0-9a-f]{64}$/u.test(container.Id) ||
    container.Image !== storageImage ||
    container.Config.Image !== `qcrm-foundation/seaweedfs@${storageImage}` ||
    labels["com.docker.compose.project"] !== "quantum-platform-foundation" ||
    labels["com.docker.compose.service"] !== "platform-storage" ||
    labels["com.docker.compose.container-number"] !== "1" ||
    labels["com.docker.compose.oneoff"] !== "False" ||
    !container.State.Running ||
    container.State.Paused === true ||
    container.State.Restarting === true ||
    !container.State.StartedAt ||
    !base ||
    !/^\/opt\/quantum\/builds\/[0-9a-f]{40}\/infra\/compose\/platform-foundation\.yaml$/u.test(
      base,
    ) ||
    files?.length !== 2 ||
    files[1] !== overridePath ||
    labels["com.docker.compose.project.working_dir"] !== base.slice(0, base.lastIndexOf("/")) ||
    Object.keys(container.NetworkSettings.Networks).length !== 1 ||
    container.NetworkSettings.Networks[storageNetwork]?.NetworkID !== network.Id ||
    network.Name !== storageNetwork ||
    network.Internal !== true ||
    network.Driver !== "bridge" ||
    network.Scope !== "local" ||
    typeof network.Id !== "string" ||
    !/^[0-9a-f]{64}$/u.test(network.Id) ||
    container.HostConfig.NetworkMode !== storageNetwork ||
    Object.keys((container.HostConfig.PortBindings ?? {}) as object).length !== 0 ||
    container.HostConfig.PublishAllPorts === true ||
    ![previousMemory, targetMemory].includes(Number(container.HostConfig.Memory))
  )
    throw new HostAdapterError("IDENTITY_MISMATCH");
  return base;
}

/** Fixed, host-owned repair. No image, restart, network, port, mount or secret changes. */
export async function tuneAttachmentStorageResources(
  api: CandidateDockerApi,
  files: TuningFiles = tuningFiles,
) {
  const path = `/containers/${storageName}/json`;
  const before = (await api("GET", path)) as ContainerInspection;
  const network = (await api("GET", `/networks/${storageNetwork}`)) as Record<string, unknown>;
  const composePath = validateStorage(before, network);
  attachmentStorageCompose(await files.read(composePath));
  const original = await files.read(overridePath);
  const next = attachmentStorageOverride(original);
  const swap = before.HostConfig.MemorySwap;
  if (typeof swap !== "number" || !Number.isSafeInteger(swap) || swap < -1)
    throw new HostAdapterError("IDENTITY_MISMATCH");
  const swapChange = swap > 0 && swap < targetMemory ? { MemorySwap: targetMemory * 2 } : {};
  const changed = before.HostConfig.Memory !== targetMemory || Object.keys(swapChange).length > 0;
  if (
    changed &&
    (await files.availableMemory()) <
      targetMemory - Number(before.HostConfig.Memory) + 2 * 1024 ** 3
  )
    throw new HostAdapterError("UNAVAILABLE");
  // Persist first: a failed update remains safely retryable, never falsely reported as applied.
  if (next !== original) await files.replace(overridePath, original, next);
  if (changed)
    await api("POST", `/containers/${before.Id}/update`, { Memory: targetMemory, ...swapChange });
  const after = (await api("GET", path)) as ContainerInspection;
  validateStorage(after, network);
  const { Memory: _beforeMemory, MemorySwap: _beforeSwap, ...beforeHost } = before.HostConfig;
  const { Memory: _afterMemory, MemorySwap: _afterSwap, ...afterHost } = after.HostConfig;
  if (
    after.Id !== before.Id ||
    after.Image !== before.Image ||
    after.State.StartedAt !== before.State.StartedAt ||
    after.HostConfig.Memory !== targetMemory ||
    after.HostConfig.MemorySwap !== (swapChange.MemorySwap ?? swap) ||
    JSON.stringify(before.Config) !== JSON.stringify(after.Config) ||
    JSON.stringify(beforeHost) !== JSON.stringify(afterHost) ||
    JSON.stringify(before.NetworkSettings.Networks) !==
      JSON.stringify(after.NetworkSettings.Networks)
  )
    throw new HostAdapterError("TARGET_CONFLICT");
  return {
    state: "APPLIED",
    memoryBytes: targetMemory,
    memorySwapBytes: after.HostConfig.MemorySwap,
    restarted: false,
    reused: !changed && next === original,
  } as const;
}

/** Replace only the registered storage tmpfs; preserve the master address and all durable mounts. */
export async function tuneAttachmentStorageTemporary(
  api: CandidateDockerApi,
  files: TuningFiles = tuningFiles,
) {
  const inspectPath = `/containers/${storageName}/json`;
  const before = (await api("GET", inspectPath)) as ContainerInspection;
  const network = (await api("GET", `/networks/${storageNetwork}`)) as Record<string, unknown>;
  const composePath = validateStorage(before, network);
  attachmentStorageCompose(await files.read(composePath));
  const original = await files.read(overridePath);
  const next = attachmentStorageTempOverride(original);
  const tmpfs = before.HostConfig.Tmpfs as Record<string, string> | undefined;
  const address = before.NetworkSettings.Networks[storageNetwork]?.IPAddress;
  if (
    before.HostConfig.Memory !== targetMemory ||
    !tmpfs ||
    Object.keys(tmpfs).length !== 1 ||
    !["rw,noexec,nosuid,size=64m", "rw,noexec,nosuid,size=512m"].includes(tmpfs["/tmp"] ?? "") ||
    !address ||
    !/^172\.23\.0\.[1-9][0-9]{0,2}$/u.test(address) ||
    Number(address.split(".")[3]) > 254 ||
    before.Mounts?.filter(
      (mount) =>
        mount.Type === "volume" &&
        mount.Name === "qcrm-staging-platform-storage" &&
        mount.Destination === "/data" &&
        mount.RW,
    ).length !== 1
  )
    throw new HostAdapterError("IDENTITY_MISMATCH");
  const filters = encodeURIComponent(
    JSON.stringify({ label: ["com.quantum.ghl-import-mode=ATTACHMENTS"] }),
  );
  const active = (await api("GET", `/containers/json?all=false&filters=${filters}`)) as unknown;
  if (!Array.isArray(active) || active.length !== 0) throw new HostAdapterError("TARGET_CONFLICT");
  if (tmpfs["/tmp"] === "rw,noexec,nosuid,size=512m" && before.State.Health?.Status === "healthy") {
    if (next !== original) await files.replace(overridePath, original, next, "temp");
    return { state: "APPLIED", tmpfsBytes: 512 * 1024 ** 2, reused: true } as const;
  }
  if (
    tmpfs["/tmp"] !== "rw,noexec,nosuid,size=64m" ||
    before.State.Health?.Status !== "healthy" ||
    (await files.availableMemory()) < 2 * 1024 ** 3
  )
    throw new HostAdapterError("UNAVAILABLE");
  const body = candidateContainerBody(before, before.Image);
  const endpoint = {
    ...body.NetworkingConfig.EndpointsConfig[storageNetwork],
    IPAMConfig: { IPv4Address: address },
  };
  const replacement = {
    ...body,
    Image: before.Config.Image,
    Labels: { ...before.Config.Labels, "com.quantum.ghl-storage-predecessor": before.Id },
    HostConfig: { ...body.HostConfig, Tmpfs: { "/tmp": "rw,noexec,nosuid,size=512m" } },
    NetworkingConfig: { EndpointsConfig: { [storageNetwork]: endpoint } },
  };
  const backupName = `${storageName}-before-ghl-temp512`;
  let candidateId: string | undefined;
  await files.recordPredecessor?.({
    schemaVersion: 1,
    containerId: before.Id,
    imageId: before.Image,
    backupName,
    networkId: network.Id,
    endpoint,
  });
  if (next !== original) await files.replace(overridePath, original, next, "temp");
  try {
    await api("POST", `/containers/${before.Id}/stop?t=30`);
    await api("POST", `/containers/${before.Id}/rename?name=${encodeURIComponent(backupName)}`);
    await api("POST", `/networks/${network.Id as string}/disconnect`, {
      Container: before.Id,
      Force: false,
    });
    const created = (await api(
      "POST",
      `/containers/create?name=${encodeURIComponent(storageName)}`,
      replacement,
    )) as { Id?: string };
    if (!created.Id || !/^[0-9a-f]{64}$/u.test(created.Id))
      throw new HostAdapterError("UNAVAILABLE");
    candidateId = created.Id;
    await api("POST", `/containers/${candidateId}/start`);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const observed = (await api("GET", inspectPath)) as ContainerInspection;
      validateStorage(observed, network);
      if (
        observed.Id !== candidateId ||
        observed.Image !== before.Image ||
        observed.HostConfig.Memory !== targetMemory ||
        (observed.HostConfig.Tmpfs as Record<string, string> | undefined)?.["/tmp"] !==
          "rw,noexec,nosuid,size=512m" ||
        observed.NetworkSettings.Networks[storageNetwork]?.IPAddress !== address ||
        JSON.stringify(observed.HostConfig.Binds) !== JSON.stringify(before.HostConfig.Binds)
      )
        throw new HostAdapterError("IDENTITY_MISMATCH");
      if (observed.State.Health?.Status === "healthy")
        return {
          state: "APPLIED",
          tmpfsBytes: 512 * 1024 ** 2,
          previousContainer: backupName,
          reused: false,
        } as const;
      if (!observed.State.Running || observed.State.Health?.Status === "unhealthy")
        throw new HostAdapterError("UNAVAILABLE");
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
    throw new HostAdapterError("UNAVAILABLE");
  } catch (error) {
    // Docker may have applied a request whose response was lost: reconcile identity and state.
    const named = (await api(
      "GET",
      `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ name: [`^/${storageName}$`] }))}`,
    )) as { Id?: string; Names?: string[] }[];
    if (!Array.isArray(named) || named.length > 1) throw new HostAdapterError("TARGET_CONFLICT");
    const found = named[0];
    if (found && found.Id !== before.Id) {
      if (
        !found.Id ||
        !/^[0-9a-f]{64}$/u.test(found.Id) ||
        !found.Names?.includes(`/${storageName}`)
      )
        throw new HostAdapterError("TARGET_CONFLICT");
      const candidate = (await api("GET", `/containers/${found.Id}/json`)) as ContainerInspection;
      if (
        candidate.Id !== found.Id ||
        candidate.Image !== before.Image ||
        candidate.Config.Labels["com.quantum.ghl-storage-predecessor"] !== before.Id ||
        JSON.stringify(candidate.HostConfig.Binds) !== JSON.stringify(before.HostConfig.Binds)
      )
        throw new HostAdapterError("IDENTITY_MISMATCH");
      await api("DELETE", `/containers/${found.Id}?force=true&v=false`).catch(() => undefined);
      const remaining = (await api(
        "GET",
        `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ id: [found.Id] }))}`,
      )) as unknown;
      if (!Array.isArray(remaining) || remaining.length !== 0)
        throw new HostAdapterError("TARGET_CONFLICT"); // Never start two writers for the same volume.
    }
    const inspectPredecessor = async () => {
      const observed = (await api("GET", `/containers/${before.Id}/json`)) as ContainerInspection;
      if (
        observed.Id !== before.Id ||
        observed.Image !== before.Image ||
        ![`/${storageName}`, `/${backupName}`].includes(observed.Name) ||
        JSON.stringify(observed.Config) !== JSON.stringify(before.Config) ||
        JSON.stringify(observed.HostConfig.Binds) !== JSON.stringify(before.HostConfig.Binds)
      )
        throw new HostAdapterError("IDENTITY_MISMATCH");
      return observed;
    };
    let predecessor = await inspectPredecessor();
    if (!predecessor.NetworkSettings.Networks[storageNetwork]) {
      await api("POST", `/networks/${network.Id as string}/connect`, {
        Container: before.Id,
        EndpointConfig: endpoint,
      }).catch(() => undefined);
      predecessor = await inspectPredecessor();
      if (!predecessor.NetworkSettings.Networks[storageNetwork])
        throw new HostAdapterError("TARGET_CONFLICT");
    }
    if (predecessor.Name !== `/${storageName}`) {
      await api(
        "POST",
        `/containers/${before.Id}/rename?name=${encodeURIComponent(storageName)}`,
      ).catch(() => undefined);
      predecessor = await inspectPredecessor();
      if (predecessor.Name !== `/${storageName}`) throw new HostAdapterError("TARGET_CONFLICT");
    }
    if (!predecessor.State.Running)
      await api("POST", `/containers/${before.Id}/start`).catch(() => undefined);
    const recoveryDeadline = Date.now() + 120_000;
    let recovered = false;
    while (Date.now() < recoveryDeadline) {
      predecessor = await inspectPredecessor();
      if (!predecessor.State.Running || predecessor.State.Health?.Status === "unhealthy") break;
      if (
        predecessor.State.Health?.Status === "healthy" &&
        predecessor.NetworkSettings.Networks[storageNetwork]?.IPAddress === address
      ) {
        recovered = true;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
    if (!recovered) throw new HostAdapterError("TARGET_CONFLICT");
    if (next !== original) await files.replace(overridePath, next, original, "temp-rollback");
    throw error;
  }
}

export async function withAttachmentStorageTuningLock<T>(action: () => Promise<T>): Promise<T> {
  if ((await realpath("/opt/quantum/config/staging")) !== "/opt/quantum/config/staging")
    throw new HostAdapterError("IDENTITY_MISMATCH");
  const lock = await open(lockPath, "wx", 0o600).catch(() => {
    throw new HostAdapterError("TARGET_CONFLICT");
  });
  try {
    return await action();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
