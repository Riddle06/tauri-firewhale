import { compactFieldPaths, normalizeMainField, parseFieldPath, resolveRowField } from "./field-path";
import type { OrderByClause, QueryAst } from "./types";

type Row = Record<string, unknown>;

export function getProjectionFields(ast: QueryAst): string[] | undefined {
  return ast.select?.map((field) => normalizeMainField(field, ast.collectionAlias));
}

export function getClientQueryProjection(ast: QueryAst): string[] | undefined {
  if (!ast.select) return undefined;
  return [...ast.select, ...ast.orderBy.map((order) => order.field)];
}

export function projectRow(row: Row, fields: string[]): Row {
  const projected: Row = {};
  for (const field of fields) {
    const segments = parseFieldPath(field);
    if (!segments) continue;
    const value = resolveRowField(row, field);
    if (value === undefined) continue;
    let target = projected;
    for (const segment of segments.slice(0, -1)) {
      if (!Object.hasOwn(target, segment)) {
        Object.defineProperty(target, segment, {
          value: {}, enumerable: true, writable: true, configurable: true
        });
      }
      target = target[segment] as Row;
    }
    Object.defineProperty(target, segments[segments.length - 1], {
      value, enumerable: true, writable: true, configurable: true
    });
  }
  return projected;
}

export function projectResultRows(rows: Row[], ast: QueryAst): Row[] {
  const fields = getProjectionFields(ast);
  if (!fields) return rows;
  const paths = compactFieldPaths(fields);
  return rows.map((row) => {
    const projected = projectRow(row, paths);
    if (typeof row.__docId === "string") {
      Object.defineProperty(projected, "__docId", { value: row.__docId });
    }
    return projected;
  });
}

function compareValues(left: unknown, right: unknown): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

function resolveSortField(row: Row, field: string): unknown {
  const value = resolveRowField(row, field);
  return field === "id" && value === undefined ? row.__docId : value;
}

export function sortResultRows(rows: Row[], orderBy: OrderByClause[], collectionAlias?: string): Row[] {
  if (orderBy.length === 0) return rows;
  const orderFields = orderBy.map(({ field, dir }) => ({
    field: normalizeMainField(field, collectionAlias),
    direction: dir === "desc" ? -1 : 1,
  }));
  return [...rows].sort((left, right) => {
    for (const { field, direction } of orderFields) {
      const diff = compareValues(resolveSortField(left, field), resolveSortField(right, field));
      if (diff !== 0) return diff * direction;
    }
    return 0;
  });
}
