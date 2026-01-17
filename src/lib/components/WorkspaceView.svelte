<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import {
    activeConnection,
    activeConnectionId,
    initConnections,
    selectConnection
  } from "$lib/stores/connections";
  import {
    activeTab,
    addTab,
    addCollection,
    closeTab,
    collections,
    loadWorkspaceForConnection,
    setCollections,
    setActiveTab,
    tabs,
    updateCollectionPath,
    updateQueryText
  } from "$lib/stores/workspace";
  import { normalizeCollectionPath } from "$lib/utils/state";
  import { parseQueryChain, validateQueryAst } from "$lib/query/parser";
  import { fetchCollectionsForConnection, runFirestoreQuery } from "$lib/query/firestore";
  import type { ConnectionProfile } from "$lib/models";

  const { connectionId = null } = $props<{ connectionId?: string | null }>();

  const bottomTabs = [
    { id: "result", label: "Result" },
    { id: "console", label: "Query Console" }
  ] as const;

  const DEFAULT_QUERY_LIMIT = 50;

  let bottomTab = $state<(typeof bottomTabs)[number]["id"]>("result");
  let workspaceLoading = $state(false);
  let collectionsLoading = $state(false);
  let collectionsError = $state("");
  let lastCollectionsConnectionId = $state<string | null>(null);
  let createCollectionOpen = $state(false);
  let newCollectionPath = $state("");
  let collectionError = $state("");
  let runStates = $state<Record<string, QueryRunState>>({});
  let runLogs = $state<Record<string, QueryLog[]>>({});
  let runSequence = $state(0);

  const tauriEnabled = isTauri();
  const currentWindow = tauriEnabled ? getCurrentWebviewWindow() : null;

  type QueryRunState = {
    status: "idle" | "running" | "success" | "error";
    rows: Record<string, unknown>[];
    error?: string;
    warnings?: string[];
    durationMs?: number;
    pageIndex: number;
    pageSize: number;
    hasNextPage: boolean;
  };

  type QueryLog = {
    id: number;
    level: "info" | "error";
    message: string;
    timestamp: number;
  };

  const emptyRunState: QueryRunState = {
    status: "idle",
    rows: [],
    pageIndex: 0,
    pageSize: 0,
    hasNextPage: false
  };

  const activeRunState = $derived.by<QueryRunState>(() => {
    if (!$activeTab) return emptyRunState;
    return runStates[$activeTab.id] ?? emptyRunState;
  });

  const activeRunLogs = $derived.by<QueryLog[]>(() => {
    if (!$activeTab) return [];
    return runLogs[$activeTab.id] ?? [];
  });

  const activeColumns = $derived.by(() => {
    if (!activeRunState || activeRunState.rows.length === 0) return [] as string[];
    const keys = Object.keys(activeRunState.rows[0]);
    if (!keys.includes("id")) return keys;
    return ["id", ...keys.filter((key) => key !== "id")];
  });

  onMount(() => {
    let currentConnection: string | null = null;

    const unsubscribe = activeConnectionId.subscribe(async (nextId) => {
      if (!nextId) {
        workspaceLoading = false;
        return;
      }
      if (currentConnection === nextId) return;
      currentConnection = nextId;
      runStates = {};
      runLogs = {};
      runSequence = 0;
      workspaceLoading = true;
      await loadWorkspaceForConnection(nextId);
      workspaceLoading = false;
    });

    const unsubscribeConnection = activeConnection.subscribe((connection) => {
      if (!connection) return;
      void refreshCollections(connection);
    });

    void initConnections().then(async () => {
      if (connectionId) {
        await selectConnection(connectionId);
      }
    });

    return () => {
      unsubscribe();
      unsubscribeConnection();
    };
  });

  $effect(() => {
    if (!$activeConnection?.name) return;
    const title = `${$activeConnection.name} - Firewhale`;
    document.title = title;
    if (currentWindow) {
      void currentWindow.setTitle(title);
    }
  });

  function createNewTab(): void {
    if (!$activeConnectionId) return;
    addTab($activeConnectionId, "");
    bottomTab = "result";
  }

  function buildDefaultQuery(path: string): string {
    const normalized = normalizeCollectionPath(path) || path;
    return `db.collection('${normalized}')\n  .orderBy('id', 'asc')\n  .limit(${DEFAULT_QUERY_LIMIT})\n  .get()`;
  }

  function handleQueryInput(event: Event): void {
    if (!$activeTab) return;
    const target = event.target as HTMLTextAreaElement;
    updateQueryText($activeTab.id, target.value);
  }

  async function runQuery(pageIndex = 0): Promise<void> {
    if (!$activeTab) return;
    if (!$activeConnection) {
      setRunError($activeTab.id, "No active connection.");
      return;
    }
    const tabId = $activeTab.id;
    const queryText = $activeTab.queryText.trim();

    runStates = {
      ...runStates,
      [tabId]: {
        status: "running",
        rows: [],
        pageIndex,
        pageSize: 0,
        hasNextPage: false
      }
    };
    bottomTab = "result";
    pushLog(tabId, "info", "Running query...");

    const parsed = parseQueryChain(queryText);
    if (!parsed.ok) {
      setRunError(tabId, parsed.error);
      return;
    }

    const validationErrors = validateQueryAst(parsed.ast);
    if (validationErrors.length > 0) {
      setRunError(tabId, validationErrors.join(" "));
      return;
    }

    if ($activeTab.collectionPath !== parsed.ast.collectionPath) {
      updateCollectionPath(tabId, parsed.ast.collectionPath);
    }

    let result;
    try {
      result = await runFirestoreQuery($activeConnection, parsed.ast, { pageIndex });
    } catch (error) {
      setRunError(
        tabId,
        error instanceof Error ? error.message : "Failed to run query."
      );
      return;
    }
    runStates = {
      ...runStates,
      [tabId]: {
        status: "success",
        rows: result.rows,
        warnings: result.warnings,
        durationMs: result.durationMs,
        pageIndex: result.pageIndex,
        pageSize: result.pageSize,
        hasNextPage: result.hasNextPage
      }
    };
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        pushLog(tabId, "info", warning);
      }
    }
    pushLog(tabId, "info", `Returned ${result.rows.length} row(s).`);
  }

  function selectCollection(path: string): void {
    if (!$activeTab) return;
    updateCollectionPath($activeTab.id, path);
    if (!$activeTab.queryText.trim()) {
      updateQueryText(
        $activeTab.id,
        buildDefaultQuery(path)
      );
    }
  }

  function openCollectionTab(path: string): void {
    if (!$activeConnectionId) return;
    const created = addTab($activeConnectionId, path);
    if (created) {
      updateQueryText(created.id, buildDefaultQuery(path));
    }
    bottomTab = "result";
  }

  function runPreviousPage(): void {
    if (activeRunState.status !== "success") return;
    if (activeRunState.pageIndex <= 0) return;
    void runQuery(activeRunState.pageIndex - 1);
  }

  function runNextPage(): void {
    if (activeRunState.status !== "success") return;
    if (!activeRunState.hasNextPage) return;
    void runQuery(activeRunState.pageIndex + 1);
  }

  async function refreshCollections(connection: ConnectionProfile): Promise<void> {
    if (collectionsLoading) return;
    if (lastCollectionsConnectionId === connection.id && !collectionsError) return;
    collectionsLoading = true;
    collectionsError = "";
    try {
      const list = await fetchCollectionsForConnection(connection);
      setCollections(list, { merge: true });
      lastCollectionsConnectionId = connection.id;
    } catch (error) {
      collectionsError =
        error instanceof Error ? error.message : "Failed to load collections.";
    } finally {
      collectionsLoading = false;
    }
  }

  function openCreateCollection(): void {
    createCollectionOpen = true;
    newCollectionPath = "";
    collectionError = "";
  }

  function cancelCreateCollection(): void {
    createCollectionOpen = false;
    newCollectionPath = "";
    collectionError = "";
  }

  function submitCollection(): void {
    const normalized = normalizeCollectionPath(newCollectionPath.trim());
    if (!normalized) {
      collectionError = "Collection path is required.";
      return;
    }
    const added = addCollection(normalized);
    if (!added) {
      collectionError = "Collection already exists.";
      return;
    }
    createCollectionOpen = false;
    newCollectionPath = "";
    collectionError = "";
    if ($activeTab) {
      selectCollection(normalized);
    }
  }

  function handleCollectionKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    submitCollection();
  }

  function setRunError(tabId: string, message: string): void {
    const previous = runStates[tabId];
    runStates = {
      ...runStates,
      [tabId]: {
        status: "error",
        rows: [],
        error: message,
        pageIndex: previous?.pageIndex ?? 0,
        pageSize: previous?.pageSize ?? 0,
        hasNextPage: previous?.hasNextPage ?? false
      }
    };
    pushLog(tabId, "error", message);
  }

  function pushLog(tabId: string, level: QueryLog["level"], message: string): void {
    runSequence += 1;
    const entry: QueryLog = {
      id: runSequence,
      level,
      message,
      timestamp: Date.now()
    };
    const existing = runLogs[tabId] ?? [];
    runLogs = {
      ...runLogs,
      [tabId]: [...existing, entry]
    };
  }

  function formatCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.map((entry) => String(entry)).join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString();
  }
</script>

{#if !$activeConnectionId}
  <div class="workspace-empty">
    <h2>No connection selected</h2>
    <p>Return to the launcher to open a workspace window.</p>
  </div>
{:else}
  <div class="workspace-shell">
    <aside class="collections-panel">
      <div class="collections-header">
        <div class="connection-pill">
          <span class="dot"></span>
          <span>{$activeConnection?.name}</span>
          <span class="badge">{$activeConnection?.ui.badgeText}</span>
        </div>
        <button class="ghost" onclick={createNewTab}>New tab</button>
      </div>

      <div class="collections-body">
        <div class="section-title">Collections</div>
        <div class="collection-scroll">
          {#if collectionsLoading}
            <div class="collections-empty">
              <p>Loading collections...</p>
            </div>
          {:else if collectionsError}
            <div class="collections-empty">
              <p>Failed to load collections.</p>
              <p class="muted">{collectionsError}</p>
            </div>
          {:else if $collections.length === 0}
            <div class="collections-empty">
              <p>No collections found.</p>
              <p class="muted">Create one or check your credentials.</p>
            </div>
          {:else}
            <div class="collection-table">
              <div class="collection-header">
                <span>#</span>
                <span>Collection</span>
              </div>
              <div class="collection-rows">
                {#each $collections as collection, index (collection)}
                  <button
                    class={`collection-row ${
                      $activeTab?.collectionPath === collection ? "active" : ""
                    }`}
                    onclick={() => selectCollection(collection)}
                    ondblclick={() => openCollectionTab(collection)}
                  >
                    <span class="collection-index">{index + 1}</span>
                    <span class="collection-name">{collection}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="collection-create">
          {#if createCollectionOpen}
            <div class="collection-form">
              <input
                class="collection-input"
                type="text"
                placeholder="e.g. users"
                bind:value={newCollectionPath}
                oninput={() => (collectionError = "")}
                onkeydown={handleCollectionKeydown}
              />
              {#if collectionError}
                <div class="collection-error">{collectionError}</div>
              {/if}
              <div class="collection-actions">
                <button class="ghost" onclick={cancelCreateCollection}>Cancel</button>
                <button class="primary" onclick={submitCollection}>Create</button>
              </div>
            </div>
          {:else}
            <button class="ghost" onclick={openCreateCollection}>
              Create collection
            </button>
          {/if}
        </div>
      </div>
    </aside>

    <section class="workspace-main">
      <header class="workspace-header">
        <div>
          <div class="workspace-title">Query workspace</div>
          <div class="workspace-subtitle">Connection scoped tabs</div>
        </div>
        <div class="workspace-actions">
          {#if workspaceLoading}
            <span class="status">Loading workspace...</span>
          {/if}
          <button
            class="primary run-button"
            type="button"
            onclick={() => runQuery()}
            disabled={!$activeTab || activeRunState.status === "running"}
          >
            {activeRunState.status === "running" ? "Running..." : "Run"}
          </button>
        </div>
      </header>

      <div class="tabs-bar">
        {#each $tabs as tab (tab.id)}
          <div class={`tab ${tab.id === $activeTab?.id ? "active" : ""}`}>
            <button class="tab-main" type="button" onclick={() => setActiveTab(tab.id)}>
              <span class="tab-title">{tab.title}</span>
              <span class="tab-path">{tab.collectionPath || "collection"}</span>
            </button>
            <button
              class="tab-close"
              type="button"
              onclick={() => closeTab(tab.id)}
              aria-label="Close tab"
            >
              x
            </button>
          </div>
        {/each}
        <button class="tab-add" onclick={createNewTab}>+</button>
      </div>

      <section class="query-panel">
        <div class="panel-header">
          <h3>Query</h3>
          <span class="status muted">
            {$activeTab?.collectionPath || "Select a collection"}
          </span>
        </div>
        <textarea
          class="editor"
          value={$activeTab?.queryText ?? ""}
          oninput={handleQueryInput}
          placeholder="db.collection('users')&#10;  .where('age', '>', 18)&#10;  .where('status', '==', 'active')&#10;  .orderBy('createdAt', 'desc')&#10;  .limit(50)&#10;  .get()"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          disabled={!$activeTab}
        ></textarea>
      </section>

      <section class="bottom-panel">
        <div class="bottom-tabs">
          {#each bottomTabs as tabOption (tabOption.id)}
            <button
              class={`bottom-tab ${bottomTab === tabOption.id ? "active" : ""}`}
              onclick={() => (bottomTab = tabOption.id)}
            >
              {tabOption.label}
            </button>
          {/each}
        </div>
        <div class="bottom-content">
          {#if bottomTab === "result"}
            {#if activeRunState.status === "running"}
              <div class="panel-card">Running query...</div>
            {:else if activeRunState.status === "error"}
              <div class="panel-card panel-error">
                <strong>Query failed.</strong>
                <div>{activeRunState.error}</div>
              </div>
            {:else if activeRunState.status === "success"}
              {#if activeRunState.rows.length === 0}
                <div class="panel-card">No results found.</div>
              {:else}
                <div class="result-summary">
                  {activeRunState.rows.length} row(s)
                  {#if activeRunState.durationMs !== undefined}
                    <span>· {activeRunState.durationMs} ms</span>
                  {/if}
                </div>
                <div class="result-table-wrap">
                  <table class="result-table">
                    <thead>
                      <tr>
                        {#each activeColumns as column (column)}
                          <th>{column}</th>
                        {/each}
                      </tr>
                    </thead>
                    <tbody>
                      {#each activeRunState.rows as row, rowIndex (row.id ?? rowIndex)}
                        <tr>
                          {#each activeColumns as column (column)}
                            <td>{formatCell(row[column])}</td>
                          {/each}
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
                <div class="result-pagination">
                  <button
                    class="ghost"
                    type="button"
                    onclick={runPreviousPage}
                    disabled={activeRunState.pageIndex <= 0 || activeRunState.status !== "success"}
                  >
                    Previous
                  </button>
                  <div class="page-indicator">
                    Page {activeRunState.pageIndex + 1}
                  </div>
                  <button
                    class="ghost"
                    type="button"
                    onclick={runNextPage}
                    disabled={!activeRunState.hasNextPage || activeRunState.status !== "success"}
                  >
                    Next
                  </button>
                </div>
              {/if}
            {:else}
              <div class="panel-card">Run a query to see results.</div>
            {/if}
          {:else}
            {#if activeRunLogs.length === 0}
              <div class="panel-card">Console logs will appear here.</div>
            {:else}
              <div class="console-list">
                {#each activeRunLogs as log (log.id)}
                  <div class={`console-line ${log.level}`}>
                    <span class="console-time">{formatTimestamp(log.timestamp)}</span>
                    <span>{log.message}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      </section>
    </section>
  </div>
{/if}

<style>
  .workspace-shell {
    display: grid;
    grid-template-columns: 260px 1fr;
    min-height: 100vh;
  }

  .collections-panel {
    padding: 24px 18px;
    background: rgba(255, 255, 255, 0.75);
    border-right: 1px solid rgba(29, 26, 22, 0.08);
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
  }

  .collections-header {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .connection-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid rgba(29, 26, 22, 0.12);
    background: rgba(255, 255, 255, 0.9);
    font-size: 0.85rem;
  }

  .connection-pill .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff6b35;
  }

  .badge {
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: rgba(255, 107, 53, 0.15);
    color: #c44b23;
  }

  .collections-body {
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }

  .section-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: rgba(29, 26, 22, 0.6);
  }

  .collection-scroll {
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }

  .collection-table {
    border-radius: 14px;
    border: 1px solid rgba(29, 26, 22, 0.12);
    background: rgba(255, 255, 255, 0.85);
    overflow: hidden;
  }

  .collection-header {
    display: grid;
    grid-template-columns: 34px 1fr;
    gap: 8px;
    padding: 8px 10px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(29, 26, 22, 0.5);
    background: rgba(255, 255, 255, 0.95);
    border-bottom: 1px solid rgba(29, 26, 22, 0.1);
  }

  .collection-rows {
    display: grid;
  }

  .collection-row {
    display: grid;
    grid-template-columns: 34px 1fr;
    gap: 8px;
    align-items: center;
    text-align: left;
    padding: 8px 10px;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .collection-row + .collection-row {
    border-top: 1px solid rgba(29, 26, 22, 0.08);
  }

  .collection-row.active {
    background: rgba(29, 122, 111, 0.12);
  }

  .collection-index {
    font-size: 0.75rem;
    color: rgba(29, 26, 22, 0.45);
  }

  .collection-name {
    font-weight: 600;
    font-size: 0.85rem;
  }

  .collection-create {
    margin-top: 12px;
    display: grid;
    gap: 8px;
  }

  .collection-form {
    display: grid;
    gap: 8px;
  }

  .collection-input {
    border-radius: 12px;
    border: 1px solid rgba(29, 26, 22, 0.15);
    padding: 8px 10px;
    font-size: 0.9rem;
    background: #fff;
  }

  .collection-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .collection-error {
    color: #b42318;
    font-size: 0.8rem;
  }

  .collections-empty {
    padding: 12px;
    border-radius: 14px;
    border: 1px dashed rgba(29, 26, 22, 0.2);
    background: rgba(255, 255, 255, 0.7);
  }

  .muted {
    color: rgba(29, 26, 22, 0.5);
  }

  .workspace-main {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: 16px;
    padding: 24px;
    min-height: 0;
    min-width: 0;
  }

  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .workspace-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .workspace-title {
    font-size: 1.2rem;
    font-weight: 600;
  }

  .workspace-subtitle {
    font-size: 0.85rem;
    color: rgba(29, 26, 22, 0.6);
  }

  .tabs-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .tab {
    display: flex;
    align-items: stretch;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.75);
    border: 1px solid transparent;
    min-width: 160px;
    text-align: left;
    cursor: pointer;
    position: relative;
  }

  .tab.active {
    border-color: rgba(29, 122, 111, 0.6);
    box-shadow: 0 8px 18px rgba(29, 122, 111, 0.2);
  }

  .tab-main {
    flex: 1;
    display: grid;
    gap: 2px;
    padding: 0 20px 0 0;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
  }

  .tab-title {
    font-weight: 600;
  }

  .tab-path {
    font-size: 0.75rem;
    color: rgba(29, 26, 22, 0.5);
  }

  .tab-close {
    position: absolute;
    top: 6px;
    right: 10px;
    font-size: 0.75rem;
    color: rgba(29, 26, 22, 0.6);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .tab-add {
    border-radius: 12px;
    padding: 8px 12px;
    border: 1px dashed rgba(29, 26, 22, 0.3);
    background: transparent;
    cursor: pointer;
  }

  .query-panel,
  .bottom-panel {
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(29, 26, 22, 0.12);
    border-radius: 18px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  .editor {
    flex: 1;
    border-radius: 14px;
    border: 1px solid rgba(29, 26, 22, 0.15);
    padding: 12px;
    font-family: "IBM Plex Mono", "Fira Mono", monospace;
    font-size: 0.9rem;
    background: rgba(255, 255, 255, 0.9);
    resize: none;
  }

  .bottom-panel {
    min-height: 200px;
  }

  .bottom-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }

  .bottom-tab {
    border-radius: 999px;
    padding: 6px 12px;
    border: 1px solid rgba(29, 26, 22, 0.15);
    background: rgba(255, 255, 255, 0.9);
    cursor: pointer;
  }

  .bottom-tab.active {
    background: rgba(29, 122, 111, 0.15);
    border-color: rgba(29, 122, 111, 0.4);
  }

  .bottom-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    min-width: 0;
  }

  .panel-card {
    height: 100%;
    padding: 12px;
    border-radius: 14px;
    border: 1px dashed rgba(29, 26, 22, 0.15);
    background: rgba(255, 255, 255, 0.6);
    color: rgba(29, 26, 22, 0.6);
  }

  .panel-error {
    border-color: rgba(180, 35, 24, 0.4);
    color: #7a1b14;
    background: rgba(255, 245, 245, 0.9);
  }

  .result-summary {
    font-size: 0.8rem;
    color: rgba(29, 26, 22, 0.6);
    margin-bottom: 8px;
  }

  .result-pagination {
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .page-indicator {
    font-size: 0.8rem;
    color: rgba(29, 26, 22, 0.6);
  }

  .result-table-wrap {
    width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(29, 26, 22, 0.12);
    background: rgba(255, 255, 255, 0.9);
    overflow: auto;
    max-height: clamp(220px, 40vh, 420px);
    max-width: 100%;
    min-width: 0;
  }

  .result-table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
  }

  .result-table th,
  .result-table td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(29, 26, 22, 0.08);
    white-space: nowrap;
  }

  .result-table th {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(29, 26, 22, 0.55);
    background: rgba(255, 255, 255, 0.95);
  }

  .console-list {
    display: grid;
    gap: 6px;
    font-family: "IBM Plex Mono", "Fira Mono", monospace;
    font-size: 0.8rem;
    color: rgba(29, 26, 22, 0.7);
  }

  .console-line {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(29, 26, 22, 0.08);
  }

  .console-line.error {
    border-color: rgba(180, 35, 24, 0.3);
    color: #b42318;
  }

  .console-time {
    font-size: 0.7rem;
    color: rgba(29, 26, 22, 0.5);
  }

  .workspace-empty {
    margin: auto;
    max-width: 420px;
    text-align: center;
    padding: 32px;
    background: rgba(255, 255, 255, 0.85);
    border-radius: 24px;
    border: 1px solid rgba(29, 26, 22, 0.1);
  }

  .primary,
  .ghost {
    border-radius: 999px;
    border: 1px solid transparent;
    padding: 8px 14px;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .primary {
    background: #1d7a6f;
    color: #fff;
  }

  .ghost {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(29, 26, 22, 0.12);
  }

  .status {
    font-size: 0.75rem;
    color: rgba(29, 26, 22, 0.6);
  }

  @media (max-width: 1024px) {
    .workspace-shell {
      grid-template-columns: 1fr;
    }

    .collections-panel {
      border-right: none;
      border-bottom: 1px solid rgba(29, 26, 22, 0.08);
      height: auto;
      overflow: visible;
    }

    .collection-scroll {
      max-height: 40vh;
    }
  }
</style>
