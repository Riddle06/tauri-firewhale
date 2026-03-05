import { describe, expect, test } from "bun:test";
import {
  UPDATE_PROMPT_LAST_DATE_KEY,
  UPDATE_PROMPT_SKIPPED_VERSION_KEY,
  getLocalDateKey,
  markUpdatePromptShown,
  readUpdatePromptState,
  shouldShowUpdatePrompt,
  skipUpdateVersion
} from "./prompt-state";

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

describe("getLocalDateKey", () => {
  test("formats year-month-day using local date parts", () => {
    expect(getLocalDateKey(new Date(2026, 2, 5))).toBe("2026-03-05");
  });
});

describe("readUpdatePromptState", () => {
  test("reads stored values", () => {
    const storage = new MemoryStorage();
    storage.setItem(UPDATE_PROMPT_LAST_DATE_KEY, "2026-03-05");
    storage.setItem(UPDATE_PROMPT_SKIPPED_VERSION_KEY, "1.2.3");

    expect(readUpdatePromptState(storage)).toEqual({
      lastPromptDate: "2026-03-05",
      skippedVersion: "1.2.3"
    });
  });

  test("normalizes missing or blank values to null", () => {
    const storage = new MemoryStorage();
    storage.setItem(UPDATE_PROMPT_LAST_DATE_KEY, "   ");

    expect(readUpdatePromptState(storage)).toEqual({
      lastPromptDate: null,
      skippedVersion: null
    });
  });
});

describe("shouldShowUpdatePrompt", () => {
  test("returns false when latest version is skipped", () => {
    expect(
      shouldShowUpdatePrompt(
        {
          lastPromptDate: null,
          skippedVersion: "1.2.3"
        },
        "1.2.3",
        "2026-03-05"
      )
    ).toBe(false);
  });

  test("returns false when user already prompted today", () => {
    expect(
      shouldShowUpdatePrompt(
        {
          lastPromptDate: "2026-03-05",
          skippedVersion: null
        },
        "1.2.4",
        "2026-03-05"
      )
    ).toBe(false);
  });

  test("returns true when version is not skipped and last prompt date differs", () => {
    expect(
      shouldShowUpdatePrompt(
        {
          lastPromptDate: "2026-03-04",
          skippedVersion: "1.2.3"
        },
        "1.2.4",
        "2026-03-05"
      )
    ).toBe(true);
  });
});

describe("storage mutators", () => {
  test("writes today's prompt date", () => {
    const storage = new MemoryStorage();
    markUpdatePromptShown(storage, "2026-03-05");
    expect(storage.getItem(UPDATE_PROMPT_LAST_DATE_KEY)).toBe("2026-03-05");
  });

  test("writes skipped version", () => {
    const storage = new MemoryStorage();
    skipUpdateVersion(storage, "1.2.4");
    expect(storage.getItem(UPDATE_PROMPT_SKIPPED_VERSION_KEY)).toBe("1.2.4");
  });
});
