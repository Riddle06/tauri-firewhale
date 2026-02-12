<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import DocumentEditor from "$lib/components/DocumentEditor.svelte";
  import { formatJson } from "$lib/utils/json-highlight";

  const {
    collectionPath = "",
    documentId = "",
    payload = null
  } = $props<{
    collectionPath?: string | null;
    documentId?: string | null;
    payload?: string | null;
  }>();

  type DocumentViewPayload = {
    row: Record<string, unknown>;
    collectionPath?: string;
    id?: string;
    title?: string;
  };

  let viewCollection = $state("");
  let viewDocumentId = $state("");
  let documentJson = $state("");
  let documentReady = $state(false);
  let unlisten: UnlistenFn | null = null;
  let copyState = $state<"idle" | "copied" | "error">("idle");
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;
  const currentWindow = isTauri() ? getCurrentWebviewWindow() : null;

  function buildTitle(nextCollection: string, nextId: string): string {
    const collectionLabel = nextCollection || "collection";
    const idLabel = nextId || "Document";
    return `${collectionLabel} - ${idLabel} - View Mode`;
  }

  function setWindowTitle(title: string): void {
    document.title = title;
    if (currentWindow) {
      void currentWindow.setTitle(title);
    }
  }

  function applyPayload(nextPayload: DocumentViewPayload): void {
    if (!nextPayload) return;
    if (nextPayload.collectionPath) {
      viewCollection = nextPayload.collectionPath;
    }
    if (nextPayload.id) {
      viewDocumentId = nextPayload.id;
    }
    const nextTitle = nextPayload.title ?? buildTitle(viewCollection, viewDocumentId);
    setWindowTitle(nextTitle);
    documentJson = formatJson(nextPayload.row);
    documentReady = true;
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

  onMount(() => {
    viewCollection = collectionPath ?? "";
    viewDocumentId = documentId ?? "";
    setWindowTitle(buildTitle(viewCollection, viewDocumentId));

    if (payload) {
      try {
        const parsed = JSON.parse(payload) as DocumentViewPayload;
        applyPayload(parsed);
      } catch {
        documentReady = false;
      }
    }

    if (currentWindow) {
      void currentWindow
        .listen<DocumentViewPayload>("document:view", (event) => {
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
    </div>
  </header>
  <section class="document-body">
    {#if documentReady}
      <DocumentEditor value={documentJson} readOnly={true} />
    {:else}
      <div class="document-placeholder">Waiting for document data...</div>
    {/if}
  </section>
  <footer class="document-footer">
    <div class="document-actions">
      <button class="ghost" onclick={copyDocument} disabled={!documentReady}>
        {copyState === "copied"
          ? "Copied"
          : copyState === "error"
            ? "Copy failed"
            : "Copy"}
      </button>
      <button class="ghost" onclick={closeWindow}>Close</button>
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


  .document-body {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .document-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .document-actions {
    display: flex;
    gap: 12px;
  }

  .ghost {
    border-radius: 999px;
    border: 1px solid transparent;
    padding: 8px 14px;
    font-size: 0.85rem;
    cursor: pointer;
    background: rgba(var(--fw-ice-rgb), 0.9);
    border-color: rgba(var(--fw-frost-rgb), 0.9);
    color: var(--fw-deep);
    transition: background-color 0.15s ease, transform 0.15s ease;
  }

  .ghost:hover {
    background: rgba(var(--fw-sky-rgb), 0.35);
    transform: translateY(-1px);
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
</style>
