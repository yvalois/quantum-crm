import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CreateInfrastructureServerSchema,
  InfrastructureServerListQuerySchema,
  InfrastructureServerListResponseSchema,
  InfrastructureServerResponseSchema,
  UpdateInfrastructureServerSchema,
  type InfrastructureServerContract,
} from "@quantum-crm/contracts";
import { DatabaseUnavailableError } from "@quantum-crm/database";
import {
  InfrastructureServerConflictError,
  InfrastructureServerNotFoundError,
  InfrastructureServerService,
  InfrastructureServerValidationError,
  InfrastructureServerVersionConflictError,
  type InfrastructureServer,
  type UpdateInfrastructureServerCommand,
} from "@quantum-crm/platform-domain";

import { platformAuthContext, RequirePlatformPermission } from "./platform-security.js";

export const INFRASTRUCTURE_SERVER_SERVICE = Symbol("INFRASTRUCTURE_SERVER_SERVICE");

interface HeaderResponse {
  readonly setHeader: (name: string, value: string) => void;
}

function toContract(server: InfrastructureServer): InfrastructureServerContract {
  return {
    id: server.id,
    code: server.code,
    displayName: server.displayName,
    provider: server.provider,
    region: server.region,
    publicIpv4: server.publicIpv4,
    operatingSystem: server.operatingSystem,
    architecture: server.architecture,
    status: server.status,
    totalCapacity: server.totalCapacity,
    reservedCapacity: server.reservedCapacity,
    availableCapacity: server.availableCapacity,
    credentialConfigured: server.operationCredentialRef.length > 0,
    confirmedAt: server.confirmedAt.toISOString(),
    version: server.version.toString(),
    createdAt: server.createdAt.toISOString(),
    updatedAt: server.updatedAt.toISOString(),
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

function translate(error: unknown): never {
  if (error instanceof InfrastructureServerNotFoundError) throw new NotFoundException();
  if (error instanceof InfrastructureServerConflictError) throw new ConflictException();
  if (error instanceof InfrastructureServerVersionConflictError) {
    throw new HttpException("Precondition Failed", 412);
  }
  if (error instanceof InfrastructureServerValidationError) throw new BadRequestException();
  if (error instanceof DatabaseUnavailableError) throw new ServiceUnavailableException();
  throw error;
}

@Controller("api/v1/infrastructure-servers")
export class InfrastructureServersController {
  public constructor(
    @Inject(INFRASTRUCTURE_SERVER_SERVICE)
    private readonly servers: InfrastructureServerService,
  ) {}

  @Get()
  @RequirePlatformPermission("deployments:read")
  public async list(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Query() rawQuery: Record<string, unknown>,
  ) {
    platformAuthContext(request);
    const parsed = InfrastructureServerListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException();
    try {
      const servers = await this.servers.list({
        limit: parsed.data.pageSize,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      });
      return InfrastructureServerListResponseSchema.parse({
        schemaVersion: "infrastructure-server-list/v1",
        data: servers.map(toContract),
        meta: { pageSize: parsed.data.pageSize },
      });
    } catch (error) {
      translate(error);
    }
  }

  @Post()
  @RequirePlatformPermission("deployments:execute")
  public async create(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    platformAuthContext(request);
    const parsed = CreateInfrastructureServerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const server = await this.servers.create({
        ...parsed.data,
        confirmedAt: new Date(parsed.data.confirmedAt),
      });
      response.setHeader("ETag", etag(server.version));
      response.setHeader("Location", `/api/v1/infrastructure-servers/${server.id}`);
      return InfrastructureServerResponseSchema.parse({
        schemaVersion: "infrastructure-server/v1",
        data: toContract(server),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Get(":id")
  @RequirePlatformPermission("deployments:read")
  public async get(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Param("id", new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    platformAuthContext(request);
    try {
      const server = await this.servers.get(id);
      response.setHeader("ETag", etag(server.version));
      return InfrastructureServerResponseSchema.parse({
        schemaVersion: "infrastructure-server/v1",
        data: toContract(server),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Patch(":id")
  @RequirePlatformPermission("deployments:execute")
  public async update(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    platformAuthContext(request);
    const parsed = UpdateInfrastructureServerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    const changes: UpdateInfrastructureServerCommand = {
      ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
      ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
      ...(parsed.data.provider !== undefined ? { provider: parsed.data.provider } : {}),
      ...(parsed.data.region !== undefined ? { region: parsed.data.region } : {}),
      ...(parsed.data.publicIpv4 !== undefined ? { publicIpv4: parsed.data.publicIpv4 } : {}),
      ...(parsed.data.operatingSystem !== undefined
        ? { operatingSystem: parsed.data.operatingSystem }
        : {}),
      ...(parsed.data.architecture !== undefined ? { architecture: parsed.data.architecture } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.totalCapacity !== undefined
        ? { totalCapacity: parsed.data.totalCapacity }
        : {}),
      ...(parsed.data.reservedCapacity !== undefined
        ? { reservedCapacity: parsed.data.reservedCapacity }
        : {}),
      ...(parsed.data.operationCredentialRef !== undefined
        ? { operationCredentialRef: parsed.data.operationCredentialRef }
        : {}),
      ...(parsed.data.confirmedAt ? { confirmedAt: new Date(parsed.data.confirmedAt) } : {}),
    };
    try {
      const server = await this.servers.update(id, expectedVersion(ifMatch), changes);
      response.setHeader("ETag", etag(server.version));
      return InfrastructureServerResponseSchema.parse({
        schemaVersion: "infrastructure-server/v1",
        data: toContract(server),
      });
    } catch (error) {
      translate(error);
    }
  }
}
