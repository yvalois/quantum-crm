import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Body,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CreateTenantProfileSchema,
  ProvisioningOperationResponseSchema,
  RequestTenantProvisioningSchema,
  TenantProfileListQuerySchema,
  TenantProfileListResponseSchema,
  UpdateTenantProfileSchema,
  tenantProfileResponse,
  type TenantProfileContract,
  type ProvisioningOperationContract,
} from "@quantum-crm/contracts";
import { DatabaseUnavailableError } from "@quantum-crm/database";
import {
  ProvisioningOperationConflictError,
  InfrastructureCapacityExceededError,
  InfrastructureServerNotAdmissibleError,
  ProvisioningOperationValidationError,
  PlatformReleaseNotDeployableError,
  TenantProfileLifecycleTransitionError,
  TenantProfileConflictError,
  TenantProfileNotFoundError,
  TenantProfileService,
  TenantProfileValidationError,
  TenantProfileVersionConflictError,
  TenantProvisioningService,
  type ProvisioningOperation,
  type TenantProfile,
  type TenantProfileCursor,
  type TenantProfileListCriteria,
  type UpdateTenantProfileCommand,
} from "@quantum-crm/platform-domain";
import { Inject } from "@nestjs/common";

import { platformAuthContext, RequirePlatformPermission } from "./platform-security.js";

export const TENANT_PROFILE_SERVICE = Symbol("TENANT_PROFILE_SERVICE");
export const TENANT_PROVISIONING_SERVICE = Symbol("TENANT_PROVISIONING_SERVICE");

interface HeaderResponse {
  readonly setHeader: (name: string, value: string) => void;
}

function toContract(profile: TenantProfile): TenantProfileContract {
  return {
    id: profile.id,
    name: profile.name,
    slug: profile.slug,
    adminContactName: profile.adminContactName,
    adminContactEmail: profile.adminContactEmail,
    status: profile.status,
    serverId: profile.serverId ?? null,
    releaseId: profile.releaseId ?? null,
    version: profile.version.toString(),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function provisioningOperationContract(
  operation: ProvisioningOperation,
): ProvisioningOperationContract {
  return {
    id: operation.id,
    tenantProfileId: operation.tenantProfileId,
    serverId: operation.serverId,
    releaseId: operation.releaseId,
    requestedCapacity: operation.requestedCapacity,
    capacityReservation: {
      id: operation.capacityReservation.id,
    },
    status: operation.status,
    currentStep: operation.currentStep,
    attempt: operation.attempt,
    version: operation.version.toString(),
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
  };
}

function etag(version: bigint): string {
  return `"${version.toString()}"`;
}

function expectedVersion(value: string | undefined): bigint {
  if (!value) throw new HttpException("Precondition Required", 428);
  const match = /^"([1-9][0-9]*)"$/u.exec(value);
  if (!match?.[1]) throw new BadRequestException();
  return BigInt(match[1]);
}

function idempotencyKey(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9._:-]{8,128}$/u.test(value)) throw new BadRequestException();
  return value;
}

function encodeCursor(cursor: TenantProfileCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt.toISOString(), cursor.id]), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(value: string | undefined): TenantProfileCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("Invalid cursor");
    const [timestamp, id] = parsed;
    if (
      typeof timestamp !== "string" ||
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)
    ) {
      throw new Error("Invalid cursor");
    }
    const createdAt = new Date(timestamp);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== timestamp) {
      throw new Error("Invalid cursor");
    }
    return Object.freeze({ createdAt, id });
  } catch {
    throw new BadRequestException();
  }
}

function translate(error: unknown): never {
  if (error instanceof TenantProfileNotFoundError) throw new NotFoundException();
  if (error instanceof TenantProfileConflictError) throw new ConflictException();
  if (error instanceof TenantProfileVersionConflictError) {
    throw new HttpException("Precondition Failed", 412);
  }
  if (
    error instanceof ProvisioningOperationConflictError ||
    error instanceof InfrastructureCapacityExceededError ||
    error instanceof InfrastructureServerNotAdmissibleError ||
    error instanceof PlatformReleaseNotDeployableError ||
    error instanceof TenantProfileLifecycleTransitionError
  ) {
    throw new ConflictException();
  }
  if (error instanceof ProvisioningOperationValidationError) throw new BadRequestException();
  if (error instanceof TenantProfileValidationError) throw new BadRequestException();
  if (error instanceof DatabaseUnavailableError) throw new ServiceUnavailableException();
  throw error;
}

@Controller("api/v1/tenant-profiles")
export class TenantProfilesController {
  public constructor(
    @Inject(TENANT_PROFILE_SERVICE) private readonly profiles: TenantProfileService,
    @Inject(TENANT_PROVISIONING_SERVICE)
    private readonly provisioning: TenantProvisioningService,
  ) {}

  @Get()
  @RequirePlatformPermission("tenants:read")
  public async list(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Query() rawQuery: Record<string, unknown>,
  ) {
    platformAuthContext(request);
    const parsed = TenantProfileListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException();
    try {
      const cursor = decodeCursor(parsed.data.cursor);
      const criteria: TenantProfileListCriteria = {
        limit: parsed.data.pageSize,
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.serverId !== undefined ? { serverId: parsed.data.serverId } : {}),
        ...(parsed.data.releaseId !== undefined ? { releaseId: parsed.data.releaseId } : {}),
        ...(parsed.data.search !== undefined ? { search: parsed.data.search } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      };
      const page = await this.profiles.list(criteria);
      return TenantProfileListResponseSchema.parse({
        schemaVersion: "tenant-profile-list/v1",
        data: page.items.map(toContract),
        meta: {
          pageSize: parsed.data.pageSize,
          nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
        },
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post()
  @RequirePlatformPermission("tenants:manage")
  public async create(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    platformAuthContext(request);
    const parsed = CreateTenantProfileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const profile = await this.profiles.create(parsed.data);
      response.setHeader("ETag", etag(profile.version));
      return tenantProfileResponse(toContract(profile));
    } catch (error) {
      translate(error);
    }
  }

  @Get(":id")
  @RequirePlatformPermission("tenants:read")
  public async get(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Param("id", new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    platformAuthContext(request);
    try {
      const profile = await this.profiles.get(id);
      response.setHeader("ETag", etag(profile.version));
      return tenantProfileResponse(toContract(profile));
    } catch (error) {
      translate(error);
    }
  }

  @Patch(":id")
  @RequirePlatformPermission("tenants:manage")
  public async update(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    platformAuthContext(request);
    const parsed = UpdateTenantProfileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const changes: UpdateTenantProfileCommand = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.slug !== undefined ? { slug: parsed.data.slug } : {}),
        ...(parsed.data.adminContactName !== undefined
          ? { adminContactName: parsed.data.adminContactName }
          : {}),
        ...(parsed.data.adminContactEmail !== undefined
          ? { adminContactEmail: parsed.data.adminContactEmail }
          : {}),
      };
      const profile = await this.profiles.update(id, expectedVersion(ifMatch), changes);
      response.setHeader("ETag", etag(profile.version));
      return tenantProfileResponse(toContract(profile));
    } catch (error) {
      translate(error);
    }
  }

  @Post(":id/provisioning-operations")
  @HttpCode(202)
  @RequirePlatformPermission("deployments:execute")
  public async requestProvisioning(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const auth = platformAuthContext(request);
    const parsed = RequestTenantProvisioningSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const result = await this.provisioning.request({
        tenantProfileId: id,
        serverId: parsed.data.serverId,
        releaseId: parsed.data.releaseId,
        requestedCapacity: parsed.data.requestedCapacity,
        requestedByOperatorId: auth.principal.id,
        idempotencyKey: idempotencyKey(rawIdempotencyKey),
        correlationId: auth.correlationId,
        expectedTenantVersion: expectedVersion(ifMatch),
      });
      response.setHeader(
        "Location",
        `/api/v1/tenant-profiles/${id}/provisioning-operations/${result.operation.id}`,
      );
      response.setHeader("X-Tenant-Profile-ETag", etag(result.tenantVersion));
      return ProvisioningOperationResponseSchema.parse({
        schemaVersion: "tenant-provisioning-operation/v1",
        data: provisioningOperationContract(result.operation),
        meta: { idempotentReplay: result.idempotentReplay },
      });
    } catch (error) {
      translate(error);
    }
  }
}
