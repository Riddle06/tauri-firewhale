export type JsonToken = {
  value: string;
  className: "json-key" | "json-string" | "json-number" | "json-boolean" | "json-null" | null;
};

const tokenRegex =
  /("(?:\\.|[^"\\])*"(?:\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function formatJson(row: Record<string, unknown> | null): string {
  if (!row) return "";
  return JSON.stringify(row, null, 2);
}

export function tokenizeJson(row: Record<string, unknown> | null): JsonToken[] {
  const json = formatJson(row);
  if (!json) return [];
  const tokens: JsonToken[] = [];
  let lastIndex = 0;

  for (const match of json.matchAll(tokenRegex)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ value: json.slice(lastIndex, index), className: null });
    }
    const value = match[0];
    let className: JsonToken["className"] = "json-number";
    if (value.startsWith("\"")) {
      className = value.endsWith(":") ? "json-key" : "json-string";
    } else if (value === "true" || value === "false") {
      className = "json-boolean";
    } else if (value === "null") {
      className = "json-null";
    }
    tokens.push({ value, className });
    lastIndex = index + value.length;
  }

  if (lastIndex < json.length) {
    tokens.push({ value: json.slice(lastIndex), className: null });
  }

  return tokens;
}
