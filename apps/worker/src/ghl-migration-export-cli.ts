import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { loadGhlMigrationExportConfig } from "@quantum-crm/config";

import { exportGhlMigration } from "./ghl-migration-export.js";
import {
  EncryptedGhlExportStorage,
  verifyEncryptedGhlExport,
} from "./ghl-migration-export-storage.js";
import { GhlReadOnlyClient } from "./ghl-migration-probe-client.js";

async function main(): Promise<void> {
  const config = loadGhlMigrationExportConfig();
  const exportId = randomUUID();
  const deadlineEpochMilliseconds = Date.now() + config.deadlineSeconds * 1_000;
  const storage = await EncryptedGhlExportStorage.create(
    config.outputRoot,
    exportId,
    config.encryptionKey,
  );
  const client = new GhlReadOnlyClient({
    apiOrigin: config.apiOrigin,
    locationId: config.locationId,
    token: config.token,
    requestTimeoutMs: 25_000,
    deadlineEpochMilliseconds,
  });
  process.stdout.write(`${JSON.stringify({ event: "STARTED", exportId, mode: "READ_ONLY" })}\n`);
  let lastProgressAt = 0;
  try {
    const report = await exportGhlMigration(
      {
        exportId,
        locationId: config.locationId,
        maxRequests: config.maxRequests,
        deadlineEpochMilliseconds,
      },
      client,
      {
        async writePage(page) {
          await storage.writePage(page);
          if (page.checkpoint.complete || Date.now() - lastProgressAt >= 10_000) {
            lastProgressAt = Date.now();
            process.stdout.write(
              `${JSON.stringify({ event: "PROGRESS", stream: page.stream, records: page.checkpoint.recordsWritten, total: page.checkpoint.sourceReportedTotal, complete: page.checkpoint.complete })}\n`,
            );
          }
        },
        finish: (result) => storage.finish(result),
      },
    );
    const verified = await verifyEncryptedGhlExport(
      join(storage.directory, "records.qcrm"),
      config.encryptionKey,
    );
    if (JSON.stringify(verified) !== JSON.stringify(report))
      throw new Error("Export verification mismatch");
    process.stdout.write(`${JSON.stringify({ event: "VERIFIED", exportId, report })}\n`);
    if (report.status !== "COMPLETE") process.exitCode = 2;
  } finally {
    await storage.close();
  }
}

void main().catch(() => {
  process.stderr.write(
    `${JSON.stringify({ event: "FAILED", code: "EXPORT_INCOMPLETE", note: "No destination data was modified" })}\n`,
  );
  process.exitCode = 1;
});
