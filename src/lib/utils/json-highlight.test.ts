import { describe, expect, test } from "bun:test";
import { formatJson, tokenizeJson } from "./json-highlight";

describe("tokenizeJson", () => {
  test("returns empty tokens for null input", () => {
    expect(tokenizeJson(null)).toEqual([]);
  });

  test("preserves JSON output and token classes", () => {
    const input = {
      id: "abc",
      count: 3,
      active: true,
      nested: { value: null },
      list: [1, "two"]
    };

    const formatted = formatJson(input);
    const tokens = tokenizeJson(input);
    const reconstructed = tokens.map((token) => token.value).join("");

    expect(formatted).toBe(JSON.stringify(input, null, 2));
    expect(reconstructed).toBe(formatted);
    expect(
      tokens.some(
        (token) =>
          token.className === "json-key" && token.value.includes("\"id\"")
      )
    ).toBe(true);
    expect(
      tokens.some(
        (token) => token.className === "json-string" && token.value === "\"abc\""
      )
    ).toBe(true);
    expect(
      tokens.some(
        (token) => token.className === "json-number" && token.value === "3"
      )
    ).toBe(true);
    expect(
      tokens.some(
        (token) => token.className === "json-boolean" && token.value === "true"
      )
    ).toBe(true);
    expect(
      tokens.some(
        (token) => token.className === "json-null" && token.value === "null"
      )
    ).toBe(true);
  });
});
