import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  CreatePlatformReleaseSchema,
  PlatformReleaseResponseSchema,
  type PlatformReleaseContract,
} from "@quantum-crm/contracts";
import {
  PlatformReleaseConflictError,
  PlatformReleaseService,
  type PlatformRelease,
} from "@quantum-crm/platform-domain";

import { PLATFORM_RELEASE_SERVICE } from "./releases.controller.js";
import {
  GithubActionsReleasePublisherGuard,
  githubActionsReleasePublisherContext,
  PublicRoute,
} from "./platform-security.js";

interface HeaderResponse {
  readonly setHeader: (name: string, value: string) => void;
  readonly status: (code: number) => void;
}

function toContract(release: PlatformRelease): PlatformReleaseContract {
  return {
    id: release.id,
    semanticVersion: release.semanticVersion,
    commitSha: release.commitSha,
    releaseNotes: release.releaseNotes,
    compatibility: release.compatibility,
    artifacts: [...release.artifacts],
    status: release.status,
    version: release.version.toString(),
    createdAt: release.createdAt.toISOString(),
    updatedAt: release.updatedAt.toISOString(),
  };
}

function sameRelease(left: PlatformRelease, right: ReturnType<typeof CreatePlatformReleaseSchema.parse>): boolean {
  const leftArtifacts = new Map(left.artifacts.map((artifact) => [artifact.name, artifact.digest]));
  return (
    left.id === right.id &&
    left.semanticVersion === right.semanticVersion &&
    left.commitSha === right.commitSha &&
    left.releaseNotes === right.releaseNotes &&
    left.compatibility.configurationSchemaVersion === right.compatibility.configurationSchemaVersion &&
    left.compatibility.agentContractVersion === right.compatibility.agentContractVersion &&
    left.compatibility.databaseMigrationRequired === right.compatibility.databaseMigrationRequired &&
    left.compatibility.minimumSourceVersion === right.compatibility.minimumSourceVersion &&
    right.artifacts.every((artifact) => leftArtifacts.get(artifact.name) === artifact.digest)
  );
}

@Controller("api/v1/release-candidates")
@PublicRoute()
@UseGuards(GithubActionsReleasePublisherGuard)
export class ReleaseCandidatePublisherController {
  public constructor(
    @Inject(PLATFORM_RELEASE_SERVICE) private readonly releases: PlatformReleaseService,
  ) {}

  @Post()
  public async create(
    @Req() request: Parameters<typeof githubActionsReleasePublisherContext>[0],
    @Body() body: unknown,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const publisher = githubActionsReleasePublisherContext(request);
    const parsed = CreatePlatformReleaseSchema.safeParse(body);
    if (!parsed.success || parsed.data.commitSha !== publisher.commitSha) {
      throw new BadRequestException();
    }

    try {
      const release = await this.releases.create(parsed.data);
      response.status(201);
      response.setHeader("ETag", `"${release.version.toString()}"`);
      response.setHeader("Location", `/api/v1/releases/${release.id}`);
      return PlatformReleaseResponseSchema.parse({
        schemaVersion: "platform-release/v1",
        data: toContract(release),
      });
    } catch (error) {
      if (!(error instanceof PlatformReleaseConflictError)) throw error;
      const existing = await this.releases.get(parsed.data.id).catch(() => null);
      if (!existing || !sameRelease(existing, parsed.data)) throw new ConflictException();
      response.status(200);
      response.setHeader("ETag", `"${existing.version.toString()}"`);
      response.setHeader("Location", `/api/v1/releases/${existing.id}`);
      return PlatformReleaseResponseSchema.parse({
        schemaVersion: "platform-release/v1",
        data: toContract(existing),
      });
    }
  }
}
