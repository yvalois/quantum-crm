import { inflateRawSync } from "node:zlib";

import type { ContactImportRow } from "@quantum-crm/domain";

const maximumBytes = 5 * 1024 * 1024;
const maximumRows = 5_000;
const maximumZipEntries = 64;
const maximumXmlBytes = 5 * 1024 * 1024;

export class ContactImportFileError extends Error {
  public constructor(message = "Invalid contact import file") {
    super(message);
    this.name = "ContactImportFileError";
  }
}

function header(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, "");
}

function cell(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([\da-f]+);/giu, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function xmlText(value: string): string {
  return decodeXml(
    [...value.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/giu)].map((match) => match[1] ?? "").join(""),
  );
}

function parseCsv(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((item) => item.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new ContactImportFileError("The CSV contains an unclosed quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((item) => item.trim() !== "")) rows.push(row);
  }
  return rows;
}

function unzip(bytes: Buffer): Map<string, Buffer> {
  const endOfCentralDirectory = 0x06054b50;
  const centralDirectoryEntry = 0x02014b50;
  const localFileEntry = 0x04034b50;
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (bytes.readUInt32LE(index) === endOfCentralDirectory) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new ContactImportFileError("The XLSX archive is invalid");
  const entryCount = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralOffset = bytes.readUInt32LE(end + 16);
  if (entryCount > maximumZipEntries || centralOffset + centralSize > bytes.length) {
    throw new ContactImportFileError("The XLSX archive is too large");
  }

  const files = new Map<string, Buffer>();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(cursor) !== centralDirectoryEntry) throw new ContactImportFileError();
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (uncompressedSize > maximumXmlBytes || localOffset + 30 > bytes.length) {
      throw new ContactImportFileError("The XLSX archive is too large");
    }
    if (bytes.readUInt32LE(localOffset) !== localFileEntry) throw new ContactImportFileError();
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new ContactImportFileError();
    const compressed = bytes.subarray(dataStart, dataEnd);
    let content: Buffer;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8)
      content = inflateRawSync(compressed, { maxOutputLength: maximumXmlBytes });
    else throw new ContactImportFileError("The XLSX uses an unsupported compression method");
    if (content.length > maximumXmlBytes)
      throw new ContactImportFileError("The XLSX archive is too large");
    files.set(name, content);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function parseXlsx(bytes: Buffer): string[][] {
  const files = unzip(bytes);
  const worksheetName = [...files.keys()].find((name) =>
    /^xl\/worksheets\/[^/]+\.xml$/u.test(name),
  );
  if (!worksheetName) throw new ContactImportFileError("The file has no worksheet");
  const sharedStrings = files.get("xl/sharedStrings.xml");
  const shared = sharedStrings
    ? [...sharedStrings.toString("utf8").matchAll(/<si\b[\s\S]*?<\/si>/giu)].map((match) =>
        xmlText(match[0]),
      )
    : [];
  const worksheet = files.get(worksheetName)!.toString("utf8");
  const rows: string[][] = [];
  for (const rowMatch of worksheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/giu)) {
    const row: string[] = [];
    for (const cellMatch of (rowMatch[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/giu)) {
      const attributes = cellMatch[1] ?? "";
      const body = cellMatch[2] ?? "";
      const reference = attributes.match(/\br="([A-Z]+)\d+"/u)?.[1];
      if (!reference) continue;
      let column = 0;
      for (const character of reference) column = column * 26 + character.charCodeAt(0) - 64;
      const type = attributes.match(/\bt="([^"]+)"/u)?.[1];
      const value =
        type === "inlineStr"
          ? xmlText(body)
          : decodeXml(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/iu)?.[1] ?? "");
      const resolved = type === "s" ? (shared[Number(value)] ?? "") : value;
      row[column - 1] = resolved;
    }
    rows.push(row.map((value) => value ?? ""));
  }
  return rows;
}

function rowsFromFile(bytes: Buffer): string[][] {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseXlsx(bytes);
  return parseCsv(bytes.toString("utf8").replace(/^\uFEFF/u, ""));
}

export function parseContactImportFile(input: {
  readonly fileName: string;
  readonly contentBase64: string;
}): readonly ContactImportRow[] {
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.contentBase64) ||
    input.contentBase64.length % 4 !== 0
  ) {
    throw new ContactImportFileError();
  }
  const bytes = Buffer.from(input.contentBase64, "base64");
  if (bytes.length === 0 || bytes.length > maximumBytes) throw new ContactImportFileError();
  let rows: string[][];
  try {
    rows = rowsFromFile(bytes);
  } catch (error) {
    if (error instanceof ContactImportFileError) throw error;
    throw new ContactImportFileError();
  }
  if (rows.length < 2 || rows.length > maximumRows + 1) throw new ContactImportFileError();
  const headings = rows[0]!.map(header);
  const displayIndex = headings.findIndex((value) =>
    ["displayname", "name", "nombre"].includes(value),
  );
  const emailIndex = headings.findIndex((value) =>
    ["email", "correo", "correoelectronico"].includes(value),
  );
  const phoneIndex = headings.findIndex((value) => ["phone", "telefono", "tel"].includes(value));
  if (displayIndex < 0 || (emailIndex < 0 && phoneIndex < 0)) {
    throw new ContactImportFileError("Columns displayName and email or phone are required");
  }
  return Object.freeze(
    rows.slice(1).map((row, index) => ({
      rowNumber: index + 2,
      displayName: String(row[displayIndex] ?? ""),
      email: emailIndex < 0 ? null : cell(row[emailIndex]),
      phone: phoneIndex < 0 ? null : cell(row[phoneIndex]),
    })),
  );
}
