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

  let viewCollection = $state(collectionPath ?? "");
  let viewDocumentId = $state(documentId ?? "");
  let viewTabId = $state<string | null>(null);
  let viewConnectionId = $state<string | null>(null);
  let idIsSynthetic = $state(false);
  let documentJson = $state("");
  let initialJson = $state("");
  let documentReady = $state(false);
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
      void currentWindow.close();
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
  }

  .document-subtitle {
    font-size: 0.85rem;
    color: rgba(29, 26, 22, 0.6);
  }

  .document-body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .document-placeholder {
    width: 100%;
    border-radius: 16px;
    border: 1px dashed rgba(29, 26, 22, 0.2);
    background: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(29, 26, 22, 0.55);
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
    background: rgba(29, 122, 111, 0.1);
    color: #1d5c55;
  }

  .status.error {
    background: rgba(180, 35, 24, 0.12);
    color: #b42318;
  }

  .status.warning {
    background: rgba(217, 119, 6, 0.12);
    color: #a25405;
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
    background: #1d7a6f;
    color: #fff;
  }

  .ghost {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba(29, 26, 22, 0.12);
  }
</style>
