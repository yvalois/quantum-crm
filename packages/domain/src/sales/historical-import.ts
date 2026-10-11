import type { OpportunityStatus, SalesContactLookup, SalesMemberLookup } from "./index.js";
import type {
  HistoricalImportContext,
  HistoricalImportResult,
  HistoricalImportSource,
} from "../shared/historical-import.js";

export interface HistoricalPipelineInput extends HistoricalImportContext {
  readonly source: HistoricalImportSource;
  readonly name: string;
  readonly description: string;
  readonly createdAt: Date;
  readonly stages: readonly {
    readonly externalId: string;
    readonly name: string;
    readonly description: string;
    readonly position: number;
  }[];
}

export interface HistoricalPipelineResult extends HistoricalImportResult {
  readonly stages: readonly { readonly externalId: string; readonly id: string }[];
}

export interface HistoricalOpportunityInput extends HistoricalImportContext {
  readonly source: HistoricalImportSource;
  readonly contactId: string;
  readonly pipelineId: string;
  readonly stageId: string;
  /** Explicit destination assignment; original assignedTo remains in the private source. */
  readonly ownerMemberId: string;
  readonly title: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: OpportunityStatus;
  readonly closeReason: string | null;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface HistoricalSalesImportLookups {
  readonly contacts: SalesContactLookup;
  readonly members: SalesMemberLookup;
}

export interface HistoricalSalesImportPort {
  readonly importPipeline: (input: HistoricalPipelineInput) => Promise<HistoricalPipelineResult>;
  readonly importOpportunity: (input: HistoricalOpportunityInput) => Promise<HistoricalImportResult>;
}
