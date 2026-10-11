import { loadGhlMigrationAttachmentsConfig } from "@quantum-crm/config";
import { createCrmPostgresDatabase, createPostgresPool, createHistoricalConversationPostgresRepository, acquireGhlAttachmentImportGuard } from "@quantum-crm/database";
import { FileService, HistoricalConversationService, iamPermissions, type HistoricalImportContext, type FileRecord } from "@quantum-crm/domain";
import { createS3ObjectStorage, createClamAvClient } from "@quantum-crm/files-infrastructure";
import { loadVerifiedGhlImport } from "./ghl-migration-import-artifact.js";
import { importGhlAttachments } from "./ghl-migration-attachments.js";
import { startFileProcessingLoop, type FileProcessingLoop, type FileProcessingRepository } from "./file-processing-loop.js";

async function main(): Promise<void> {
  const config = loadGhlMigrationAttachmentsConfig();
  const artifact = await loadVerifiedGhlImport(config);
  const database = createCrmPostgresDatabase(config.database, "ghl-attachments");
  const pool = createPostgresPool(config.database, "ghl-attachments");
  pool.on("error", () => { process.exitCode = 1; });
  let guard: Awaited<ReturnType<typeof acquireGhlAttachmentImportGuard>> | undefined;
  let processing: FileProcessingLoop | undefined;
  try {
    await database.connect();
    const owner = await database.members.findInitialAdministrator?.();
    if (!owner || owner.status !== "ACTIVE" || !owner.oidcSubject) throw new Error("No active administrator");
    const authorization = await database.memberships.findAuthorizationByOidcSubject(owner.oidcSubject);
    if (!authorization || authorization.status !== "ACTIVE" || authorization.commercialScope !== "PROFILE") throw new Error("Unauthorized import");
    const context: HistoricalImportContext = {actor: {memberId: owner.id, scope: "PROFILE"},
      permissions: iamPermissions.filter((permission) => authorization.permissions.includes(permission))};
    for (const permission of ["crm:conversations:configure", "crm:conversations:read", "crm:files:upload", "crm:files:read", "crm:files:reference"] as const)
      if (!context.permissions.includes(permission)) throw new Error("Unauthorized import");
    guard = await acquireGhlAttachmentImportGuard(pool, {...config, operatorMemberId: owner.id});
    const storageOptions = {endpoint: config.files.endpoint, region: config.files.region,
      incomingBucket: config.files.incomingBucket, objectsBucket: config.files.objectsBucket,
      requestTimeoutMs: 60_000};
    const upload = createS3ObjectStorage({...storageOptions, credentials: {
      accessKey: config.files.uploadCredentials.accessKey.expose(), secretKey: config.files.uploadCredentials.secretKey.expose()}});
    const storage = createS3ObjectStorage({...storageOptions, credentials: {
      accessKey: config.processor.processorCredentials.accessKey.expose(), secretKey: config.processor.processorCredentials.secretKey.expose()}});
    const delivery = createS3ObjectStorage({...storageOptions, credentials: {
      accessKey: config.files.deliveryCredentials.accessKey.expose(), secretKey: config.files.deliveryCredentials.secretKey.expose()}});
    const files: FileService = new FileService(database.commercial.files, {
      canUseOwner: async (actor, fileOwner) => fileOwner.kind === "existing" && fileOwner.module === "conversations" && fileOwner.type === "historical_attachment" &&
        await history.canUseAttachmentOwner(actor, fileOwner.id),
    }, {
      authorizeUpload: async (file: FileRecord) => {
        const signed = upload.reserveUpload({objectKey: file.incomingObjectKey, expectedSha256Base64: file.expectedSha256,
          contentType: file.declaredMime, maxBytes: file.declaredSize, expiresInSeconds: 600});
        return {...signed, method: "POST", expiresAt: new Date(signed.expiresAt)};
      },
      inspectUpload: (file) => upload.inspectIncomingUpload(file.incomingObjectKey),
      authorizeDownload: async (file) => {
        if (!file.objectKey || !file.objectVersionId) throw new Error("File not available");
        return {method: "GET", url: delivery.presignDownload({objectKey: file.objectKey, versionId: file.objectVersionId, expiresInSeconds: 60}),
          expiresAt: new Date(Date.now()+60_000), objectVersionId: file.objectVersionId};
      },
    });
    const history: HistoricalConversationService = new HistoricalConversationService(createHistoricalConversationPostgresRepository(pool), {
      contactExistsFor: async (actor,id) => (await database.commercial.contacts.find(actor,id)) !== null,
      isActiveMember: async (id) => (await database.members.findById(id))?.status === "ACTIVE",
    }, {fileForAttachment: async (actor,id) => {
      const file = await files.get(actor,context.permissions,id);
      return {id: file.id, status: file.status, owner: file.owner, originalName: file.originalName,
        mimeType: file.observedMime ?? file.declaredMime, size: file.observedSize ?? file.declaredSize};
    }});
    const scanner = createClamAvClient(config.processor.clamAv);
    const processingRepository: FileProcessingRepository = {
      claimNext: async (input) => {
        await guard!.check();
        const lease = await database.commercial.files.claimNextProcessing(input);
        return lease ? {operationId: lease.operationId, generation: lease.leaseGeneration, file: lease.file} : null;
      },
      persist: (input) => database.commercial.files.transitionProcessing({operationId: input.lease.operationId,
        leaseGeneration: input.lease.generation, file: input.file, now: input.now}),
    };
    processing = startFileProcessingLoop({repository: processingRepository, storage, scanner, pollIntervalMs: 250, leaseSeconds: 300,
      onError: () => process.stderr.write('{"event":"ghl_attachment_scan_retry"}\n')});
    const result = await importGhlAttachments({artifact, context, files, history, checkLock: guard.check,
      report: (counts) => process.stdout.write(JSON.stringify({event: "ghl_attachment_import_progress", ...counts})+"\n")});
    process.stdout.write(JSON.stringify({event: "ghl_attachment_import_completed", total: result.expectedCount, processed: result.reservedCount,
      available: result.availableCount, rejected: result.rejectedCount, failed: result.failedCount, pending: result.pendingCount + result.missingCount,
      bytes: result.totalBytes})+"\n");
    if (result.pendingCount || result.missingCount || result.failedCount) process.exitCode = 2;
  } finally {
    await processing?.close();
    guard?.close();
    await Promise.all([database.close(), pool.end()]);
  }
}
void main().catch(() => { process.stderr.write('{"event":"ghl_import_failed","code":"ATTACHMENTS_FAILED"}\n'); process.exitCode = 1; });
