import { derived, get, writable } from "svelte/store";
import type { TabState, WorkspaceState } from "$lib/models";
import { loadWorkspace, saveWorkspace } from "$lib/storage/storage";
import {
  createTabState,
  createWorkspaceState,
  deriveTabTitle,
  normalizeCollectionPath
} from "$lib/utils/state";

const workspace = writable<WorkspaceState | null>(null);
const activeTab = derived(workspace, ($workspace) => {
  if (!$workspace) return null;
  return $workspace.tabs.find((tab) => tab.id === $workspace.activeTabId) ?? null;
});
const tabs = derived(workspace, ($workspace) => $workspace?.tabs ?? []);
const collections = derived(workspace, ($workspace) => $workspace?.collections ?? []);
const fieldStats = derived(
  workspace,
  ($workspace) => $workspace?.fieldStats ?? {}
);

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWorkspace: WorkspaceState | null = null;

function normalizeCollectionList(list: string[] | undefined): string[] {
  const next: string[] = [];
  for (const entry of list ?? []) {
    const normalized = normalizeCollectionPath(entry);
    if (!normalized) continue;
    if (!next.includes(normalized)) next.push(normalized);
  }
  return next;
}

function mergeCollections(base: string[], extra: string[]): string[] {
  const next = [...base];
  for (const entry of extra) {
    if (!next.includes(entry)) next.push(entry);
  }
  return next;
}

function buildCollections(current: WorkspaceState): string[] {
  const base = normalizeCollectionList(current.collections);
  const fromTabs = normalizeCollectionList(current.tabs.map((tab) => tab.collectionPath));
  return mergeCollections(base, fromTabs);
}

function collectionsEqual(left: string[] | undefined, right: string[]): boolean {
  const normalizedLeft = normalizeCollectionList(left);
  if (normalizedLeft.length !== right.length) return false;
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    if (normalizedLeft[index] !== right[index]) return false;
  }
  return true;
}

function appendCollection(list: string[] | undefined, path: string): string[] {
  const normalized = normalizeCollectionPath(path);
  const next = normalizeCollectionList(list);
  if (!normalized) return next;
  if (!next.includes(normalized)) next.push(normalized);
  return next;
}

function schedulePersist(): void {
  pendingWorkspace = get(workspace);
  if (!pendingWorkspace) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const snapshot = pendingWorkspace;
    pendingWorkspace = null;
    persistTimer = null;
    if (snapshot) {
      void saveWorkspace(snapshot.connectionId, snapshot);
    }
  }, 500);
}

async function persistWorkspace(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  pendingWorkspace = null;
  const current = get(workspace);
  if (!current) return;
  await saveWorkspace(current.connectionId, current);
}

export async function loadWorkspaceForConnection(
  connectionId: string
): Promise<WorkspaceState> {
  await persistWorkspace();
  const stored = await loadWorkspace(connectionId);
  const nextWorkspace = stored ?? createWorkspaceState(connectionId);
  const nextCollections = buildCollections(nextWorkspace);
  const hydratedWorkspace = {
    ...nextWorkspace,
    collections: nextCollections,
    fieldStats: nextWorkspace.fieldStats ?? {}
  };
  workspace.set(hydratedWorkspace);
  if (!stored || !collectionsEqual(nextWorkspace.collections, nextCollections)) {
    await saveWorkspace(connectionId, hydratedWorkspace);
  }
  return hydratedWorkspace;
}

export function clearWorkspace(): void {
  workspace.set(null);
}

export function setActiveTab(tabId: string): void {
  workspace.update((current) => {
    if (!current) return current;
    return { ...current, activeTabId: tabId };
  });
  void persistWorkspace();
}

export function addTab(connectionId: string, collectionPath: string): TabState | null {
  const tabPath = normalizeCollectionPath(collectionPath);
  let created: TabState | null = null;
  workspace.update((current) => {
    if (!current || current.connectionId !== connectionId) return current;
    const nextTab = createTabState(connectionId, tabPath);
    created = nextTab;
    const nextCollections = appendCollection(current.collections, tabPath);
    return {
      ...current,
      collections: nextCollections,
      tabs: [...current.tabs, nextTab],
      activeTabId: nextTab.id
    };
  });
  schedulePersist();
  return created;
}

export function closeTab(tabId: string): void {
  workspace.update((current) => {
    if (!current) return current;
    const nextTabs = current.tabs.filter((tab) => tab.id !== tabId);
    let nextActive = current.activeTabId;
    if (current.activeTabId === tabId) {
      nextActive = nextTabs[0]?.id ?? null;
    }
    const finalTabs = nextTabs.length > 0 ? nextTabs : [createTabState(current.connectionId)];
    if (finalTabs.length === 1 && !nextActive) {
      nextActive = finalTabs[0].id;
    }
    return { ...current, tabs: finalTabs, activeTabId: nextActive };
  });
  schedulePersist();
}

export function updateQueryText(tabId: string, queryText: string): void {
  workspace.update((current) => {
    if (!current) return current;
    return {
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, queryText } : tab
      )
    };
  });
  schedulePersist();
}

export function updateClientPagination(tabId: string, enabled: boolean): void {
  workspace.update((current) => {
    if (!current) return current;
    return {
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, clientPagination: enabled } : tab
      )
    };
  });
  schedulePersist();
}

export function updateCollectionPath(tabId: string, path: string): void {
  const normalized = normalizeCollectionPath(path);
  workspace.update((current) => {
    if (!current) return current;
    const nextCollections = appendCollection(current.collections, normalized);
    return {
      ...current,
      collections: nextCollections,
      tabs: current.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              collectionPath: normalized,
              title: deriveTabTitle(normalized)
            }
          : tab
      )
    };
  });
  schedulePersist();
}

export function addCollection(path: string): boolean {
  const normalized = normalizeCollectionPath(path);
  if (!normalized) return false;
  let added = false;
  workspace.update((current) => {
    if (!current) return current;
    const nextCollections = appendCollection(current.collections, normalized);
    if (collectionsEqual(current.collections, nextCollections)) return current;
    added = true;
    return { ...current, collections: nextCollections };
  });
  if (added) schedulePersist();
  return added;
}

export function setCollections(
  list: string[],
  options: { merge?: boolean } = {}
): void {
  workspace.update((current) => {
    if (!current) return current;
    const normalized = normalizeCollectionList(list);
    const nextCollections = options.merge
      ? mergeCollections(normalizeCollectionList(current.collections), normalized)
      : normalized;
    if (collectionsEqual(current.collections, nextCollections)) return current;
    return { ...current, collections: nextCollections };
  });
  schedulePersist();
}

function mergeFieldStats(
  existing: Record<string, number>,
  rows: Record<string, unknown>[]
): Record<string, number> {
  const next = { ...existing };
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      next[key] = (next[key] ?? 0) + 1;
    }
  }
  return next;
}

export function recordFieldStats(
  collectionPath: string,
  rows: Record<string, unknown>[]
): void {
  const normalized = normalizeCollectionPath(collectionPath);
  if (!normalized || rows.length === 0) return;
  workspace.update((current) => {
    if (!current) return current;
    const stats = current.fieldStats ?? {};
    const currentStats = stats[normalized] ?? {};
    const nextStats = mergeFieldStats(currentStats, rows);
    return {
      ...current,
      fieldStats: {
        ...stats,
        [normalized]: nextStats
      }
    };
  });
  schedulePersist();
}

export { workspace, activeTab, tabs, collections, fieldStats };
