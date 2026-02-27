const COLLECTION_CALL_PATTERN = /\bcollection\s*\(\s*(["'])(?:\\.|(?!\1).)*\1\s*\)/;

function escapeCollectionPath(path: string, quote: "\"" | "'"): string {
  const escapedBackslashes = path.replace(/\\/g, "\\\\");
  if (quote === "\"") {
    return escapedBackslashes.replace(/"/g, "\\\"");
  }
  return escapedBackslashes.replace(/'/g, "\\'");
}

export function replaceCollectionPathInQuery(
  queryText: string,
  collectionPath: string
): string | null {
  let replaced = false;
  const next = queryText.replace(COLLECTION_CALL_PATTERN, (_match, quoteValue: string) => {
    replaced = true;
    const quote = quoteValue === "\"" ? "\"" : "'";
    const escapedPath = escapeCollectionPath(collectionPath, quote);
    return `collection(${quote}${escapedPath}${quote})`;
  });
  return replaced ? next : null;
}
