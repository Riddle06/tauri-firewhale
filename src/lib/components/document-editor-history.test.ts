import { EditorState } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { describe, expect, test } from "bun:test";
import { documentEditorHistory } from "./document-editor-history";

describe("documentEditorHistory", () => {
  test("restores document edits through CodeMirror history", () => {
    const original = '{\n  "name": "Firewhale"\n}';
    const changed = '{\n  "name": "Firewhale Desktop"\n}';
    let state = EditorState.create({
      doc: original,
      extensions: documentEditorHistory
    });
    state = state.update({
      changes: { from: original.lastIndexOf("\""), insert: " Desktop" }
    }).state;

    let restored = state;
    const handled = undo({
      state,
      dispatch: (transaction) => {
        restored = transaction.state;
      }
    });

    expect(handled).toBe(true);
    expect(state.doc.toString()).toBe(changed);
    expect(restored.doc.toString()).toBe(original);
  });
});
