<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { isTauri } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import DocumentEditView from "$lib/components/DocumentEditView.svelte";
  import DocumentView from "$lib/components/DocumentView.svelte";
  import LauncherView from "$lib/components/LauncherView.svelte";
  import WorkspaceView from "$lib/components/WorkspaceView.svelte";
  import {
    fetchLatestStableRelease,
    isVersionNewer
  } from "$lib/update/releases";
  import {
    getLocalDateKey,
    markUpdatePromptShown,
    readUpdatePromptState,
    shouldShowUpdatePrompt,
    skipUpdateVersion
  } from "$lib/update/prompt-state";

  type UpdatePrompt = {
    currentVersion: string;
    latestVersion: string;
    releaseTitle: string;
    releaseUrl: string;
  };

  const GITHUB_OWNER = "Riddle06";
  const GITHUB_REPO = "tauri-firewhale";
  const RELEASE_LATEST_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

  const view = $derived.by(() => $page.url.searchParams.get("view") ?? "launcher");
  const connectionId = $derived.by(() => $page.url.searchParams.get("connectionId"));
  const collectionPath = $derived.by(() => $page.url.searchParams.get("collection"));
  const documentId = $derived.by(() => $page.url.searchParams.get("id"));
  const payload = $derived.by(() => $page.url.searchParams.get("payload"));

  let updatePrompt = $state<UpdatePrompt | null>(null);
  let openingReleasePage = $state(false);

  onMount(() => {
    void checkForUpdatesOnStartup();
  });

  async function checkForUpdatesOnStartup(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    try {
      const currentVersion = await getVersion();
      const latestRelease = await fetchLatestStableRelease(
        GITHUB_OWNER,
        GITHUB_REPO
      );

      if (!latestRelease) {
        return;
      }
      if (!isVersionNewer(latestRelease.version, currentVersion)) {
        return;
      }

      const storage = window.localStorage;
      const promptState = readUpdatePromptState(storage);
      const todayKey = getLocalDateKey();
      if (!shouldShowUpdatePrompt(promptState, latestRelease.version, todayKey)) {
        return;
      }

      markUpdatePromptShown(storage, todayKey);
      updatePrompt = {
        currentVersion,
        latestVersion: latestRelease.version,
        releaseTitle: latestRelease.title,
        releaseUrl: RELEASE_LATEST_URL
      };
    } catch (error) {
      console.warn("Failed to check for updates.", error);
    }
  }

  function remindTomorrow(): void {
    updatePrompt = null;
  }

  function skipThisVersion(): void {
    if (!updatePrompt) {
      return;
    }

    skipUpdateVersion(window.localStorage, updatePrompt.latestVersion);
    updatePrompt = null;
  }

  async function openLatestReleasePage(): Promise<void> {
    if (!updatePrompt || openingReleasePage) {
      return;
    }

    openingReleasePage = true;
    try {
      if (isTauri()) {
        await openUrl(updatePrompt.releaseUrl);
      } else {
        window.open(updatePrompt.releaseUrl, "_blank", "noopener,noreferrer");
      }
      updatePrompt = null;
    } catch (error) {
      console.warn("Failed to open release page.", error);
    } finally {
      openingReleasePage = false;
    }
  }
</script>

{#if view === "document"}
  <DocumentView
    collectionPath={collectionPath}
    documentId={documentId}
    payload={payload}
  />
{:else if view === "document-edit"}
  <DocumentEditView
    collectionPath={collectionPath}
    documentId={documentId}
    payload={payload}
  />
{:else if view === "workspace"}
  <WorkspaceView connectionId={connectionId} />
{:else}
  <LauncherView />
{/if}

{#if updatePrompt}
  <div class="update-backdrop">
    <div
      class="update-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-dialog-title"
    >
      <h2 id="update-dialog-title">Update available</h2>
      <p class="update-body">
        You are running <strong>v{updatePrompt.currentVersion}</strong>. A newer
        version <strong>v{updatePrompt.latestVersion}</strong> is available.
      </p>
      <p class="update-meta">{updatePrompt.releaseTitle}</p>
      <div class="update-actions">
        <button class="update-ghost" onclick={skipThisVersion}>
          Skip this version
        </button>
        <button class="update-ghost" onclick={remindTomorrow}>
          Remind me tomorrow
        </button>
        <button
          class="update-primary"
          disabled={openingReleasePage}
          onclick={openLatestReleasePage}
        >
          {openingReleasePage ? "Opening..." : "Open latest release"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(:root) {
    --fw-whale: #28b6f6;
    --fw-whale-rgb: 40 182 246;
    --fw-deep: #0b5a80;
    --fw-deep-rgb: 11 90 128;
    --fw-sky: #9adfff;
    --fw-sky-rgb: 154 223 255;
    --fw-ice: #e6f7ff;
    --fw-ice-rgb: 230 247 255;
    --fw-flame: #f46a2a;
    --fw-flame-rgb: 244 106 42;
    --fw-flame-light: #ffc84a;
    --fw-flame-light-rgb: 255 200 74;
    --fw-ember: #d94a2a;
    --fw-ember-rgb: 217 74 42;
    --fw-ink: #10222d;
    --fw-ink-rgb: 16 34 45;
    --fw-slate: #4b5b66;
    --fw-slate-rgb: 75 91 102;
    --fw-mist: #f5fafd;
    --fw-frost: #d7e8f2;
    --fw-frost-rgb: 215 232 242;
    --fw-flame-gradient: linear-gradient(135deg, #f46a2a 0%, #ffc84a 100%);
    --fw-ocean-gradient: linear-gradient(135deg, #28b6f6 0%, #9adfff 100%);
    --fw-mist-gradient: linear-gradient(180deg, #f5fafd 0%, #e6f7ff 100%);
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family: "Space Grotesk", "Helvetica Neue", Arial, sans-serif;
    color: var(--fw-ink);
    background:
      radial-gradient(
        circle at 12% 12%,
        rgba(var(--fw-sky-rgb), 0.35) 0%,
        transparent 45%
      ),
      radial-gradient(
        circle at 88% 0%,
        rgba(var(--fw-flame-light-rgb), 0.25) 0%,
        transparent 40%
      ),
      var(--fw-mist-gradient);
    background-color: var(--fw-mist);
    min-height: 100vh;
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font-family: inherit;
  }

  .update-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(var(--fw-ink-rgb), 0.28);
    backdrop-filter: blur(8px);
  }

  .update-dialog {
    width: min(540px, 100%);
    padding: 24px;
    border-radius: 20px;
    border: 1px solid rgba(var(--fw-frost-rgb), 0.95);
    background:
      linear-gradient(
        180deg,
        rgba(var(--fw-ice-rgb), 0.98) 0%,
        rgba(var(--fw-ice-rgb), 0.92) 100%
      );
    box-shadow:
      0 18px 40px rgba(var(--fw-ink-rgb), 0.18),
      inset 0 1px 0 rgba(255, 255, 255, 0.65);
  }

  .update-dialog h2 {
    margin: 0;
    color: var(--fw-deep);
    font-size: 1.2rem;
    letter-spacing: 0.01em;
  }

  .update-body {
    margin: 12px 0 0;
    color: var(--fw-ink);
    line-height: 1.6;
  }

  .update-meta {
    margin: 8px 0 0;
    color: rgba(var(--fw-slate-rgb), 0.9);
    font-size: 0.85rem;
  }

  .update-actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }

  .update-primary,
  .update-ghost {
    border-radius: 999px;
    border: 1px solid transparent;
    padding: 8px 14px;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .update-primary {
    background: var(--fw-whale);
    color: #fff;
    box-shadow: 0 8px 16px rgba(var(--fw-whale-rgb), 0.22);
    transition: transform 0.15s ease, box-shadow 0.15s ease,
      background-color 0.15s ease;
  }

  .update-primary:hover:not(:disabled) {
    background: var(--fw-deep);
    box-shadow: 0 10px 20px rgba(var(--fw-deep-rgb), 0.25);
    transform: translateY(-1px);
  }

  .update-primary:disabled {
    opacity: 0.65;
    cursor: default;
  }

  .update-ghost {
    background: rgba(var(--fw-ice-rgb), 0.95);
    border-color: rgba(var(--fw-frost-rgb), 0.95);
    color: var(--fw-deep);
    transition: background-color 0.15s ease, transform 0.15s ease;
  }

  .update-ghost:hover {
    background: rgba(var(--fw-sky-rgb), 0.35);
    transform: translateY(-1px);
  }

  @media (max-width: 720px) {
    .update-dialog {
      padding: 20px;
    }

    .update-actions {
      justify-content: stretch;
    }

    .update-primary,
    .update-ghost {
      width: 100%;
    }
  }
</style>
