<script lang="ts">
  import { onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers } from "@codemirror/view";
  import { codeFolding, foldGutter, foldKeymap } from "@codemirror/language";
  import { json } from "@codemirror/lang-json";
  import {
    highlightSelectionMatches,
    openSearchPanel,
    searchKeymap
  } from "@codemirror/search";
  import { vscodeDark } from "@uiw/codemirror-theme-vscode";

  const { value = "", readOnly = true, onChange = () => {} } = $props<{
    value?: string;
    readOnly?: boolean;
    onChange?: (nextValue: string) => void;
  }>();

  let editorRoot: HTMLDivElement | null = null;
  let view: EditorView | null = null;
  let isUpdating = false;
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  let searchObserver: MutationObserver | null = null;

  onMount(() => {
    if (!editorRoot) return;
    const state = EditorState.create({
      doc: value,
      extensions: [
        foldGutter(),
        lineNumbers(),
        codeFolding(),
        json(),
        vscodeDark,
        highlightSelectionMatches(),
        keymap.of([...foldKeymap, ...searchKeymap]),
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

    const applySearchInputConfig = () => {
      if (!view) return;
      const inputs = view.dom.querySelectorAll(".cm-search input");
      if (!inputs.length) return;
      inputs.forEach((node) => {
        if (!(node instanceof HTMLInputElement)) return;
        if (node.dataset.fwSearchConfigured === "true") return;
        node.setAttribute("autocapitalize", "off");
        node.setAttribute("autocorrect", "off");
        node.setAttribute("spellcheck", "false");
        node.setAttribute("autocomplete", "off");
        node.style.textTransform = "none";
        node.dataset.fwSearchConfigured = "true";
      });
    };

    if (typeof window !== "undefined") {
      keydownHandler = (event: KeyboardEvent) => {
        if (!view) return;
        if (event.defaultPrevented) return;
        const isModF = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f";
        if (!isModF) return;
        event.preventDefault();
        openSearchPanel(view);
        view.focus();
        requestAnimationFrame(applySearchInputConfig);
      };
      window.addEventListener("keydown", keydownHandler, true);
    }

    if (typeof MutationObserver !== "undefined") {
      searchObserver = new MutationObserver(applySearchInputConfig);
      searchObserver.observe(view.dom, { childList: true, subtree: true });
    }

    return () => {
      if (keydownHandler && typeof window !== "undefined") {
        window.removeEventListener("keydown", keydownHandler, true);
      }
      keydownHandler = null;
      searchObserver?.disconnect();
      searchObserver = null;
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
    border: 1px solid rgba(var(--fw-deep-rgb), 0.35);
    background: var(--fw-ink);
    overflow: hidden;
    display: flex;
  }

  .editor :global(.cm-editor) {
    flex: 1;
    height: 100%;
    background-color: var(--fw-ink);
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
    background: rgba(var(--fw-deep-rgb), 0.7);
    color: rgba(var(--fw-ice-rgb), 0.7);
    border-right: 1px solid rgba(var(--fw-deep-rgb), 0.5);
  }

  .editor :global(.cm-lineNumbers .cm-gutterElement) {
    padding: 0 10px 0 8px;
  }

  .editor :global(.cm-foldGutter .cm-gutterElement) {
    cursor: pointer;
    color: rgba(var(--fw-ice-rgb), 0.7);
  }

  .editor :global(.cm-foldPlaceholder) {
    background: rgba(var(--fw-whale-rgb), 0.35);
    border: 1px solid rgba(var(--fw-ice-rgb), 0.2);
    color: rgba(var(--fw-ice-rgb), 0.9);
  }

  .editor :global(.cm-activeLineGutter) {
    background: rgba(var(--fw-whale-rgb), 0.2);
  }
</style>
