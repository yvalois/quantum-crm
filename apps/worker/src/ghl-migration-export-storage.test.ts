import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SecretValue } from "@quantum-crm/config";
import { describe, expect, it } from "vitest";

import {
  EncryptedGhlExportStorage,
  verifyEncryptedGhlExport,
} from "./ghl-migration-export-storage.js";

describe("encrypted GHL export storage", () => {
  it("authenticates pages and the manifest without storing plaintext", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-ghl-storage-"));
    try {
      const key = new SecretValue("ab".repeat(32));
      const storage = await EncryptedGhlExportStorage.create(root, randomUUID(), key);
      const page = { records: ["synthetic.private@example.test"], checkpoint: "synthetic-cursor" };
      await storage.writePage(page);
      await storage.finish({ status: "COMPLETE", count: 1 });
      const artifact = join(storage.directory, "records.qcrm");
      const contents = await readFile(artifact, "utf8");
      expect(contents).not.toContain("synthetic.private");
      expect(contents).not.toContain("synthetic-cursor");
      const pages: unknown[] = [];
      await expect(
        verifyEncryptedGhlExport(artifact, key, async (value) => {
          pages.push(value);
        }),
      ).resolves.toEqual({ status: "COMPLETE", count: 1 });
      expect(pages).toEqual([page]);
      await expect(
        verifyEncryptedGhlExport(artifact, new SecretValue("cd".repeat(32))),
      ).rejects.toThrow();
      await writeFile(artifact, contents.split("\n").slice(0, 1).join("\n") + "\n");
      await expect(verifyEncryptedGhlExport(artifact, key)).rejects.toThrow("Incomplete");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an existing export directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "qcrm-ghl-storage-"));
    try {
      const key = new SecretValue("ab".repeat(32));
      const id = randomUUID();
      const storage = await EncryptedGhlExportStorage.create(root, id, key);
      await storage.close();
      await expect(EncryptedGhlExportStorage.create(root, id, key)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
