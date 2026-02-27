import { describe, expect, test } from "bun:test";
import { replaceCollectionPathInQuery } from "./collection";

describe("replaceCollectionPathInQuery", () => {
  test("replaces collection path in single-quoted query", () => {
    const input =
      "db.collection('users').where('status', '==', 'active').orderBy('createdAt', 'desc').get()";
    const next = replaceCollectionPathInQuery(input, "orders");
    expect(next).toBe(
      "db.collection('orders').where('status', '==', 'active').orderBy('createdAt', 'desc').get()"
    );
  });

  test("replaces collection path in double-quoted query", () => {
    const input = "collection(\"users\").limit(10).get()";
    const next = replaceCollectionPathInQuery(input, "orders");
    expect(next).toBe("collection(\"orders\").limit(10).get()");
  });

  test("escapes matching quote in replacement path", () => {
    const input = "collection(\"users\").get()";
    const next = replaceCollectionPathInQuery(input, "team\"alpha");
    expect(next).toBe("collection(\"team\\\"alpha\").get()");
  });

  test("returns null when query does not include collection()", () => {
    const input = "db.where('age', '>', 18).get()";
    const next = replaceCollectionPathInQuery(input, "orders");
    expect(next).toBe(null);
  });
});
