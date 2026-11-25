import { describe, expect, test } from "bun:test";
import { parseFieldPath, resolveRowField } from "./field-path";
import {
  getClientQueryProjection,
  getProjectionFields,
  getResultCellValue,
  projectResultRows,
  sortResultRows,
} from "./result-rows";
import type { QueryAst } from "./types";

const ast: QueryAst = { collectionPath: "users", where: [], orderBy: [], operation: "get" };
const joinedAst: QueryAst = {
  ...ast,
  collectionAlias: "u",
  joins: [{ collectionPath: "organization", alias: "o", leftField: "o.id", op: "==", rightField: "organization" }],
};

function joinedRow(main: Record<string, unknown>, organizations: Record<string, unknown>[]) {
  const row = { ...main, o: organizations };
  Object.defineProperty(row, "__mainRow", { value: main });
  return row;
}

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

  test("selects main and joined columns without exposing join keys or changing LEFT JOIN cardinality", () => {
    const query: QueryAst = { ...joinedAst, select: ["u.displayName", "o.name"] };
    const matched = { id: "stored-id", displayName: "Mia", organization: "org-1" };
    Object.defineProperty(matched, "__docId", { value: "real-user-id" });
    const rows = projectResultRows([
      joinedRow(matched, [{ name: "Acme", region: "TW" }]),
      joinedRow({ displayName: "Avery", organization: "missing" }, []),
    ], query);

    expect(getProjectionFields(query)).toEqual(["displayName", "o.name"]);
    expect(getClientQueryProjection(query)).toBe(undefined);
    expect(rows).toEqual([
      { displayName: "Mia", "o.name": ["Acme"] },
      { displayName: "Avery", "o.name": [] },
    ]);
    expect(rows[0].__docId).toBe("real-user-id");
    expect(getResultCellValue(rows[0], "o.name", query)).toEqual(["Acme"]);
    expect(getResultCellValue(rows[1], "o.name", query)).toEqual([]);
  });

  test("keeps colliding main and joined names separate and preserves one-to-many values", () => {
    const query: QueryAst = { ...joinedAst, select: ["u.o.address.city", "o.address.city"] };
    const [row] = projectResultRows([
      joinedRow({ o: { address: { city: "Taipei" } } }, [
        { address: { city: "Tainan" } },
        { address: { city: "Taichung" } },
      ]),
    ], query);

    expect(getProjectionFields(query)).toEqual(["u.o.address.city", "o.address.city"]);
    expect(row).toEqual({ "u.o.address.city": "Taipei", "o.address.city": ["Tainan", "Taichung"] });
  });
});
