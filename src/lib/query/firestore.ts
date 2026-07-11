import { isTauri } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { SignJWT, importPKCS8 } from "jose";
import type { ConnectionProfile } from "$lib/models";
import type { QueryAst, QueryRunResult, WhereClause } from "$lib/query/types";
import {
  encodeFirestoreFields,
  encodeFirestoreValue,
  type FirestoreValue
} from "$lib/query/firestore-values";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

type TokenCacheEntry = {
  token: string;
  expiresAt: number;
};

type FirestoreFilter =
  | { fieldFilter: { field: { fieldPath: string }; op: string; value: FirestoreValue } }
  | { compositeFilter: { op: "AND"; filters: FirestoreFilter[] } };

type FirestoreDocument = {
  name?: string;
  fields?: Record<string, FirestoreValue>;
};

export type FirestoreQueryResult = QueryRunResult & {
  pageIndex: number;
  pageSize: number;
  hasNextPage: boolean;
};

const tokenCache = new Map<string, TokenCacheEntry>();

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_PAGE_SIZE = 50;
const JOIN_IN_VALUE_LIMIT = 30;
const JOIN_REQUEST_CONCURRENCY = 4;

const OPERATOR_MAP: Record<WhereClause["op"], string> = {
  "==": "EQUAL",
  "!=": "NOT_EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
  in: "IN",
  "array-contains": "ARRAY_CONTAINS",
  "array-contains-any": "ARRAY_CONTAINS_ANY"
};

function parseServiceAccount(raw: string): ServiceAccount {
  const data = JSON.parse(raw) as ServiceAccount;
  if (!data.client_email || !data.private_key) {
    throw new Error("Invalid credential JSON.");
  }
  return data;
}

async function loadServiceAccount(path: string): Promise<ServiceAccount> {
  if (!isTauri()) {
    throw new Error("Credential files are only supported in the desktop app.");
  }
  if (!path) {
    throw new Error("Credential path is missing.");
  }
  const raw = await readTextFile(path);
  return parseServiceAccount(raw);
}

function decodeFirestoreValue(value?: FirestoreValue): unknown {
  if (!value) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.nullValue !== undefined) return null;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.referenceValue !== undefined) return value.referenceValue;
  if (value.geoPointValue !== undefined) return value.geoPointValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.arrayValue) {
    return (value.arrayValue.values ?? []).map((entry) => decodeFirestoreValue(entry));
  }
  if (value.mapValue) {
    const fields = value.mapValue.fields ?? {};
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(fields)) {
      output[key] = decodeFirestoreValue(entry);
    }
    return output;
  }
  return null;
}

function buildFirestoreFilter(clauses: WhereClause[]): FirestoreFilter | undefined {
  if (clauses.length === 0) return undefined;
  const filters = clauses.map(
    (clause): FirestoreFilter => ({
      fieldFilter: {
        field: { fieldPath: clause.field },
        op: OPERATOR_MAP[clause.op],
        value: encodeFirestoreValue(clause.value)
      }
    })
  );
  if (filters.length === 1) return filters[0];
  return { compositeFilter: { op: "AND", filters } };
}

function splitCollectionPath(path: string): { parentPath: string; collectionId: string } {
  const parts = path.split("/").filter(Boolean);
  const collectionId = parts[parts.length - 1] ?? "";
  const parentSegments = parts.slice(0, -1);
  const parentPath = parentSegments.join("/");
  return { parentPath, collectionId };
}

async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const cacheKey = serviceAccount.client_email;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.token;
  }

  const tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;
  const issuedAt = Math.floor(now / 1000);
  const privateKey = await importPKCS8(serviceAccount.private_key, "RS256");

  const jwt = await new SignJWT({ scope: FIRESTORE_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .setIssuer(serviceAccount.client_email)
    .setAudience(tokenUri)
    .sign(privateKey);

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Token request failed (${response.status}): ${message}`);
  }

  const payload = (await response.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  const expiresAt = now + (payload.expires_in - 60) * 1000;
  tokenCache.set(cacheKey, { token: payload.access_token, expiresAt });
  return payload.access_token;
}

async function listCollectionIds(
  projectId: string,
  accessToken: string
): Promise<string[]> {
  const collections: string[] = [];
  let pageToken: string | undefined;
  const parent = `projects/${projectId}/databases/(default)/documents`;

  do {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:listCollectionIds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          parent,
          pageSize: 1000,
          pageToken
        })
      }
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Firestore request failed (${response.status}): ${message}`);
    }

    const payload = (await response.json()) as {
      collectionIds?: string[];
      nextPageToken?: string;
    };

    if (payload.collectionIds) {
      collections.push(...payload.collectionIds);
    }
    pageToken = payload.nextPageToken;
  } while (pageToken);

  return collections;
}

export async function fetchCollectionsForConnection(
  connection: ConnectionProfile
): Promise<string[]> {
  const credentialPath = connection.auth.encryptedPayloadRef;
  const serviceAccount = await loadServiceAccount(credentialPath);
  if (
    connection.projectId &&
    serviceAccount.project_id &&
    connection.projectId !== serviceAccount.project_id
  ) {
    throw new Error("Project ID does not match credential.");
  }

  const projectId = connection.projectId || serviceAccount.project_id;

  if (!projectId) {
    throw new Error("Project ID is missing.");
  }

  const accessToken = await getAccessToken(serviceAccount);
  return listCollectionIds(projectId, accessToken);
}

type StructuredQueryOptions = {
  pageSize?: number;
  pageIndex?: number;
  includeOrderBy?: boolean;
  includeLimit?: boolean;
};

function buildStructuredQuery(
  ast: QueryAst,
  options: StructuredQueryOptions = {}
): Record<string, unknown> {
  const { collectionId } = splitCollectionPath(ast.collectionPath);
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId }]
  };

  const filter = buildFirestoreFilter(ast.where);
  if (filter) {
    structuredQuery.where = filter;
  }

  if (options.includeOrderBy !== false && ast.orderBy.length > 0) {
    structuredQuery.orderBy = ast.orderBy.map((order) => ({
      field: { fieldPath: order.field },
      direction: order.dir === "desc" ? "DESCENDING" : "ASCENDING"
    }));
  }

  if (options.includeLimit !== false) {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const pageIndex = options.pageIndex ?? 0;
    structuredQuery.offset = pageIndex * pageSize;
    structuredQuery.limit = pageSize;
  }

  return structuredQuery;
}

function extractDocumentId(name?: string): string {
  if (!name) return "";
  const parts = name.split("/");
  return parts[parts.length - 1] ?? "";
}

function buildDocumentPath(collectionPath: string, documentId: string): string {
  const normalizedCollection = collectionPath.replace(/^\/+|\/+$/g, "");
  const normalizedId = documentId.replace(/^\/+|\/+$/g, "");
  if (!normalizedCollection) return normalizedId;
  if (!normalizedId) return normalizedCollection;
  return `${normalizedCollection}/${normalizedId}`;
}

function normalizeMainField(field: string, collectionAlias?: string): string {
  const prefix = collectionAlias ? `${collectionAlias}.` : "";
  return prefix && field.startsWith(prefix) ? field.slice(prefix.length) : field;
}

function normalizeMainQuery(ast: QueryAst): QueryAst {
  return {
    ...ast,
    where: ast.where.map((clause) => ({
      ...clause,
      field: normalizeMainField(clause.field, ast.collectionAlias)
    })),
    orderBy: ast.orderBy.map((clause) => ({
      ...clause,
      field: normalizeMainField(clause.field, ast.collectionAlias)
    }))
  };
}

function resolveRowField(row: Record<string, unknown>, field: string): unknown {
  if (Object.prototype.hasOwnProperty.call(row, field)) return row[field];
  return field.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, row);
}

function normalizeDocumentId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const segments = String(value).split("/").filter(Boolean);
  return segments[segments.length - 1] ?? null;
}

function getJoinValueKey(value: unknown): string | null {
  if (value === null) return "null";
  if (typeof value === "string") return `string:${value}`;
  if (typeof value === "number") return `number:${value}`;
  if (typeof value === "boolean") return `boolean:${value}`;
  return null;
}

function splitJoinReference(
  reference: string,
  collectionAlias: string | undefined,
  joinAliases: Set<string>
): { alias?: string; field: string } {
  const [first, ...rest] = reference.split(".");
  if (rest.length > 0 && (first === collectionAlias || joinAliases.has(first))) {
    return { alias: first, field: rest.join(".") };
  }
  return { field: reference };
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  handler: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (const chunk of chunkValues(values, JOIN_REQUEST_CONCURRENCY)) {
    results.push(...await Promise.all(chunk.map(handler)));
  }
  return results;
}

function decodeFirestoreDocument(document?: FirestoreDocument): Record<string, unknown> | null {
  if (!document) return null;
  const fields = document.fields ?? {};
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    row[key] = decodeFirestoreValue(value);
  }
  const documentId = extractDocumentId(document.name);
  if (documentId) {
    const hasIdField = Object.prototype.hasOwnProperty.call(row, "id");
    if (!hasIdField) {
      row.id = documentId;
    }
    Object.defineProperty(row, "__docId", {
      value: documentId,
      enumerable: false
    });
    Object.defineProperty(row, "__idSynthetic", {
      value: !hasIdField,
      enumerable: false
    });
  }
  return row;
}

function parseRunQueryResponse(payload: unknown): Record<string, unknown>[] {
  if (!Array.isArray(payload)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const entry of payload) {
    const document = (entry as { document?: FirestoreDocument }).document;
    const row = decodeFirestoreDocument(document);
    if (!row) continue;
    rows.push(row);
  }
  return rows;
}

function parseBatchGetResponse(payload: unknown): Record<string, unknown>[] {
  if (!Array.isArray(payload)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const entry of payload) {
    const document = (entry as { found?: FirestoreDocument }).found;
    const row = decodeFirestoreDocument(document);
    if (row) rows.push(row);
  }
  return rows;
}

function getDocumentJoinId(document: Record<string, unknown>): unknown {
  const documentId = (document as { __docId?: unknown }).__docId;
  return documentId ?? document.id;
}

function getRunQueryUrl(projectId: string, collectionPath: string): string {
  const { parentPath } = splitCollectionPath(collectionPath);
  const parent = parentPath
    ? `projects/${projectId}/databases/(default)/documents/${parentPath}`
    : `projects/${projectId}/databases/(default)/documents`;
  return `https://firestore.googleapis.com/v1/${parent}:runQuery`;
}

async function fetchFirestoreDocumentsById(
  projectId: string,
  accessToken: string,
  collectionPath: string,
  documentIds: string[]
): Promise<Record<string, unknown>[]> {
  if (documentIds.length === 0) return [];
  const basePath = `projects/${projectId}/databases/(default)/documents`;
  const response = await fetch(
    `https://firestore.googleapis.com/v1/${basePath}:batchGet`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: documentIds.map((id) => `${basePath}/${buildDocumentPath(collectionPath, id)}`)
      })
    }
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Firestore join request failed (${response.status}): ${message}`);
  }
  return parseBatchGetResponse((await response.json()) as unknown[]);
}

async function fetchFirestoreDocumentsByField(
  projectId: string,
  accessToken: string,
  collectionPath: string,
  field: string,
  values: unknown[]
): Promise<Record<string, unknown>[]> {
  const url = getRunQueryUrl(projectId, collectionPath);
  const chunks = chunkValues(values, JOIN_IN_VALUE_LIMIT);
  const responses = await mapWithConcurrency(chunks, async (chunk) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: splitCollectionPath(collectionPath).collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath: field },
              op: "IN",
              value: encodeFirestoreValue(chunk)
            }
          }
        }
      })
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Firestore join request failed (${response.status}): ${message}`);
    }
    return parseRunQueryResponse(await response.json());
  });
  return responses.flat();
}

type JoinedRow = { main: Record<string, unknown>; output: Record<string, unknown> };

function getJoinSourceValues(
  output: Record<string, unknown>,
  reference: string,
  collectionAlias: string | undefined,
  joinAliases: Set<string>
): unknown[] {
  const parsed = splitJoinReference(reference, collectionAlias, joinAliases);
  if (parsed.alias && parsed.alias !== collectionAlias) {
    const sourceRows = output[parsed.alias];
    if (!Array.isArray(sourceRows)) return [];
    return sourceRows.map((row) =>
      row && typeof row === "object" ? resolveRowField(row as Record<string, unknown>, parsed.field) : undefined
    );
  }
  return [resolveRowField(output, parsed.field)];
}

function addJoinResult(
  output: Record<string, unknown>,
  alias: string,
  documents: Record<string, unknown>[]
): Record<string, unknown> {
  const fields: Record<string, unknown> = { [alias]: documents };
  const keys = new Set(documents.flatMap((document) => Object.keys(document)));
  for (const key of keys) {
    fields[`${alias}.${key}`] = documents.map((document) => document[key]);
  }
  return { ...output, ...fields };
}

export async function applyFirestoreJoins(
  projectId: string,
  accessToken: string,
  ast: QueryAst,
  rows: Record<string, unknown>[]
): Promise<{ rows: Record<string, unknown>[]; warnings: string[] }> {
  const joins = ast.joins ?? [];
  if (joins.length === 0 || rows.length === 0) return { rows, warnings: [] };
  const warnings: string[] = [];
  let joinedRows: JoinedRow[] = rows.map((main) => ({ main, output: { ...main } }));
  const joinAliases = new Set<string>();

  for (const join of joins) {
    const left = splitJoinReference(
      join.leftField,
      ast.collectionAlias,
      new Set([...joinAliases, join.alias])
    );
    const sources = new Map<string, unknown>();
    let skippedValues = 0;
    for (const { output } of joinedRows) {
      for (const value of getJoinSourceValues(output, join.rightField, ast.collectionAlias, joinAliases)) {
        const normalizedValue = left.field === "id" ? normalizeDocumentId(value) : value;
        const key = getJoinValueKey(normalizedValue);
        if (key) {
          sources.set(key, normalizedValue);
        } else if (value !== undefined) {
          skippedValues += 1;
        }
      }
    }
    if (skippedValues > 0) {
      warnings.push(`Join ${join.alias} skipped ${skippedValues} unsupported source value(s).`);
    }

    const matches = new Map<string, Record<string, unknown>[]>();
    if (left.field === "id") {
      const ids = [...sources.values()]
        .map(normalizeDocumentId)
        .filter((id): id is string => Boolean(id));
      const documents = (await mapWithConcurrency(chunkValues(ids, JOIN_IN_VALUE_LIMIT), (chunk) =>
        fetchFirestoreDocumentsById(projectId, accessToken, join.collectionPath, chunk)
      )).flat();
      for (const document of documents) {
        const key = getJoinValueKey(getDocumentJoinId(document));
        if (key) matches.set(key, [document]);
      }
    } else if (sources.size > 0) {
      const documents = await fetchFirestoreDocumentsByField(
        projectId,
        accessToken,
        join.collectionPath,
        left.field,
        [...sources.values()]
      );
      for (const document of documents) {
        const key = getJoinValueKey(resolveRowField(document, left.field));
        if (!key) continue;
        matches.set(key, [...(matches.get(key) ?? []), document]);
      }
    }

    joinedRows = joinedRows.map(({ main, output }) => {
      const documents = getJoinSourceValues(output, join.rightField, ast.collectionAlias, joinAliases)
        .flatMap((value) => {
          const normalizedValue = left.field === "id" ? normalizeDocumentId(value) : value;
          return matches.get(getJoinValueKey(normalizedValue) ?? "") ?? [];
        });
      return { main, output: addJoinResult(output, join.alias, documents) };
    });
    joinAliases.add(join.alias);
  }

  const outputRows = joinedRows.map(({ main, output }) => {
    Object.defineProperty(output, "__mainRow", { value: main, enumerable: false });
    return output;
  });
  return { rows: outputRows, warnings };
}

function parseCountResponse(payload: unknown): number {
  if (!Array.isArray(payload)) return 0;
  for (const entry of payload) {
    const result = (entry as { result?: { aggregateFields?: Record<string, FirestoreValue> } }).result;
    const fields = result?.aggregateFields;
    if (!fields) continue;
    const countField = fields.total ?? fields.count ?? Object.values(fields)[0];
    if (!countField) continue;
    const decoded = decodeFirestoreValue(countField);
    if (typeof decoded === "number") return decoded;
    if (typeof decoded === "string") {
      const parsed = Number(decoded);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

export async function runFirestoreQuery(
  connection: ConnectionProfile,
  ast: QueryAst,
  options: { pageIndex?: number; pageSize?: number } = {}
): Promise<FirestoreQueryResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const rawPageSize = options.pageSize ?? ast.limit ?? DEFAULT_PAGE_SIZE;
  const pageSize = Number.isFinite(rawPageSize)
    ? Math.max(1, Math.floor(rawPageSize))
    : DEFAULT_PAGE_SIZE;
  const rawPageIndex = options.pageIndex ?? 0;
  const pageIndex = Number.isFinite(rawPageIndex)
    ? Math.max(0, Math.floor(rawPageIndex))
    : 0;

  if (!ast.limit) {
    warnings.push(`No limit specified. Using default page size ${pageSize}.`);
  }

  const credentialPath = connection.auth.encryptedPayloadRef;
  const serviceAccount = await loadServiceAccount(credentialPath);
  if (
    connection.projectId &&
    serviceAccount.project_id &&
    connection.projectId !== serviceAccount.project_id
  ) {
    throw new Error("Project ID does not match credential.");
  }

  const projectId = connection.projectId || serviceAccount.project_id;

  if (!projectId) {
    throw new Error("Project ID is missing.");
  }

  const accessToken = await getAccessToken(serviceAccount);
  const { parentPath } = splitCollectionPath(ast.collectionPath);
  const baseParent = parentPath
    ? `projects/${projectId}/databases/(default)/documents/${parentPath}`
    : `projects/${projectId}/databases/(default)/documents`;
  const url = `https://firestore.googleapis.com/v1/${baseParent}:runQuery`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: buildStructuredQuery(normalizeMainQuery(ast), { pageSize, pageIndex })
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Firestore request failed (${response.status}): ${message}`);
  }

  const payload = await response.json();
  const joined = await applyFirestoreJoins(
    projectId,
    accessToken,
    ast,
    parseRunQueryResponse(payload)
  );
  warnings.push(...joined.warnings);

  return {
    rows: joined.rows,
    warnings,
    durationMs: Date.now() - start,
    pageIndex,
    pageSize,
    hasNextPage: joined.rows.length === pageSize
  };
}

export async function runFirestoreQueryAll(
  connection: ConnectionProfile,
  ast: QueryAst
): Promise<QueryRunResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const credentialPath = connection.auth.encryptedPayloadRef;
  const serviceAccount = await loadServiceAccount(credentialPath);
  if (
    connection.projectId &&
    serviceAccount.project_id &&
    connection.projectId !== serviceAccount.project_id
  ) {
    throw new Error("Project ID does not match credential.");
  }

  const projectId = connection.projectId || serviceAccount.project_id;

  if (!projectId) {
    throw new Error("Project ID is missing.");
  }

  const accessToken = await getAccessToken(serviceAccount);
  const { parentPath } = splitCollectionPath(ast.collectionPath);
  const baseParent = parentPath
    ? `projects/${projectId}/databases/(default)/documents/${parentPath}`
    : `projects/${projectId}/databases/(default)/documents`;
  const url = `https://firestore.googleapis.com/v1/${baseParent}:runQuery`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: buildStructuredQuery(normalizeMainQuery(ast), {
        includeLimit: false,
        includeOrderBy: false
      })
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Firestore request failed (${response.status}): ${message}`);
  }

  const payload = await response.json();
  const joined = await applyFirestoreJoins(
    projectId,
    accessToken,
    ast,
    parseRunQueryResponse(payload)
  );
  warnings.push(...joined.warnings);

  return {
    rows: joined.rows,
    warnings,
    durationMs: Date.now() - start
  };
}

export async function runFirestoreCountQuery(
  connection: ConnectionProfile,
  ast: QueryAst
): Promise<number> {
  const credentialPath = connection.auth.encryptedPayloadRef;
  const serviceAccount = await loadServiceAccount(credentialPath);
  if (
    connection.projectId &&
    serviceAccount.project_id &&
    connection.projectId !== serviceAccount.project_id
  ) {
    throw new Error("Project ID does not match credential.");
  }

  const projectId = connection.projectId || serviceAccount.project_id;

  if (!projectId) {
    throw new Error("Project ID is missing.");
  }

  const accessToken = await getAccessToken(serviceAccount);
  const { parentPath } = splitCollectionPath(ast.collectionPath);
  const baseParent = parentPath
    ? `projects/${projectId}/databases/(default)/documents/${parentPath}`
    : `projects/${projectId}/databases/(default)/documents`;
  const url = `https://firestore.googleapis.com/v1/${baseParent}:runAggregationQuery`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: buildStructuredQuery(normalizeMainQuery(ast), {
          includeLimit: false,
          includeOrderBy: false
        }),
        aggregations: [{ alias: "total", count: {} }]
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Firestore request failed (${response.status}): ${message}`);
  }

  const payload = await response.json();
  return parseCountResponse(payload);
}

export async function updateFirestoreDocument(
  connection: ConnectionProfile,
  collectionPath: string,
  documentId: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!collectionPath) {
    throw new Error("Collection path is missing.");
  }
  if (!documentId) {
    throw new Error("Document id is missing.");
  }
  const credentialPath = connection.auth.encryptedPayloadRef;
  const serviceAccount = await loadServiceAccount(credentialPath);
  if (
    connection.projectId &&
    serviceAccount.project_id &&
    connection.projectId !== serviceAccount.project_id
  ) {
    throw new Error("Project ID does not match credential.");
  }

  const projectId = connection.projectId || serviceAccount.project_id;

  if (!projectId) {
    throw new Error("Project ID is missing.");
  }

  const accessToken = await getAccessToken(serviceAccount);
  const documentPath = buildDocumentPath(collectionPath, documentId);
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: encodeFirestoreFields(data, { coerceTimestampStrings: true })
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Firestore request failed (${response.status}): ${message}`);
  }

  const payload = (await response.json()) as FirestoreDocument;
  const row = decodeFirestoreDocument(payload);
  if (!row) {
    throw new Error("Failed to decode updated document.");
  }
  return row;
}

export async function createFirestoreDocument(
  connection: ConnectionProfile,
  collectionPath: string,
  documentId: string | null,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const normalizedCollectionPath = collectionPath.replace(/^\/+|\/+$/g, "");
  if (!normalizedCollectionPath) {
    throw new Error("Collection path is missing.");
  }

  const normalizedDocumentId = (documentId ?? "").replace(/^\/+|\/+$/g, "");
  if (normalizedDocumentId.includes("/")) {
    throw new Error("Document id cannot contain '/'.");
  }

  const credentialPath = connection.auth.encryptedPayloadRef;
  const serviceAccount = await loadServiceAccount(credentialPath);
  if (
    connection.projectId &&
    serviceAccount.project_id &&
    connection.projectId !== serviceAccount.project_id
  ) {
    throw new Error("Project ID does not match credential.");
  }

  const projectId = connection.projectId || serviceAccount.project_id;

  if (!projectId) {
    throw new Error("Project ID is missing.");
  }

  const accessToken = await getAccessToken(serviceAccount);
  const query = new URLSearchParams();
  if (normalizedDocumentId) {
    query.set("documentId", normalizedDocumentId);
  }
  const queryString = query.toString();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${normalizedCollectionPath}${
    queryString ? `?${queryString}` : ""
  }`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: encodeFirestoreFields(data, { coerceTimestampStrings: true })
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Firestore request failed (${response.status}): ${message}`);
  }

  const payload = (await response.json()) as FirestoreDocument;
  const row = decodeFirestoreDocument(payload);
  if (!row) {
    throw new Error("Failed to decode created document.");
  }
  return row;
}
