const FIELD_SEGMENT = /(?:([A-Za-z_][A-Za-z0-9_]*)|`((?:[^`\\]|\\[`\\])+)`)/y;

export function formatFieldPathSegment(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return key;
  return `\`${key.replace(/[`\\]/g, "\\$&")}\``;
}

export function parseFieldPath(path: string): string[] | null {
  const segments: string[] = [];
  let offset = 0;
  while (offset < path.length) {
    FIELD_SEGMENT.lastIndex = offset;
    const match = FIELD_SEGMENT.exec(path);
    if (!match) return null;
    segments.push(match[1] ?? match[2].replace(/\\([`\\])/g, "$1"));
    offset = FIELD_SEGMENT.lastIndex;
    if (offset === path.length) return segments;
    if (path[offset] !== ".") return null;
    offset += 1;
  }
  return null;
}

export function normalizeMainField(field: string, collectionAlias?: string): string {
  const prefix = collectionAlias ? `${collectionAlias}.` : "";
  return prefix && field.startsWith(prefix) ? field.slice(prefix.length) : field;
}

export function resolveProjectionField(
  reference: string,
  collectionAlias?: string,
  joins: { alias: string }[] = [],
): { field: string; joinAlias?: string } {
  const field = normalizeMainField(reference, collectionAlias);
  if (field !== reference) return { field };
  const join = joins.find(({ alias }) => reference.startsWith(`${alias}.`));
  return join ? { field: reference.slice(join.alias.length + 1), joinAlias: join.alias } : { field };
}

export function resolveRowField(row: Record<string, unknown>, field: string): unknown {
  const segments = parseFieldPath(field);
  if (segments?.length === 1 && segments[0] === "__name__") return row.__docId;
  return segments?.reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, segment)) {
      return undefined;
    }
    return (value as Record<string, unknown>)[segment];
  }, row);
}

export function compactFieldPaths(fields: string[]): string[] {
  const paths = fields.map((field) => {
    const segments = parseFieldPath(field);
    return {
      field: segments?.length === 1 && segments[0] === "__name__" ? "__name__" : field,
      segments,
      key: segments ? JSON.stringify(segments) : field
    };
  });
  const byKey = new Map(paths.map((path) => [path.key, path]));
  return [...byKey.values()].filter(({ segments }) => {
    if (!segments) return true;
    for (let length = 1; length < segments.length; length += 1) {
      if (byKey.has(JSON.stringify(segments.slice(0, length)))) return false;
    }
    return true;
  }).map(({ field }) => field);
}
