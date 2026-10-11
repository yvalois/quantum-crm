import type { GhlImportOperationIdentity, GhlImportOperationRepository, GhlImportProgress } from "@quantum-crm/domain";
import type { PoolClient } from "pg";
import type { PostgresPool } from "./postgres-database.js";

export function createGhlImportOperationRepository(pool: PostgresPool): GhlImportOperationRepository {
  let client: PoolClient | undefined;
  let active: GhlImportOperationIdentity | undefined;
  let failedConnection = false;
  const assertActive = (): PoolClient => {
    if (!client || !active || failedConnection) throw new Error("Import operation is not active");
    return client;
  };
  const compare = (row: Record<string, unknown>, identity: GhlImportOperationIdentity): void => {
    if (row.tenant_id !== identity.tenantId || row.location_id !== identity.locationId || row.export_id !== identity.exportId ||
      row.artifact_sha256 !== identity.artifactSha256 || row.currency !== identity.currency || row.operator_member_id !== identity.operatorMemberId) {
      throw new Error("Import operation identity conflict");
    }
  };
  return {
    begin: async (identity) => {
      if (client) throw new Error("Import operation already active");
      client = await pool.connect();
      client.on("error", () => { failedConnection = true; });
      try {
        const check = await client.query<{ database_name: string; runtime_role: string; locked: boolean }>(
          "SELECT current_database() AS database_name, current_user AS runtime_role, pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          [`ghl-import:${identity.locationId}`],
        );
        const suffix = identity.tenantId.replaceAll("-", "");
        if (!check.rows[0]?.locked || check.rows[0].database_name !== `qcrm_t_${suffix}` || check.rows[0].runtime_role !== `qcrm_r_${suffix}`) throw new Error("Import target unavailable");
        await client.query("BEGIN");
        const current = await client.query("SELECT * FROM integrations.ghl_import_operations WHERE id=$1::uuid FOR UPDATE", [identity.operationId]);
        if (current.rows[0]) {
          compare(current.rows[0] as Record<string, unknown>, identity);
          await client.query("UPDATE integrations.ghl_import_operations SET status='RUNNING', attempts=attempts+1, updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid", [identity.operationId]);
        } else {
          await client.query(`INSERT INTO integrations.ghl_import_operations(id,tenant_id,location_id,export_id,artifact_sha256,currency,operator_member_id,status)
            VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7::uuid,'RUNNING')`,
          [identity.operationId, identity.tenantId, identity.locationId, identity.exportId, identity.artifactSha256, identity.currency, identity.operatorMemberId]);
        }
        await client.query("INSERT INTO integrations.ghl_import_events(operation_id,event_type) VALUES($1::uuid,'STARTED')", [identity.operationId]);
        await client.query("COMMIT");
        active = identity;
      } catch {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release(true); client = undefined;
        throw new Error("Import target or operation validation failed");
      }
    },
    checkpoint: async (progress) => {
      const connection = assertActive();
      await connection.query("BEGIN");
      try {
        await connection.query("UPDATE integrations.ghl_import_operations SET progress=jsonb_set(progress,ARRAY[$2],$3::jsonb), updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid AND status='RUNNING'", [active?.operationId, progress.resource, JSON.stringify(progress)]);
        await connection.query("INSERT INTO integrations.ghl_import_events(operation_id,event_type,progress) VALUES($1::uuid,'PROGRESS',$2::jsonb)", [active?.operationId, JSON.stringify(progress)]);
        await connection.query("COMMIT");
      } catch {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw new Error("Import checkpoint failed");
      }
    },
    finish: async (status) => {
      const connection = assertActive();
      await connection.query("BEGIN");
      try {
        await connection.query("UPDATE integrations.ghl_import_operations SET status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid", [active?.operationId, status]);
        await connection.query("INSERT INTO integrations.ghl_import_events(operation_id,event_type) VALUES($1::uuid,$2)", [active?.operationId, status]);
        await connection.query("COMMIT");
      } catch {
        await connection.query("ROLLBACK").catch(() => undefined);
        throw new Error("Import completion failed");
      }
    },
    inspect: async (identity) => {
      const connection = await pool.connect();
      try {
        const result = await connection.query("SELECT * FROM integrations.ghl_import_operations WHERE id=$1::uuid", [identity.operationId]);
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) return null;
        compare(row, identity);
        return {status: String(row.status), progress: Object.values(row.progress as Record<string, GhlImportProgress>)};
      } finally { connection.release(); }
    },
    close: async () => {
      // Destroying this session releases the session-scoped exclusion lock even after a failed transaction.
      client?.release(true); client = undefined; active = undefined;
    },
  };
}
