import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretValue, type GhlMigrationImportConfig } from "@quantum-crm/config";
import { describe, expect, it, vi } from "vitest";

import { EncryptedGhlExportStorage } from "./ghl-migration-export-storage.js";
import {
  importStreams, loadVerifiedGhlImport, moneyMinor, privateSnapshot,
} from "./ghl-migration-import-artifact.js";

const locationId = "synthetic_location";
const tenantId = "019b0000-0000-7000-8000-000000000001";
const key = new SecretValue("ab".repeat(32));

async function artifactFixture(options: {
  readonly recordSchema?: string;
  readonly sourceLocation?: string;
  readonly totalCount?: number;
  readonly streamCount?: number;
  readonly finish?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "qcrm-ghl-import-test-"));
  const exportId = randomUUID();
  const storage = await EncryptedGhlExportStorage.create(root, exportId, key);
  for (const stream of importStreams) {
    await storage.writePage({
      schemaVersion: "ghl-migration-export-page/v1", exportId, stream,
      records: stream === "CONTACTS" ? [JSON.stringify({
        schemaVersion: options.recordSchema ?? "ghl-migration-export-record/v1",
        resource: "CONTACTS", stream, sourceId: "synthetic_contact",
        record: { id: "synthetic_contact", locationId: options.sourceLocation ?? locationId, firstName: "Synthetic" },
      })] : [],
    });
  }
  if (options.finish === false) await storage.close();
  else await storage.finish({
    schemaVersion: "ghl-migration-export-report/v1", status: "COMPLETE",
    mode: "READ_ONLY", generatedAt: "2026-10-11T12:00:00Z",
    recordsWritten: options.totalCount ?? 1,
    streams: importStreams.map((stream) => ({
      stream, status: "COMPLETE", recordsWritten: stream === "CONTACTS" ? options.streamCount ?? 1 : 0,
    })),
  });
  const artifact = join(storage.directory, "records.qcrm");
  const config: GhlMigrationImportConfig = {
    database: {
      schemaVersion: "database-config/v1", target: "crm", tenantId,
      connectionUrl: new SecretValue("postgres://synthetic:synthetic@database/synthetic"),
      poolMax: 5, connectionTimeoutMs: 5000, statementTimeoutMs: 15000,
      lockTimeoutMs: 5000, idleInTransactionTimeoutMs: 10000,
    },
    tenantId, locationId, operationId: randomUUID(), exportId, artifact,
    artifactSha256: createHash("sha256").update(await readFile(artifact)).digest("hex"),
    encryptionKey: key, currency: "GTQ", mode: "APPLY",
  };
  return { root, config, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe("GHL authenticated import artifact", () => {
  it("accepts the exporter's exact string schema version and reconciles every stream", async () => {
    const fixture = await artifactFixture();
    try {
      const artifact = await loadVerifiedGhlImport(fixture.config);
      expect(artifact.recordCount).toBe(1);
      expect(artifact.records.size).toBe(8);
      expect(artifact.records.get("CONTACTS")?.[0]?.id).toBe("synthetic_contact");
      expect(artifact.generatedAt.toISOString()).toBe("2026-10-11T12:00:00.000Z");
    } finally { await fixture.cleanup(); }
  });

  it("rejects modified ciphertext even when an attacker supplies its new file digest", async () => {
    const fixture = await artifactFixture();
    try {
      const original = await readFile(fixture.config.artifact, "utf8");
      const lines = original.trimEnd().split("\n");
      const envelope = JSON.parse(lines[0] ?? "") as { data: string };
      envelope.data = `${envelope.data.startsWith("A") ? "B" : "A"}${envelope.data.slice(1)}`;
      lines[0] = JSON.stringify(envelope);
      const corrupted = `${lines.join("\n")}\n`;
      await writeFile(fixture.config.artifact, corrupted);
      await expect(loadVerifiedGhlImport(fixture.config)).rejects.toThrow("digest mismatch");
      await expect(loadVerifiedGhlImport({
        ...fixture.config, artifactSha256: createHash("sha256").update(corrupted).digest("hex"),
      })).rejects.toThrow();
    } finally { await fixture.cleanup(); }
  });

  it("does not hand an artifact to destination work without the final authenticated manifest", async () => {
    const fixture = await artifactFixture({ finish: false });
    const destination = vi.fn();
    try {
      await expect(loadVerifiedGhlImport(fixture.config).then(destination)).rejects.toThrow("Incomplete");
      expect(destination).not.toHaveBeenCalled();
    } finally { await fixture.cleanup(); }
  });

  it("rejects schema, source location and expected export identity mismatches", async () => {
    for (const options of [{ recordSchema: "1" }, { sourceLocation: "other_location" }]) {
      const fixture = await artifactFixture(options);
      try { await expect(loadVerifiedGhlImport(fixture.config)).rejects.toThrow("source identity"); }
      finally { await fixture.cleanup(); }
    }
    const fixture = await artifactFixture();
    try {
      await expect(loadVerifiedGhlImport({ ...fixture.config, exportId: randomUUID() })).rejects.toThrow("page identity");
    } finally { await fixture.cleanup(); }
  });

  it("rejects complete manifests whose global or per-stream counts differ", async () => {
    for (const options of [{ totalCount: 2 }, { streamCount: 2 }]) {
      const fixture = await artifactFixture(options);
      try { await expect(loadVerifiedGhlImport(fixture.config)).rejects.toThrow(); }
      finally { await fixture.cleanup(); }
    }
  });

  it("keeps GTQ decimal amounts exact and removes credentials from retained metadata", () => {
    expect(["0", "0.01", "123.45", "123.4500", "8.1"].map(moneyMinor)).toEqual([0n, 1n, 12345n, 12345n, 810n]);
    expect(() => moneyMinor("1.001")).toThrow();
    expect(() => moneyMinor(-1)).toThrow();
    expect(() => moneyMinor(Number.NaN)).toThrow();
    const snapshot = privateSnapshot({
      body: "Preserved text", attachments: ["https://files.example.test/private"],
      access_token: "synthetic-secret", nested: { url: "https://files.example.test/a?X-Amz-Signature=synthetic" },
    });
    expect(JSON.stringify(snapshot)).toContain("Preserved text");
    expect(JSON.stringify(snapshot)).not.toContain("synthetic-secret");
    expect(JSON.stringify(snapshot)).not.toContain("https://files.example.test");
  });
});
