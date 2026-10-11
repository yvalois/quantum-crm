export interface GhlImportProgress {
  readonly resource: string;
  readonly processed: number;
  readonly created: number;
  readonly replayed: number;
  readonly conflicts: number;
  readonly total: number;
}

export interface GhlImportOperationIdentity {
  readonly operationId: string;
  readonly tenantId: string;
  readonly locationId: string;
  readonly exportId: string;
  readonly artifactSha256: string;
  readonly currency: string;
  readonly operatorMemberId: string;
}

/** Owns only integration intent/progress; business records belong to their modules. */
export interface GhlImportOperationRepository {
  readonly begin: (identity: GhlImportOperationIdentity) => Promise<void>;
  readonly checkpoint: (progress: GhlImportProgress) => Promise<void>;
  readonly finish: (status: "COMPLETE" | "CONFLICTS" | "FAILED") => Promise<void>;
  readonly inspect: (identity: GhlImportOperationIdentity) => Promise<{
    readonly status: string;
    readonly progress: readonly GhlImportProgress[];
  } | null>;
  readonly close: () => Promise<void>;
}
