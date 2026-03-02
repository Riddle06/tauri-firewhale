import { describe, expect, test } from "bun:test";
import { applyTimestampDisplayValue } from "./timestamp-display";

describe("applyTimestampDisplayValue", () => {
  test("converts nested UTC timestamps to selected local timezone format", () => {
    const input = {
      createdAt: "2026-02-28T06:08:34Z",
      nested: {
        updatedAt: "2026-02-28T06:11:39.034Z"
      },
      list: ["2026-02-28T06:08:34Z", "draft"]
    };
    const output = applyTimestampDisplayValue(input, {
      useLocalTimezone: true,
      timezone: "UTC+8"
    }) as Record<string, unknown>;

    expect(output).toEqual({
      createdAt: "2026-02-28T14:08:34+08:00",
      nested: {
        updatedAt: "2026-02-28T14:11:39.034+08:00"
      },
      list: ["2026-02-28T14:08:34+08:00", "draft"]
    });
  });

  test("converts offset timestamps back to UTC when local display is disabled", () => {
    const output = applyTimestampDisplayValue("2026-02-28T14:08:34+08:00", {
      useLocalTimezone: false,
      timezone: "UTC+8"
    });
    expect(output).toBe("2026-02-28T06:08:34Z");
  });
});
