import {
  createInfrastructureServerDraft,
  type InfrastructureServer,
  type InfrastructureServerArchitecture,
  type InfrastructureServerDraft,
  type InfrastructureServerStatus,
  type ServerCapacity,
} from "./infrastructure-server.js";

export interface InfrastructureServerListCriteria {
  readonly status?: InfrastructureServerStatus;
  readonly limit: number;
}

export interface InfrastructureServerRepository {
  readonly create: (draft: InfrastructureServerDraft) => Promise<InfrastructureServer>;
  readonly findById: (id: string) => Promise<InfrastructureServer | null>;
  readonly list: (
    criteria: InfrastructureServerListCriteria,
  ) => Promise<readonly InfrastructureServer[]>;
  readonly update: (
    id: string,
    expectedVersion: bigint,
    draft: InfrastructureServerDraft,
  ) => Promise<InfrastructureServer | null>;
}

export class InfrastructureServerNotFoundError extends Error {
  public constructor() {
    super("Infrastructure server not found");
    this.name = "InfrastructureServerNotFoundError";
  }
}

export class InfrastructureServerConflictError extends Error {
  public constructor() {
    super("Infrastructure server conflicts with existing state");
    this.name = "InfrastructureServerConflictError";
  }
}

export class InfrastructureServerVersionConflictError extends Error {
  public constructor() {
    super("Infrastructure server version is stale");
    this.name = "InfrastructureServerVersionConflictError";
  }
}

export interface CreateInfrastructureServerCommand {
  readonly code: string;
  readonly displayName: string;
  readonly provider: string;
  readonly region: string;
  readonly publicIpv4: string;
  readonly operatingSystem: string;
  readonly architecture: InfrastructureServerArchitecture;
  readonly status: InfrastructureServerStatus;
  readonly totalCapacity: ServerCapacity;
  readonly operationCredentialRef: string;
  readonly confirmedAt: Date;
}

export type UpdateInfrastructureServerCommand = Partial<CreateInfrastructureServerCommand>;

export class InfrastructureServerService {
  public constructor(private readonly repository: InfrastructureServerRepository) {}

  public create(command: CreateInfrastructureServerCommand): Promise<InfrastructureServer> {
    return this.repository.create(
      createInfrastructureServerDraft({
        ...command,
        reservedCapacity: { cpuMillicores: 0, memoryMiB: 0, storageMiB: 0 },
      }),
    );
  }

  public async get(id: string): Promise<InfrastructureServer> {
    const server = await this.repository.findById(id);
    if (!server) throw new InfrastructureServerNotFoundError();
    return server;
  }

  public list(
    criteria: InfrastructureServerListCriteria,
  ): Promise<readonly InfrastructureServer[]> {
    return this.repository.list(criteria);
  }

  public async update(
    id: string,
    expectedVersion: bigint,
    changes: UpdateInfrastructureServerCommand,
  ): Promise<InfrastructureServer> {
    const current = await this.get(id);
    const draft = createInfrastructureServerDraft({
      code: changes.code ?? current.code,
      displayName: changes.displayName ?? current.displayName,
      provider: changes.provider ?? current.provider,
      region: changes.region ?? current.region,
      publicIpv4: changes.publicIpv4 ?? current.publicIpv4,
      operatingSystem: changes.operatingSystem ?? current.operatingSystem,
      architecture: changes.architecture ?? current.architecture,
      status: changes.status ?? current.status,
      totalCapacity: changes.totalCapacity ?? current.totalCapacity,
      reservedCapacity: current.reservedCapacity,
      operationCredentialRef: changes.operationCredentialRef ?? current.operationCredentialRef,
      confirmedAt: changes.confirmedAt ?? current.confirmedAt,
    });
    const updated = await this.repository.update(id, expectedVersion, draft);
    if (!updated) throw new InfrastructureServerVersionConflictError();
    return updated;
  }
}
