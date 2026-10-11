import { loadGhlMigrationImportConfig } from "@quantum-crm/config";
import { createCrmPostgresDatabase, createPostgresPool, createContactsHistoricalImportPort,
  createSettingsHistoricalImportPort, createSalesHistoricalImportPort,
  createContactsHistoricalImportVerification, createSettingsHistoricalImportVerification, createSalesHistoricalImportVerification,
  createHistoricalConversationPostgresRepository, createGhlImportOperationRepository } from "@quantum-crm/database";
import { HistoricalConversationService, iamPermissions, type HistoricalImportContext,
  type GhlImportOperationIdentity } from "@quantum-crm/domain";
import { loadVerifiedGhlImport } from "./ghl-migration-import-artifact.js";
import { importGhlArtifact } from "./ghl-migration-import.js";

async function main(): Promise<void> {
  const config = loadGhlMigrationImportConfig();
  // Full authentication/identity verification precedes opening the writable repositories.
  const artifact = await loadVerifiedGhlImport(config);
  const database = createCrmPostgresDatabase(config.database, "ghl-migration-import");
  const pool = createPostgresPool(config.database, "ghl-migration-import");
  pool.on("error", () => { process.exitCode = 1; });
  const operations = createGhlImportOperationRepository(pool);
  try {
    await database.connect();
    const owner = await database.members.findInitialAdministrator?.();
    if (!owner || owner.status !== "ACTIVE" || !owner.oidcSubject) throw new Error("No active initial administrator");
    const authorization = await database.memberships.findAuthorizationByOidcSubject(owner.oidcSubject);
    if (!authorization || authorization.status !== "ACTIVE" || authorization.commercialScope !== "PROFILE") throw new Error("Import owner is not authorized");
    const permissions = iamPermissions.filter((permission) => authorization.permissions.includes(permission));
    const context: HistoricalImportContext = {actor:{memberId:owner.id,scope:"PROFILE"}, permissions};
    const identity: GhlImportOperationIdentity = {operationId:config.operationId, tenantId:config.tenantId,
      locationId:config.locationId,exportId:config.exportId,artifactSha256:config.artifactSha256,currency:config.currency,operatorMemberId:owner.id};
    if (config.mode === "VERIFY") {
      const result = await operations.inspect(identity);
      const [contacts, settings, sales, conversations] = await Promise.all([
        createContactsHistoricalImportVerification(pool).verify(config.locationId),
        createSettingsHistoricalImportVerification(pool).verify(config.locationId),
        createSalesHistoricalImportVerification(pool).verify(config.locationId),
        createHistoricalConversationPostgresRepository(pool).verifyImports(config.locationId),
      ]);
      const expected = (name:string) => result?.progress.find((item)=>item.resource === name)?.total ?? Number.POSITIVE_INFINITY;
      const consistent = contacts.existingContacts === contacts.mappedContacts && contacts.existingLabels === contacts.mappedLabels &&
        settings.existingFields === settings.mappedFields && sales.existingPipelines === sales.mappedPipelines &&
        sales.existingStages === sales.mappedStages && sales.existingOpportunities === sales.mappedOpportunities && sales.validOpportunityStages === sales.existingOpportunities &&
        conversations.threadCount === conversations.mappedThreadCount && conversations.messageCount === conversations.mappedMessageCount &&
        conversations.inconsistentMessageCount === 0 && conversations.invalidParentCount === 0 &&
        contacts.existingContacts >= expected("CONTACTS") && settings.existingFields >= expected("CUSTOM_FIELDS") &&
        sales.existingPipelines >= expected("PIPELINES") && sales.existingOpportunities >= expected("OPPORTUNITIES") &&
        conversations.threadCount >= expected("CONVERSATIONS") && conversations.messageCount >= expected("MESSAGES");
      console.log(JSON.stringify({event:"ghl_import_verification",artifactRecords:artifact.recordCount,consistent,operation:result,contacts,settings,sales,conversations}));
      if (!consistent || !result || result.status !== "COMPLETE" || result.progress.some((item)=>item.processed !== item.total || item.conflicts !== 0)) process.exitCode = 2;
      return;
    }
    const members = {isActive:async (id:string)=>(await database.members.findById(id))?.status === "ACTIVE"};
    const contacts = {existsFor:async (actor:HistoricalImportContext["actor"],id:string)=>(await database.commercial.contacts.find(actor,id)) !== null};
    const result = await importGhlArtifact(artifact,identity,context,{
      contacts:createContactsHistoricalImportPort(pool,members),settings:createSettingsHistoricalImportPort(pool),
      sales:createSalesHistoricalImportPort(pool,{contacts,members}),operations,
      conversations:new HistoricalConversationService(createHistoricalConversationPostgresRepository(pool),{
        contactExistsFor:contacts.existsFor,isActiveMember:members.isActive,
      }),
    }, (progress)=>console.log(JSON.stringify({event:"ghl_import_progress",...progress})));
    console.log(JSON.stringify({event:"ghl_import_complete",...result}));
    if(result.status !== "COMPLETE") process.exitCode = 2;
  } finally { await operations.close(); await Promise.all([database.close(),pool.end()]); }
}

void main().catch(() => {
  // Driver/provider errors may contain customer data or connection details.
  console.error(JSON.stringify({event:"ghl_import_failed",code:"IMPORT_FAILED"}));
  process.exitCode = 1;
});
