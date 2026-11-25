import { expect, test } from "bun:test";
import { getCompletionResult } from "./engine";

function complete(doc: string) {
  return getCompletionResult({
    doc,
    pos: doc.length,
    explicit: false,
    collections: ["users"],
    collectionPath: "users",
    fieldStats: { users: { name: 2, status: 1 } },
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
