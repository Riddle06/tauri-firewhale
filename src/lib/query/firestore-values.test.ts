import { describe, expect, test } from "bun:test";
import { encodeFirestoreFields } from "./firestore-values";

describe("encodeFirestoreFields", () => {
  test("coerces ISO UTC strings to timestampValue for document updates", () => {
    const fields = encodeFirestoreFields(
      {
        createdAt: "2025-04-15T01:40:49.216Z"
      },
      { coerceTimestampStrings: true }
    );
    expect(fields.createdAt).toEqual({ timestampValue: "2025-04-15T01:40:49.216Z" });
  });

  test("coerces nested ISO UTC strings recursively", () => {
    const fields = encodeFirestoreFields(
      {
        meta: {
          updatedAt: "2025-04-15T01:40:49.216Z"
        },
        history: ["2025-04-15T01:40:49.216Z", "draft"]
      },
      { coerceTimestampStrings: true }
    );
    expect(fields.meta).toEqual({
      mapValue: {
        fields: {
          updatedAt: { timestampValue: "2025-04-15T01:40:49.216Z" }
        }
      }
    });
    expect(fields.history).toEqual({
      arrayValue: {
        values: [{ timestampValue: "2025-04-15T01:40:49.216Z" }, { stringValue: "draft" }]
      }
    });
  });

  test("coerces ISO datetime with offset to UTC timestampValue", () => {
    const fields = encodeFirestoreFields(
      {
        updatedAt: "2026-02-28T14:11:39.034+08:00"
      },
      { coerceTimestampStrings: true }
    );
    expect(fields.updatedAt).toEqual({ timestampValue: "2026-02-28T06:11:39.034Z" });
  });

  test("keeps ISO UTC strings as stringValue when coercion is disabled", () => {
    const fields = encodeFirestoreFields({
      createdAt: "2025-04-15T01:40:49.216Z"
    });
    expect(fields.createdAt).toEqual({ stringValue: "2025-04-15T01:40:49.216Z" });
  });

  test("keeps non-ISO strings as stringValue even when coercion is enabled", () => {
    const fields = encodeFirestoreFields(
      {
        createdAt: "2025/04/15 01:40:49"
      },
      { coerceTimestampStrings: true }
    );
    expect(fields.createdAt).toEqual({ stringValue: "2025/04/15 01:40:49" });
  });
});
