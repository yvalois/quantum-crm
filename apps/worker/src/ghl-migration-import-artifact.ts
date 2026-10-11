import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { GhlMigrationImportConfig } from "@quantum-crm/config";
import type { HistoricalImportSource, HistoricalJsonValue } from "@quantum-crm/domain";
import { verifyEncryptedGhlExport } from "./ghl-migration-export-storage.js";

export const importStreams = [
  "CONTACTS",
  "TAGS",
  "CUSTOM_FIELDS",
  "PIPELINES",
  "OPPORTUNITIES",
  "CONVERSATIONS",
  "MESSAGES_NON_EMAIL",
  "MESSAGES_EMAIL",
] as const;
export type ImportStream = (typeof importStreams)[number];
export type ImportRecord = Readonly<Record<string, HistoricalJsonValue>>;
export interface GhlImportArtifact {
  readonly locationId: string;
  readonly exportId: string;
  readonly records: ReadonlyMap<ImportStream, readonly ImportRecord[]>;
  readonly generatedAt: Date;
  readonly recordCount: number;
}

export function object(value: unknown): ImportRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid import object");
  return value as ImportRecord;
}
export function array(value: unknown): readonly HistoricalJsonValue[] {
  if (!Array.isArray(value)) throw new Error("Invalid import list");
  return value as readonly HistoricalJsonValue[];
}
export function text(value: unknown, max = 1_000_000): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error("Invalid import text");
  return value;
}
export function optionalText(value: unknown, max = 1_000_000): string | null {
  return value === null || value === undefined || value === "" ? null : text(value, max);
}
export function identifier(value: unknown): string {
  const result = text(value, 200);
  if (!/^[A-Za-z0-9_-]+$/u.test(result)) throw new Error("Invalid external identifier");
  return result;
}
export function date(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("Invalid import date");
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error("Invalid import date");
  return result;
}
export function moneyMinor(value: unknown): bigint {
  if (typeof value !== "number" && typeof value !== "string")
    throw new Error("Invalid monetary value");
  const match = /^(\d{1,14})(?:\.(\d{1,2})0*)?$/u.exec(String(value));
  if (!match?.[1]) throw new Error("Unsupported monetary precision");
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

/** Raw bytes stay in the encrypted export; signed URLs/secrets do not enter business tables. */
export function privateSnapshot(value: HistoricalJsonValue): HistoricalJsonValue {
  if (typeof value === "string")
    return /[?&](?:token|key|signature|x-amz-[^=]+|access_token)=/iu.test(value)
      ? "[REFERENCIA EN EXPORTACION CIFRADA]"
      : value;
  if (Array.isArray(value)) return value.map(privateSnapshot);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        /^(?:attachments|password|secret|access_token|refresh_token|authorization)$/iu.test(key)
          ? "[CONSERVADO EN EXPORTACION CIFRADA]"
          : privateSnapshot(child),
      ]),
    );
  return value;
}
export function source(
  locationId: string,
  record: ImportRecord,
  externalId = identifier(record.id),
): HistoricalImportSource {
  return {
    system: "GHL",
    locationId,
    externalId,
    payloadHash: createHash("sha256").update(JSON.stringify(record)).digest("hex"),
    raw: privateSnapshot(record),
  };
}

/** Collects only authenticated data in bounded memory; no destination callback before final verification. */
export async function loadVerifiedGhlImport(
  config: GhlMigrationImportConfig,
): Promise<GhlImportArtifact> {
  const metadata = await lstat(config.artifact);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size > 256 * 1024 * 1024 ||
    metadata.size < 1 ||
    resolve(await realpath(config.artifact)) !== resolve(config.artifact)
  )
    throw new Error("Invalid import artifact");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(config.artifact)) hash.update(chunk as Buffer);
  if (hash.digest("hex") !== config.artifactSha256)
    throw new Error("Import artifact digest mismatch");
  const records = new Map<ImportStream, ImportRecord[]>(
    importStreams.map((stream) => [stream, []]),
  );
  const seen = new Set<string>();
  let count = 0;
  let bytes = 0;
  const manifest = object(
    await verifyEncryptedGhlExport(config.artifact, config.encryptionKey, async (input) => {
      const page = object(input);
      if (
        page.schemaVersion !== "ghl-migration-export-page/v1" ||
        page.exportId !== config.exportId ||
        !importStreams.includes(page.stream as ImportStream)
      )
        throw new Error("Import page identity mismatch");
      const stream = page.stream as ImportStream;
      for (const line of array(page.records)) {
        const encoded = text(line);
        bytes += Buffer.byteLength(encoded);
        if (bytes > 256 * 1024 * 1024 || ++count > 200_000)
          throw new Error("Import exceeds memory budget");
        const row = object(JSON.parse(encoded));
        const record = object(row.record);
        const id = identifier(record.id);
        if (
          row.schemaVersion !== "ghl-migration-export-record/v1" ||
          row.stream !== stream ||
          row.sourceId !== id ||
          record.locationId !== config.locationId
        )
          throw new Error("Import source identity mismatch");
        const key = `${stream.startsWith("MESSAGES_") ? "MESSAGES" : stream}:${id}`;
        if (seen.has(key)) throw new Error("Duplicate import source identifier");
        seen.add(key);
        records.get(stream)?.push(record);
      }
    }),
  );
  const after = await lstat(config.artifact);
  if (
    after.size !== metadata.size ||
    after.mtimeMs !== metadata.mtimeMs ||
    after.ino !== metadata.ino
  )
    throw new Error("Import artifact changed during verification");
  if (
    manifest.schemaVersion !== "ghl-migration-export-report/v1" ||
    manifest.status !== "COMPLETE" ||
    manifest.recordsWritten !== count
  )
    throw new Error("Import requires a complete export");
  const reports = array(manifest.streams).map(object);
  if (reports.length !== importStreams.length) throw new Error("Missing import streams");
  for (const stream of importStreams) {
    const matches = reports.filter((report) => report.stream === stream);
    if (
      matches.length !== 1 ||
      matches[0]?.status !== "COMPLETE" ||
      matches[0]?.recordsWritten !== records.get(stream)?.length
    )
      throw new Error("Import stream count mismatch");
  }
  const generatedAt = date(manifest.generatedAt);
  if (!generatedAt) throw new Error("Missing export timestamp");
  return {
    records,
    generatedAt,
    recordCount: count,
    locationId: config.locationId,
    exportId: config.exportId,
  };
}
