import { createHash } from "node:crypto";

import {
  createFileReservation,
  type FileRecord,
  type FileService,
  type HistoricalAttachmentRecord,
  type HistoricalConversationService,
  type HistoricalImportContext,
} from "@quantum-crm/domain";
import { uploadReservedFile } from "@quantum-crm/files-infrastructure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GhlAttachmentDownloadError, type downloadGhlAttachment } from "./ghl-attachment-download.js";
import { importGhlAttachments } from "./ghl-migration-attachments.js";
import {
  importStreams,
  type GhlImportArtifact,
  type ImportRecord,
  type ImportStream,
} from "./ghl-migration-import-artifact.js";

vi.mock("@quantum-crm/files-infrastructure", () => ({ uploadReservedFile: vi.fn() }));

const uuid = (sequence: number) => `019b0000-0000-7000-8000-${String(sequence).padStart(12, "0")}`;
const now = new Date("2026-10-11T12:00:00Z");
const bytes = new TextEncoder().encode("synthetic attachment");
const privateUrl = "https://storage.googleapis.com/synthetic/a.png?token=private-url-canary";
const context: HistoricalImportContext = {
  actor: { memberId: uuid(1), scope: "PROFILE" },
  permissions: ["crm:files:read", "crm:files:upload", "crm:files:reference", "crm:conversations:read", "crm:conversations:configure"],
};

function fixture(urls: readonly string[] = [privateUrl]): GhlImportArtifact {
  const records = new Map<ImportStream, readonly ImportRecord[]>(importStreams.map((stream) => [stream, []]));
  records.set("MESSAGES_NON_EMAIL", [{ id: "message_one", attachments: urls }]);
  return { records, generatedAt: now, recordCount: 1, locationId: "synthetic_location", exportId: uuid(2) };
}

function harness(artifact = fixture(), finalStatus: FileRecord["status"] = "AVAILABLE", initialBytes = 0) {
  const attachments = new Map<string, HistoricalAttachmentRecord>();
  const stored = new Map<string, FileRecord>();
  const reservations = new Map<string, FileRecord>();
  const events: string[] = [];
  let sequence = 10;
  const reserveAttachment = vi.fn<HistoricalConversationService["reserveAttachment"]>(async (_context, input) => {
    const key = `${input.externalMessageId}:${input.attachmentIndex}`;
    const previous = attachments.get(key);
    if (previous) return previous;
    const record: HistoricalAttachmentRecord = {
      id: uuid(sequence++), messageId: uuid(3), attachmentIndex: input.attachmentIndex,
      sourceHash: input.sourceHash, fileId: null, status: "PENDING", errorCode: null,
      name: null, mimeType: null, size: null,
    };
    attachments.set(key, record);
    return record;
  });
  const setAttachmentResult = vi.fn<HistoricalConversationService["setAttachmentResult"]>(async (_context, input) => {
    const entry = [...attachments.entries()].find(([, record]) => record.id === input.attachmentId)!;
    const file = input.fileId ? stored.get(input.fileId) : undefined;
    if (input.status === "AVAILABLE") expect(file?.status).toBe("AVAILABLE");
    const record: HistoricalAttachmentRecord = {
      ...entry[1], fileId: input.fileId, status: input.status, errorCode: input.errorCode,
      name: file?.originalName ?? null, mimeType: file?.declaredMime ?? null,
      size: file?.declaredSize ?? null,
    };
    attachments.set(entry[0], record);
    events.push(`${input.status}:${input.attachmentId}`);
    return record;
  });
  const verifyAttachments = vi.fn<HistoricalConversationService["verifyAttachments"]>(async () => {
    const values = [...attachments.values()];
    const expectedCount = [...artifact.records.values()].reduce((total, rows) => total + rows.reduce((count, row) => count + (Array.isArray(row.attachments) ? row.attachments.length : 0), 0), 0);
    return {
      totalBytes: initialBytes + values.reduce((total, record) => total + (record.size ?? 0), 0),
      expectedCount, reservedCount: values.length, availableCount: values.filter((record) => record.status === "AVAILABLE").length,
      rejectedCount: values.filter((record) => record.status === "REJECTED").length,
      failedCount: values.filter((record) => record.status === "FAILED").length,
      pendingCount: values.filter((record) => record.status === "PENDING").length,
      missingCount: expectedCount - values.length,
    };
  });
  const get = vi.fn<FileService["get"]>(async (_actor, _permissions, id) => {
    const file = stored.get(id);
    if (!file) throw new Error("Synthetic file missing");
    return file;
  });
  const reserveUpload = vi.fn<FileService["reserveUpload"]>(async (input) => {
    const previous = reservations.get(input.idempotencyKey);
    const file = previous ?? createFileReservation({ ...input, id: uuid(sequence++), incomingObjectKey: `incoming/${uuid(sequence)}`, now });
    if (!previous) { stored.set(file.id, file); reservations.set(input.idempotencyKey, file); }
    return { file, replayed: !!previous, upload: { method: "POST", url: "http://platform-storage:8333/incoming", fields: {}, expiresAt: new Date(now.getTime() + 600_000) } };
  });
  const completeUpload = vi.fn<FileService["completeUpload"]>(async (input) => {
    const previous = stored.get(input.fileId)!;
    const file = { ...previous, incomingVersionId: "incoming-version", status: finalStatus };
    stored.set(file.id, file);
    events.push(`COMPLETED:${file.id}`);
    return { file, replayed: false, operation: { id: uuid(sequence++), fileId: file.id, kind: "PROCESS_UPLOAD", status: "PENDING", createdAt: now, updatedAt: now } };
  });
  const attachReference = vi.fn<FileService["attachReference"]>(async (input) => {
    expect(stored.get(input.fileId)?.status).toBe("AVAILABLE");
    return { reference: { id: uuid(sequence++), fileId: input.fileId, owner: input.owner, kind: input.kind, createdAt: now }, replayed: false };
  });
  const download = vi.fn<typeof downloadGhlAttachment>().mockResolvedValue({ bytes, mime: "image/png", fileClass: "IMAGE", name: "Adjunto.png" });
  const report = vi.fn<(result: Readonly<Record<string, number>>) => void>();
  const checkLock = vi.fn(async () => undefined);
  const input = {
    artifact, context, download, report, checkLock,
    files: { get, reserveUpload, completeUpload, attachReference } as unknown as FileService,
    history: { reserveAttachment, setAttachmentResult, verifyAttachments } as unknown as HistoricalConversationService,
  };
  return { input, attachments, stored, events, get, reserveUpload, completeUpload, attachReference, setAttachmentResult, download, report, checkLock };
}

beforeEach(() => vi.mocked(uploadReservedFile).mockReset().mockResolvedValue({ versionId: "incoming-version", receipt: "receipt" }));
afterEach(() => vi.restoreAllMocks());

describe("GHL historical attachment transfer", () => {
  it("binds the pending file before uploading and replay never redownloads or creates a duplicate", async () => {
    const h = harness();
    vi.mocked(uploadReservedFile).mockImplementation(async () => {
      expect([...h.attachments.values()][0]).toMatchObject({ status: "PENDING", fileId: expect.any(String) });
      expect(h.events[0]).toMatch(/^PENDING:/u);
      return { versionId: "incoming-version", receipt: "receipt" };
    });
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ availableCount: 1, pendingCount: 0 });
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ availableCount: 1, pendingCount: 0 });
    expect(h.download).toHaveBeenCalledOnce();
    expect(uploadReservedFile).toHaveBeenCalledOnce();
    expect(h.reserveUpload).toHaveBeenCalledOnce();
    expect(h.completeUpload).toHaveBeenCalledOnce();
    expect(h.attachReference).toHaveBeenCalledOnce();
    expect(h.attachments.size).toBe(1);
    expect(h.stored.size).toBe(1);
    expect(h.checkLock).toHaveBeenCalled();
  });

  it("continues other attachments after a missing source and reports only aggregate numbers", async () => {
    const h = harness(fixture([privateUrl, "https://storage.googleapis.com/synthetic/b.png"]));
    h.download.mockRejectedValueOnce(new GhlAttachmentDownloadError("SOURCE_UNAVAILABLE"));
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ availableCount: 1, failedCount: 1, pendingCount: 0 });
    expect([...h.attachments.values()].map((record) => record.errorCode)).toContain("SOURCE_UNAVAILABLE");
    const reports = h.report.mock.calls.map(([report]) => report);
    expect(JSON.stringify(reports)).not.toContain("private-url-canary");
    expect(JSON.stringify(reports)).not.toContain("https://");
    expect(reports.every((report) => Object.values(report).every((value) => typeof value === "number"))).toBe(true);
    expect(h.attachReference).toHaveBeenCalledOnce();
  });

  it("records scan rejection without publishing a reference or retrying infected bytes", async () => {
    const h = harness(fixture(), "REJECTED");
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ rejectedCount: 1, availableCount: 0 });
    await importGhlAttachments(h.input);
    expect(h.setAttachmentResult).toHaveBeenCalledWith(context, expect.objectContaining({ status: "REJECTED", errorCode: "SCAN_REJECTED" }));
    expect(h.attachReference).not.toHaveBeenCalled();
    expect(h.download).toHaveBeenCalledOnce();
  });

  it("never marks quarantine available and resumes completed uploads without downloading again", async () => {
    const h = harness(fixture(), "QUARANTINED");
    vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(20 * 60_000 + 1);
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ pendingCount: 1, availableCount: 0 });
    expect(h.attachReference).not.toHaveBeenCalled();
    expect(h.setAttachmentResult.mock.calls.some(([, result]) => result.status === "AVAILABLE")).toBe(false);
    for (const [id, file] of h.stored) h.stored.set(id, { ...file, status: "AVAILABLE" });
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ pendingCount: 0, availableCount: 1 });
    expect(h.download).toHaveBeenCalledOnce();
    expect(uploadReservedFile).toHaveBeenCalledOnce();
  });

  it("leaves work pending at the profile byte budget before reserving or uploading bytes", async () => {
    const h = harness(fixture(), "AVAILABLE", 8 * 1024 ** 3 - bytes.length + 1);
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ pendingCount: 1, availableCount: 0, rejectedCount: 0 });
    expect(h.reserveUpload).not.toHaveBeenCalled();
    expect(uploadReservedFile).not.toHaveBeenCalled();
    expect(h.setAttachmentResult).not.toHaveBeenCalled();
  });

  it("serializes the byte budget across concurrent downloads and stops later source requests", async () => {
    const h = harness(fixture([privateUrl, `${privateUrl}&b=2`, `${privateUrl}&c=3`]), "AVAILABLE", 8 * 1024 ** 3 - bytes.length);
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ availableCount: 1, pendingCount: 2, rejectedCount: 0 });
    expect(h.reserveUpload).toHaveBeenCalledOnce();
    expect(uploadReservedFile).toHaveBeenCalledOnce();
    expect(h.download).toHaveBeenCalledTimes(2);
  });

  it("fails closed on unsupported source shapes before opening destination reservations", async () => {
    const artifact = fixture();
    const records = new Map(artifact.records);
    records.set("MESSAGES_NON_EMAIL", [{ id: "bad_message", attachments: [{ url: privateUrl }] }]);
    const h = harness({ ...artifact, records });
    await expect(importGhlAttachments(h.input)).rejects.toThrow("Unsupported attachment source shape");
    expect(h.attachments.size).toBe(0);
    expect(h.download).not.toHaveBeenCalled();
  });

  it("redownloads only an unfinished reservation and refuses changed bytes", async () => {
    const h = harness();
    vi.mocked(uploadReservedFile).mockRejectedValueOnce(new Error("private-network-canary"));
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ failedCount: 1 });
    const file = [...h.stored.values()][0]!;
    expect(file.expectedSha256).toBe(createHash("sha256").update(bytes).digest("base64"));
    h.download.mockResolvedValueOnce({ bytes: new TextEncoder().encode("changed source"), mime: "image/png", fileClass: "IMAGE", name: "Adjunto.png" });
    await expect(importGhlAttachments(h.input)).resolves.toMatchObject({ failedCount: 1, availableCount: 0 });
    expect(uploadReservedFile).toHaveBeenCalledOnce();
    expect(h.stored.size).toBe(1);
    expect(JSON.stringify(h.report.mock.calls)).not.toContain("private-network-canary");
  });
});
