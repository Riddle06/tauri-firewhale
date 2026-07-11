export const WHERE_OPERATORS = [
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "in",
  "array-contains",
  "array-contains-any"
] as const;

export type WhereOperator = (typeof WHERE_OPERATORS)[number];

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[];

export type WhereClause = {
  field: string;
  op: WhereOperator;
  value: QueryValue;
};

export type OrderByClause = {
  field: string;
  dir: "asc" | "desc";
};

export type JoinClause = {
  collectionPath: string;
  alias: string;
  leftField: string;
  op: "==";
  rightField: string;
};

export type QueryAst = {
  collectionPath: string;
  collectionAlias?: string;
  joins?: JoinClause[];
  where: WhereClause[];
  orderBy: OrderByClause[];
  limit?: number;
  get: boolean;
};

export type QueryParseResult =
  | { ok: true; ast: QueryAst }
  | { ok: false; error: string; position?: number };

export type QueryRunResult = {
  rows: Record<string, unknown>[];
  warnings: string[];
  durationMs: number;
};
