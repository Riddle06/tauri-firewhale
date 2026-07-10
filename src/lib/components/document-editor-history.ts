import { history, historyKeymap } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

export const documentEditorHistory = [history(), keymap.of(historyKeymap)];
