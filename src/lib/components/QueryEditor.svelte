<script lang="ts">
  import { onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers } from "@codemirror/view";
  import {
    autocompletion,
    snippetCompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
  } from "@codemirror/autocomplete";
  import { vscodeDark } from "@uiw/codemirror-theme-vscode";
  import { javascript } from "@codemirror/lang-javascript";
  import { createCompletionClient } from "$lib/completion/ipc";
  import type {
    CompletionOptionData,
    CompletionRequest,
    CompletionResultData,
    FieldStatsMap
  } from "$lib/completion/types";

  const {
    value = "",
    collections = [] as string[],
    fieldStats = {} as FieldStatsMap,
    collectionPath = "",
    onChange = () => {},
    onFormat = () => {},
    onRun = () => {},
  } = $props<{
    value?: string;
    collections?: string[];
    fieldStats?: FieldStatsMap;
    collectionPath?: string;
    onChange?: (nextValue: string) => void;
    onFormat?: () => void;
    onRun?: () => void;
  }>();

  let editorRoot: HTMLDivElement | null = null;
  let view: EditorView | null = null;
  let isUpdating = false;
  let completionClient: ReturnType<typeof createCompletionClient> | null = null;
  let activeCompletionAbort: AbortController | null = null;

  const editorKeymap = keymap.of([
    {
      key: "Tab",
      run: (view) => {
        view.dispatch(view.state.replaceSelection("  "));
        return true;
      },
    },
    {
      key: "Mod-Shift-f",
      run: () => {
        onFormat();
        return true;
      },
    },
    {
      key: "Shift-Alt-f",
      run: () => {
        onFormat();
        return true;
      },
    },
    {
      key: "Mod-Enter",
      run: () => {
        onRun();
        return true;
      },
    },
  ]);

  function mapCompletionOptions(options: CompletionOptionData[]): Completion[] {
    return options.map((option) => {
      if (option.snippet) {
        return snippetCompletion(option.snippet, {
          label: option.label,
          detail: option.detail,
          type: option.type,
        });
      }
      return {
        label: option.label,
        detail: option.detail,
        type: option.type,
      };
    });
  }

  function mapCompletionResult(
    result: CompletionResultData,
  ): CompletionResult {
    return {
      from: result.from,
      options: mapCompletionOptions(result.options),
      validFor: result.validFor ? new RegExp(result.validFor) : undefined,
    };
  }

  function completionSource(
    context: CompletionContext,
  ): CompletionResult | null | Promise<CompletionResult | null> {
    if (!completionClient) return null;

    activeCompletionAbort?.abort();
    const controller = new AbortController();
    activeCompletionAbort = controller;

    context.addEventListener(
      "abort",
      () => controller.abort(),
      { onDocChange: true },
    );

    const request: CompletionRequest = {
      doc: context.state.doc.toString(),
      pos: context.pos,
      explicit: context.explicit,
      collections,
      fieldStats,
      collectionPath,
    };

    return completionClient
      .request(request, controller.signal)
      .then((result) => {
        if (!result || controller.signal.aborted || context.aborted) return null;
        return mapCompletionResult(result);
      });
  }

  onMount(() => {
    if (!editorRoot) return;
    completionClient = createCompletionClient();
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        javascript(),
        vscodeDark,
        editorKeymap,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || !view) return;
          if (isUpdating) return;
          const nextValue = update.state.doc.toString();
          onChange(nextValue);
        }),
        autocompletion({ override: [completionSource] }),
      ],
    });
    view = new EditorView({ state, parent: editorRoot });
    return () => {
      activeCompletionAbort?.abort();
      activeCompletionAbort = null;
      completionClient?.dispose();
      completionClient = null;
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
      changes: { from: 0, to: current.length, insert: value },
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

  .editor :global(.cm-activeLineGutter) {
    background: rgba(var(--fw-whale-rgb), 0.2);
  }
</style>
