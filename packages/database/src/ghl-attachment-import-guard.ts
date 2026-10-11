import type { GhlImportOperationIdentity } from "@quantum-crm/domain";
import type { PostgresPool } from "./postgres-database.js";
/** Serializes the attachment extension without reopening or changing a completed data import. */
export async function acquireGhlAttachmentImportGuard(pool: PostgresPool, identity: GhlImportOperationIdentity) {
  const client = await pool.connect();
  let failed = false;
  client.on("error", () => { failed = true; });
  try {
    const suffix = identity.tenantId.replaceAll("-", "");
    const result = await client.query(
      `SELECT current_database() AS database_name,current_user AS runtime_role,
        pg_try_advisory_lock(hashtextextended($1,0)) AS locked,
        EXISTS(SELECT 1 FROM integrations.ghl_import_operations WHERE id=$2::uuid AND tenant_id=$3::uuid
          AND location_id=$4 AND export_id=$5::uuid AND artifact_sha256=$6 AND currency=$7
          AND operator_member_id=$8::uuid AND status='COMPLETE') AS approved`,
      [`ghl-attachments:${identity.locationId}`,identity.operationId,identity.tenantId,identity.locationId,
        identity.exportId,identity.artifactSha256,identity.currency,identity.operatorMemberId]);
    const row = result.rows[0] as Record<string,unknown> | undefined;
    if (!row?.locked || !row.approved || row.database_name !== `qcrm_t_${suffix}` || row.runtime_role !== `qcrm_r_${suffix}`)
      throw new Error("Attachment target is not approved");
    return {
      check: async () => { if (failed) throw new Error("Attachment import lock lost"); await client.query("SELECT 1"); },
      close: () => { client.release(true); },
    };
  } catch { client.release(true); throw new Error("Attachment target is not approved or is busy"); }
}
