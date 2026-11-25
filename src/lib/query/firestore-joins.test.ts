import { describe, expect, test } from "bun:test";
import { applyFirestoreJoins } from "./firestore";
import type { QueryAst } from "./types";

function document(name: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    name: `projects/demo/databases/(default)/documents/${name}`,
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, { stringValue: String(value) }])
    )
  };
}

describe("applyFirestoreJoins", () => {
  test("uses batchGet for document id joins and preserves a nested left join result", async () => {
    const originalFetch = globalThis.fetch;
    try {
    globalThis.fetch = async () => new Response(JSON.stringify([
      { found: document("workflows/w1", { name: "Primary workflow" }) }
    ]));
    const ast: QueryAst = {
      collectionPath: "steps",
      collectionAlias: "wes",
      joins: [{ collectionPath: "workflows", alias: "w", leftField: "w.id", op: "==", rightField: "wes.workflowId" }],
      where: [],
      orderBy: [],
      operation: "get"
    };

    const result = await applyFirestoreJoins("demo", "token", ast, [
      { id: "step-1", workflowId: "w1" },
      { id: "step-2", workflowId: "missing" }
    ]);

    expect(result.warnings).toEqual([]);
    expect(result.rows[0]?.w).toEqual([{ id: "w1", name: "Primary workflow" }]);
    expect(result.rows[0]?.["w.name"]).toEqual(["Primary workflow"]);
    expect(result.rows[1]?.w).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("supports generic equality joins and chained aliases", async () => {
    const originalFetch = globalThis.fetch;
    try {
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith(":batchGet")) {
        return new Response(JSON.stringify([
          { found: document("owners/owner-1", { name: "Avery" }) }
        ]));
      }
      const body = JSON.parse(String(init?.body)) as { structuredQuery: { where: { fieldFilter: { field: { fieldPath: string } } } } };
      const field = body.structuredQuery.where.fieldFilter.field.fieldPath;
      const rows = field === "slug"
        ? [{ document: document("workflows/w1", { slug: "alpha", ownerId: "owner-1" }) }]
        : [];
      return new Response(JSON.stringify(rows));
    };
    const ast: QueryAst = {
      collectionPath: "steps",
      collectionAlias: "wes",
      joins: [
        { collectionPath: "workflows", alias: "w", leftField: "w.slug", op: "==", rightField: "wes.workflowSlug" },
        { collectionPath: "owners", alias: "o", leftField: "o.id", op: "==", rightField: "w.ownerId" }
      ],
      where: [],
      orderBy: [],
      operation: "get"
    };

    const result = await applyFirestoreJoins("demo", "token", ast, [{ workflowSlug: "alpha" }]);

    expect(result.rows[0]?.["w.slug"]).toEqual(["alpha"]);
    expect(result.rows[0]?.["o.name"]).toEqual(["Avery"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reads the main document even when a joined alias has the same name as a main field", async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[][] = [];
    try {
      globalThis.fetch = async (_url, init) => {
        const { documents } = JSON.parse(String(init?.body)) as { documents: string[] };
        requests.push(documents);
        return new Response(JSON.stringify([{
          found: { name: documents[0], fields: { name: { stringValue: `Match ${requests.length}` } } }
        }]));
      };
      const ast: QueryAst = {
        collectionPath: "users",
        collectionAlias: "u",
        joins: [
          { collectionPath: "orgs", alias: "organization", leftField: "organization.id", op: "==", rightField: "u.organization" },
          { collectionPath: "audits", alias: "a", leftField: "a.id", op: "==", rightField: "u.organization" }
        ],
        where: [],
        orderBy: [],
        operation: "get"
      };
      const main = Object.defineProperty({ organization: "org-1" }, "__docId", { value: "user-1" });
      const { rows } = await applyFirestoreJoins("demo", "token", ast, [main]);

      expect(requests).toEqual([
        ["projects/demo/databases/(default)/documents/orgs/org-1"],
        ["projects/demo/databases/(default)/documents/audits/org-1"]
      ]);
      expect(rows[0]?.["organization.name"]).toEqual(["Match 1"]);
      expect(rows[0]?.["a.name"]).toEqual(["Match 2"]);
      expect(rows[0]?.__docId).toBe("user-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
