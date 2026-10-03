import { createConnection, type Socket } from "node:net";

export interface ClamAvClientOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly maxSignatureAgeSeconds: number;
  readonly now?: () => Date;
  readonly connect?: (port: number, host: string) => Socket;
}

export interface ClamAvVersion {
  readonly engine: string;
  readonly signatureVersion: string;
  readonly signatureDate: Date;
}

export type ClamAvScanResult =
  | { readonly status: "CLEAN"; readonly version: ClamAvVersion }
  | { readonly status: "INFECTED"; readonly signature: string; readonly version: ClamAvVersion };

export interface ClamAvClient {
  readonly ping: () => Promise<void>;
  readonly version: () => Promise<ClamAvVersion>;
  readonly scan: (bytes: Uint8Array) => Promise<ClamAvScanResult>;
}

export class ClamAvUnavailableError extends Error {
  public constructor(
    public readonly reason: "UNAVAILABLE" | "STALE_SIGNATURES" | "INVALID_RESPONSE",
  ) {
    super(`ClamAV operation failed: ${reason}`);
    this.name = "ClamAvUnavailableError";
  }
}

function responseText(chunks: readonly Uint8Array[]): string {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/[\0\r\n]+$/gu, "");
}

export function parseClamAvVersion(value: string): ClamAvVersion {
  const normalized = value.replace(/[\0\r\n]+$/gu, "");
  const match = /^ClamAV\s+([^/]+)\/([^/]+)\/(.+)$/u.exec(normalized);
  if (!match?.[1] || !match[2] || !match[3]) {
    throw new ClamAvUnavailableError("INVALID_RESPONSE");
  }
  const signatureDate = new Date(match[3]);
  if (Number.isNaN(signatureDate.getTime())) {
    throw new ClamAvUnavailableError("INVALID_RESPONSE");
  }
  return Object.freeze({
    engine: match[1],
    signatureVersion: match[2],
    signatureDate,
  });
}

export function parseClamAvScanResponse(
  value: string,
): { readonly status: "CLEAN" } | { readonly status: "INFECTED"; readonly signature: string } {
  const normalized = value.replace(/[\0\r\n]+$/gu, "");
  if (/^(?:stream|stdin): OK$/u.test(normalized)) return Object.freeze({ status: "CLEAN" });
  const infected = /^(?:stream|stdin): (.+) FOUND$/u.exec(normalized);
  if (infected?.[1]) return Object.freeze({ status: "INFECTED", signature: infected[1] });
  throw new ClamAvUnavailableError("INVALID_RESPONSE");
}

function exchange(
  options: ClamAvClientOptions,
  command: Uint8Array,
  payload?: Uint8Array,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = (options.connect ?? ((port, host) => createConnection(port, host)))(
      options.port,
      options.host,
    );
    const chunks: Uint8Array[] = [];
    let settled = false;
    const fail = (reason: "UNAVAILABLE" | "INVALID_RESPONSE") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new ClamAvUnavailableError(reason));
    };
    socket.setTimeout(options.timeoutMs, () => fail("UNAVAILABLE"));
    socket.once("error", () => fail("UNAVAILABLE"));
    socket.on("data", (chunk: Buffer) => {
      chunks.push(new Uint8Array(chunk));
      if (chunks.reduce((total, current) => total + current.byteLength, 0) > 16_384) {
        fail("INVALID_RESPONSE");
        return;
      }
      if (chunk.includes(0)) {
        if (settled) return;
        settled = true;
        socket.end();
        try {
          resolve(responseText(chunks));
        } catch {
          reject(new ClamAvUnavailableError("INVALID_RESPONSE"));
        }
      }
    });
    socket.once("end", () => {
      if (settled) return;
      settled = true;
      try {
        resolve(responseText(chunks));
      } catch {
        reject(new ClamAvUnavailableError("INVALID_RESPONSE"));
      }
    });
    socket.once("connect", () => {
      socket.write(command);
      if (payload) {
        for (let offset = 0; offset < payload.byteLength; offset += 64 * 1024) {
          const chunk = payload.subarray(offset, Math.min(offset + 64 * 1024, payload.byteLength));
          const size = Buffer.allocUnsafe(4);
          size.writeUInt32BE(chunk.byteLength);
          socket.write(size);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      }
    });
  });
}

export function createClamAvClient(options: ClamAvClientOptions): ClamAvClient {
  const version = async (): Promise<ClamAvVersion> => {
    const parsed = parseClamAvVersion(
      await exchange(options, new TextEncoder().encode("zVERSION\0")),
    );
    const ageSeconds =
      ((options.now ?? (() => new Date()))().getTime() - parsed.signatureDate.getTime()) / 1_000;
    if (ageSeconds < -300 || ageSeconds > options.maxSignatureAgeSeconds) {
      throw new ClamAvUnavailableError("STALE_SIGNATURES");
    }
    return parsed;
  };
  return Object.freeze({
    ping: async () => {
      const response = await exchange(options, new TextEncoder().encode("zPING\0"));
      if (response !== "PONG") throw new ClamAvUnavailableError("INVALID_RESPONSE");
    },
    version,
    scan: async (bytes: Uint8Array) => {
      const scannerVersion = await version();
      const result = parseClamAvScanResponse(
        await exchange(options, new TextEncoder().encode("zINSTREAM\0"), bytes),
      );
      return Object.freeze({ ...result, version: scannerVersion });
    },
  });
}
