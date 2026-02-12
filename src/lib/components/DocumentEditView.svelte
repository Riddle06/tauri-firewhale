<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import DocumentEditor from "$lib/components/DocumentEditor.svelte";
  import { updateFirestoreDocument } from "$lib/query/firestore";
  import {
    formatDocumentJson,
    isDocumentJsonDirty,
    parseDocumentJson
  } from "$lib/utils/document-json";
  import {
    activeConnection,
    initConnections,
    selectConnection
  } from "$lib/stores/connections";

  const {
    collectionPath = "",
    documentId = "",
    payload = null
  } = $props<{
    collectionPath?: string | null;
    documentId?: string | null;
    payload?: string | null;
  }>();

  type DocumentEditPayload = {
    row: Record<string, unknown>;
    collectionPath?: string;
    id?: string;
    title?: string;
    tabId?: string;
    connectionId?: string;
    idIsSynthetic?: boolean;
  };

  type DocumentUpdatedPayload = {
    tabId: string;
    collectionPath: string;
    documentId: string;
    row: Record<string, unknown>;
  };

  const tauriEnabled = isTauri();
  const currentWindow = tauriEnabled ? getCurrentWebviewWindow() : null;

  let viewCollection = $state("");
  let viewDocumentId = $state("");
  let viewTabId = $state<string | null>(null);
  let viewConnectionId = $state<string | null>(null);
  let idIsSynthetic = $state(false);
  let documentJson = $state("");
  let initialJson = $state("");
  let documentReady = $state(false);
  let copyState = $state<"idle" | "copied" | "error">("idle");
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;
  let jsonError = $state("");
  let saveError = $state("");
  let saving = $state(false);
  let connectionsReady = $state(false);
  let unlisten: UnlistenFn | null = null;

  function buildTitle(nextCollection: string, nextId: string): string {
    const collectionLabel = nextCollection || "collection";
    const idLabel = nextId || "Document";
    return `${collectionLabel} - ${idLabel} - Edit Mode`;
  }

  function setWindowTitle(title: string): void {
    document.title = title;
    if (currentWindow) {
      void currentWindow.setTitle(title);
    }
  }

  function stripSyntheticId(
    row: Record<string, unknown>,
    synthetic: boolean
  ): Record<string, unknown> {
    if (!synthetic) return row;
    if (!Object.prototype.hasOwnProperty.call(row, "id")) return row;
    const { id: _id, ...rest } = row as Record<string, unknown> & { id?: unknown };
    return rest;
  }

  function syncConnection(): void {
    if (!connectionsReady || !viewConnectionId) return;
    void selectConnection(viewConnectionId);
  }

  function applyPayload(nextPayload: DocumentEditPayload): void {
    if (!nextPayload) return;
    if (nextPayload.collectionPath) {
      viewCollection = nextPayload.collectionPath;
    }
    if (nextPayload.id) {
      viewDocumentId = nextPayload.id;
    }
    if (nextPayload.tabId) {
      viewTabId = nextPayload.tabId;
    }
    if (nextPayload.connectionId) {
      viewConnectionId = nextPayload.connectionId;
    }
    idIsSynthetic = Boolean(nextPayload.idIsSynthetic);
    const nextTitle = nextPayload.title ?? buildTitle(viewCollection, viewDocumentId);
    setWindowTitle(nextTitle);
    const editableRow = stripSyntheticId(nextPayload.row, idIsSynthetic);
    documentJson = formatDocumentJson(editableRow);
    initialJson = documentJson;
    documentReady = true;
    jsonError = "";
    saveError = "";
    syncConnection();
  }

  function handleEditorChange(nextValue: string): void {
    documentJson = nextValue;
    const parsed = parseDocumentJson(nextValue);
    jsonError = parsed.ok ? "" : parsed.error;
  }

  function closeWindow(): void {
    if (currentWindow) {
      void currentWindow.emit("document:close", { label: currentWindow.label });
      return;
    }
    if (typeof window !== "undefined") {
      window.close();
    }
  }

  async function handleSave(): Promise<void> {
    if (saving) return;
    saveError = "";
    if (!tauriEnabled) {
      saveError = "Editing documents is only supported in the desktop app.";
      return;
    }
    if (!viewCollection || !viewDocumentId) {
      saveError = "Missing document context.";
      return;
    }
    if (!viewTabId) {
      saveError = "Missing workspace context.";
      return;
    }
    if (!$activeConnection) {
      saveError = "Connection not ready.";
      return;
    }
    const parsed = parseDocumentJson(documentJson);
    if (!parsed.ok) {
      jsonError = parsed.error;
      return;
    }
    saving = true;
    try {
      const updatedRow = await updateFirestoreDocument(
        $activeConnection,
        viewCollection,
        viewDocumentId,
        parsed.value
      );
      const updatePayload: DocumentUpdatedPayload = {
        tabId: viewTabId,
        collectionPath: viewCollection,
        documentId: viewDocumentId,
        row: updatedRow
      };
      if (currentWindow) {
        void currentWindow.emit("document:updated", updatePayload);
      } else if (typeof window !== "undefined" && window.opener) {
        window.opener.postMessage(
          { type: "document:updated", payload: updatePayload },
          "*"
        );
      }
      closeWindow();
    } catch (error) {
      saveError = error instanceof Error ? error.message : "Failed to save document.";
    } finally {
      saving = false;
    }
  }

  function handleCancel(): void {
    closeWindow();
  }

  async function copyDocument(): Promise<void> {
    if (!documentJson) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(documentJson);
      } else if (typeof document !== "undefined") {
        const textarea = document.createElement("textarea");
        textarea.value = documentJson;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      copyState = "copied";
    } catch {
      copyState = "error";
    }
    if (copyTimeout) {
      clearTimeout(copyTimeout);
    }
    copyTimeout = setTimeout(() => {
      copyState = "idle";
    }, 1500);
  }

  const isDirty = $derived.by(() => isDocumentJsonDirty(initialJson, documentJson));
  const canSave = $derived.by(
    () =>
      documentReady &&
      isDirty &&
      !jsonError &&
      !saving &&
      tauriEnabled &&
      Boolean(viewCollection) &&
      Boolean(viewDocumentId) &&
      Boolean(viewTabId) &&
      Boolean($activeConnection)
  );

  onMount(() => {
    void initConnections().then(() => {
      connectionsReady = true;
      syncConnection();
    });

    viewCollection = collectionPath ?? "";
    viewDocumentId = documentId ?? "";
    setWindowTitle(buildTitle(viewCollection, viewDocumentId));

    if (payload) {
      try {
        const parsed = JSON.parse(payload) as DocumentEditPayload;
        applyPayload(parsed);
      } catch {
        documentReady = false;
      }
    }

    if (currentWindow) {
      void currentWindow
        .listen<DocumentEditPayload>("document:edit", (event) => {
          applyPayload(event.payload);
        })
        .then((cleanup) => {
          unlisten = cleanup;
          void currentWindow.emit("document:ready", { label: currentWindow.label });
        });
    }

    return () => {
      unlisten?.();
      unlisten = null;
      if (copyTimeout) {
        clearTimeout(copyTimeout);
        copyTimeout = null;
      }
    };
  });
</script>

<div class="document-shell">
  <header class="document-header">
    <div>
      <div class="document-title">{buildTitle(viewCollection, viewDocumentId)}</div>
      <div class="document-subtitle">Edit document</div>
    </div>
  </header>
  <section class="document-body">
    {#if documentReady}
      <DocumentEditor value={documentJson} readOnly={false} onChange={handleEditorChange} />
    {:else}
      <div class="document-placeholder">Waiting for document data...</div>
    {/if}
  </section>
  <footer class="document-footer">
    <div class="document-status">
      {#if jsonError}
        <div class="status error">{jsonError}</div>
      {/if}
      {#if saveError}
        <div class="status error">{saveError}</div>
      {/if}
      {#if !tauriEnabled}
        <div class="status warning">Editing is only supported in the desktop app.</div>
      {/if}
    </div>
    <div class="document-actions">
      <button class="ghost" onclick={copyDocument} disabled={!documentReady}>
        {copyState === "copied"
          ? "Copied"
          : copyState === "error"
            ? "Copy failed"
            : "Copy"}
      </button>
      <button class="ghost" onclick={handleCancel}>Cancel</button>
      <button class="primary" onclick={handleSave} disabled={!canSave}>
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  </footer>
</div>

<style>
  .document-shell {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
    height: 100vh;
    min-height: 0;
    box-sizing: border-box;
  }

  .document-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .document-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--fw-deep);
  }

  .document-subtitle {
    font-size: 0.85rem;
    color: var(--fw-slate);
  }

  .document-body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .document-placeholder {
    width: 100%;
    border-radius: 16px;
    border: 1px dashed rgba(var(--fw-frost-rgb), 0.9);
    background: rgba(var(--fw-ice-rgb), 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fw-slate);
    font-size: 0.9rem;
  }

  .document-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .document-status {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.8rem;
  }

  .status {
    padding: 6px 10px;
    border-radius: 10px;
    background: rgba(var(--fw-whale-rgb), 0.12);
    color: var(--fw-deep);
  }

  .status.error {
    background: rgba(var(--fw-ember-rgb), 0.12);
    color: var(--fw-ember);
  }

  .status.warning {
    background: rgba(var(--fw-flame-light-rgb), 0.25);
    color: var(--fw-flame);
  }

  .document-actions {
    display: flex;
    gap: 12px;
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
</style>
