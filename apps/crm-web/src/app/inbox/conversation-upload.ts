import type { FileClass, FileContract } from "@quantum-crm/contracts";

const accepted: Readonly<
  Record<string, { readonly fileClass: FileClass; readonly maxBytes: number }>
> = {
  "image/jpeg": { fileClass: "IMAGE", maxBytes: 5_000_000 },
  "image/png": { fileClass: "IMAGE", maxBytes: 5_000_000 },
  "audio/mpeg": { fileClass: "AUDIO", maxBytes: 16_000_000 },
  "audio/ogg": { fileClass: "AUDIO", maxBytes: 16_000_000 },
  "application/pdf": { fileClass: "DOCUMENT", maxBytes: 50_000_000 },
  "text/plain": { fileClass: "DOCUMENT", maxBytes: 50_000_000 },
};

async function responseError(response: Response): Promise<Error> {
  const payload: unknown = await response.json().catch(() => null);
  return new Error(
    payload &&
      typeof payload === "object" &&
      "title" in payload &&
      typeof payload.title === "string"
      ? payload.title
      : "No se pudo completar la carga.",
  );
}

async function digest(file: File): Promise<string> {
  const checksum = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  for (const byte of checksum) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function uploadConversationFile(input: {
  readonly file: File;
  readonly conversationId: string;
  readonly csrf: string;
  readonly progress: (message: string) => void;
}): Promise<FileContract> {
  const format = accepted[input.file.type];
  if (!format || !input.file.size || input.file.size > format.maxBytes) {
    throw new Error("Formato o tamaño no compatible con WhatsApp.");
  }
  const checksum = await digest(input.file);
  const intent = await fetch("/api/files", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": input.csrf,
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      owner: {
        kind: "existing",
        module: "conversations",
        type: "conversation",
        id: input.conversationId,
      },
      fileClass: format.fileClass,
      originalName: input.file.name,
      declaredMime: input.file.type,
      declaredSize: input.file.size,
      expectedSha256: checksum,
    }),
  });
  if (!intent.ok) throw await responseError(intent);
  const reservation = (await intent.json()) as {
    readonly data: {
      readonly file: FileContract;
      readonly upload: {
        readonly url: string;
        readonly fields: Readonly<Record<string, string>>;
      };
    };
  };
  const body = new FormData();
  for (const [key, value] of Object.entries(reservation.data.upload.fields))
    body.append(key, value);
  body.append("qcrm-upload-url", reservation.data.upload.url);
  body.append("file", input.file, input.file.name);
  input.progress(`Subiendo ${input.file.name}…`);
  const stored = await fetch("/api/files/upload", {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-csrf-token": input.csrf },
    body,
  });
  const receiptBody = await stored.text();
  if (!stored.ok) throw new Error("El almacenamiento rechazó el archivo.");
  const versionId =
    stored.headers.get("x-amz-version-id") ??
    receiptBody.match(/<VersionId>([^<]+)<\/VersionId>/u)?.[1];
  const completed = await fetch(`/api/files/${reservation.data.file.id}/complete`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": input.csrf,
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      checksum,
      ...(versionId ? { versionId } : {}),
      ...(stored.headers.get("etag") ? { receipt: stored.headers.get("etag") } : {}),
    }),
  });
  if (!completed.ok) throw await responseError(completed);
  input.progress("Validando y escaneando el archivo…");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    const status = await fetch(`/api/files/${reservation.data.file.id}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!status.ok) throw await responseError(status);
    const file = ((await status.json()) as { readonly data: FileContract }).data;
    if (file.status === "AVAILABLE") return file;
    if (["REJECTED", "FAILED", "DELETED"].includes(file.status)) {
      throw new Error("El archivo no superó la validación de seguridad.");
    }
  }
  throw new Error("El archivo sigue en validación. Revísalo más tarde en la biblioteca.");
}
