import {
  BadRequestException,
  ConflictException,
  Controller,
  GatewayTimeoutException,
  Headers,
  HttpCode,
  Inject,
  Post,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ActivationDeliveryCallbackSchema,
  ActivationDeliveryRequestSchema,
  ActivationDeliveryResponseSchema,
} from "@quantum-crm/contracts";
import { DatabaseUnavailableError } from "@quantum-crm/database";
import {
  ActivationDeliveryValidationError,
  type ActivationDeliveryRepository,
} from "@quantum-crm/platform-domain";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { PublicRoute, platformAuthContext, RequirePlatformPermission } from "./platform-security.js";

export const ACTIVATION_DELIVERY_REPOSITORY = Symbol("ACTIVATION_DELIVERY_REPOSITORY");
export const ACTIVATION_DELIVERY_CALLBACK_CONFIG = Symbol("ACTIVATION_DELIVERY_CALLBACK_CONFIG");
export const activationDeliveryRoute = "api/v1/tenant-profiles";
export const activationDeliveryCallbackRoute = "api/v1/internal/activation-deliveries";

export interface ActivationDeliveryCallbackConfig {
  readonly principal: "deploy-executor";
  readonly audience: "quantum-admin-api-activation-callback";
  readonly token: { readonly expose: () => string };
}

interface HeaderResponse {
  readonly setHeader: (name: string, value: string) => void;
}

interface CallbackRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface WaiterKey {
  readonly correlationId: string;
  readonly operatorId: string;
  readonly tenantProfileId: string;
  readonly generation: number;
}

function waiterKey(input: WaiterKey): string {
  return `${input.correlationId}:${input.operatorId}:${input.tenantProfileId}:${input.generation}`;
}

/** URLs exist only in this process and only until the original request ends. */
export class ActivationDeliveryWaiters {
  private readonly values = new Map<
    string,
    { readonly resolve: (value: string) => void; readonly timeout: NodeJS.Timeout }
  >();

  public wait(input: WaiterKey, timeoutMilliseconds: number): Promise<string | null> {
    const key = waiterKey(input);
    if (this.values.has(key)) throw new ConflictException();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.values.delete(key);
        resolve(null);
      }, timeoutMilliseconds);
      this.values.set(key, {
        timeout,
        resolve: (url) => {
          clearTimeout(timeout);
          this.values.delete(key);
          resolve(url);
        },
      });
    });
  }

  public discard(input: WaiterKey): void {
    const value = this.values.get(waiterKey(input));
    if (!value) return;
    clearTimeout(value.timeout);
    this.values.delete(waiterKey(input));
  }

  public deliver(input: WaiterKey, url: string): boolean {
    const value = this.values.get(waiterKey(input));
    if (!value) return false;
    value.resolve(url);
    return true;
  }
}

function expectedVersion(value: string | undefined): bigint {
  if (!value) throw new BadRequestException("If-Match is required");
  const match = /^"([1-9][0-9]*)"$/u.exec(value);
  if (!match?.[1]) throw new BadRequestException();
  return BigInt(match[1]);
}

function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/u.test(value)) throw new BadRequestException();
  return value;
}

function header(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function exactSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function activationHeaders(response: HeaderResponse): void {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function translate(error: unknown): never {
  if (error instanceof ActivationDeliveryValidationError) throw new ConflictException();
  if (error instanceof DatabaseUnavailableError) throw new ServiceUnavailableException();
  throw error;
}

@Controller(activationDeliveryRoute)
export class ActivationDeliveryController {
  public constructor(
    @Inject(ACTIVATION_DELIVERY_REPOSITORY)
    private readonly deliveries: ActivationDeliveryRepository,
    private readonly waiters: ActivationDeliveryWaiters,
  ) {}

  @Post(":tenantProfileId/activation-deliveries")
  @HttpCode(200)
  @RequirePlatformPermission("deployments:activate")
  public async request(
    @Req() request: Parameters<typeof platformAuthContext>[0] & { readonly body?: unknown },
    @Param("tenantProfileId", new ParseUUIDPipe()) tenantProfileId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const auth = platformAuthContext(request);
    if (!ActivationDeliveryRequestSchema.safeParse(request.body ?? {}).success) {
      throw new BadRequestException();
    }
    const administrator = await this.deliveries.findInitialAdministrator(tenantProfileId);
    if (!administrator?.subject || administrator.status === "CONSUMED") throw new ConflictException();
    const generation = administrator.generation + 1;
    const key = {
      correlationId: auth.correlationId,
      operatorId: auth.principal.id,
      tenantProfileId,
      generation,
    } as const;
    const waiting = this.waiters.wait(key, 35_000);
    try {
      const result = await this.deliveries.request({
        id: randomUUID(),
        tenantProfileId,
        requestedByOperatorId: auth.principal.id,
        expectedTenantVersion: expectedVersion(ifMatch),
        idempotencyKey: idempotencyKey(rawIdempotencyKey),
        payloadHash: createHash("sha256")
          .update(JSON.stringify({ tenantProfileId, administratorSubject: administrator.subject, generation }))
          .digest("hex"),
        correlationId: auth.correlationId,
        now: new Date(),
      });
      if (result.idempotentReplay || result.intent.generation !== generation) {
        this.waiters.discard(key);
        throw new ConflictException();
      }
      const url = await waiting;
      activationHeaders(response);
      if (!url) throw new GatewayTimeoutException();
      return ActivationDeliveryResponseSchema.parse({
        schemaVersion: "activation-delivery/v1",
        data: { url, expiresAt: result.intent.expiresAt.toISOString() },
        meta: {
          intentId: result.intent.id,
          tenantProfileId,
          generation,
          version: result.intent.version.toString(),
        },
      });
    } catch (error) {
      this.waiters.discard(key);
      translate(error);
    }
  }
}

/**
 * This route deliberately does not live below `:tenantProfileId`: the private
 * executor callback is authenticated by its fixed service credentials and its
 * body, not by a path parameter that Nest could try to parse first.
 */
@Controller(activationDeliveryCallbackRoute)
export class ActivationDeliveryCallbackController {
  public constructor(
    private readonly waiters: ActivationDeliveryWaiters,
    @Inject(ACTIVATION_DELIVERY_CALLBACK_CONFIG)
    private readonly callbackConfig: ActivationDeliveryCallbackConfig,
  ) {}

  @Post("callback")
  @HttpCode(202)
  @PublicRoute()
  public callback(
    @Req() request: CallbackRequest & { readonly body?: unknown },
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
    const parsed = ActivationDeliveryCallbackSchema.safeParse(request.body);
    if (!parsed.success) throw new BadRequestException();
    const accepted = this.waiters.deliver(
      {
        correlationId: parsed.data.correlationId,
        operatorId: parsed.data.operatorId,
        tenantProfileId: parsed.data.tenantProfileId,
        generation: parsed.data.generation,
      },
      parsed.data.url,
    );
    activationHeaders(response);
    return { accepted };
  }
}
