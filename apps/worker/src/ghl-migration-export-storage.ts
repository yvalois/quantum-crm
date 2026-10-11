import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import type { SecretValue } from "@quantum-crm/config";

const format = "qcrm-ghl-export/aes256gcm/v1";
const initialHash = "0".repeat(64);

export class EncryptedGhlExportStorage {
  private sequence = 0;
  private previousHash = initialHash;
  private finalized = false;

  private constructor(
    public readonly directory: string,
    private readonly exportId: string,
    private readonly key: Buffer,
    private readonly file: FileHandle,
  ) {}

  public static async create(
    root: string,
    exportId: string,
    secret: SecretValue,
  ): Promise<EncryptedGhlExportStorage> {
    if (!/^[a-f0-9-]{36}$/u.test(exportId) || !/^[a-f0-9]{64}$/u.test(secret.expose())) {
      throw new Error("Invalid export storage configuration");
    }
    const metadata = await lstat(root);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      resolve(await realpath(root)) !== resolve(root) ||
      (metadata.mode & 0o077) !== 0
    ) {
      throw new Error("Export root must be an existing private directory");
    }
    const directory = join(root, exportId);
    await mkdir(directory, { mode: 0o700 });
    const file = await open(join(directory, "records.qcrm"), "wx", 0o600);
    return new EncryptedGhlExportStorage(
      directory,
      exportId,
      Buffer.from(secret.expose(), "hex"),
      file,
    );
  }

  public async writePage(page: unknown): Promise<void> {
    await this.append({ kind: "page", page });
  }

  private async append(value: unknown): Promise<void> {
    if (this.finalized) throw new Error("Export storage is closed");
    const iv = randomBytes(12);
    const aad = `${format}:${this.exportId}:${this.sequence}:${this.previousHash}`;
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    const line = JSON.stringify({
      format,
      exportId: this.exportId,
      sequence: this.sequence,
      previousHash: this.previousHash,
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      data: ciphertext.toString("base64"),
    });
    await this.file.writeFile(`${line}\n`, "utf8");
    await this.file.sync();
    this.previousHash = createHash("sha256").update(line).digest("hex");
    this.sequence += 1;
  }

  public async finish(report: unknown): Promise<void> {
    await this.append({ kind: "manifest", report });
    await this.close();
  }

  public async close(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    this.key.fill(0);
    await this.file.close();
  }
}

/** Verifies every authenticated page and the final manifest; never writes plaintext. */
export async function verifyEncryptedGhlExport(
  artifact: string,
  secret: SecretValue,
  onPage?: (page: unknown) => Promise<void>,
): Promise<unknown> {
  const key = Buffer.from(secret.expose(), "hex");
  let previousHash = initialHash;
  let sequence = 0;
  let exportId: string | undefined;
  let manifest: unknown;
  let hasManifest = false;
  const input = createReadStream(artifact, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const envelope: unknown = JSON.parse(line);
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
        throw new Error("Invalid encrypted export");
      const e = envelope as Record<string, unknown>;
      if (
        hasManifest ||
        e.format !== format ||
        e.sequence !== sequence ||
        e.previousHash !== previousHash ||
        typeof e.exportId !== "string" ||
        !/^[a-f0-9-]{36}$/u.test(e.exportId) ||
        (exportId !== undefined && exportId !== e.exportId) ||
        typeof e.iv !== "string" ||
        !/^[a-f0-9]{24}$/u.test(e.iv) ||
        typeof e.tag !== "string" ||
        !/^[a-f0-9]{32}$/u.test(e.tag) ||
        typeof e.data !== "string"
      ) {
        throw new Error("Invalid encrypted export sequence");
      }
      exportId = e.exportId;
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "hex"));
      decipher.setAAD(Buffer.from(`${format}:${exportId}:${sequence}:${previousHash}`));
      decipher.setAuthTag(Buffer.from(e.tag, "hex"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(e.data, "base64")),
        decipher.final(),
      ]);
      const payload: unknown = JSON.parse(plaintext.toString("utf8"));
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        throw new Error("Invalid export payload");
      const p = payload as Record<string, unknown>;
      if (p.kind === "page") await onPage?.(p.page);
      else if (p.kind === "manifest") {
        manifest = p.report;
        hasManifest = true;
      } else throw new Error("Invalid export payload kind");
      previousHash = createHash("sha256").update(line).digest("hex");
      sequence += 1;
    }
    if (!hasManifest) throw new Error("Incomplete encrypted export");
    return manifest;
  } finally {
    key.fill(0);
    lines.close();
    input.destroy();
  }
}
