import { describe, expect, test } from "bun:test";
import { parseQueryChain, validateQueryAst } from "./parser";

describe("parseQueryChain", () => {
  test("parses a valid chain query", () => {
    const input =
      "db.collection('users').where('age', '>', 18).where('status', '==', 'active').orderBy('createdAt', 'desc').limit(5).get()";
    const result = parseQueryChain(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ast.collectionPath).toBe("users");
      expect(result.ast.where.length).toBe(2);
      expect(result.ast.orderBy[0]?.dir).toBe("desc");
      expect(result.ast.limit).toBe(5);
      expect(result.ast.get).toBe(true);
      expect(validateQueryAst(result.ast)).toEqual([]);
    }
  });

  test("fails on missing get()", () => {
    const input = "db.collection('users').where('age', '>', 18)";
    const result = parseQueryChain(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const errors = validateQueryAst(result.ast);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  test("fails on invalid syntax", () => {
    const input = "collection('users').where('age' > 18)";
    const result = parseQueryChain(input);
    expect(result.ok).toBe(false);
  });
});
