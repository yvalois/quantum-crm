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

import type { CandidateDockerApi, ContainerInspection } from "./ghl-candidate-operations.js";
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
  readonly replace: (path: string, previous: string, next: string) => Promise<void>;
  readonly availableMemory: () => Promise<number>;
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
  async replace(path, previous, next) {
    if (path !== overridePath) throw new HostAdapterError("IDENTITY_MISMATCH");
    const before = await checkedFile(path);
    const predecessor = `${path}.before-ghl-storage-memory`;
    try {
      await writeFile(predecessor, previous, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      await checkedFile(predecessor);
      if ((await readFile(predecessor, "utf8")) !== previous)
        throw new HostAdapterError("TARGET_CONFLICT");
    }
    const temporary = `${path}.ghl-memory-update`;
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
