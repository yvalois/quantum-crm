import {
  buildGhlCandidate,
  deployGhlCandidate,
  ghlCandidateApps,
  runRegisteredGhlImport,
  setupGhlIntegrationTest,
  upgradeGhlIntegrationTest,
  tuneRegisteredGhlAttachmentStorage,
  type GhlCandidateApp,
} from "./ghl-candidate-operations.js";
import { HostAdapterError } from "./host-adapter.js";

// Host bootstrap only. Arguments select fixed operations and registered UUIDs; never commands or paths.
const [action, first, second, third, ...extra] = process.argv.slice(2);
try {
  if (extra.length > 0 || !first) throw new HostAdapterError("IDENTITY_MISMATCH");
  let result: unknown;
  if (action === "TEST_SETUP" && second === undefined && third === undefined) {
    result = await setupGhlIntegrationTest(first);
  } else if (action === "TUNE_ATTACHMENT_STORAGE" && second && third === undefined) {
    result = await tuneRegisteredGhlAttachmentStorage(first, second);
  } else if (action === "TUNE_ATTACHMENT_STORAGE_TEMP" && second && third === undefined) {
    result = await tuneRegisteredGhlAttachmentStorage(first, second, true);
  } else if (action === "TEST_UPGRADE" && second && third === undefined) {
    result = await upgradeGhlIntegrationTest(first, second);
  } else if (
    action === "BUILD" &&
    second &&
    third === undefined &&
    ghlCandidateApps.includes(second as GhlCandidateApp)
  ) {
    result = await buildGhlCandidate(first, second as GhlCandidateApp);
  } else if (action === "DEPLOY_COMPONENTS" && second && third) {
    result = await deployGhlCandidate(first, second, third);
  } else if (
    (action === "MIGRATE" ||
      action === "VERIFY" ||
      action === "APPLY" ||
      action === "ATTACHMENTS") &&
    second
  ) {
    const attempt = third === undefined ? 1 : Number(third);
    result = await runRegisteredGhlImport(first, second, action, attempt);
  } else {
    throw new HostAdapterError("IDENTITY_MISMATCH");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ error: error instanceof HostAdapterError ? error.reason : "UNAVAILABLE" })}\n`,
  );
  process.exitCode = 1;
}
