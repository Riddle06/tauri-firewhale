<script lang="ts">
  import { onMount, tick } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { isTauri } from "@tauri-apps/api/core";
  import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import type { UnlistenFn } from "@tauri-apps/api/event";
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
    fieldStats,
    loadWorkspaceForConnection,
    recordFieldStats,
    setCollections,
    setActiveTab,
    tabs,
    updateClientPagination,
    updateCollectionPath,
    updateQueryText
  } from "$lib/stores/workspace";
  import { normalizeCollectionPath } from "$lib/utils/state";
  import { parseQueryChain, validateQueryAst } from "$lib/query/parser";
  import type { OrderByClause, QueryAst } from "$lib/query/types";
  import {
    fetchCollectionsForConnection,
    runFirestoreCountQuery,
    runFirestoreQuery,
    runFirestoreQueryAll
  } from "$lib/query/firestore";
  import type { ConnectionProfile } from "$lib/models";
  import QueryEditor from "$lib/components/QueryEditor.svelte";

  const { connectionId = null } = $props<{ connectionId?: string | null }>();

  const bottomTabs = [
    { id: "result", label: "Result" },
    { id: "console", label: "Query Console" }
  ] as const;

  const DEFAULT_QUERY_LIMIT = 50;
  const CLIENT_PAGINATION_THRESHOLD = 100;
  const BOTTOM_PANEL_STORAGE_KEY = "firewhale:bottom-panel-height";
  const DEFAULT_QUERY_PANEL_HEIGHT = 280;
  const DEFAULT_BOTTOM_PANEL_HEIGHT = 360;
  const DEFAULT_RESULT_COLUMN_WIDTH = 250;
  const MIN_RESULT_COLUMN_WIDTH = 120;
  const MIN_BOTTOM_PANEL_HEIGHT = 220;
  const MIN_QUERY_PANEL_HEIGHT = 240;
  const RESIZER_HEIGHT = 12;
  const RESIZE_STEP = 24;

  let bottomTab = $state<(typeof bottomTabs)[number]["id"]>("result");
  let workspaceLoading = $state(false);
  let collectionsLoading = $state(false);
  let collectionsError = $state("");
  let lastCollectionsConnectionId = $state<string | null>(null);
  let createCollectionOpen = $state(false);
  let newCollectionPath = $state("");
  let collectionError = $state("");
  let collectionFilter = $state("");
  let bottomPanelHeight = $state(DEFAULT_BOTTOM_PANEL_HEIGHT);
  let isResizing = $state(false);
  let runStates = $state<Record<string, QueryRunState>>({});
  let runLogs = $state<Record<string, QueryLog[]>>({});
  let runSequence = $state(0);
  let panelsEl = $state<HTMLDivElement | null>(null);
  let resizeStartY = 0;
  let resizeStartHeight = 0;
  let columnWidths = $state<Record<string, number>>({});
  let columnResizeState = $state<ColumnResizeState | null>(null);
  let contextMenu = $state<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    row: null
  });

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
    clientPagination?: boolean;
    clientRows?: Record<string, unknown>[];
    totalRows?: number;
  };

  type QueryLog = {
    id: number;
    level: "info" | "error";
    message: string;
    timestamp: number;
  };

  type PendingClientRun = {
    tabId: string;
    ast: QueryAst;
    pageIndex: number;
  };

  type DocumentViewPayload = {
    row: Record<string, unknown>;
    collectionPath: string;
    id: string;
    title: string;
  };

  type DocumentEditPayload = {
    row: Record<string, unknown>;
    collectionPath: string;
    id: string;
    title: string;
    tabId: string;
    connectionId: string;
    idIsSynthetic?: boolean;
  };

  type DocumentWindowPayload =
    | { event: "document:view"; payload: DocumentViewPayload }
    | { event: "document:edit"; payload: DocumentEditPayload };

  type DocumentUpdatedPayload = {
    tabId: string;
    collectionPath: string;
    documentId: string;
    row: Record<string, unknown>;
  };

  type DocumentReadyPayload = {
    label: string;
  };

  type ColumnResizeState = {
    column: string;
    startX: number;
    startWidth: number;
  };

  type ContextMenuState = {
    open: boolean;
    x: number;
    y: number;
    row: Record<string, unknown> | null;
  };

  const emptyRunState: QueryRunState = {
    status: "idle",
    rows: [],
    pageIndex: 0,
    pageSize: 0,
    hasNextPage: false,
    clientPagination: false,
    clientRows: []
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

  const resultTableWidth = $derived.by(() => {
    if (activeColumns.length === 0) return 0;
    return activeColumns.reduce((total, column) => total + getColumnWidth(column), 0);
  });

  const filteredCollections = $derived.by(() => {
    const needle = collectionFilter.trim().toLowerCase();
    if (!needle) return $collections;
    return $collections.filter((collection) =>
      collection.toLowerCase().includes(needle)
    );
  });

  const documentPayloads = new SvelteMap<string, DocumentWindowPayload>();

  let documentReadyUnlisten: UnlistenFn | null = null;
  let documentUpdateUnlisten: UnlistenFn | null = null;
  let clientPaginationWarningOpen = $state(false);
  let clientPaginationWarningCount = $state(0);
  let clientPaginationPending = $state<PendingClientRun | null>(null);

  function parseStoredHeight(value: string | null): number | null {
    if (!value) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  function getMaxBottomPanelHeight(): number {
    if (!panelsEl) return Number.POSITIVE_INFINITY;
    const available = panelsEl.clientHeight - RESIZER_HEIGHT;
    if (available <= 0) return MIN_BOTTOM_PANEL_HEIGHT;
    return Math.max(MIN_BOTTOM_PANEL_HEIGHT, available - MIN_QUERY_PANEL_HEIGHT);
  }

  function clampBottomPanelHeight(height: number): number {
    const maxHeight = getMaxBottomPanelHeight();
    return Math.min(Math.max(height, MIN_BOTTOM_PANEL_HEIGHT), maxHeight);
  }

  function setBottomPanelHeight(height: number, persist = true): void {
    const clamped = Math.round(clampBottomPanelHeight(height));
    if (clamped === bottomPanelHeight) {
      if (persist && typeof window !== "undefined") {
        window.localStorage.setItem(BOTTOM_PANEL_STORAGE_KEY, String(clamped));
      }
      return;
    }
    bottomPanelHeight = clamped;
    if (!persist || typeof window === "undefined") return;
    window.localStorage.setItem(BOTTOM_PANEL_STORAGE_KEY, String(clamped));
  }

  function computeDefaultBottomPanelHeight(): number {
    if (!panelsEl) return DEFAULT_BOTTOM_PANEL_HEIGHT;
    const available = panelsEl.clientHeight - RESIZER_HEIGHT;
    if (available <= 0) return DEFAULT_BOTTOM_PANEL_HEIGHT;
    return clampBottomPanelHeight(available - DEFAULT_QUERY_PANEL_HEIGHT);
  }

  function handleResizerPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
    isResizing = true;
    resizeStartY = event.clientY;
    resizeStartHeight = bottomPanelHeight;
  }

  function handleResizerPointerMove(event: PointerEvent): void {
    if (!isResizing) return;
    event.preventDefault();
    const delta = event.clientY - resizeStartY;
    const nextHeight = resizeStartHeight - delta;
    setBottomPanelHeight(nextHeight, false);
  }

  function handleResizerPointerUp(event: PointerEvent): void {
    if (!isResizing) return;
    (event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId);
    isResizing = false;
    setBottomPanelHeight(bottomPanelHeight);
  }

  function handleResizerKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? RESIZE_STEP : -RESIZE_STEP;
    setBottomPanelHeight(bottomPanelHeight + delta);
  }

  function getColumnWidth(column: string): number {
    return columnWidths[column] ?? DEFAULT_RESULT_COLUMN_WIDTH;
  }

  function shouldTruncateColumn(column: string): boolean {
    return getColumnWidth(column) <= DEFAULT_RESULT_COLUMN_WIDTH;
  }

  function setColumnWidth(column: string, width: number): void {
    const clamped = Math.max(MIN_RESULT_COLUMN_WIDTH, Math.round(width));
    if (columnWidths[column] === clamped) return;
    columnWidths = { ...columnWidths, [column]: clamped };
  }

  function handleColumnResizerPointerDown(event: PointerEvent, column: string): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
    columnResizeState = {
      column,
      startX: event.clientX,
      startWidth: getColumnWidth(column)
    };
  }

  function handleColumnResizerPointerMove(event: PointerEvent): void {
    if (!columnResizeState) return;
    event.preventDefault();
    const delta = event.clientX - columnResizeState.startX;
    setColumnWidth(columnResizeState.column, columnResizeState.startWidth + delta);
  }

  function handleColumnResizerPointerUp(event: PointerEvent): void {
    if (!columnResizeState) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)?.releasePointerCapture(event.pointerId);
    columnResizeState = null;
  }

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
      await tick();
      if (panelsEl) {
        setBottomPanelHeight(bottomPanelHeight, false);
      }
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

    if (currentWindow) {
      void currentWindow
        .listen<DocumentReadyPayload>("document:ready", (event) => {
          const label = event.payload?.label;
          if (!label) return;
          const payload = documentPayloads.get(label);
          if (!payload) return;
          void currentWindow.emitTo(label, payload.event, payload.payload);
          documentPayloads.delete(label);
        })
        .then((cleanup) => {
          documentReadyUnlisten = cleanup;
        });

      void currentWindow
        .listen<DocumentUpdatedPayload>("document:updated", (event) => {
          if (!event.payload) return;
          handleDocumentUpdated(event.payload);
        })
        .then((cleanup) => {
          documentUpdateUnlisten = cleanup;
        });
    }

    let messageHandler: ((event: MessageEvent) => void) | null = null;
    if (!currentWindow && typeof window !== "undefined") {
      messageHandler = (event: MessageEvent) => {
        const data = event.data as { type?: string; payload?: DocumentUpdatedPayload };
        if (!data || data.type !== "document:updated" || !data.payload) return;
        handleDocumentUpdated(data.payload);
      };
      window.addEventListener("message", messageHandler);
    }

    return () => {
      unsubscribe();
      unsubscribeConnection();
      documentReadyUnlisten?.();
      documentReadyUnlisten = null;
      documentUpdateUnlisten?.();
      documentUpdateUnlisten = null;
      if (messageHandler && typeof window !== "undefined") {
        window.removeEventListener("message", messageHandler);
      }
    };
  });

  onMount(() => {
    if (typeof window === "undefined") return;

    const storedHeight = parseStoredHeight(
      window.localStorage.getItem(BOTTOM_PANEL_STORAGE_KEY)
    );

    void tick().then(() => {
      const initialHeight = storedHeight ?? computeDefaultBottomPanelHeight();
      setBottomPanelHeight(initialHeight);
    });

    const handleResize = () => {
      setBottomPanelHeight(bottomPanelHeight, false);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
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

  $effect(() => {
    if (activeColumns.length === 0) return;
    let changed = false;
    const next = { ...columnWidths };
    for (const column of activeColumns) {
      if (next[column] === undefined) {
        next[column] = DEFAULT_RESULT_COLUMN_WIDTH;
        changed = true;
      }
    }
    if (changed) columnWidths = next;
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

  function normalizeQueryWhitespace(input: string): string {
    let output = "";
    let inString: "'" | "\"" | null = null;
    let escaped = false;
    let sawSpace = false;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (inString) {
        output += char;
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
        output += char;
        sawSpace = false;
        continue;
      }
      if (/\s/.test(char)) {
        if (!sawSpace) {
          output += " ";
          sawSpace = true;
        }
        continue;
      }
      sawSpace = false;
      output += char;
    }

    return output.trim();
  }

  function splitQueryChain(input: string): string[] {
    const segments: string[] = [];
    let current = "";
    let inString: "'" | "\"" | null = null;
    let escaped = false;
    let depth = 0;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (inString) {
        current += char;
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
        current += char;
        continue;
      }
      if (char === "(" || char === "[" || char === "{") {
        depth += 1;
        current += char;
        continue;
      }
      if (char === ")" || char === "]" || char === "}") {
        depth = Math.max(0, depth - 1);
        current += char;
        continue;
      }
      if (char === "." && depth === 0) {
        const prev = input[i - 1];
        const next = input[i + 1];
        if (prev && next && /[0-9]/.test(prev) && /[0-9]/.test(next)) {
          current += char;
          continue;
        }
        if (current.trim()) {
          segments.push(current.trim());
        }
        current = "";
        continue;
      }
      current += char;
    }

    if (current.trim()) {
      segments.push(current.trim());
    }
    return segments;
  }

  function formatQueryText(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return input;

    const normalized = normalizeQueryWhitespace(trimmed);
    const segments = splitQueryChain(normalized);
    if (segments.length === 0) return input;
    if (segments.length === 1) return segments[0];

    const lines: string[] = [];
    let startIndex = 1;
    if (segments.length > 1 && !segments[0].includes("(")) {
      lines.push(`${segments[0]}.${segments[1]}`.trim());
      startIndex = 2;
    } else {
      lines.push(segments[0].trim());
    }
    for (let i = startIndex; i < segments.length; i += 1) {
      const segment = segments[i].trim();
      if (!segment) continue;
      lines.push(`  .${segment}`);
    }
    return lines.join("\n");
  }

  function formatActiveQuery(): void {
    if (!$activeTab) return;
    const formatted = formatQueryText($activeTab.queryText);
    if (formatted !== $activeTab.queryText) {
      updateQueryText($activeTab.id, formatted);
    }
  }

  function handleQueryInput(nextValue: string): void {
    if (!$activeTab) return;
    updateQueryText($activeTab.id, nextValue);
  }

  function resolveClientPageSize(limit?: number): number {
    if (typeof limit === "number" && Number.isFinite(limit)) {
      return Math.max(1, Math.floor(limit));
    }
    return DEFAULT_QUERY_LIMIT;
  }

  function compareValues(left: unknown, right: unknown): number {
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    if (left === right) return 0;
    return left > right ? 1 : -1;
  }

  function sortRows(
    rows: Record<string, unknown>[],
    orderBy: OrderByClause[]
  ): Record<string, unknown>[] {
    if (orderBy.length === 0) return rows;
    return [...rows].sort((left, right) => {
      for (const order of orderBy) {
        const dir = order.dir === "desc" ? -1 : 1;
        const diff = compareValues(left[order.field], right[order.field]);
        if (diff !== 0) return diff * dir;
      }
      return 0;
    });
  }

  function applyClientPage(
    tabId: string,
    nextPageIndex: number
  ): void {
    const current = runStates[tabId];
    if (!current?.clientPagination || !current.clientRows) return;
    const pageSize = current.pageSize || DEFAULT_QUERY_LIMIT;
    const totalRows = current.clientRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const clampedIndex = Math.min(Math.max(nextPageIndex, 0), totalPages - 1);
    const start = clampedIndex * pageSize;
    const pageRows = current.clientRows.slice(start, start + pageSize);
    runStates = {
      ...runStates,
      [tabId]: {
        ...current,
        rows: pageRows,
        pageIndex: clampedIndex,
        hasNextPage: (clampedIndex + 1) * pageSize < totalRows
      }
    };
  }

  function handleClientPaginationToggle(event: Event): void {
    if (!$activeTab) return;
    const target = event.target as HTMLInputElement;
    updateClientPagination($activeTab.id, target.checked);
  }

  function clearClientPaginationWarning(): void {
    clientPaginationWarningOpen = false;
    clientPaginationWarningCount = 0;
    clientPaginationPending = null;
  }

  async function confirmClientPagination(): Promise<void> {
    const pending = clientPaginationPending;
    clearClientPaginationWarning();
    if (!pending) return;
    await runClientPaginationQuery(pending.ast, pending.tabId, pending.pageIndex);
  }

  async function runClientPaginationQuery(
    ast: QueryAst,
    tabId: string,
    pageIndex: number
  ): Promise<void> {
    const connection = $activeConnection;
    if (!connection) {
      setRunError(tabId, "No active connection.");
      return;
    }
    runStates = {
      ...runStates,
      [tabId]: {
        status: "running",
        rows: [],
        pageIndex,
        pageSize: resolveClientPageSize(ast.limit),
        hasNextPage: false,
        clientPagination: true,
        clientRows: []
      }
    };
    bottomTab = "result";
    pushLog(tabId, "info", "Running query...");

    let queryResult;
    try {
      queryResult = await runFirestoreQueryAll(connection, {
        ...ast,
        orderBy: [],
        limit: undefined
      });
    } catch (error) {
      setRunError(
        tabId,
        error instanceof Error ? error.message : "Failed to run query."
      );
      return;
    }

    const pageSize = resolveClientPageSize(ast.limit);
    const sortedRows = sortRows(queryResult.rows, ast.orderBy);
    const totalRows = sortedRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const clampedPageIndex = Math.min(Math.max(pageIndex, 0), totalPages - 1);
    const start = clampedPageIndex * pageSize;
    const pageRows = sortedRows.slice(start, start + pageSize);
    const warnings = [...queryResult.warnings];
    if (ast.limit === undefined) {
      warnings.push(`No limit specified. Using default page size ${pageSize}.`);
    }

    runStates = {
      ...runStates,
      [tabId]: {
        status: "success",
        rows: pageRows,
        warnings,
        durationMs: queryResult.durationMs,
        pageIndex: clampedPageIndex,
        pageSize,
        hasNextPage: (clampedPageIndex + 1) * pageSize < totalRows,
        clientPagination: true,
        clientRows: sortedRows,
        totalRows
      }
    };
    if (sortedRows.length > 0) {
      recordFieldStats(ast.collectionPath, sortedRows);
    }
    if (warnings.length > 0) {
      for (const warning of warnings) {
        pushLog(tabId, "info", warning);
      }
    }
    pushLog(tabId, "info", `Returned ${totalRows} row(s).`);
  }

  async function runServerPaginationQuery(
    ast: QueryAst,
    tabId: string,
    pageIndex: number
  ): Promise<void> {
    const connection = $activeConnection;
    if (!connection) {
      setRunError(tabId, "No active connection.");
      return;
    }
    runStates = {
      ...runStates,
      [tabId]: {
        status: "running",
        rows: [],
        pageIndex,
        pageSize: 0,
        hasNextPage: false,
        clientPagination: false,
        clientRows: []
      }
    };
    bottomTab = "result";
    pushLog(tabId, "info", "Running query...");

    let result;
    try {
      result = await runFirestoreQuery(connection, ast, { pageIndex });
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
        hasNextPage: result.hasNextPage,
        clientPagination: false,
        clientRows: []
      }
    };
    if (result.rows.length > 0) {
      recordFieldStats(ast.collectionPath, result.rows);
    }
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        pushLog(tabId, "info", warning);
      }
    }
    pushLog(tabId, "info", `Returned ${result.rows.length} row(s).`);
  }

  async function runQuery(pageIndex = 0): Promise<void> {
    if (!$activeTab) return;
    if (!$activeConnection) {
      setRunError($activeTab.id, "No active connection.");
      return;
    }
    const tabId = $activeTab.id;
    const queryText = $activeTab.queryText.trim();

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

    clearClientPaginationWarning();
    const clientPaginationEnabled = $activeTab.clientPagination ?? false;
    if (clientPaginationEnabled && parsed.ast.where.length === 0) {
      setRunError(tabId, "Client-side pagination mode requires at least one where clause.");
      return;
    }

    if (clientPaginationEnabled) {
      let totalCount: number;
      try {
        totalCount = await runFirestoreCountQuery($activeConnection, parsed.ast);
      } catch (error) {
        setRunError(
          tabId,
          error instanceof Error ? error.message : "Failed to count query results."
        );
        return;
      }
      if (totalCount > CLIENT_PAGINATION_THRESHOLD) {
        clientPaginationWarningCount = totalCount;
        clientPaginationPending = { tabId, ast: parsed.ast, pageIndex };
        clientPaginationWarningOpen = true;
        return;
      }
      await runClientPaginationQuery(parsed.ast, tabId, pageIndex);
      return;
    }

    await runServerPaginationQuery(parsed.ast, tabId, pageIndex);
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

  async function openCollectionTab(path: string): Promise<void> {
    if (!$activeConnectionId) return;
    const created = addTab($activeConnectionId, path);
    if (created) {
      updateQueryText(created.id, buildDefaultQuery(path));
    }
    bottomTab = "result";
    if (!created) return;
    await tick();
    if ($activeTab?.id === created.id) {
      void runQuery();
    }
  }

  function runPreviousPage(): void {
    if (activeRunState.status !== "success") return;
    if (activeRunState.pageIndex <= 0) return;
    if (activeRunState.clientPagination && $activeTab) {
      applyClientPage($activeTab.id, activeRunState.pageIndex - 1);
      return;
    }
    void runQuery(activeRunState.pageIndex - 1);
  }

  function runNextPage(): void {
    if (activeRunState.status !== "success") return;
    if (!activeRunState.hasNextPage) return;
    if (activeRunState.clientPagination && $activeTab) {
      applyClientPage($activeTab.id, activeRunState.pageIndex + 1);
      return;
    }
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

  function resolveContextMenuPosition(x: number, y: number): { x: number; y: number } {
    if (typeof window === "undefined") return { x, y };
    const padding = 8;
    const menuWidth = 180;
    const menuHeight = 96;
    const maxX = Math.max(padding, window.innerWidth - menuWidth - padding);
    const maxY = Math.max(padding, window.innerHeight - menuHeight - padding);
    return { x: Math.min(x, maxX), y: Math.min(y, maxY) };
  }

  function openRowContextMenu(event: MouseEvent, row: Record<string, unknown>): void {
    event.preventDefault();
    const { x, y } = resolveContextMenuPosition(event.clientX, event.clientY);
    contextMenu = { open: true, x, y, row };
  }

  function closeContextMenu(): void {
    if (!contextMenu.open) return;
    contextMenu = { open: false, x: 0, y: 0, row: null };
  }

  function handleDocumentUpdated(payload: DocumentUpdatedPayload): void {
    if (!payload?.tabId || !payload.documentId) return;
    const previous = runStates[payload.tabId];
    if (!previous || previous.status !== "success") return;
    const nextRows = previous.rows.map((row) => {
      const rowId = getRowId(row);
      if (rowId === payload.documentId) {
        return payload.row;
      }
      return row;
    });
    runStates = {
      ...runStates,
      [payload.tabId]: {
        ...previous,
        rows: nextRows
      }
    };
    if (payload.collectionPath) {
      recordFieldStats(payload.collectionPath, [payload.row]);
    }
  }

  function getRowId(row: Record<string, unknown>): string {
    const metaId = (row as { __docId?: unknown }).__docId;
    if (typeof metaId === "string" && metaId) {
      return metaId;
    }
    const id = row.id;
    if (typeof id === "string" || typeof id === "number") {
      return String(id);
    }
    return "Document";
  }

  function isSyntheticRowId(row: Record<string, unknown>): boolean {
    return (row as { __idSynthetic?: boolean }).__idSynthetic === true;
  }

  function buildViewTitle(collectionPath: string, row: Record<string, unknown>): string {
    const collectionLabel = collectionPath || "collection";
    const idLabel = getRowId(row);
    return `${collectionLabel} - ${idLabel} - View Mode`;
  }

  function buildEditTitle(collectionPath: string, row: Record<string, unknown>): string {
    const collectionLabel = collectionPath || "collection";
    const idLabel = getRowId(row);
    return `${collectionLabel} - ${idLabel} - Edit Mode`;
  }

  async function openJsonViewerWindow(row: Record<string, unknown>): Promise<void> {
    if (!$activeTab) return;
    const collectionPath = $activeTab.collectionPath || "collection";
    const idLabel = getRowId(row);
    const title = buildViewTitle(collectionPath, row);
    const params = new URLSearchParams({
      view: "document",
      collection: collectionPath,
      id: idLabel
    });
    const url = `/?${params.toString()}`;

    if (!tauriEnabled) {
      if (typeof window !== "undefined") {
        const payload = JSON.stringify({ row, collectionPath, id: idLabel, title });
        const browserParams = new URLSearchParams({
          view: "document",
          collection: collectionPath,
          id: idLabel,
          payload
        });
        window.open(`/?${browserParams.toString()}`, "_blank");
      }
      closeContextMenu();
      return;
    }

    const label = `doc-view-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const payload: DocumentViewPayload = { row, collectionPath, id: idLabel, title };
    documentPayloads.set(label, { event: "document:view", payload });
    const viewer = new WebviewWindow(label, {
      url,
      title,
      width: 920,
      height: 720,
      minWidth: 720,
      minHeight: 520
    });
    void viewer.once("tauri://error", () => {
      documentPayloads.delete(label);
    });

    closeContextMenu();
  }

  async function openEditDocumentWindow(row: Record<string, unknown>): Promise<void> {
    if (!$activeTab || !$activeConnectionId) return;
    const collectionPath = $activeTab.collectionPath || "collection";
    const idLabel = getRowId(row);
    const title = buildEditTitle(collectionPath, row);
    const params = new URLSearchParams({
      view: "document-edit",
      collection: collectionPath,
      id: idLabel
    });
    const url = `/?${params.toString()}`;

    const payload: DocumentEditPayload = {
      row,
      collectionPath,
      id: idLabel,
      title,
      tabId: $activeTab.id,
      connectionId: $activeConnectionId,
      idIsSynthetic: isSyntheticRowId(row)
    };

    if (!tauriEnabled) {
      if (typeof window !== "undefined") {
        const browserParams = new URLSearchParams({
          view: "document-edit",
          collection: collectionPath,
          id: idLabel,
          payload: JSON.stringify(payload)
        });
        window.open(`/?${browserParams.toString()}`, "_blank");
      }
      closeContextMenu();
      return;
    }

    const label = `doc-edit-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    documentPayloads.set(label, { event: "document:edit", payload });
    const viewer = new WebviewWindow(label, {
      url,
      title,
      width: 940,
      height: 760,
      minWidth: 720,
      minHeight: 560
    });
    void viewer.once("tauri://error", () => {
      documentPayloads.delete(label);
    });

    closeContextMenu();
  }

  function handleContextMenuBackdropClick(event: MouseEvent): void {
    if (event.currentTarget !== event.target) return;
    closeContextMenu();
  }

  function handleBackdropKeydown(
    event: KeyboardEvent,
    closeHandler: () => void
  ): void {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Escape") return;
    event.preventDefault();
    closeHandler();
  }

  function handleClientPaginationBackdropClick(event: MouseEvent): void {
    if (event.currentTarget !== event.target) return;
    clearClientPaginationWarning();
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
        <div class="collection-filter">
          <input
            class="collection-filter-input"
            type="search"
            placeholder="Filter collections"
            bind:value={collectionFilter}
            aria-label="Filter collections"
          />
        </div>
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
          {:else if filteredCollections.length === 0}
            <div class="collections-empty">
              <p>No collections match.</p>
              <p class="muted">Try another keyword.</p>
            </div>
          {:else}
            <div class="collection-table">
              <div class="collection-header">
                <span>#</span>
                <span>Collection</span>
              </div>
              <div class="collection-rows">
                {#each filteredCollections as collection, index (collection)}
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

      <div class="workspace-panels" bind:this={panelsEl} class:resizing={isResizing}>
        <section class="query-panel">
          <div class="panel-header">
            <h3>Query</h3>
          <div class="panel-meta">
            <span class="status muted">
              {$activeTab?.collectionPath || "Select a collection"}
            </span>
              <div class="run-actions">
                <label class="client-pagination-toggle">
                  <input
                    type="checkbox"
                    checked={$activeTab?.clientPagination ?? false}
                    onchange={handleClientPaginationToggle}
                    disabled={!$activeTab}
                  />
                  <span>Client-side pagination mode</span>
                </label>
                <button
                  class="primary run-button"
                  type="button"
                  onclick={() => runQuery()}
                  disabled={!$activeTab || activeRunState.status === "running"}
                  title="Run (Cmd/Ctrl+Enter)"
                >
                  {activeRunState.status === "running" ? "Running..." : "Run"}
                </button>
              </div>
            <button
              class="ghost format-button"
              type="button"
              onclick={formatActiveQuery}
                disabled={!$activeTab}
                title="Format (Cmd/Ctrl+Shift+F or Shift+Alt+F)"
              >
                Format
              </button>
            </div>
          </div>
          {#if $activeTab}
            <QueryEditor
              value={$activeTab.queryText}
              collections={$collections}
              fieldStats={$fieldStats}
              collectionPath={$activeTab.collectionPath}
              onChange={handleQueryInput}
              onFormat={formatActiveQuery}
              onRun={() => runQuery()}
            />
          {:else}
            <div class="editor editor-empty">Select a collection to begin.</div>
          {/if}
        </section>

        <button
          class="panel-resizer"
          aria-label="Resize panels"
          type="button"
          tabindex="0"
          onpointerdown={handleResizerPointerDown}
          onpointermove={handleResizerPointerMove}
          onpointerup={handleResizerPointerUp}
          onpointercancel={handleResizerPointerUp}
          onkeydown={handleResizerKeydown}
        ></button>

        <section class="bottom-panel" style={`height: ${bottomPanelHeight}px;`}>
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
                    <table class="result-table" style={`width: ${resultTableWidth}px;`}>
                      <colgroup>
                        {#each activeColumns as column (column)}
                          <col style={`width: ${getColumnWidth(column)}px;`} />
                        {/each}
                      </colgroup>
                      <thead>
                        <tr>
                          {#each activeColumns as column (column)}
                            <th>
                              <span class="column-label">{column}</span>
                              <span
                                class={`column-resizer ${columnResizeState?.column === column ? "active" : ""}`}
                                onpointerdown={(event) => handleColumnResizerPointerDown(event, column)}
                                onpointermove={handleColumnResizerPointerMove}
                                onpointerup={handleColumnResizerPointerUp}
                                onpointercancel={handleColumnResizerPointerUp}
                              ></span>
                            </th>
                          {/each}
                        </tr>
                      </thead>
                      <tbody>
                        {#each activeRunState.rows as row, rowIndex (row.id ?? rowIndex)}
                          <tr
                            class="result-row"
                            oncontextmenu={(event) => openRowContextMenu(event, row)}
                            ondblclick={() => openJsonViewerWindow(row)}
                          >
                            {#each activeColumns as column (column)}
                              {@const cellValue = formatCell(row[column])}
                              {@const truncate = shouldTruncateColumn(column)}
                              <td>
                                <span
                                  class="cell-content"
                                  class:truncate={truncate}
                                  class:expand={!truncate}
                                  title={cellValue}
                                >
                                  {cellValue}
                                </span>
                              </td>
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
      </div>
    </section>
  </div>
  {#if clientPaginationWarningOpen}
    <div
      class="confirm-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close confirmation"
      onclick={handleClientPaginationBackdropClick}
      onkeydown={(event) => handleBackdropKeydown(event, clearClientPaginationWarning)}
    >
      <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="client-pagination-title">
        <div class="confirm-title" id="client-pagination-title">
          You are currently using client-side pagination.
        </div>
        <div class="confirm-text">
          This action will fetch approximately
          <strong>{clientPaginationWarningCount.toLocaleString()}</strong>
          records in a single request.
        </div>
        <div class="confirm-text">
          Loading this amount of data may take longer and result in higher query costs.
        </div>
        <div class="confirm-text">Are you sure you want to continue?</div>
        <div class="confirm-actions">
          <button class="ghost" type="button" onclick={clearClientPaginationWarning}>
            Cancel
          </button>
          <button class="primary" type="button" onclick={confirmClientPagination}>
            Run query
          </button>
        </div>
      </div>
    </div>
  {/if}
  {#if contextMenu.open}
    <div
      class="context-menu-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close context menu"
      onclick={handleContextMenuBackdropClick}
      onkeydown={(event) => handleBackdropKeydown(event, closeContextMenu)}
    >
      <div
        class="context-menu"
        style={`top: ${contextMenu.y}px; left: ${contextMenu.x}px;`}
      >
        <button
          class="context-menu-item"
          type="button"
          onclick={() => contextMenu.row && openJsonViewerWindow(contextMenu.row)}
        >
          View as JSON
        </button>
        <button
          class="context-menu-item"
          type="button"
          onclick={() => contextMenu.row && openEditDocumentWindow(contextMenu.row)}
        >
          Edit document
        </button>
      </div>
    </div>
  {/if}
{/if}

<style>
  .workspace-shell {
    display: grid;
    grid-template-columns: 260px 1fr;
    height: 100vh;
    min-height: 0;
  }

  .collections-panel {
    padding: 24px 18px;
    background: rgba(var(--fw-ice-rgb), 0.88);
    border-right: 1px solid rgba(var(--fw-frost-rgb), 0.9);
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
    border: 1px solid rgba(var(--fw-frost-rgb), 0.9);
    background: rgba(var(--fw-ice-rgb), 0.95);
    color: var(--fw-deep);
    font-size: 0.85rem;
  }

  .connection-pill .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fw-flame);
  }

  .badge {
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: rgba(var(--fw-flame-rgb), 0.15);
    color: var(--fw-flame);
  }

  .collections-body {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }

  .section-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--fw-slate);
  }

  .collection-scroll {
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }

  .collection-filter {
    display: flex;
  }

  .collection-filter-input {
    width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(var(--fw-frost-rgb), 0.9);
    padding: 8px 10px;
    font-size: 0.9rem;
    background: #fff;
  }

  .collection-filter-input:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(var(--fw-sky-rgb), 0.35);
  }

  .collection-table {
    border-radius: 14px;
    border: 1px solid rgba(var(--fw-frost-rgb), 0.9);
    background: rgba(var(--fw-ice-rgb), 0.9);
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
    color: rgba(var(--fw-slate-rgb), 0.9);
    background: rgba(var(--fw-ice-rgb), 0.95);
    border-bottom: 1px solid rgba(var(--fw-frost-rgb), 0.9);
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
    border-radius: 10px;
    cursor: pointer;
    transition: background-color 0.15s ease, box-shadow 0.15s ease,
      color 0.15s ease;
  }

  .collection-row + .collection-row {
    border-top: 1px solid rgba(var(--fw-frost-rgb), 0.85);
  }

  .collection-row:hover {
    background: var(--fw-ice);
    box-shadow: inset 0 0 0 1px rgba(var(--fw-whale-rgb), 0.45);
  }

  .collection-row.active {
    background: rgba(var(--fw-whale-rgb), 0.28);
    box-shadow: inset 0 0 0 1px rgba(var(--fw-whale-rgb), 0.5);
  }

  .collection-row:hover .collection-name,
  .collection-row:hover .collection-index {
    color: var(--fw-deep);
  }

  .collection-index {
    font-size: 0.75rem;
    color: rgba(var(--fw-slate-rgb), 0.8);
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
    border: 1px solid rgba(var(--fw-frost-rgb), 0.9);
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
    color: var(--fw-ember);
    font-size: 0.8rem;
  }

  .collections-empty {
    padding: 12px;
    border-radius: 14px;
    border: 1px dashed rgba(var(--fw-frost-rgb), 0.9);
    background: rgba(var(--fw-ice-rgb), 0.75);
  }

  .muted {
    color: var(--fw-slate);
  }

  .workspace-main {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 16px;
    padding: 24px;
    height: 100%;
    box-sizing: border-box;
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
    color: var(--fw-slate);
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
    background: rgba(var(--fw-ice-rgb), 0.9);
    border: 1px solid transparent;
    min-width: 160px;
    text-align: left;
    cursor: pointer;
    position: relative;
  }

  .tab.active {
    border-color: rgba(var(--fw-whale-rgb), 0.6);
    box-shadow: 0 8px 18px rgba(var(--fw-whale-rgb), 0.25);
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
    color: var(--fw-slate);
  }

  .tab-close {
    position: absolute;
    top: 6px;
    right: 10px;
    font-size: 0.75rem;
    color: var(--fw-slate);
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .tab-add {
    border-radius: 12px;
    padding: 8px 12px;
    border: 1px dashed rgba(var(--fw-frost-rgb), 0.9);
    background: transparent;
    cursor: pointer;
  }

  .workspace-panels {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    flex: 1;
  }

  .workspace-panels.resizing {
    user-select: none;
  }

  .panel-resizer {
    height: 12px;
    display: grid;
    place-items: center;
    cursor: row-resize;
    touch-action: none;
    width: 100%;
    border: none;
    background: transparent;
    padding: 0;
  }

  .panel-resizer::after {
    content: "";
    width: 44px;
    height: 3px;
    border-radius: 999px;
    background: rgba(var(--fw-frost-rgb), 0.9);
    transition: background-color 0.15s ease, width 0.15s ease;
  }

  .panel-resizer:hover::after {
    background: rgba(var(--fw-whale-rgb), 0.55);
    width: 54px;
  }

  .panel-resizer:focus-visible {
    outline: none;
  }

  .panel-resizer:focus-visible::after {
    background: rgba(var(--fw-whale-rgb), 0.75);
    width: 54px;
  }

  .workspace-panels.resizing .panel-resizer::after {
    background: rgba(var(--fw-whale-rgb), 0.75);
  }

  .query-panel,
  .bottom-panel {
    background: rgba(var(--fw-ice-rgb), 0.9);
    border: 1px solid rgba(var(--fw-frost-rgb), 0.9);
    border-radius: 18px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .query-panel {
    flex: 1 1 auto;
    min-height: 240px;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .panel-meta {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .run-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .client-pagination-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.72rem;
    color: var(--fw-slate);
    cursor: pointer;
    user-select: none;
  }

  .client-pagination-toggle input {
    accent-color: var(--fw-whale);
  }

  .client-pagination-toggle input:disabled {
    cursor: not-allowed;
  }

  .client-pagination-toggle input:disabled + span {
    opacity: 0.6;
  }

  .panel-header h3 {
    margin: 0;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--fw-slate);
  }

  .editor {
    flex: 1;
    border-radius: 14px;
    border: 1px solid rgba(var(--fw-deep-rgb), 0.35);
    background: var(--fw-ink);
    overflow: hidden;
    min-height: 0;
  }

  .format-button {
    padding: 6px 12px;
    font-size: 0.75rem;
  }

  .format-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .editor-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(var(--fw-ice-rgb), 0.8);
    font-size: 0.85rem;
  }

  .bottom-panel {
    flex: 0 0 auto;
    min-height: 220px;
  }

  .bottom-tabs {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }

  .bottom-tab {
    border-radius: 999px;
    padding: 6px 12px;
    border: 1px solid rgba(var(--fw-deep-rgb), 0.18);
    background: #fff;
    color: var(--fw-deep);
    font-size: 0.85rem;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
  }

  .bottom-tab:hover {
    background: var(--fw-ice);
    border-color: rgba(var(--fw-whale-rgb), 0.6);
  }

  .bottom-tab.active {
    background:  rgba(var(--fw-whale-rgb));
    color: #fff;
    border-color: var(--fw-whale);
    box-shadow: inset 0 0 0 1px rgba(var(--fw-whale-rgb), 0.3);
  }

  .bottom-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }

  .panel-card {
    height: 100%;
    padding: 12px;
    border-radius: 14px;
    border: 1px dashed rgba(var(--fw-frost-rgb), 0.9);
    background: rgba(var(--fw-ice-rgb), 0.75);
    color: var(--fw-slate);
    flex: 1 1 auto;
    min-height: 0;
  }

  .panel-error {
    border-color: rgba(var(--fw-ember-rgb), 0.4);
    color: var(--fw-ember);
    background: rgba(var(--fw-ember-rgb), 0.1);
  }

  .result-summary {
    font-size: 0.8rem;
    color: var(--fw-slate);
    margin-bottom: 8px;
  }

  .result-pagination {
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex: 0 0 auto;
  }

  .page-indicator {
    font-size: 0.8rem;
    color: var(--fw-slate);
  }

  .result-table-wrap {
    width: 100%;
    border-radius: 12px;
    border: 1px solid rgba(var(--fw-frost-rgb), 0.9);
    background: rgba(var(--fw-ice-rgb), 0.95);
    overflow: auto;
    flex: 1 1 auto;
    max-width: 100%;
    min-width: 0;
    min-height: 0;
  }

  .result-table {
    min-width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    table-layout: fixed;
  }

  .result-table th,
  .result-table td {
    text-align: left;
    padding: 8px 10px;
    vertical-align: top;
  }

  .result-table th {
    position: sticky;
    top: 0;
    z-index: 1;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(var(--fw-slate-rgb), 0.9);
    background: #fff;
    padding-right: 18px;
  }

  .column-label {
    display: block;
  }

  .column-resizer {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    touch-action: none;
  }

  .column-resizer::after {
    content: "";
    position: absolute;
    top: 20%;
    left: 50%;
    transform: translateX(-50%);
    width: 1px;
    height: 60%;
    background: rgba(var(--fw-deep-rgb), 0.25);
  }

  .column-resizer:hover::after,
  .column-resizer.active::after {
    background: rgba(var(--fw-whale-rgb), 0.6);
  }

  .result-row {
    cursor: pointer;
  }

  .result-table tbody td {
    border-bottom: 1px solid rgba(var(--fw-deep-rgb), 0.08);
  }

  .result-table td {
    transition: background-color 0.15s ease;
  }

  .cell-content {
    display: block;
    max-width: 100%;
  }

  .cell-content.truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell-content.expand {
    white-space: normal;
    overflow: visible;
    word-break: break-word;
  }

  .result-row:hover td {
    background: var(--fw-ice);
    color: var(--fw-ink);
  }

  .console-list {
    display: grid;
    gap: 6px;
    font-family: "IBM Plex Mono", "Fira Mono", monospace;
    font-size: 0.8rem;
    color: rgba(var(--fw-slate-rgb), 0.9);
    align-content: start;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  .console-line {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(var(--fw-ice-rgb), 0.9);
    border: 1px solid rgba(var(--fw-frost-rgb), 0.9);
  }

  .console-line.error {
    border-color: rgba(var(--fw-ember-rgb), 0.35);
    color: var(--fw-ember);
  }

  .console-time {
    font-size: 0.7rem;
    color: rgba(var(--fw-slate-rgb), 0.85);
  }

  .confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 55;
    display: grid;
    place-items: center;
    background: rgba(var(--fw-ink-rgb), 0.35);
    padding: 24px;
  }

  .confirm-modal {
    width: min(520px, 92vw);
    background: #fff;
    border-radius: 18px;
    border: 1px solid rgba(var(--fw-frost-rgb), 0.9);
    box-shadow: 0 18px 36px rgba(var(--fw-ink-rgb), 0.2);
    padding: 20px 22px;
    display: grid;
    gap: 10px;
  }

  .confirm-title {
    font-weight: 600;
    color: var(--fw-deep);
  }

  .confirm-text {
    font-size: 0.85rem;
    color: var(--fw-slate);
    line-height: 1.5;
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }

  .context-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }

  .context-menu {
    position: absolute;
    min-width: 180px;
    padding: 6px;
    border-radius: 12px;
    border: 1px solid rgba(var(--fw-deep-rgb), 0.25);
    background: #fff;
    box-shadow: 0 16px 32px rgba(var(--fw-ink-rgb), 0.18);
  }

  .context-menu-item {
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border-radius: 10px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .context-menu-item:hover {
    background: var(--fw-ice);
  }

  .workspace-empty {
    margin: auto;
    max-width: 420px;
    text-align: center;
    padding: 32px;
    background: rgba(var(--fw-ice-rgb), 0.9);
    border-radius: 24px;
    border: 1px solid rgba(var(--fw-frost-rgb), 0.9);
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
    background: var(--fw-whale);
    color: #fff;
    box-shadow: 0 8px 16px rgba(var(--fw-whale-rgb), 0.2);
    transition: transform 0.15s ease, box-shadow 0.15s ease,
      background-color 0.15s ease;
  }

  .primary:hover {
    background: var(--fw-deep);
    box-shadow: 0 10px 20px rgba(var(--fw-deep-rgb), 0.25);
    transform: translateY(-1px);
  }

  .ghost {
    background: rgba(var(--fw-ice-rgb), 0.9);
    border-color: rgba(var(--fw-frost-rgb), 0.9);
    color: var(--fw-deep);
    transition: background-color 0.15s ease, transform 0.15s ease;
  }

  .ghost:hover {
    background: rgba(var(--fw-sky-rgb), 0.35);
    transform: translateY(-1px);
  }

  .status {
    font-size: 0.75rem;
    color: var(--fw-slate);
  }

  @media (max-width: 1024px) {
    .workspace-shell {
      grid-template-columns: 1fr;
    }

    .collections-panel {
      border-right: none;
      border-bottom: 1px solid rgba(var(--fw-frost-rgb), 0.9);
      height: auto;
      overflow: visible;
    }

    .collection-scroll {
      max-height: 40vh;
    }
  }
</style>
