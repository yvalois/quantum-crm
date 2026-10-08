import {
  BadRequestException,
  ConflictException,
  Controller,
  GatewayTimeoutException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  CreateProfileOperatorSchema,
  ProfileOperatorAccessResponseSchema,
  ProfileOperatorCallbackSchema,
  ProfileOperatorListResponseSchema,
  type ProfileOperatorContract,
} from "@quantum-crm/contracts";
import { DatabaseUnavailableError } from "@quantum-crm/database";
import {
  ProfileOperatorConflictError,
  ProfileOperatorValidationError,
  type ProfileOperatorAssignment,
  type ProfileOperatorRepository,
} from "@quantum-crm/platform-domain";
import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  ACTIVATION_DELIVERY_CALLBACK_CONFIG,
  type ActivationDeliveryCallbackConfig,
} from "./activation-delivery.controller.js";
import {
  PublicRoute,
  RequirePlatformPermission,
  platformAuthContext,
} from "./platform-security.js";

export const PROFILE_OPERATOR_REPOSITORY = Symbol("PROFILE_OPERATOR_REPOSITORY");

interface HeaderResponse {
  readonly setHeader: (name: string, value: string) => void;
}

interface CallbackRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
}

interface DeliveredAccess {
  readonly activationUrl: string;
  readonly temporaryPassword: string;
}

function key(input: {
  readonly correlationId: string;
  readonly requestedByOperatorId: string;
  readonly assignmentId: string;
}): string {
  return `${input.correlationId}:${input.requestedByOperatorId}:${input.assignmentId}`;
}

export class ProfileOperatorWaiters {
  private readonly values = new Map<
    string,
    { readonly resolve: (value: DeliveredAccess) => void; readonly timeout: NodeJS.Timeout }
  >();

  public wait(input: Parameters<typeof key>[0], timeoutMilliseconds: number) {
    const waiterKey = key(input);
    if (this.values.has(waiterKey)) throw new ConflictException();
    return new Promise<DeliveredAccess | null>((resolve) => {
      const timeout = setTimeout(() => {
        this.values.delete(waiterKey);
        resolve(null);
      }, timeoutMilliseconds);
      this.values.set(waiterKey, {
        timeout,
        resolve: (access) => {
          clearTimeout(timeout);
          this.values.delete(waiterKey);
          resolve(access);
        },
      });
    });
  }

  public discard(input: Parameters<typeof key>[0]): void {
    const value = this.values.get(key(input));
    if (!value) return;
    clearTimeout(value.timeout);
    this.values.delete(key(input));
  }

  public deliver(input: Parameters<typeof key>[0], access: DeliveredAccess): boolean {
    const value = this.values.get(key(input));
    if (!value) return false;
    value.resolve(access);
    return true;
  }
}

function contract(value: ProfileOperatorAssignment): ProfileOperatorContract {
  return {
    id: value.id,
    tenantProfileId: value.tenantProfileId,
    displayName: value.displayName,
    email: value.email,
    status: value.status,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/u.test(value)) throw new BadRequestException();
  return value;
}

function noStore(response: HeaderResponse): void {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function translate(error: unknown): never {
  if (error instanceof ProfileOperatorValidationError) throw new BadRequestException();
  if (error instanceof ProfileOperatorConflictError) throw new ConflictException();
  if (error instanceof DatabaseUnavailableError) throw new ServiceUnavailableException();
  throw error;
}

function header(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function exactSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

@Controller("api/v1/tenant-profiles/:tenantProfileId/platform-operators")
export class ProfileOperatorsController {
  public constructor(
    @Inject(PROFILE_OPERATOR_REPOSITORY)
    private readonly repository: ProfileOperatorRepository,
    private readonly waiters: ProfileOperatorWaiters,
  ) {}

  @Get()
  @RequirePlatformPermission("tenants:manage")
  public async list(@Param("tenantProfileId", new ParseUUIDPipe()) tenantProfileId: string) {
    try {
      const values = await this.repository.list(tenantProfileId);
      return ProfileOperatorListResponseSchema.parse({
        schemaVersion: "profile-operator-list/v1",
        data: values.map(contract),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post()
  @HttpCode(200)
  @RequirePlatformPermission("tenants:manage")
  public async create(
    @Req() request: Parameters<typeof platformAuthContext>[0] & { readonly body?: unknown },
    @Param("tenantProfileId", new ParseUUIDPipe()) tenantProfileId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const auth = platformAuthContext(request);
    const parsed = CreateProfileOperatorSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestException();
    const assignmentId = randomUUID();
    const waiter = {
      correlationId: auth.correlationId,
      requestedByOperatorId: auth.principal.id,
      assignmentId,
    };
    const waiting = this.waiters.wait(waiter, 35_000);
    try {
      const result = await this.repository.request({
        id: assignmentId,
        tenantProfileId,
        requestedByOperatorId: auth.principal.id,
        displayName: parsed.data.displayName,
        email: parsed.data.email,
        correlationId: auth.correlationId,
        idempotencyKey: idempotencyKey(rawIdempotencyKey),
        now: new Date(),
      });
      if (result.idempotentReplay) {
        this.waiters.discard(waiter);
        throw new ConflictException();
      }
      const access = await waiting;
      noStore(response);
      if (!access) throw new GatewayTimeoutException();
      return ProfileOperatorAccessResponseSchema.parse({
        schemaVersion: "profile-operator-access/v1",
        data: {
          operator: contract({ ...result.assignment, status: "ACTIVE", updatedAt: new Date() }),
          username: result.assignment.email,
          temporaryPassword: access.temporaryPassword,
          activationUrl: access.activationUrl,
        },
      });
    } catch (error) {
      this.waiters.discard(waiter);
      translate(error);
    }
  }
}

@Controller("api/v1/internal/profile-operators")
export class ProfileOperatorCallbackController {
  public constructor(
    private readonly waiters: ProfileOperatorWaiters,
    @Inject(ACTIVATION_DELIVERY_CALLBACK_CONFIG)
    private readonly callbackConfig: ActivationDeliveryCallbackConfig,
  ) {}

  @Post("callback")
  @HttpCode(202)
  @PublicRoute()
  public callback(
    @Req() request: CallbackRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ): { readonly accepted: boolean } {
    if (
      header(request.headers["x-qcrm-internal-principal"]) !== this.callbackConfig.principal ||
      header(request.headers["x-qcrm-internal-audience"]) !== this.callbackConfig.audience ||
      !exactSecret(
        header(request.headers.authorization)?.replace(/^Bearer /u, "") ?? "",
        this.callbackConfig.token.expose(),
      )
    ) {
      throw new UnauthorizedException();
    }
    const parsed = ProfileOperatorCallbackSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestException();
    const accepted = this.waiters.deliver(
      {
        correlationId: parsed.data.correlationId,
        requestedByOperatorId: parsed.data.requestedByOperatorId,
        assignmentId: parsed.data.assignmentId,
      },
      {
        activationUrl: parsed.data.activationUrl,
        temporaryPassword: parsed.data.temporaryPassword,
      },
    );
    noStore(response);
    return { accepted };
  }
}
