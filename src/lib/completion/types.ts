export type FieldStatsMap = Record<string, Record<string, number>>;

export type CompletionOptionData = {
  label: string;
  type?: string;
  detail?: string;
  snippet?: string;
};

export type CompletionResultData = {
  from: number;
  options: CompletionOptionData[];
  validFor?: string;
};

export type CompletionRequest = {
  doc: string;
  pos: number;
  explicit: boolean;
  collections: string[];
  fieldStats: FieldStatsMap;
  collectionPath: string;
};

export type CompletionWorkerMessage =
  | { type: "complete"; id: number; request: CompletionRequest }
  | { type: "abort"; id: number };

export type CompletionWorkerResponse = {
  id: number;
  result: CompletionResultData | null;
};
