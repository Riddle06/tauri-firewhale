<script lang="ts">
  import { onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, lineNumbers } from "@codemirror/view";
  import { json } from "@codemirror/lang-json";
  import { vscodeDark } from "@uiw/codemirror-theme-vscode";

  const { value = "", readOnly = true, onChange = () => {} } = $props<{
    value?: string;
    readOnly?: boolean;
    onChange?: (nextValue: string) => void;
  }>();

  let editorRoot: HTMLDivElement | null = null;
  let view: EditorView | null = null;
  let isUpdating = false;

  onMount(() => {
    if (!editorRoot) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        json(),
        vscodeDark,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || !view) return;
          if (isUpdating) return;
          onChange(update.state.doc.toString());
        })
      ]
    });
    view = new EditorView({ state, parent: editorRoot });
    return () => {
      view?.destroy();
      view = null;
    };
  });

  $effect(() => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    isUpdating = true;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    });
    isUpdating = false;
  });
</script>

<div class="editor" bind:this={editorRoot}></div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: #1e1e1e;
    overflow: hidden;
    display: flex;
  }

  .editor :global(.cm-editor) {
    flex: 1;
    height: 100%;
  }

  .editor :global(.cm-scroller) {
    height: 100%;
    overflow: auto;
    font-family: "IBM Plex Mono", "Fira Mono", monospace;
    font-size: 0.9rem;
  }

  .editor :global(.cm-content) {
    padding: 12px;
  }

  .editor :global(.cm-gutters) {
    background: #1a1a1a;
    color: rgba(255, 255, 255, 0.55);
    border-right: 1px solid rgba(255, 255, 255, 0.08);
  }

  .editor :global(.cm-lineNumbers .cm-gutterElement) {
    padding: 0 10px 0 8px;
  }

  .editor :global(.cm-activeLineGutter) {
    background: rgba(255, 255, 255, 0.08);
  }
</style>
