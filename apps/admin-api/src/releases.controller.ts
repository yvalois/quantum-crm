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
  CreatePlatformReleaseSchema,
  PlatformReleaseListQuerySchema,
  PlatformReleaseListResponseSchema,
  PlatformReleaseResponseSchema,
  UpdatePlatformReleaseStatusSchema,
  type PlatformReleaseContract,
} from "@quantum-crm/contracts";
import { DatabaseUnavailableError } from "@quantum-crm/database";
import {
  PlatformReleaseConflictError,
  PlatformReleaseNotFoundError,
  PlatformReleaseService,
  PlatformReleaseValidationError,
  PlatformReleaseVersionConflictError,
  type PlatformRelease,
} from "@quantum-crm/platform-domain";

import { platformAuthContext, RequirePlatformPermission } from "./platform-security.js";

export const PLATFORM_RELEASE_SERVICE = Symbol("PLATFORM_RELEASE_SERVICE");

interface HeaderResponse {
  readonly setHeader: (name: string, value: string) => void;
}

function toContract(release: PlatformRelease): PlatformReleaseContract {
  return {
    id: release.id,
    semanticVersion: release.semanticVersion,
    commitSha: release.commitSha,
    releaseNotes: release.releaseNotes,
    compatibility: release.compatibility,
    artifacts: [...release.artifacts],
    legacyArtifactCatalog: release.legacyArtifactCatalog,
    status: release.status,
    version: release.version.toString(),
    createdAt: release.createdAt.toISOString(),
    updatedAt: release.updatedAt.toISOString(),
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
  if (error instanceof PlatformReleaseNotFoundError) throw new NotFoundException();
  if (error instanceof PlatformReleaseConflictError) throw new ConflictException();
  if (error instanceof PlatformReleaseVersionConflictError) {
    throw new HttpException("Precondition Failed", 412);
  }
  if (error instanceof PlatformReleaseValidationError) throw new BadRequestException();
  if (error instanceof DatabaseUnavailableError) throw new ServiceUnavailableException();
  throw error;
}

@Controller("api/v1/releases")
export class ReleasesController {
  public constructor(
    @Inject(PLATFORM_RELEASE_SERVICE) private readonly releases: PlatformReleaseService,
  ) {}

  @Get()
  @RequirePlatformPermission("deployments:read")
  public async list(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Query() rawQuery: Record<string, unknown>,
  ) {
    platformAuthContext(request);
    const parsed = PlatformReleaseListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException();
    try {
      const releases = await this.releases.list({
        limit: parsed.data.pageSize,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      });
      return PlatformReleaseListResponseSchema.parse({
        schemaVersion: "platform-release-list/v1",
        data: releases.map(toContract),
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
    const parsed = CreatePlatformReleaseSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const release = await this.releases.create({
        ...parsed.data,
        compatibility: {
          configurationSchemaVersion: parsed.data.compatibility.configurationSchemaVersion,
          agentContractVersion: parsed.data.compatibility.agentContractVersion,
          databaseMigrationRequired: parsed.data.compatibility.databaseMigrationRequired,
          ...(parsed.data.compatibility.minimumSourceVersion
            ? { minimumSourceVersion: parsed.data.compatibility.minimumSourceVersion }
            : {}),
        },
      });
      response.setHeader("ETag", etag(release.version));
      response.setHeader("Location", `/api/v1/releases/${release.id}`);
      return PlatformReleaseResponseSchema.parse({
        schemaVersion: "platform-release/v1",
        data: toContract(release),
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
      const release = await this.releases.get(id);
      response.setHeader("ETag", etag(release.version));
      return PlatformReleaseResponseSchema.parse({
        schemaVersion: "platform-release/v1",
        data: toContract(release),
      });
    } catch (error) {
      translate(error);
    }
  }

  @Patch(":id/status")
  @RequirePlatformPermission("deployments:execute")
  public async updateStatus(
    @Req() request: Parameters<typeof platformAuthContext>[0],
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    platformAuthContext(request);
    const parsed = UpdatePlatformReleaseStatusSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    try {
      const release = await this.releases.updateStatus(
        id,
        expectedVersion(ifMatch),
        parsed.data.status,
      );
      response.setHeader("ETag", etag(release.version));
      return PlatformReleaseResponseSchema.parse({
        schemaVersion: "platform-release/v1",
        data: toContract(release),
      });
    } catch (error) {
      translate(error);
    }
  }
}
