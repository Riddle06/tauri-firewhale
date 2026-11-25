import { formatJson } from "$lib/utils/json-highlight";

export type DocumentJsonParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function formatDocumentJson(value: Record<string, unknown>): string {
  return formatJson(value);
}

export function parseDocumentJson(input: string): DocumentJsonParseResult {
  if (!input.trim()) {
    return { ok: false, error: "JSON cannot be empty." };
  }
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "JSON must be an object." };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON."
    };
  }
}

export function isDocumentJsonDirty(original: string, current: string): boolean {
  return original !== current;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasField(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function equalJsonValues(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) =>
      equalJsonValues(value, right[index])
    );
  }
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    hasField(right, key) && equalJsonValues(left[key], right[key])
  );
}

function formatFieldPathSegment(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return key;
  return `\`${key.replace(/[`\\]/g, "\\$&")}\``;
}

export function getChangedDocumentFieldPaths(
  original: Record<string, unknown>,
  edited: Record<string, unknown>
): string[] {
  const paths: string[] = [];

  function collectChanges(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    prefix = ""
  ): void {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const segment = formatFieldPathSegment(key);
      const path = prefix ? `${prefix}.${segment}` : segment;
      if (!hasField(before, key) || !hasField(after, key)) {
        paths.push(path);
        continue;
      }
      const previousValue = before[key];
      const nextValue = after[key];
      if (isJsonObject(previousValue) && isJsonObject(nextValue)) {
        collectChanges(previousValue, nextValue, path);
      } else if (!equalJsonValues(previousValue, nextValue)) {
        paths.push(path);
      }
    }
  }

  collectChanges(original, edited);
  return paths;
}
