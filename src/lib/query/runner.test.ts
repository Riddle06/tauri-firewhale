import { expect, test } from "bun:test";
import type { QueryAst } from "./types";
import { runQueryAst } from "./runner";

test("runQueryAst applies where/orderBy/limit", async () => {
  const ast: QueryAst = {
    collectionPath: "users",
    where: [{ field: "status", op: "==", value: "active" }],
    orderBy: [{ field: "age", dir: "desc" }],
    limit: 2,
    get: true
  };

  const result = await runQueryAst(ast);
  expect(result.rows.length).toBeLessThanOrEqual(2);
  expect(result.rows.length).toBeGreaterThan(0);
});
