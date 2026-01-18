/// <reference lib="webworker" />

import { getCompletionResult } from "./engine";
import type { CompletionWorkerMessage, CompletionWorkerResponse } from "./types";

const aborted = new Set<number>();

self.addEventListener("message", (event: MessageEvent<CompletionWorkerMessage>) => {
  const message = event.data;
  if (message.type === "abort") {
    aborted.add(message.id);
    return;
  }

  if (message.type !== "complete") return;

  const result = getCompletionResult(message.request);
  if (aborted.has(message.id)) {
    aborted.delete(message.id);
    return;
  }

  const response: CompletionWorkerResponse = {
    id: message.id,
    result
  };
  self.postMessage(response);
});

export {};
