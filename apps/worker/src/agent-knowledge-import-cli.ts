import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { loadAgentKnowledgeImportConfig } from "@quantum-crm/config";
import { createCrmPostgresDatabase } from "@quantum-crm/database";
import { FileService, type FileRecord, type IamPermission } from "@quantum-crm/domain";
import { createS3ObjectStorage, uploadReservedFile } from "@quantum-crm/files-infrastructure";

import { extractAgentCatalogChunks } from "./agent-catalog-pdf.js";

const permissions: readonly IamPermission[] = [
  "crm:files:read",
  "crm:files:upload",
  "crm:files:reference",
  "crm:documents:templates",
];

function stableId(tenantId: string, catalog: string, checksum: string): string {
  const digest = createHash("sha256").update(`${tenantId}:${catalog}:${checksum}`).digest();
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function main(): Promise<void> {
  const config = loadAgentKnowledgeImportConfig();
  const database = createCrmPostgresDatabase(config.database, "agent-knowledge-import");
  try {
    await database.connect();
    const admin = await database.members.findInitialAdministrator?.();
    if (!admin || admin.status !== "ACTIVE" || !admin.oidcSubject)
      throw new Error("No active administrator");
    const authorization = await database.memberships.findAuthorizationByOidcSubject(
      admin.oidcSubject,
    );
    if (
      !authorization ||
      authorization.status !== "ACTIVE" ||
      authorization.commercialScope !== "PROFILE" ||
      permissions.some((permission) => !authorization.permissions.includes(permission))
    ) {
      throw new Error("Knowledge import is not authorized");
    }
    const actor = { memberId: admin.id, scope: "PROFILE" as const };
    const common = {
      endpoint: config.signer.endpoint,
      region: config.signer.region,
      incomingBucket: config.signer.incomingBucket,
      objectsBucket: config.signer.objectsBucket,
      requestTimeoutMs: config.signer.requestTimeoutMs,
    };
    const upload = createS3ObjectStorage({
      ...common,
      credentials: {
        accessKey: config.signer.uploadCredentials.accessKey.expose(),
        secretKey: config.signer.uploadCredentials.secretKey.expose(),
      },
    });
    const delivery = createS3ObjectStorage({
      ...common,
      credentials: {
        accessKey: config.signer.deliveryCredentials.accessKey.expose(),
        secretKey: config.signer.deliveryCredentials.secretKey.expose(),
      },
    });
    const files = new FileService(
      database.commercial.files,
      {
        canUseOwner: async (requestActor, owner) =>
          requestActor.memberId === admin.id &&
          requestActor.scope === "PROFILE" &&
          owner.kind === "existing" &&
          owner.module === "agents" &&
          owner.type === "knowledge_source" &&
          (await database.commercial.agentKnowledge.findSource(owner.id)) !== null,
      },
      {
        authorizeUpload: async (file: FileRecord) => {
          const signed = upload.reserveUpload({
            objectKey: file.incomingObjectKey,
            expectedSha256Base64: file.expectedSha256,
            contentType: file.declaredMime,
            maxBytes: file.declaredSize,
            expiresInSeconds: 600,
          });
          return { ...signed, method: "POST", expiresAt: new Date(signed.expiresAt) };
        },
        inspectUpload: (file) => upload.inspectIncomingUpload(file.incomingObjectKey),
        authorizeDownload: async (file) => {
          if (!file.objectKey || !file.objectVersionId) throw new Error("File not available");
          return {
            method: "GET",
            url: delivery.presignDownload({
              objectKey: file.objectKey,
              versionId: file.objectVersionId,
              expiresInSeconds: 60,
            }),
            expiresAt: new Date(Date.now() + 60_000),
            objectVersionId: file.objectVersionId,
          };
        },
      },
    );
    for (const [catalog, path] of [
      ["individual", config.individualPath],
      ["corporativo", config.corporativoPath],
    ] as const) {
      const bytes = await readFile(path);
      const checksum = createHash("sha256").update(bytes).digest("base64");
      const sourceId = stableId(config.tenantId, catalog, checksum);
      const source = await database.commercial.agentKnowledge.createSource({
        id: sourceId,
        catalog,
        createdByMemberId: admin.id,
      });
      if (source.active && source.status === "READY" && source.revision === checksum) {
        process.stdout.write(JSON.stringify({ event: "agent_catalog_ready", catalog }) + "\n");
        continue;
      }
      const owner = {
        kind: "existing" as const,
        module: "agents" as const,
        type: "knowledge_source" as const,
        id: sourceId,
      };
      const payloadHash = createHash("sha256")
        .update(`${sourceId}:${checksum}:${bytes.length}`)
        .digest("hex");
      const reservation = await files.reserveUpload({
        actor,
        permissions,
        owner,
        fileClass: "DOCUMENT",
        originalName: `${catalog}.pdf`,
        declaredMime: "application/pdf",
        declaredSize: bytes.length,
        expectedSha256: checksum,
        idempotencyKey: `agent-catalog:${sourceId}`,
        payloadHash,
      });
      await database.commercial.agentKnowledge.bindFile(sourceId, reservation.file.id);
      let file = await files.get(actor, permissions, reservation.file.id);
      if (file.status === "PENDING" && !file.incomingVersionId) {
        const receipt = await uploadReservedFile({
          authorization: reservation.upload,
          bytes,
          maxBytes: bytes.length,
          requestTimeoutMs: 120_000,
        });
        await files.completeUpload({
          actor,
          permissions,
          fileId: file.id,
          checksum,
          ...receipt,
          idempotencyKey: `agent-catalog-complete:${sourceId}`,
          payloadHash,
        });
      }
      const until = Date.now() + 10 * 60_000;
      while (Date.now() < until) {
        file = await files.get(actor, permissions, reservation.file.id);
        if (file.status === "AVAILABLE") break;
        if (["REJECTED", "FAILED", "DELETED"].includes(file.status))
          throw new Error("Catalog file validation failed");
        await delay(1_000);
      }
      if (
        file.status !== "AVAILABLE" ||
        file.expectedSha256 !== checksum ||
        file.observedSha256 !== checksum ||
        file.scanVerdict !== "CLEAN"
      )
        throw new Error("Catalog file did not become available");
      await files.attachReference({
        actor,
        permissions,
        fileId: file.id,
        owner,
        kind: "ATTACHMENT",
        idempotencyKey: `agent-catalog-ref:${sourceId}`,
        payloadHash,
      });
      const chunks = await extractAgentCatalogChunks(bytes);
      await database.commercial.agentKnowledge.activate({
        id: sourceId,
        fileId: file.id,
        revision: checksum,
        chunks,
      });
      process.stdout.write(
        JSON.stringify({
          event: "agent_catalog_ready",
          catalog,
          pages: Math.max(...chunks.map((chunk) => chunk.page)),
          chunks: chunks.length,
        }) + "\n",
      );
    }
  } finally {
    await database.close();
  }
}

void main().catch(() => {
  process.stderr.write('{"event":"agent_catalog_import_failed"}\n');
  process.exitCode = 1;
});
