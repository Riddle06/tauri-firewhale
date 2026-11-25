import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, test } from "bun:test";
import { exportPKCS8, generateKeyPair } from "jose";
import type { ConnectionProfile } from "$lib/models";
import {
  getFirestoreDocument,
  runFirestoreCountQuery,
  runFirestoreQuery,
  runFirestoreQueryAll,
  updateFirestoreDocument
} from "./firestore";
import type { QueryAst } from "./types";

const CONNECTION: ConnectionProfile = {
  id: "demo",
  name: "Demo",
  projectId: "demo",
  kind: "firestore",
  auth: { mode: "serviceAccount", encryptedPayloadRef: "demo-credentials.json" },
  ui: {}
};

const DOCUMENTS_URL = "https://firestore.googleapis.com/v1/projects/demo/databases/(default)/documents";
const NESTED_QUERY_PARENT = `${DOCUMENTS_URL}/orgs/org%20%231%3F%25`;
const TOKEN_URL = "https://oauth2.example.invalid/token";

let credentials: Promise<Uint8Array> | undefined;

async function createTestCredentials(): Promise<Uint8Array> {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  return new TextEncoder().encode(JSON.stringify({
    client_email: "firewhale-transport-test@example.invalid",
    private_key: await exportPKCS8(privateKey),
    project_id: "demo",
    token_uri: TOKEN_URL
  }));
}

type RecordedRequest = { method: string | undefined; url: URL; body: unknown };

async function withFirestoreMock(
  responses: unknown[],
  run: (requests: RecordedRequest[]) => Promise<void>
): Promise<void> {
  const credentialBytes = await (credentials ??= createTestCredentials());
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousIsTauri = Object.getOwnPropertyDescriptor(globalThis, "isTauri");
  const previousFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "isTauri", { configurable: true, value: true });
    mockIPC((command) => {
      if (command !== "plugin:fs|read_text_file") throw new Error(`Unexpected IPC command: ${command}`);
      return credentialBytes;
    });
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.href === TOKEN_URL) {
        return Response.json({ access_token: "test-token", expires_in: 3600 });
      }

      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      const payload = responses[requests.length];
      requests.push({ method: init?.method, url, body });
      if (payload === undefined) throw new Error(`Unexpected Firestore request: ${url.href}`);
      return Response.json(payload);
    };
    await run(requests);
    expect(requests.length).toBe(responses.length);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousIsTauri) Object.defineProperty(globalThis, "isTauri", previousIsTauri);
    else Reflect.deleteProperty(globalThis, "isTauri");
  }
}

const COLLECTION_QUERY: QueryAst = {
  collectionPath: "orgs/org #1?%/users",
  collectionAlias: "user",
  where: [{ field: "user.status", op: "==", value: "active" }],
  orderBy: [{ field: "user.createdAt", dir: "desc" }]
};

const FILTERED_QUERY = {
  from: [{ collectionId: "users" }],
  where: {
    fieldFilter: {
      field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "active" }
    }
  }
};

const ORDER = [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }];

function countPayload(value: string): unknown[] {
  return [{ result: { aggregateFields: { total: { integerValue: value } } } }];
}

describe("Firestore query requests", () => {
  test("projects fields on paged and full queries while retaining document identity", async () => {
    const ast: QueryAst = {
      ...COLLECTION_QUERY,
      select: ["user.id", "user.profile.displayName", "user.profile", "user.__name__"],
      limit: 2,
      operation: "get"
    };
    const documents = [
      { document: {
        name: "projects/demo/databases/(default)/documents/orgs/org #1?%/users/real-id",
        fields: { profile: { mapValue: { fields: { displayName: { stringValue: "Avery" } } } } }
      } },
      { document: {
        name: "projects/demo/databases/(default)/documents/orgs/org #1?%/users/other-id",
        fields: { id: { stringValue: "stored-id" } }
      } }
    ];
    const select = { fields: [{ fieldPath: "id" }, { fieldPath: "profile" }, { fieldPath: "__name__" }] };

    await withFirestoreMock([documents, documents], async (requests) => {
      const page = await runFirestoreQuery(CONNECTION, ast, { pageIndex: 1 });
      const all = await runFirestoreQueryAll(CONNECTION, ast);

      expect(requests.map(({ url, method }) => [url.href, method])).toEqual([
        [`${NESTED_QUERY_PARENT}:runQuery`, "POST"],
        [`${NESTED_QUERY_PARENT}:runQuery`, "POST"]
      ]);
      expect(requests[0].body).toEqual({
        structuredQuery: { ...FILTERED_QUERY, select, orderBy: ORDER, offset: 2, limit: 2 }
      });
      expect(requests[1].body).toEqual({ structuredQuery: { ...FILTERED_QUERY, select } });
      expect(page.rows.map((row) => row.__docId)).toEqual(["real-id", "other-id"]);
      expect(page.rows.map((row) => Object.keys(row))).toEqual([["profile"], ["id"]]);
      expect(JSON.parse(JSON.stringify(page.rows))).toEqual([
        { profile: { displayName: "Avery" } }, { id: "stored-id" }
      ]);
      expect(all.rows.map((row) => row.__docId)).toEqual(["real-id", "other-id"]);
    });
  });

  test("counts with explicit order and limit while keeping pagination preflight unbounded", async () => {
    const ast: QueryAst = { ...COLLECTION_QUERY, operation: "count" };
    const aggregation = (structuredQuery: Record<string, unknown>) => ({
      structuredAggregationQuery: { structuredQuery, aggregations: [{ alias: "total", count: {} }] }
    });

    await withFirestoreMock([countPayload("128"), countPayload("0"), countPayload("200")], async (requests) => {
      expect(await runFirestoreCountQuery(CONNECTION, ast, { honorQueryConstraints: true })).toBe(128);
      expect(await runFirestoreCountQuery(CONNECTION, { ...ast, limit: 5 }, {
        honorQueryConstraints: true
      })).toBe(0);
      expect(await runFirestoreCountQuery(CONNECTION, {
        ...ast, operation: "get", limit: 5, select: ["name"]
      })).toBe(200);

      expect(requests.map(({ url, method }) => [url.href, method])).toEqual([
        [`${NESTED_QUERY_PARENT}:runAggregationQuery`, "POST"],
        [`${NESTED_QUERY_PARENT}:runAggregationQuery`, "POST"],
        [`${NESTED_QUERY_PARENT}:runAggregationQuery`, "POST"]
      ]);
      expect(requests.map(({ body }) => body)).toEqual([
        aggregation({ ...FILTERED_QUERY, orderBy: ORDER }),
        aggregation({ ...FILTERED_QUERY, orderBy: ORDER, limit: 5 }),
        aggregation(FILTERED_QUERY)
      ]);
    });
  });

  test("reports a missing or unsafe aggregate result as an error", async () => {
    await withFirestoreMock([[{ readTime: "2026-11-25T00:00:00Z" }], countPayload("9007199254740993")], async () => {
      const run = () => runFirestoreCountQuery(CONNECTION, { ...COLLECTION_QUERY, operation: "count" });
      const errorMessage = (error: unknown) => error instanceof Error ? error.message : null;

      expect(await run().then(() => null, errorMessage)).toBe("Firestore response did not include a valid count.");
      expect(await run().then(() => null, errorMessage)).toBe("Firestore count exceeds the supported integer range.");
    });
  });

  test("loads the full document and sends a guarded field mask for projected edits", async () => {
    const documentId = "with # and %";
    const name = `projects/demo/databases/(default)/documents/users/${documentId}`;
    const original = { name, fields: { name: { stringValue: "Avery" }, status: { stringValue: "active" } } };
    const updated = { name, fields: { name: { stringValue: "Casey" }, status: { stringValue: "active" } } };

    await withFirestoreMock([original, updated], async (requests) => {
      const full = await getFirestoreDocument(CONNECTION, "users", documentId);
      expect(full).toEqual({ id: documentId, name: "Avery", status: "active" });
      expect(full.__docId).toBe(documentId);

      const saved = await updateFirestoreDocument(CONNECTION, "users", documentId, {
        name: "Casey", status: "active"
      }, { updateMask: ["name", "profile.`old.label`"] });
      expect(saved.status).toBe("active");

      expect(requests[0].method).toBe("GET");
      expect(requests[0].url.href).toBe(`${DOCUMENTS_URL}/users/with%20%23%20and%20%25`);
      expect(requests[1].method).toBe("PATCH");
      expect(requests[1].url.pathname).toBe(requests[0].url.pathname);
      expect(requests[1].url.searchParams.getAll("updateMask.fieldPaths")).toEqual(["name", "profile.`old.label`"]);
      expect(requests[1].url.searchParams.get("currentDocument.exists")).toBe("true");
      expect(requests[1].body).toEqual({ fields: { name: { stringValue: "Casey" } } });
    });
  });
});
