import {
  compactFieldPaths,
  normalizeMainField,
  parseFieldPath,
  resolveProjectionField,
  resolveRowField,
} from "./field-path";
import type { OrderByClause, QueryAst } from "./types";

type Row = Record<string, unknown>;

export function getProjectionFields(ast: QueryAst): string[] | undefined {
  return ast.select?.map((reference) => {
    const field = normalizeMainField(reference, ast.collectionAlias);
    const overlapsJoinAlias = ast.joins?.some(({ alias }) => field.startsWith(`${alias}.`));
    return overlapsJoinAlias ? reference : field;
  });
}

export function getClientQueryProjection(ast: QueryAst): string[] | undefined {
  if (!ast.select || ast.joins?.length) return undefined;
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

export function getMainResultRow(row: Row): Row {
  const metadata = Object.getOwnPropertyDescriptor(row, "__mainRow");
  return metadata && !metadata.enumerable ? metadata.value as Row : row;
}

export function getJoinedResultRows(row: Row, alias: string): Row[] {
  const documents = row[alias];
  return Array.isArray(documents) ? documents : [];
}

export function getResultCellValue(row: Row, field: string, projection?: QueryAst): unknown {
  return projection && !projection.joins?.length ? resolveRowField(row, field) : row[field];
}

export function projectResultRows(rows: Row[], ast: QueryAst): Row[] {
  const fields = getProjectionFields(ast);
  if (!fields || !ast.select) return rows;
  const joinFields = ast.joins?.length ? ast.select.map((reference, index) => ({
    ...resolveProjectionField(reference, ast.collectionAlias, ast.joins),
    column: fields[index],
  })) : undefined;
  const paths = joinFields ? [] : compactFieldPaths(fields);
  return rows.map((row) => {
    const main = getMainResultRow(row);
    const projected = joinFields
      ? Object.fromEntries(joinFields.flatMap(({ field, joinAlias, column }) => {
        if (joinAlias) {
          const values = getJoinedResultRows(row, joinAlias)
            .map((document) => resolveRowField(document, field));
          return [[column, values]];
        }
        const syntheticId = main.__idSynthetic === true && (field === "id" || field === "`id`");
        const value = syntheticId ? undefined : resolveRowField(main, field);
        return value === undefined ? [] : [[column, value]];
      }))
      : projectRow(main, paths);
    if (typeof main.__docId === "string") {
      Object.defineProperty(projected, "__docId", { value: main.__docId });
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
    const leftMain = getMainResultRow(left);
    const rightMain = getMainResultRow(right);
    for (const { field, direction } of orderFields) {
      const diff = compareValues(resolveSortField(leftMain, field), resolveSortField(rightMain, field));
      if (diff !== 0) return diff * direction;
    }
    return 0;
  });
}
