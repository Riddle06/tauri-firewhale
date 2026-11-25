import { describe, expect, test } from "bun:test";
import {
  formatDocumentJson,
  getChangedDocumentFieldPaths,
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

describe("getChangedDocumentFieldPaths", () => {
  test("masks only changed nested fields and preserves unchanged siblings", () => {
    const before = {
      id: "stored-id",
      profile: { city: "Taipei", email: "person@example.com" },
      createdAt: "2026-11-25T09:00:00+08:00"
    };
    const after = { ...before, profile: { ...before.profile, city: "New Taipei" } };

    expect(getChangedDocumentFieldPaths(before, after)).toEqual(["profile.city"]);
  });

  test("includes deleted fields and quotes field names with special characters", () => {
    const before = { profile: { "e.mail": "a@b.test", "key`with\\escapes": true } };
    const after = { profile: { "key`with\\escapes": false } };

    expect(getChangedDocumentFieldPaths(before, after)).toEqual([
      "profile.`e.mail`",
      "profile.`key\\`with\\\\escapes`"
    ]);
  });

  test("ignores key order and uses the whole array path for an array edit", () => {
    const before = { access: [{ read: true, write: false }], enabled: true };
    const reordered = { enabled: true, access: [{ write: false, read: true }] };
    const edited = { ...reordered, access: [{ read: true, write: true }] };

    expect(getChangedDocumentFieldPaths(before, reordered)).toEqual([]);
    expect(getChangedDocumentFieldPaths(before, edited)).toEqual(["access"]);
  });
});
