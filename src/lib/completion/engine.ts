import { normalizeCollectionPath } from "$lib/utils/state";
import type {
  CompletionOptionData,
  CompletionRequest,
  CompletionResultData,
  FieldStatsMap
} from "./types";

const baseCompletions: CompletionOptionData[] = [
  { label: "db", type: "variable" },
  { label: "collection", type: "function" },
  { label: "where", type: "function" },
  { label: "orderBy", type: "function" },
  { label: "limit", type: "function" },
  { label: "get", type: "function" },
  { label: "asc", type: "constant" },
  { label: "desc", type: "constant" },
  {
    label: "collection chain",
    detail: "collection()",
    snippet: "db.collection('${collection}')"
  },
  {
    label: "where",
    detail: "where()",
    snippet: ".where('${field}', '==', ${value})"
  },
  {
    label: "orderBy",
    detail: "orderBy()",
    snippet: ".orderBy('${field}', 'asc')"
  },
  {
    label: "limit",
    detail: "limit()",
    snippet: ".limit(50)"
  },
  {
    label: "get",
    detail: "get()",
    snippet: ".get()"
  }
];

const dbMemberCompletions: CompletionOptionData[] = [
  {
    label: "collection",
    detail: "collection()",
    snippet: "collection('${collection}')"
  }
];

const chainMemberCompletions: CompletionOptionData[] = [
  {
    label: "where",
    detail: "where()",
    snippet: "where('${field}', '==', ${value})"
  },
  {
    label: "orderBy",
    detail: "orderBy()",
    snippet: "orderBy('${field}', 'asc')"
  },
  {
    label: "limit",
    detail: "limit()",
    snippet: "limit(50)"
  },
  {
    label: "get",
    detail: "get()",
    snippet: "get()"
  }
];

function resolveCollectionFromText(text: string, fallback: string): string {
  const match = /\bcollection\s*\(\s*['"]([^'"]+)['"]/.exec(text);
  if (match?.[1]) return normalizeCollectionPath(match[1]);
  return normalizeCollectionPath(fallback);
}

function isInsideString(text: string): boolean {
  let inString: "'" | "\"" | null = null;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      inString = char;
    }
  }

  return inString !== null;
}

function buildCollectionOptions(collections: string[]): CompletionOptionData[] {
  const unique = Array.from(new Set(collections));
  return unique.map((entry) => ({
    label: entry,
    type: "property"
  }));
}

function buildFieldOptions(
  fieldStats: FieldStatsMap,
  activeCollection: string
): CompletionOptionData[] {
  if (!activeCollection) return [];
  const stats = fieldStats[activeCollection] ?? {};
  const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
  return entries.map(([field]) => ({
    label: field,
    type: "property"
  }));
}

function dotCompletion(
  before: string,
  pos: number
): CompletionResultData | null {
  const match = /\.(\w*)$/.exec(before);
  if (!match) return null;
  const beforeDot = before.slice(0, match.index);
  if (isInsideString(beforeDot)) return null;

  if (/\bdb\s*$/.test(beforeDot)) {
    return {
      from: pos - match[1].length,
      options: dbMemberCompletions,
      validFor: "\\w*"
    };
  }

  if (/\bcollection\s*\(/.test(beforeDot)) {
    return {
      from: pos - match[1].length,
      options: chainMemberCompletions,
      validFor: "\\w*"
    };
  }

  return null;
}

function collectionCompletion(
  before: string,
  pos: number,
  collections: string[]
): CompletionResultData | null {
  const match = /\bcollection\s*\(\s*['"]([^'"]*)$/.exec(before);
  if (!match) return null;
  return {
    from: pos - match[1].length,
    options: buildCollectionOptions(collections),
    validFor: "[\\w/.-]*"
  };
}

function fieldCompletion(
  before: string,
  pos: number,
  fieldStats: FieldStatsMap,
  collectionPath: string
): CompletionResultData | null {
  const match = /\b(where|orderBy)\s*\(\s*['"]([^'"]*)$/.exec(before);
  if (!match) return null;
  const activeCollection = resolveCollectionFromText(before, collectionPath);
  const options = buildFieldOptions(fieldStats, activeCollection);
  if (options.length === 0) return null;
  return {
    from: pos - match[2].length,
    options,
    validFor: "[\\w.]*"
  };
}

function keywordCompletion(
  before: string,
  pos: number,
  explicit: boolean
): CompletionResultData | null {
  const match = /[\w.]+$/.exec(before);
  if (!match && !explicit) return null;
  const length = match ? match[0].length : 0;
  return {
    from: pos - length,
    options: baseCompletions,
    validFor: "[\\w.]*"
  };
}

export function getCompletionResult(
  request: CompletionRequest
): CompletionResultData | null {
  const before = request.doc.slice(0, request.pos);
  const explicit = request.explicit ?? false;

  return (
    dotCompletion(before, request.pos) ??
    collectionCompletion(before, request.pos, request.collections) ??
    fieldCompletion(before, request.pos, request.fieldStats, request.collectionPath) ??
    keywordCompletion(before, request.pos, explicit)
  );
}
