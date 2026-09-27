import { Injectable, UnauthorizedException } from "@nestjs/common";
import { OIDC_ACCESS_TOKEN_VERIFIER, type OidcAccessTokenVerifier } from "@quantum-crm/auth";
import { SecretValue } from "@quantum-crm/config";
import { Inject } from "@nestjs/common";

export const BOOTSTRAP_SERVICE_POLICY = Symbol("BOOTSTRAP_SERVICE_POLICY");
export interface BootstrapServicePolicy { readonly clientId: "quantum-crm-bootstrap"; readonly audience: "quantum-crm-api"; }

@Injectable()
export class BootstrapServiceGuard {
  public constructor(
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER) private readonly verifier: OidcAccessTokenVerifier,
    @Inject(BOOTSTRAP_SERVICE_POLICY) private readonly policy: BootstrapServicePolicy,
  ) {}

  public async assertAuthorized(header: string | undefined): Promise<void> {
    const match = typeof header === "string" ? /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/u.exec(header) : null;
    if (!match?.[1]) throw new UnauthorizedException();
    try {
      const identity = await this.verifier.verifyAccessToken(new SecretValue(match[1]));
      if (
        identity.principalType !== "service" || identity.clientId !== this.policy.clientId ||
        !identity.audiences.includes(this.policy.audience) ||
        !identity.servicePermissions?.includes("iam:bootstrap-initial-administrator")
      ) throw new Error("bootstrap identity rejected");
    } catch {
      throw new UnauthorizedException();
    }
  }
}
