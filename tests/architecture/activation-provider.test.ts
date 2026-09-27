import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), "utf8");

describe("Keycloak activation provider", () => {
  it("records consumption only in the final action after password and TOTP", () => {
    const handler = read("infra/keycloak/activation-provider/src/main/java/com/quantumcrm/keycloak/activation/QuantumActivationActionTokenHandler.java");
    const resource = read("infra/keycloak/activation-provider/src/main/java/com/quantumcrm/keycloak/activation/QuantumActivationResourceProvider.java");
    const completion = read("infra/keycloak/activation-provider/src/main/java/com/quantumcrm/keycloak/activation/QuantumActivationCompletionRequiredAction.java");

    expect(handler).toContain("AUTH_NOTE_JTI");
    expect(handler).not.toContain('"status", "consumed"');
    expect(resource).toContain("UserModel.RequiredAction.UPDATE_PASSWORD.name()");
    expect(resource).toContain("UserModel.RequiredAction.CONFIGURE_TOTP.name()");
    expect(resource).toContain("QuantumActivationCompletionRequiredAction.ID");
    expect(completion).toContain('"status", "consumed"');
    expect(completion).toContain("getRequiredActionsStream().noneMatch");
    expect(completion).toContain("UPDATE_PASSWORD.name().equals(action)");
    expect(completion).toContain("CONFIGURE_TOTP.name().equals(action)");
  });

  it("registers the completion action as a Keycloak provider and tenant required action", () => {
    const service = read("infra/keycloak/activation-provider/src/main/resources/META-INF/services/org.keycloak.authentication.RequiredActionFactory");
    const provisioner = read("apps/deploy-executor/src/tenant-identity-provisioner.ts");

    expect(service).toContain("QuantumActivationCompletionRequiredAction");
    expect(provisioner).toContain('const activationCompletionAction = "QCRM_ACTIVATION_COMPLETE"');
    expect(provisioner).toContain("requiredActions: [{");
    expect(provisioner).toContain("completionAction.defaultAction !== false");
  });
});
