import {
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ServiceUnavailableException,
  type CustomDecorator,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  authenticatePlatformOperator,
  OIDC_ACCESS_TOKEN_VERIFIER,
  PlatformAuthenticationError,
  PlatformAuthorizationError,
  requirePlatformPermission,
  type OidcAccessTokenVerifier,
  type PlatformAuthContext,
  type PlatformAuthPolicy,
  type PlatformMembershipReader,
} from "@quantum-crm/auth";
import { SecretValue } from "@quantum-crm/config";
import type { PlatformPermission } from "@quantum-crm/platform-domain";
import { randomUUID } from "node:crypto";

export const PLATFORM_MEMBERSHIPS = Symbol("PLATFORM_MEMBERSHIPS");
export const PLATFORM_AUTH_POLICY = Symbol("PLATFORM_AUTH_POLICY");
export const PLATFORM_AUTH_CONTEXT = Symbol("PLATFORM_AUTH_CONTEXT");
export const PUBLIC_ROUTE = "quantum:public-route";
export const REQUIRED_PLATFORM_PERMISSION = "quantum:platform-permission";

export const PublicRoute = (): CustomDecorator<string> => SetMetadata(PUBLIC_ROUTE, true);
export const RequirePlatformPermission = (
  permission: PlatformPermission,
): CustomDecorator<string> => SetMetadata(REQUIRED_PLATFORM_PERMISSION, permission);

interface HttpRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  [PLATFORM_AUTH_CONTEXT]?: PlatformAuthContext;
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
export class PlatformAuthenticationGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER) private readonly verifier: OidcAccessTokenVerifier,
    @Inject(PLATFORM_MEMBERSHIPS) private readonly memberships: PlatformMembershipReader,
    @Inject(PLATFORM_AUTH_POLICY) private readonly policy: PlatformAuthPolicy,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
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
      request[PLATFORM_AUTH_CONTEXT] = await authenticatePlatformOperator({
        accessToken,
        verifier: this.verifier,
        memberships: this.memberships,
        policy: this.policy,
        correlationId: correlationId(request.headers["x-correlation-id"]),
      });
      return true;
    } catch (error) {
      if (error instanceof PlatformAuthenticationError) throw new UnauthorizedException();
      throw new ServiceUnavailableException();
    }
  }
}

@Injectable()
export class PlatformAuthorizationGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<PlatformPermission>(
      REQUIRED_PLATFORM_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;
    const auth = context.switchToHttp().getRequest<HttpRequest>()[PLATFORM_AUTH_CONTEXT];
    if (!auth) throw new UnauthorizedException();
    try {
      requirePlatformPermission(auth, permission);
      return true;
    } catch (error) {
      if (error instanceof PlatformAuthorizationError) throw new ForbiddenException();
      throw error;
    }
  }
}

export function platformAuthContext(request: HttpRequest): PlatformAuthContext {
  const context = request[PLATFORM_AUTH_CONTEXT];
  if (!context) throw new UnauthorizedException();
  return context;
}
