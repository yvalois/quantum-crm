import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdirSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

import {
  tenantStorageBucketReference,
  tenantStorageSecretReference,
  type TenantStorageProvisioner,
  type TenantStorageProvisioningResult,
} from "@quantum-crm/platform-domain";

type StorageProvisioningReason =
  "UNAVAILABLE" | "PERMISSION_DENIED" | "TARGET_CONFLICT" | "IDENTITY_MISMATCH";

export class TenantStorageProvisioningError extends Error {
  public constructor(public readonly reason: StorageProvisioningReason) {
    super(`Tenant storage provisioning failed: ${reason}`);
    this.name = "TenantStorageProvisioningError";
  }
}

interface StorageProvisionerOptions {
  readonly endpoint: string;
  readonly adminAccessKey: string;
  readonly adminSecretKey: string;
  readonly tenantSecretDirectory: string;
}

interface HttpResult {
  readonly status: number;
  readonly body: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function awsDate(now: Date): { short: string; full: string } {
  const full = now.toISOString().replace(/[-:]|\.\d{3}/gu, "");
  return { short: full.slice(0, 8), full };
}

function canonicalPath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/%2F/gu, "/"))
    .join("/");
}

function classify(status: number): StorageProvisioningReason {
  if (status === 401 || status === 403) return "PERMISSION_DENIED";
  if (status === 409) return "TARGET_CONFLICT";
  if (status >= 500) return "UNAVAILABLE";
  return "IDENTITY_MISMATCH";
}

async function signedRequest(
  options: StorageProvisionerOptions,
  service: "iam" | "s3",
  method: string,
  path: string,
  body: string,
  query = "",
  contentType = service === "iam"
    ? "application/x-www-form-urlencoded; charset=utf-8"
    : "application/xml",
): Promise<HttpResult> {
  const endpoint = new URL(options.endpoint);
  const host = endpoint.host;
  const now = awsDate(new Date());
  const payloadHash = sha256(body);
  const headers = new Headers({
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": now.full,
  });
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${now.full}\n`;
  const canonicalRequest = [
    method,
    canonicalPath(path),
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${now.short}/${"us-east-1"}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    now.full,
    credentialScope,
    sha256(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${options.adminSecretKey}`, now.short), "us-east-1"), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  headers.set(
    "authorization",
    `AWS4-HMAC-SHA256 Credential=${options.adminAccessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );
  let response: Response;
  try {
    response = await fetch(`${options.endpoint}${path}${query ? `?${query}` : ""}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TenantStorageProvisioningError("UNAVAILABLE");
  }
  const responseBody = await response.text();
  if (!response.ok) throw new TenantStorageProvisioningError(classify(response.status));
  return { status: response.status, body: responseBody };
}

function xmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, "u"));
  return match?.[1];
}

function iamForm(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

function tenantUserName(tenantProfileId: string): string {
  return `qcrm-tenant-${tenantProfileId.replaceAll("-", "")}`;
}

function secretPath(root: string, tenantProfileId: string, name: string): string {
  const rootPath = resolve(root);
  const target = resolve(rootPath, "tenant", tenantProfileId, name);
  if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`)) {
    throw new TenantStorageProvisioningError("IDENTITY_MISMATCH");
  }
  return target;
}

function readSecret(path: string): string | undefined {
  try {
    const metadata = lstatSync(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o177) !== 0 ||
      (metadata.mode & 0o400) === 0
    ) {
      return undefined;
    }
    const value = readFileSync(path, "utf8").trim();
    if (value.length === 0 || value.length > 256 || /[\0\r\n]/u.test(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function writeSecret(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, `${value}\n`, { encoding: "utf8", mode: 0o400, flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    unlinkSync(temporary, { force: true });
    throw error;
  }
}

function xmlValues(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}>([^<]+)</${tag}>`, "gu"))].map((match) => match[1]!);
}

export function createTenantStorageProvisioner(
  options: StorageProvisionerOptions,
): TenantStorageProvisioner {
  return Object.freeze({
    provision: async (command): Promise<TenantStorageProvisioningResult> => {
      const incoming = tenantStorageBucketReference(
        command.tenantProfileId,
        "INCOMING",
        command.quotaMiB,
      );
      const objects = tenantStorageBucketReference(
        command.tenantProfileId,
        "OBJECTS",
        command.quotaMiB,
      );
      const accessKeyReference = tenantStorageSecretReference(
        command.tenantProfileId,
        "ACCESS_KEY",
      );
      const secretKeyReference = tenantStorageSecretReference(
        command.tenantProfileId,
        "SECRET_KEY",
      );
      const accessKeyPath = secretPath(
        options.tenantSecretDirectory,
        command.tenantProfileId,
        "storage-access-key",
      );
      const secretKeyPath = secretPath(
        options.tenantSecretDirectory,
        command.tenantProfileId,
        "storage-secret-key",
      );
      const userName = tenantUserName(command.tenantProfileId);

      const getUser = await signedRequest(
        options,
        "iam",
        "POST",
        "/",
        iamForm({ Action: "GetUser", Version: "2010-05-08", UserName: userName }),
      ).catch((error: unknown) => {
        if (
          error instanceof TenantStorageProvisioningError &&
          error.reason === "IDENTITY_MISMATCH"
        ) {
          return undefined;
        }
        throw error;
      });
      if (!getUser) {
        await signedRequest(
          options,
          "iam",
          "POST",
          "/",
          iamForm({ Action: "CreateUser", Version: "2010-05-08", UserName: userName }),
        );
      }

      let accessKey = readSecret(accessKeyPath);
      let secretKey = readSecret(secretKeyPath);
      if (accessKey && !secretKey) throw new TenantStorageProvisioningError("IDENTITY_MISMATCH");
      if (!accessKey && secretKey) throw new TenantStorageProvisioningError("IDENTITY_MISMATCH");
      if (!accessKey || !secretKey) {
        const keys = await signedRequest(
          options,
          "iam",
          "POST",
          "/",
          iamForm({ Action: "ListAccessKeys", Version: "2010-05-08", UserName: userName }),
        );
        for (const existingAccessKey of xmlValues(keys.body, "AccessKeyId")) {
          await signedRequest(
            options,
            "iam",
            "POST",
            "/",
            iamForm({
              Action: "DeleteAccessKey",
              Version: "2010-05-08",
              UserName: userName,
              AccessKeyId: existingAccessKey,
            }),
          );
        }
        const keyResponse = await signedRequest(
          options,
          "iam",
          "POST",
          "/",
          iamForm({ Action: "CreateAccessKey", Version: "2010-05-08", UserName: userName }),
        );
        accessKey = xmlValue(keyResponse.body, "AccessKeyId");
        secretKey = xmlValue(keyResponse.body, "SecretAccessKey");
        if (!accessKey || !secretKey) throw new TenantStorageProvisioningError("IDENTITY_MISMATCH");
        writeSecret(accessKeyPath, accessKey);
        writeSecret(secretKeyPath, secretKey);
      }

      const policyName = "quantum-crm-storage";
      const policy = JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["s3:ListBucket"],
            Resource: [`arn:aws:s3:::${incoming.bucketName}`, `arn:aws:s3:::${objects.bucketName}`],
          },
          {
            Effect: "Allow",
            Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:GetObjectVersion"],
            Resource: [
              `arn:aws:s3:::${incoming.bucketName}/*`,
              `arn:aws:s3:::${objects.bucketName}/*`,
            ],
          },
        ],
      });
      await signedRequest(
        options,
        "iam",
        "POST",
        "/",
        iamForm({
          Action: "PutUserPolicy",
          Version: "2010-05-08",
          UserName: userName,
          PolicyName: policyName,
          PolicyDocument: policy,
        }),
      );

      for (const bucket of [incoming, objects]) {
        await signedRequest(options, "s3", "PUT", `/${bucket.bucketName}`, "").catch(
          (error: unknown) => {
            if (
              !(error instanceof TenantStorageProvisioningError) ||
              error.reason !== "TARGET_CONFLICT"
            )
              throw error;
          },
        );
        await signedRequest(
          options,
          "s3",
          "PUT",
          `/${bucket.bucketName}`,
          '<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>',
          "versioning=",
        );
        const quotaBytes = bucket.quotaMiB * 1024 * 1024;
        await signedRequest(
          options,
          "s3",
          "PUT",
          `/${bucket.bucketName}`,
          JSON.stringify({ quota_size: quotaBytes, quota_unit: "B", quota_enabled: true }),
          "seaweedfs-quota=",
          "application/json",
        );
      }

      return Object.freeze({
        buckets: Object.freeze([incoming, objects]),
        secrets: Object.freeze([accessKeyReference, secretKeyReference]),
        reconciled: Boolean(getUser && accessKey && secretKey),
      });
    },
  });
}
