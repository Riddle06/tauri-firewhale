<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { isTauri } from "@tauri-apps/api/core";
  import {
    WebviewWindow,
    getCurrentWebviewWindow
  } from "@tauri-apps/api/webviewWindow";
  import { open } from "@tauri-apps/plugin-dialog";
  import type { ConnectionProfile } from "$lib/models";
  import {
    connections,
    createConnection,
    initConnections,
    isReady,
    removeConnection,
    selectConnection,
    updateConnection
  } from "$lib/stores/connections";

  const colorOptions = [
    { label: "Coral", value: "#ff6b35" },
    { label: "Teal", value: "#1d7a6f" },
    { label: "Saffron", value: "#f6b042" },
    { label: "Forest", value: "#2f5233" },
    { label: "Slate", value: "#3d4a4c" },
    { label: "Brick", value: "#c44536" }
  ];

  let connectionFormOpen = $state(false);
  let editingConnectionId = $state<string | null>(null);
  let connectionName = $state("");
  let connectionProjectId = $state("");
  let connectionBadge = $state("");
  let connectionColor = $state(colorOptions[0].value);
  let serviceAccountRef = $state("");
  let formError = $state("");
  let serviceAccountError = $state("");
  let fileInput = $state<HTMLInputElement | null>(null);

  onMount(() => {
    void initConnections();
    void setLauncherTitle();
  });

  async function setLauncherTitle(): Promise<void> {
    const title = "Firewhale Launcher";
    document.title = title;
    if (isTauri()) {
      await getCurrentWebviewWindow().setTitle(title);
    }
  }

  function fileLabel(path: string): string {
    if (!path) return "Not selected";
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  }

  function isCredentialJsonFile(path: string): boolean {
    return fileLabel(path).toLowerCase().endsWith(".json");
  }

  async function pickServiceAccount(): Promise<void> {
    serviceAccountError = "";
    if (isTauri()) {
      const selected = await open({
        title: "Select credential JSON",
        multiple: false,
        directory: false,
        filters: [{ name: "Credential JSON", extensions: ["json"] }],
        fileAccessMode: "copy"
      });
      if (!selected || Array.isArray(selected)) return;
      const picked = selected.toString();
      if (!isCredentialJsonFile(picked)) {
        serviceAccountError = "Please select a .json credential file.";
        return;
      }
      serviceAccountRef = picked;
      return;
    }

    fileInput?.click();
  }

  function handleFileChange(event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    if (!isCredentialJsonFile(file.name)) {
      serviceAccountError = "Please select a .json credential file.";
      target.value = "";
      return;
    }
    serviceAccountError = "";
    serviceAccountRef = file.name;
  }

  function openCreateConnection(): void {
    editingConnectionId = null;
    connectionName = "";
    connectionProjectId = "";
    connectionBadge = "";
    connectionColor = colorOptions[0].value;
    serviceAccountRef = "";
    formError = "";
    serviceAccountError = "";
    connectionFormOpen = true;
  }

  function openEditConnection(connection: ConnectionProfile): void {
    editingConnectionId = connection.id;
    connectionName = connection.name;
    connectionProjectId = connection.projectId;
    connectionBadge = connection.ui.badgeText ?? "";
    connectionColor = connection.ui.colorTag ?? colorOptions[0].value;
    serviceAccountRef = connection.auth.encryptedPayloadRef ?? "";
    formError = "";
    serviceAccountError = "";
    connectionFormOpen = true;
  }

  function closeConnectionForm(): void {
    connectionFormOpen = false;
  }

  async function submitConnectionForm(): Promise<void> {
    formError = "";
    serviceAccountError = "";
    if (!connectionName.trim()) {
      formError = "Name is required.";
      return;
    }
    if (!connectionProjectId.trim()) {
      formError = "Project ID is required.";
      return;
    }
    if (!serviceAccountRef.trim()) {
      serviceAccountError = "Credential .json is required.";
      return;
    }
    if (!isCredentialJsonFile(serviceAccountRef)) {
      serviceAccountError = "Please select a .json credential file.";
      return;
    }

    if (editingConnectionId) {
      await updateConnection(editingConnectionId, {
        name: connectionName.trim(),
        projectId: connectionProjectId.trim(),
        auth: {
          mode: "serviceAccount",
          encryptedPayloadRef: serviceAccountRef.trim()
        },
        ui: {
          badgeText: connectionBadge.trim() || connectionName.trim(),
          colorTag: connectionColor
        }
      });
    } else {
      await createConnection({
        name: connectionName,
        projectId: connectionProjectId,
        badgeText: connectionBadge,
        colorTag: connectionColor,
        serviceAccountPath: serviceAccountRef
      });
    }

    connectionFormOpen = false;
  }

  async function handleRemoveConnection(connectionId: string): Promise<void> {
    if (confirm("Remove this connection and its workspace?")) {
      await removeConnection(connectionId);
    }
  }

  async function openWorkspace(connection: ConnectionProfile): Promise<void> {
    await selectConnection(connection.id);
    const targetUrl = `/?view=workspace&connectionId=${encodeURIComponent(
      connection.id
    )}`;

    if (!isTauri()) {
      await goto(targetUrl);
      return;
    }

    const label = `workspace-${connection.id}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }

    new WebviewWindow(label, {
      url: targetUrl,
      title: `${connection.name} - Firewhale`,
      width: 1280,
      height: 820,
      minWidth: 980,
      minHeight: 640
    });
  }
</script>

<div class="launcher">
  <header class="launcher-header">
    <div class="brand">
      <div class="brand-mark"></div>
      <div>
        <div class="brand-title">Firewhale</div>
        <div class="brand-subtitle">Choose a connection to start</div>
      </div>
    </div>
    <button class="primary" onclick={openCreateConnection}>New connection</button>
  </header>

  <div class="launcher-body">
    <section class="connection-panel">
      <div class="panel-header">
        <h2>Connections</h2>
        <span class="hint">Open a workspace window per connection.</span>
      </div>

      {#if !$isReady}
        <div class="panel-card">Loading connections...</div>
      {:else if $connections.length === 0}
        <div class="panel-card">
          <p>No connections yet.</p>
          <button class="primary" onclick={openCreateConnection}>
            Create your first connection
          </button>
        </div>
      {:else}
        <div class="connection-list">
          {#each $connections as connection (connection.id)}
            <div class="connection-card">
              <div class="connection-main">
                <div
                  class="color-dot"
                  style={`--dot-color: ${
                    connection.ui.colorTag ?? colorOptions[0].value
                  }`}
                ></div>
                <div>
                  <div class="connection-name">{connection.name}</div>
                  <div class="connection-meta">{connection.projectId}</div>
                  <div class="connection-meta small">
                    SA: {fileLabel(connection.auth.encryptedPayloadRef ?? "")}
                  </div>
                </div>
                <span class="connection-badge">
                  {connection.ui.badgeText ?? connection.name}
                </span>
              </div>
              <div class="connection-actions">
                <button class="primary" onclick={() => openWorkspace(connection)}>
                  Open
                </button>
                <button class="ghost" onclick={() => openEditConnection(connection)}>
                  Edit
                </button>
                <button
                  class="ghost danger"
                  onclick={() => handleRemoveConnection(connection.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class={`form-panel ${connectionFormOpen ? "visible" : ""}`}>
      <div class="panel-card">
        <div class="form-header">
          <h3>{editingConnectionId ? "Edit connection" : "New connection"}</h3>
          <button class="ghost" onclick={closeConnectionForm}>Close</button>
        </div>
        <label>
          Name
          <input type="text" bind:value={connectionName} placeholder="Prod" />
        </label>
        <label>
          Project ID
          <input
            type="text"
            bind:value={connectionProjectId}
            placeholder="firewhale-prod"
          />
        </label>
        <label>
          Badge text
          <input type="text" bind:value={connectionBadge} placeholder="PROD" />
        </label>
        <label>
          Color tag
          <select bind:value={connectionColor}>
            {#each colorOptions as color (color.value)}
              <option value={color.value}>{color.label}</option>
            {/each}
          </select>
        </label>
        <div class="file-row">
          <div>
            <div class="file-label">Credential</div>
            <div class="file-name">{fileLabel(serviceAccountRef)}</div>
          </div>
          <button class="ghost" onclick={pickServiceAccount}>
            Select credential JSON
          </button>
          <input
            class="hidden"
            type="file"
            accept="application/json,.json"
            bind:this={fileInput}
            onchange={handleFileChange}
          />
        </div>
        {#if formError}
          <div class="form-error">{formError}</div>
        {/if}
        {#if serviceAccountError}
          <div class="form-error">{serviceAccountError}</div>
        {/if}
        <div class="form-actions">
          <button class="ghost" onclick={closeConnectionForm}>Cancel</button>
          <button class="primary" onclick={submitConnectionForm}>
            {editingConnectionId ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </section>
  </div>
</div>

<style>
  .launcher {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 100vh;
  }

  .launcher-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 28px;
    background: rgba(255, 255, 255, 0.82);
    border-bottom: 1px solid rgba(29, 26, 22, 0.08);
    backdrop-filter: blur(12px);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .brand-mark {
    width: 44px;
    height: 44px;
    border-radius: 16px;
    background:
      url("/brand-icon.png") center / 70% no-repeat,
      linear-gradient(135deg, #ff6b35, #f6b042);
    box-shadow: 0 10px 20px rgba(255, 107, 53, 0.25);
  }

  .brand-title {
    font-size: 1.2rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .brand-subtitle {
    font-size: 0.85rem;
    color: rgba(29, 26, 22, 0.6);
  }

  .launcher-body {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 20px;
    padding: 24px;
  }

  .connection-panel,
  .form-panel {
    min-height: 0;
  }

  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .panel-header h2 {
    margin: 0;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: rgba(29, 26, 22, 0.6);
  }

  .hint {
    font-size: 0.8rem;
    color: rgba(29, 26, 22, 0.5);
  }

  .panel-card {
    padding: 18px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(29, 26, 22, 0.1);
  }

  .connection-list {
    display: grid;
    gap: 12px;
  }

  .connection-card {
    padding: 16px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(29, 26, 22, 0.1);
    display: grid;
    gap: 12px;
  }

  .connection-main {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .connection-name {
    font-weight: 600;
  }

  .connection-meta {
    font-size: 0.8rem;
    color: rgba(29, 26, 22, 0.5);
  }

  .connection-meta.small {
    font-size: 0.75rem;
  }

  .connection-badge {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid rgba(29, 26, 22, 0.12);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .connection-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .form-panel {
    opacity: 0.4;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }

  .form-panel.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .form-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  label {
    display: grid;
    gap: 6px;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(29, 26, 22, 0.6);
  }

  input,
  select {
    border-radius: 10px;
    border: 1px solid rgba(29, 26, 22, 0.15);
    padding: 8px 10px;
    font-size: 0.95rem;
    background: #fff;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    border-radius: 12px;
    border: 1px dashed rgba(29, 26, 22, 0.2);
    background: rgba(255, 255, 255, 0.6);
  }

  .file-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(29, 26, 22, 0.6);
  }

  .file-name {
    font-size: 0.9rem;
    font-weight: 600;
  }

  .hidden {
    display: none;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }

  .form-error {
    color: #b42318;
    font-size: 0.85rem;
  }

  .color-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--dot-color, #ff6b35);
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

  .ghost.danger {
    color: #b42318;
  }

  @media (max-width: 1024px) {
    .launcher-body {
      grid-template-columns: 1fr;
    }

    .form-panel {
      opacity: 1;
      pointer-events: auto;
    }
  }

  @media (max-width: 720px) {
    .launcher-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }
  }
</style>
