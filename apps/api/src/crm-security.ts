import {
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type CustomDecorator,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  authenticateCrmMember,
  CrmAuthenticationError,
  CrmAuthorizationError,
  OIDC_ACCESS_TOKEN_VERIFIER,
  requireCrmPermission,
  type CrmAuthContext,
  type CrmAuthPolicy,
  type CrmMembershipReader,
  type OidcAccessTokenVerifier,
} from "@quantum-crm/auth";
import { SecretValue } from "@quantum-crm/config";
import type { IamMemberService, IamPermission } from "@quantum-crm/domain";
import { randomUUID } from "node:crypto";

export const CRM_MEMBERSHIPS = Symbol("CRM_MEMBERSHIPS");
export const CRM_AUTH_POLICY = Symbol("CRM_AUTH_POLICY");
export const CRM_AUTH_CONTEXT = Symbol("CRM_AUTH_CONTEXT");
export const IAM_MEMBER_SERVICE = Symbol("IAM_MEMBER_SERVICE");
export const IAM_INVITATION_ACTIVATION_REPOSITORY = Symbol("IAM_INVITATION_ACTIVATION_REPOSITORY");
export const CRM_PUBLIC_ROUTE = "quantum:crm-public-route";
export const REQUIRED_CRM_PERMISSION = "quantum:crm-permission";

export const CrmPublicRoute = (): CustomDecorator<string> => SetMetadata(CRM_PUBLIC_ROUTE, true);
export const RequireCrmPermission = (permission: IamPermission): CustomDecorator<string> =>
  SetMetadata(REQUIRED_CRM_PERMISSION, permission);

interface HttpRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  [CRM_AUTH_CONTEXT]?: CrmAuthContext;
}

function bearerToken(header: string | string[] | undefined): SecretValue | null {
  if (typeof header !== "string" || header.length > 16_384) return null;
  const match = /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/u.exec(header);
  return match?.[1] ? new SecretValue(match[1]) : null;
}

function correlationId(header: string | string[] | undefined): string {
  return typeof header === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(header)
    ? header
    : randomUUID();
}

@Injectable()
export class CrmAuthenticationGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER)
    private readonly verifier: OidcAccessTokenVerifier,
    @Inject(CRM_MEMBERSHIPS) private readonly memberships: CrmMembershipReader,
    @Inject(CRM_AUTH_POLICY) private readonly policy: CrmAuthPolicy,
    @Inject(IAM_MEMBER_SERVICE) private readonly memberService: IamMemberService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(CRM_PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const accessToken = bearerToken(request.headers.authorization);
    if (!accessToken) throw new UnauthorizedException();
    try {
      request[CRM_AUTH_CONTEXT] = await authenticateCrmMember({
        accessToken,
        verifier: this.verifier,
        memberships: this.memberships,
        policy: this.policy,
        correlationId: correlationId(request.headers["x-correlation-id"]),
        onInvitedMembership: async (oidcSubject) => {
          await this.memberService.acceptConfirmedInvitationForSubject({ oidcSubject });
        },
      });
      return true;
    } catch (error) {
      if (error instanceof CrmAuthenticationError) throw new UnauthorizedException();
      throw error;
    }
  }
}

@Injectable()
export class CrmAuthorizationGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<IamPermission>(REQUIRED_CRM_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;
    const auth = context.switchToHttp().getRequest<HttpRequest>()[CRM_AUTH_CONTEXT];
    if (!auth) throw new UnauthorizedException();
    try {
      requireCrmPermission(auth, permission);
      return true;
    } catch (error) {
      if (error instanceof CrmAuthorizationError) throw new ForbiddenException();
      throw error;
    }
  }
}

export function crmAuthContext(request: HttpRequest): CrmAuthContext {
  const context = request[CRM_AUTH_CONTEXT];
  if (!context) throw new UnauthorizedException();
  return context;
}
