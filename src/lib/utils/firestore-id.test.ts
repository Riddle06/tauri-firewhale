import { describe, expect, test } from "bun:test";
import { generateFirestoreDocumentId } from "./firestore-id";

describe("generateFirestoreDocumentId", () => {
  test("returns a 20-character ID", () => {
    const id = generateFirestoreDocumentId();
    expect(id.length).toBe(20);
  });

  test("uses only Firebase-style auto ID characters", () => {
    const id = generateFirestoreDocumentId();
    expect(/^[A-Za-z0-9]{20}$/.test(id)).toBe(true);
  });

  test("generates non-identical values across multiple calls", () => {
    const ids = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      ids.add(generateFirestoreDocumentId());
    }
    expect(ids.size).toBeGreaterThan(1);
  });
});
