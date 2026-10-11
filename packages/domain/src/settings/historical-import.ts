import type {
  HistoricalImportContext,
  HistoricalImportResult,
  HistoricalImportSource,
  HistoricalJsonValue,
} from "../shared/historical-import.js";

export interface HistoricalCustomFieldInput extends HistoricalImportContext {
  readonly source: HistoricalImportSource;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly dataType: string;
  readonly section: string;
  readonly options: HistoricalJsonValue;
}

export interface HistoricalSettingsImportPort {
  readonly importCustomField: (
    input: HistoricalCustomFieldInput,
  ) => Promise<HistoricalImportResult>;
}
