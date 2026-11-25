import { expect, test } from "bun:test";
import { parseFieldPath } from "$lib/query/field-path";
import { parseQueryChain } from "$lib/query/parser";
import { getCompletionResult } from "./engine";
import type { FieldStatsMap } from "./types";

function complete(doc: string, fieldStats: FieldStatsMap = {
  users: { name: 2, status: 1 },
  organization: { title: 3, domain: 1 },
}) {
  return getCompletionResult({
    doc,
    pos: doc.length,
    explicit: false,
    collections: ["users", "organization", "organization/org1/teams"],
    collectionPath: "users",
    fieldStats,
  });
}

test("suggests select() and count() after a chain dot", () => {
  const result = complete("db.collection('users').");
  expect(result?.options.find((option) => option.label === "select")).toEqual({
    label: "select",
    detail: "select()",
    snippet: "select('${field}')",
  });
  expect(result?.options.find((option) => option.label === "count")).toEqual({
    label: "count",
    detail: "count()",
    snippet: "count()",
  });
});

for (const doc of [
  "db.collection('users').select('st",
  "db.collection('users').select('name', \"st",
]) {
  test(`suggests collection fields in ${doc}`, () => {
    expect(complete(doc)).toEqual({
      from: doc.length - 2,
      options: [
        { label: "name", type: "property" },
        { label: "status", type: "property" },
      ],
      validFor: "[\\w.]*",
    });
  });
}

test("suggests known collections only in the first join argument", () => {
  const doc = "db.collection('users').join('org";
  expect(complete(doc)).toEqual({
    from: doc.length - 3,
    options: [
      { label: "users", type: "property" },
      { label: "organization", type: "property" },
      { label: "organization/org1/teams", type: "property" },
    ],
    validFor: "[\\w/.-]*",
  });
  expect(complete("db.collection('users').join('organization', 'org")
    ?.options.some((option) => option.label === "organization")).toBe(false);
});

test("includes quotes when inserting a collection before the first join argument", () => {
  const doc = "db.collection('users').join(";
  const result = complete(doc);
  expect(result?.from).toBe(doc.length);
  expect(result?.options.find((option) => option.label === "organization")?.snippet)
    .toBe("'organization'");
});

const joined = "db.collection('users', 'u').join('organization', 'o', 'o.id', '==', 'u.organization')";

test("offers aliases while typing and refreshes suggestions after the dot", () => {
  const result = complete(joined + ".select('o");
  expect(result?.options.find((option) => option.label === "o.")).toEqual({
    label: "o.",
    detail: "organization",
    type: "variable",
  });
  expect(new RegExp(`^(?:${result?.validFor})$`).test("o.")).toBe(false);
});

test("suggests fields for the main collection alias and keeps the typed alias", () => {
  const doc = joined + ".select('u.st";
  const result = complete(doc);
  expect(result?.from).toBe(doc.length - 2);
  expect(result?.options.map((option) => option.label)).toEqual(["name", "status"]);
});

test("suggests fields for a joined collection alias in a subsequent select argument", () => {
  const doc = joined + ".select('u.name', \"o.";
  const result = complete(doc);
  expect(result?.from).toBe(doc.length);
  expect(result?.options.map((option) => option.label)).toEqual(["title", "domain"]);
});

test("uses only the aliased collection's learned fields", () => {
  const doc = joined + ".join('organization/org1/teams', 't', 't.id', '==', 'o.teamId').select('t.";
  expect(complete(doc)?.options).toEqual([]);
});

test("inserts escaped literal fields for either select argument quote", () => {
  const fields = ["company.name", "office location", "owner's name", 'owner"name', "tick`name", "slash\\name"];
  const fieldStats = { organization: Object.fromEntries(fields.map((field) => [field, 1])) };
  for (const quote of ["'", '"']) {
    const doc = `${joined}.select(${quote}o.`;
    const result = complete(doc, fieldStats);
    expect(result?.from).toBe(doc.length);
    expect(result?.options.map((option) => option.label)).toEqual(fields);
    for (const option of result?.options ?? []) {
      const parsed = parseQueryChain(`${doc}${option.snippet}${quote}).get()`);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parseFieldPath(parsed.ast.select?.[0].slice(2) ?? "")).toEqual([option.label]);
    }
  }
});

test("ignores fake join and select calls inside quoted arguments", () => {
  const doc = joined + `.where('note', '==', ".join('users', 'o') .select('ignored")\n.select('o.`;
  expect(complete(doc)?.options.map((option) => option.label)).toEqual(["title", "domain"]);
  const fakeJoin = "db.collection('users').where('note', '==', \"fake .join('org";
  expect(complete(fakeJoin)?.options.some((option) => option.label === "organization")).toBe(false);
});
