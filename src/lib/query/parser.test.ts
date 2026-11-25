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
      expect(result.ast.joins).toEqual([]);
      expect(result.ast.where.length).toBe(2);
      expect(result.ast.orderBy[0]?.dir).toBe("desc");
      expect(result.ast.limit).toBe(5);
      expect(result.ast.operation).toBe("get");
      expect(validateQueryAst(result.ast)).toEqual([]);
    }
  });

  test("parses collection aliases and left joins", () => {
    const result = parseQueryChain(
      "db.collection('workflow_edit_steps', 'wes').join('workflows', 'w', 'w.id', '==', 'wes.workflowId').where('wes.workflowId', '==', 'xxxx').limit(50).get()"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ast.collectionAlias).toBe("wes");
      expect(result.ast.joins).toEqual([
        {
          collectionPath: "workflows",
          alias: "w",
          leftField: "w.id",
          op: "==",
          rightField: "wes.workflowId"
        }
      ]);
      expect(validateQueryAst(result.ast)).toEqual([]);
    }
  });

  test("validates join aliases and main-table filters", () => {
    const parsed = parseQueryChain(
      "collection('steps', 's').join('workflows', 'w', 'w.slug', '==', 's.slug').join('owners', 'o', 'o.id', '==', 'w.ownerId').where('w.name', '==', 'blocked').get()"
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(validateQueryAst(parsed.ast)).toEqual([
        "where() and orderBy() can only reference the main collection."
      ]);
    }
  });

  test("fails on missing terminal operation", () => {
    const input = "db.collection('users').where('age', '>', 18)";
    const result = parseQueryChain(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const errors = validateQueryAst(result.ast);
      expect(errors).toEqual(["Query must end with .get() or .count()."]);
    }
  });

  test("fails on invalid syntax", () => {
    const input = "collection('users').where('age' > 18)";
    const result = parseQueryChain(input);
    expect(result.ok).toBe(false);
  });

  test("parses selected fields with nested paths, aliases, and quoting", () => {
    const parsed = parseQueryChain(
      'db.collection("users", "u").select("u.name", "profile.city", "u.`field.with.dot`",).get();'
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.ast.operation).toBe("get");
    expect(parsed.ast.select).toEqual(["u.name", "profile.city", "u.`field.with.dot`"]);
    expect(validateQueryAst(parsed.ast)).toEqual([]);
  });

  test("parses a count with explicit filters, ordering, and a limit", () => {
    const parsed = parseQueryChain(
      "collection('users').where('active', '==', true).orderBy('name').limit(10).count()"
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.ast.operation).toBe("count");
    expect(parsed.ast.where).toEqual([{ field: "active", op: "==", value: true }]);
    expect(parsed.ast.orderBy).toEqual([{ field: "name", dir: "asc" }]);
    expect(parsed.ast.limit).toBe(10);
    expect(validateQueryAst(parsed.ast)).toEqual([]);
  });

  for (const [chain, error] of [
    [".select().get()", "select() requires at least one field."],
    [".select(10).get()", "Expected string"],
    [".select('name').select('age').get()", "Only one select() is allowed."],
    [".count('name')", "Expected punct ')'"],
    [".count().get()", ".count() must be the last method."],
    [".get().count()", ".get() must be the last method."],
    [".count().limit(5)", ".count() must be the last method."],
    [".get(); .count()", "Expected eof"],
  ]) {
    test(`rejects invalid query syntax ${chain}`, () => {
      const parsed = parseQueryChain(`collection('users')${chain}`);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toBe(error);
    });
  }

  for (const [chain, error] of [
    [".select('profile..city').get()", "Invalid select() field path: profile..city."],
    [".select('name', 'u.`name`').get()", "Duplicate select() field: u.`name`."],
    [".select('name').count()", "select() cannot be combined with count()."],
    [".join('teams', 't', 't.id', '==', 'u.teamId').count()", "count() cannot be combined with join()."],
    [".join('teams', 't', 't.id', '==', 'u.teamId').select('name').get()", "select() cannot be combined with join()."],
  ]) {
    test(`validates unsupported query ${chain}`, () => {
      const parsed = parseQueryChain(`collection('users', 'u')${chain}`);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(validateQueryAst(parsed.ast)).toEqual([error]);
    });
  }
});
