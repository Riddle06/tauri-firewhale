<script lang="ts">
  import { page } from "$app/stores";
  import LauncherView from "$lib/components/LauncherView.svelte";
  import WorkspaceView from "$lib/components/WorkspaceView.svelte";
  import DocumentView from "$lib/components/DocumentView.svelte";
  import DocumentEditView from "$lib/components/DocumentEditView.svelte";

  const view = $derived.by(() => $page.url.searchParams.get("view") ?? "launcher");
  const connectionId = $derived.by(() => $page.url.searchParams.get("connectionId"));
  const collectionPath = $derived.by(() => $page.url.searchParams.get("collection"));
  const documentId = $derived.by(() => $page.url.searchParams.get("id"));
  const payload = $derived.by(() => $page.url.searchParams.get("payload"));
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
</style>
