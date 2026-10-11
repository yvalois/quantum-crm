import type {
  HistoricalImportContext,
  HistoricalImportResult,
  HistoricalImportSource,
  HistoricalJsonValue,
} from "../shared/historical-import.js";

export interface HistoricalContactField {
  readonly fieldId: string;
  readonly key: string;
  readonly label: string;
  readonly dataType: string;
  readonly value: HistoricalJsonValue;
}

export interface HistoricalContactInput extends HistoricalImportContext {
  readonly source: HistoricalImportSource;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly ownerMemberId: string | null;
  readonly labelIds: readonly string[];
  readonly customFields: readonly HistoricalContactField[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface HistoricalLabelInput extends HistoricalImportContext {
  readonly source: HistoricalImportSource;
  readonly name: string;
}

/** Only explicit external identities match; email and phone never merge people. */
export interface HistoricalContactImportPort {
  readonly importLabel: (input: HistoricalLabelInput) => Promise<HistoricalImportResult>;
  readonly importContact: (input: HistoricalContactInput) => Promise<HistoricalImportResult>;
}
