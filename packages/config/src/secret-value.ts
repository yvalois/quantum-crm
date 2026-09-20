import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { QcrmEnvironment } from "./process-config.js";

const redactedValue = "[REDACTED]";
const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

export interface SecretFileMetadata {
  readonly size: number;
  readonly isFile: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

export interface SecretFileSystem {
  readonly lstat: (path: string) => SecretFileMetadata;
  readonly readFile: (path: string) => Uint8Array;
  readonly realpath: (path: string) => string;
}

export interface SecretFileOptions {
  readonly environment: QcrmEnvironment;
  readonly expectedProtectedPath: string;
  readonly fileSystem?: SecretFileSystem;
  readonly maxBytes?: number;
}

const nodeFileSystem: SecretFileSystem = {
  lstat: (path) => lstatSync(path),
  readFile: (path) => readFileSync(path),
  realpath: (path) => realpathSync(path),
};

export class SecretValue {
  readonly #value: string;

  public constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  public expose(): string {
    return this.#value;
  }

  public toJSON(): string {
    return redactedValue;
  }

  public toString(): string {
    return redactedValue;
  }

  public [inspectSymbol](): string {
    return redactedValue;
  }
}

export class SecretFileError extends Error {
  public constructor(logicalName: string) {
    super(`Invalid secret file for ${logicalName}`);
    this.name = "SecretFileError";
  }
}

function isProtectedEnvironment(environment: QcrmEnvironment): boolean {
  return environment === "preview" || environment === "staging" || environment === "production";
}

export function loadSecretFile(
  logicalName: string,
  filePath: string,
  options: SecretFileOptions,
): SecretValue {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const maxBytes = options.maxBytes ?? 16_384;

  try {
    if (!isAbsolute(filePath)) {
      throw new Error("Secret path must be absolute");
    }

    const normalizedPath = resolve(filePath);
    const protectedPath = resolve(options.expectedProtectedPath);
    if (isProtectedEnvironment(options.environment) && normalizedPath !== protectedPath) {
      throw new Error("Secret path is not authorized");
    }

    const metadata = fileSystem.lstat(normalizedPath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > maxBytes
    ) {
      throw new Error("Secret metadata is invalid");
    }

    if (resolve(fileSystem.realpath(normalizedPath)) !== normalizedPath) {
      throw new Error("Secret path resolves elsewhere");
    }

    const bytes = fileSystem.readFile(normalizedPath);
    if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
      throw new Error("Secret size is invalid");
    }

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = decoded.replace(/\r?\n$/u, "");
    if (value.length === 0 || /[\0\r\n]/u.test(value)) {
      throw new Error("Secret content is invalid");
    }

    return new SecretValue(value);
  } catch {
    throw new SecretFileError(logicalName);
  }
}
