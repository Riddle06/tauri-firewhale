import { isTauri } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { SignJWT, importPKCS8 } from "jose";
import type { ConnectionProfile } from "$lib/models";
import type { QueryAst, QueryRunResult, QueryValue, WhereClause } from "$lib/query/types";

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

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  referenceValue?: string;
  geoPointValue?: { latitude: number; longitude: number };
  bytesValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreFilter =
  | { fieldFilter: { field: { fieldPath: string }; op: string; value: FirestoreValue } }
  | { compositeFilter: { op: "AND"; filters: FirestoreFilter[] } };

export type FirestoreQueryResult = QueryRunResult & {
  pageIndex: number;
  pageSize: number;
  hasNextPage: boolean;
};

const tokenCache = new Map<string, TokenCacheEntry>();

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_PAGE_SIZE = 50;

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

function encodeFirestoreValue(value: QueryValue): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  }
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: value.toString() };
    return { doubleValue: value };
  }
  return { stringValue: String(value) };
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

function buildStructuredQuery(ast: QueryAst, pageSize: number, pageIndex: number): Record<string, unknown> {
  const { collectionId } = splitCollectionPath(ast.collectionPath);
  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId }],
    offset: pageIndex * pageSize,
    limit: pageSize
  };

  const filter = buildFirestoreFilter(ast.where);
  if (filter) {
    structuredQuery.where = filter;
  }

  if (ast.orderBy.length > 0) {
    structuredQuery.orderBy = ast.orderBy.map((order) => ({
      field: { fieldPath: order.field },
      direction: order.dir === "desc" ? "DESCENDING" : "ASCENDING"
    }));
  }

  return structuredQuery;
}

function extractDocumentId(name?: string): string {
  if (!name) return "";
  const parts = name.split("/");
  return parts[parts.length - 1] ?? "";
}

function parseRunQueryResponse(payload: unknown): Record<string, unknown>[] {
  if (!Array.isArray(payload)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const entry of payload) {
    const document = (entry as { document?: { name?: string; fields?: Record<string, FirestoreValue> } })
      .document;
    if (!document) continue;
    const fields = document.fields ?? {};
    const row: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      row[key] = decodeFirestoreValue(value);
    }
    if (!("id" in row)) {
      const id = extractDocumentId(document.name);
      if (id) row.id = id;
    }
    rows.push(row);
  }
  return rows;
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
      structuredQuery: buildStructuredQuery(ast, pageSize, pageIndex)
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Firestore request failed (${response.status}): ${message}`);
  }

  const payload = await response.json();
  const rows = parseRunQueryResponse(payload);

  return {
    rows,
    warnings,
    durationMs: Date.now() - start,
    pageIndex,
    pageSize,
    hasNextPage: rows.length === pageSize
  };
}
