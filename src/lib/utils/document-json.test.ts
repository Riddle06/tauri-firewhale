import { describe, expect, test } from "bun:test";
import {
  formatDocumentJson,
  isDocumentJsonDirty,
  parseDocumentJson
} from "./document-json";

describe("formatDocumentJson", () => {
  test("formats JSON with stable indentation", () => {
    const input = { name: "Firewhale", count: 2, nested: { ok: true } };
    expect(formatDocumentJson(input)).toBe(JSON.stringify(input, null, 2));
  });
});

describe("parseDocumentJson", () => {
  test("rejects empty JSON strings", () => {
    const result = parseDocumentJson("  ");
    expect(result.ok).toBe(false);
  });

  test("rejects invalid JSON input", () => {
    const result = parseDocumentJson("{ nope ");
    expect(result.ok).toBe(false);
  });

  test("rejects non-object JSON values", () => {
    const result = parseDocumentJson("[1, 2, 3]");
    expect(result.ok).toBe(false);
  });

  test("accepts object JSON values", () => {
    const result = parseDocumentJson("{\"ok\": true}");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ ok: true });
    }
  });
});

describe("isDocumentJsonDirty", () => {
  test("returns false when text is unchanged", () => {
    expect(isDocumentJsonDirty("{\"ok\": true}", "{\"ok\": true}")).toBe(false);
  });

  test("returns true when text is changed", () => {
    expect(isDocumentJsonDirty("{\"ok\": true}", "{\"ok\": false}")).toBe(true);
  });
});
