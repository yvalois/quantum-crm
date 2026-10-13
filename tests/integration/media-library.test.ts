import { createHash, randomUUID } from "node:crypto";

import { parseDatabaseConfig } from "@quantum-crm/config";
import { createFilePostgresRepository } from "@quantum-crm/database";
import {
  createFileReservation,
  FileStateConflictError,
  type CommercialActor,
} from "@quantum-crm/domain";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const profiles = ["a", "b"].map((suffix) => {
  const tenantId = `00000000-0000-4000-8000-00000000000${suffix}`;
  const config = parseDatabaseConfig(
    "media-library-integration",
    {
      target: "crm",
      requiresTenant: true,
    },
    "test",
    {
      QCRM_TENANT_ID: tenantId,
      QCRM_DATABASE_URL_FILE: `/run/secrets/ghl_import_test_${suffix}_database_url`,
    },
  );
  const pool = new Pool({ connectionString: config.connectionUrl.expose(), max: 3 });
  return { tenantId, pool, files: createFilePostgresRepository(pool) };
});
const profileA = profiles[0]!;
const profileB = profiles[1]!;
const actor: CommercialActor = { memberId: randomUUID(), scope: "PROFILE" };
const other: CommercialActor = { memberId: randomUUID(), scope: "OWN" };
const now = new Date("2026-10-13T12:00:00.000Z");

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

beforeAll(async () => {
  for (const profile of profiles) {
    const suffix = profile.tenantId.replaceAll("-", "");
    const identity = await profile.pool.query<{ database_name: string; runtime_role: string }>(
      "SELECT current_database() AS database_name, current_user AS runtime_role",
    );
    expect(identity.rows[0]).toEqual({
      database_name: `qcrm_t_${suffix}`,
      runtime_role: `qcrm_r_${suffix}`,
    });
  }
});

afterAll(async () => {
  await Promise.all(profiles.map((profile) => profile.pool.end()));
});

describe("DOC-14 media organization in isolated PostgreSQL profiles", () => {
  it("creates folders idempotently, searches all pages, moves and tags without changing bytes", async () => {
    const fileId = randomUUID();
    const file = createFileReservation({
      id: fileId,
      fileClass: "IMAGE",
      owner: { kind: "library" },
      originalName: "Catalogo original.png",
      declaredMime: "image/png",
      declaredSize: 512,
      expectedSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      incomingObjectKey: `incoming/${fileId}`,
      now,
    });
    await profileA.files.reserve({
      file,
      actorMemberId: actor.memberId,
      idempotencyKey: `media-reserve-${fileId}`,
      payloadHash: hash(fileId),
    });
    const folderInput = {
      actor,
      id: randomUUID(),
      parentId: null,
      name: "Vehículos",
      idempotencyKey: `media-folder-${fileId}`,
      payloadHash: hash("Vehículos"),
    };
    const folder = await profileA.files.createMediaFolder(folderInput);
    expect((await profileA.files.createMediaFolder({ ...folderInput, id: randomUUID() })).id).toBe(
      folder.id,
    );
    const moved = await profileA.files.organizeMediaFile({
      actor,
      fileId,
      folderId: folder.id,
      name: "SUV de prueba",
      tags: ["suv", "renta"],
    });
    expect(moved).toMatchObject({
      id: fileId,
      originalName: "Catalogo original.png",
      libraryTitle: "SUV de prueba",
      libraryFolderId: folder.id,
      libraryTags: ["suv", "renta"],
      incomingObjectKey: file.incomingObjectKey,
    });
    const result = await profileA.files.list(actor, {
      collection: "library",
      search: "suv",
      folderId: folder.id,
      tag: "suv",
      sort: "NAME",
      limit: 1,
    });
    expect(result.items.map((item) => item.id)).toEqual([fileId]);
    expect(
      (
        await profileA.files.list(actor, {
          collection: "library",
          search: "inexistente",
          limit: 25,
        })
      ).items,
    ).toEqual([]);
    expect((await profileA.files.list(other, { collection: "library", limit: 25 })).items).toEqual(
      [],
    );
    expect(await profileA.files.listMediaFolders(other)).toEqual([]);
    expect((await profileB.files.list(actor, { collection: "library", limit: 25 })).items).toEqual(
      [],
    );
    expect(
      await profileB.files.organizeMediaFile({
        actor,
        fileId,
        folderId: null,
        name: "No permitido",
        tags: [],
      }),
    ).toBeNull();
    await expect(profileA.files.deleteMediaFolder(actor, folder.id)).rejects.toBeInstanceOf(
      FileStateConflictError,
    );
    await profileA.files.organizeMediaFile({
      actor,
      fileId,
      folderId: null,
      name: "SUV de prueba",
      tags: [],
    });
    expect(await profileA.files.deleteMediaFolder(actor, folder.id)).toBe(true);
  });
});
