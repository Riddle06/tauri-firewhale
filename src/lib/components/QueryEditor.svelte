<script lang="ts">
  import { onMount } from "svelte";
  import { EditorState } from "@codemirror/state";
  import { EditorView, placeholder } from "@codemirror/view";
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
    onChange = () => {}
  } = $props<{
    value?: string;
    collections?: string[];
    fieldStats?: FieldStatsMap;
    collectionPath?: string;
    onChange?: (nextValue: string) => void;
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

  const placeholderText =
    "db.collection('users')\n  .where('age', '>', 18)\n  .where('status', '==', 'active')\n  .orderBy('createdAt', 'desc')\n  .limit(50)\n  .get()";

  function resolveCollectionFromText(text: string): string {
    const match = /\bcollection\s*\(\s*['"]([^'"]+)['"]/.exec(text);
    if (match?.[1]) return normalizeCollectionPath(match[1]);
    return normalizeCollectionPath(collectionPath);
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
        javascript(),
        vscodeDark,
        placeholder(placeholderText),
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
