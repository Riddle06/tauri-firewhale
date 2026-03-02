import { describe, expect, test } from "bun:test";
import { formatTimestampForDisplay, normalizeTimestampToUtcIso } from "./timestamp";

describe("normalizeTimestampToUtcIso", () => {
  test("normalizes offset datetime to UTC ISO", () => {
    const normalized = normalizeTimestampToUtcIso("2026-02-28T14:11:39.034+08:00");
    expect(normalized).toBe("2026-02-28T06:11:39.034Z");
  });

  test("keeps UTC ISO values in UTC", () => {
    const normalized = normalizeTimestampToUtcIso("2026-02-28T06:11:39Z");
    expect(normalized).toBe("2026-02-28T06:11:39Z");
  });

  test("returns null for non-timestamp strings", () => {
    const normalized = normalizeTimestampToUtcIso("2026/02/28 06:11:39");
    expect(normalized).toBe(null);
  });
});

describe("formatTimestampForDisplay", () => {
  test("formats to local timezone offset when enabled", () => {
    const formatted = formatTimestampForDisplay("2026-02-28T06:08:34Z", {
      useLocalTimezone: true,
      timezone: "UTC+8"
    });
    expect(formatted).toBe("2026-02-28T14:08:34+08:00");
  });

  test("formats to UTC ISO when local display is disabled", () => {
    const formatted = formatTimestampForDisplay("2026-02-28T14:08:34+08:00", {
      useLocalTimezone: false,
      timezone: "UTC+8"
    });
    expect(formatted).toBe("2026-02-28T06:08:34Z");
  });
});
