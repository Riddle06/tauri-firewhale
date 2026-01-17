<script lang="ts">
  import { page } from "$app/stores";
  import LauncherView from "$lib/components/LauncherView.svelte";
  import WorkspaceView from "$lib/components/WorkspaceView.svelte";

  const view = $derived.by(() => $page.url.searchParams.get("view") ?? "launcher");
  const connectionId = $derived.by(() => $page.url.searchParams.get("connectionId"));
</script>

{#if view === "workspace"}
  <WorkspaceView connectionId={connectionId} />
{:else}
  <LauncherView />
{/if}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family: "Space Grotesk", "Helvetica Neue", Arial, sans-serif;
    color: #1d1a16;
    background-image:
      radial-gradient(circle at 15% 15%, #ffe2cc 0%, transparent 45%),
      radial-gradient(circle at 85% 0%, #ccefe4 0%, transparent 40%),
      linear-gradient(135deg, #f7f1e7 0%, #eef1ea 100%);
    min-height: 100vh;
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font-family: inherit;
  }
</style>
