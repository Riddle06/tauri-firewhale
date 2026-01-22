import type { TabState, WorkspaceState } from "$lib/models";

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function normalizeCollectionPath(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}

export function deriveTabTitle(path: string): string {
  const normalized = normalizeCollectionPath(path.trim());
  if (!normalized) return "Untitled";
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "Untitled";
}

export function createTabState(connectionId: string, collectionPath = ""): TabState {
  const normalized = normalizeCollectionPath(collectionPath);
  return {
    id: createId(),
    title: deriveTabTitle(normalized),
    connectionId,
    collectionPath: normalized,
    queryText: "",
    clientPagination: false,
    view: {}
  };
}

export function createWorkspaceState(connectionId: string): WorkspaceState {
  const firstTab = createTabState(connectionId, "");
  return {
    id: createId(),
    connectionId,
    openConnectionIds: [connectionId],
    tabs: [firstTab],
    activeTabId: firstTab.id,
    collections: [],
    fieldStats: {}
  };
}
