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
