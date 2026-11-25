import { describe, expect, test } from "bun:test";
import { parseFieldPath, resolveRowField } from "./field-path";
import { getClientQueryProjection, getProjectionFields, projectResultRows, sortResultRows } from "./result-rows";
import type { QueryAst } from "./types";

const ast: QueryAst = { collectionPath: "users", where: [], orderBy: [], operation: "get" };

describe("projected query results", () => {
  test("sorts by unselected nested fields before removing them from results", () => {
    const query: QueryAst = {
      ...ast,
      collectionAlias: "u",
      select: ["u.name", "u.profile.city"],
      orderBy: [{ field: "u.profile.createdAt", dir: "asc" }]
    };
    const rows = [
      { name: "Mia", profile: { city: "Taipei", createdAt: 20 } },
      { name: "Avery", profile: { city: "Tainan", createdAt: 10 } }
    ];

    expect(getClientQueryProjection(query)).toEqual(["u.name", "u.profile.city", "u.profile.createdAt"]);
    expect(projectResultRows(sortResultRows(rows, query.orderBy, query.collectionAlias), query)).toEqual([
      { name: "Avery", profile: { city: "Tainan" } },
      { name: "Mia", profile: { city: "Taipei" } }
    ]);
  });

  test("keeps the real document ID separate from a selected id field", () => {
    const row = { id: "my-field", name: "Mia" };
    Object.defineProperty(row, "__docId", { value: "firestore-id" });
    const [projected] = projectResultRows([row], { ...ast, select: ["id", "__name__"] });

    expect(projected.__docId).toBe("firestore-id");
    expect(JSON.stringify(projected)).toBe('{"id":"my-field","__name__":"firestore-id"}');
    expect(resolveRowField(projected, "__name__")).toBe("firestore-id");
    expect(resolveRowField(projected, "`__name__`")).toBe("firestore-id");
  });

  test("preserves absent and quoted paths without treating literal dots as nesting", () => {
    const row = { "profile.city": "Literal", profile: { city: "Nested" } };
    const query = { ...ast, select: ["`profile.city`", "profile.city", "missing"] };

    expect(getProjectionFields(query)).toEqual(["`profile.city`", "profile.city", "missing"]);
    expect(projectResultRows([row], query)).toEqual([
      { "profile.city": "Literal", profile: { city: "Nested" } }
    ]);
    expect(parseFieldPath("map.`tick\\`field`.")).toBe(null);
    expect(parseFieldPath("map.`tick\\`field`")).toEqual(["map", "tick`field"]);
  });
});
