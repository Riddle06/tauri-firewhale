export function orderTableColumns(
  columns: string[],
  selectedColumns: string[] | undefined
): string[] {
  const availableColumns = new Set(columns);
  const orderedColumns: string[] = [];

  for (const column of selectedColumns ?? []) {
    if (availableColumns.has(column) && !orderedColumns.includes(column)) {
      orderedColumns.push(column);
    }
  }

  for (const column of columns) {
    if (!orderedColumns.includes(column)) orderedColumns.push(column);
  }

  return orderedColumns;
}

export function moveTableColumn(
  columns: string[],
  column: string,
  target: string,
  placeAfter: boolean
): string[] {
  if (column === target) return columns;

  const nextColumns = columns.filter((item) => item !== column);
  const targetIndex = nextColumns.indexOf(target);
  if (targetIndex < 0) return columns;

  nextColumns.splice(targetIndex + (placeAfter ? 1 : 0), 0, column);
  return nextColumns;
}
