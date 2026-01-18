<script lang="ts">
  import { onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap, lineNumbers } from "@codemirror/view";
  import {
    autocompletion,
    snippetCompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult
  } from "@codemirror/autocomplete";
  import { vscodeDark } from "@uiw/codemirror-theme-vscode";
  import { javascript } from "@codemirror/lang-javascript";
  import { normalizeCollectionPath } from "$lib/utils/state";

  type FieldStatsMap = Record<string, Record<string, number>>;

  const {
    value = "",
    collections = [],
    fieldStats = {},
    collectionPath = "",
    onChange = () => {},
    onFormat = () => {},
    onRun = () => {}
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

  const baseCompletions: Completion[] = [
    { label: "db", type: "variable" },
    { label: "collection", type: "function" },
    { label: "where", type: "function" },
    { label: "orderBy", type: "function" },
    { label: "limit", type: "function" },
    { label: "get", type: "function" },
    { label: "asc", type: "constant" },
    { label: "desc", type: "constant" },
    snippetCompletion("db.collection('${collection}')", {
      label: "collection chain",
      detail: "collection()"
    }),
    snippetCompletion(".where('${field}', '==', ${value})", {
      label: "where",
      detail: "where()"
    }),
    snippetCompletion(".orderBy('${field}', 'asc')", {
      label: "orderBy",
      detail: "orderBy()"
    }),
    snippetCompletion(".limit(50)", {
      label: "limit",
      detail: "limit()"
    }),
    snippetCompletion(".get()", {
      label: "get",
      detail: "get()"
    })
  ];

  const dbMemberCompletions: Completion[] = [
    snippetCompletion("collection('${collection}')", {
      label: "collection",
      detail: "collection()"
    })
  ];

  const chainMemberCompletions: Completion[] = [
    snippetCompletion("where('${field}', '==', ${value})", {
      label: "where",
      detail: "where()"
    }),
    snippetCompletion("orderBy('${field}', 'asc')", {
      label: "orderBy",
      detail: "orderBy()"
    }),
    snippetCompletion("limit(50)", {
      label: "limit",
      detail: "limit()"
    }),
    snippetCompletion("get()", {
      label: "get",
      detail: "get()"
    })
  ];

  const editorKeymap = keymap.of([
    {
      key: "Tab",
      run: (view) => {
        view.dispatch(view.state.replaceSelection("  "));
        return true;
      }
    },
    {
      key: "Mod-Shift-f",
      run: () => {
        onFormat();
        return true;
      }
    },
    {
      key: "Shift-Alt-f",
      run: () => {
        onFormat();
        return true;
      }
    },
    {
      key: "Mod-Enter",
      run: () => {
        onRun();
        return true;
      }
    }
  ]);

  function resolveCollectionFromText(text: string): string {
    const match = /\bcollection\s*\(\s*['"]([^'"]+)['"]/.exec(text);
    if (match?.[1]) return normalizeCollectionPath(match[1]);
    return normalizeCollectionPath(collectionPath);
  }

  function isInsideString(text: string): boolean {
    let inString: "'" | "\"" | null = null;
    let escaped = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === inString) {
          inString = null;
        }
        continue;
      }
      if (char === "'" || char === "\"") {
        inString = char;
      }
    }

    return inString !== null;
  }

  function dotCompletion(context: CompletionContext): CompletionResult | null {
    const before = context.state.sliceDoc(0, context.pos);
    const match = /\.(\w*)$/.exec(before);
    if (!match) return null;
    const beforeDot = before.slice(0, match.index);
    if (isInsideString(beforeDot)) return null;

    if (/\bdb\s*$/.test(beforeDot)) {
      return {
        from: context.pos - match[1].length,
        options: dbMemberCompletions,
        validFor: /\w*/
      };
    }

    if (/\bcollection\s*\(/.test(beforeDot)) {
      return {
        from: context.pos - match[1].length,
        options: chainMemberCompletions,
        validFor: /\w*/
      };
    }

    return null;
  }

  function buildCollectionOptions(): Completion[] {
    const unique = Array.from(new Set(collections));
    return unique.map((entry) => ({
      label: entry,
      type: "property"
    }));
  }

  function buildFieldOptions(activeCollection: string): Completion[] {
    if (!activeCollection) return [];
    const stats = fieldStats[activeCollection] ?? {};
    const entries = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    return entries.map(([field]) => ({
      label: field,
      type: "property"
    }));
  }

  function collectionCompletion(
    context: CompletionContext,
    before: string
  ): CompletionResult | null {
    const match = /\bcollection\s*\(\s*['"]([^'"]*)$/.exec(before);
    if (!match) return null;
    const from = context.pos - match[1].length;
    return {
      from,
      options: buildCollectionOptions(),
      validFor: /[\w/.-]*/
    };
  }

  function fieldCompletion(
    context: CompletionContext,
    before: string
  ): CompletionResult | null {
    const match = /\b(where|orderBy)\s*\(\s*['"]([^'"]*)$/.exec(before);
    if (!match) return null;
    const from = context.pos - match[2].length;
    const activeCollection = resolveCollectionFromText(before);
    const options = buildFieldOptions(activeCollection);
    if (options.length === 0) return null;
    return {
      from,
      options,
      validFor: /[\w.]*/
    };
  }

  function keywordCompletion(context: CompletionContext): CompletionResult | null {
    const word = context.matchBefore(/[\w.]+/);
    if (!word || (word.from === word.to && !context.explicit)) {
      return null;
    }
    return {
      from: word.from,
      options: baseCompletions,
      validFor: /[\w.]*/
    };
  }

  function completionSource(context: CompletionContext): CompletionResult | null {
    const before = context.state.sliceDoc(0, context.pos);
    return (
      dotCompletion(context) ??
      collectionCompletion(context, before) ??
      fieldCompletion(context, before) ??
      keywordCompletion(context)
    );
  }

  onMount(() => {
    if (!editorRoot) return;
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
        autocompletion({ override: [completionSource] })
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
