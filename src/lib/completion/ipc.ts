import { getCompletionResult } from "./engine";
import type {
  CompletionRequest,
  CompletionResultData,
  CompletionWorkerMessage,
  CompletionWorkerResponse
} from "./types";

export type CompletionClient = {
  request: (
    request: CompletionRequest,
    signal: AbortSignal
  ) => Promise<CompletionResultData | null>;
  dispose: () => void;
};

function createLocalClient(): CompletionClient {
  return {
    async request(request, signal) {
      if (signal.aborted) return null;
      const result = getCompletionResult(request);
      return signal.aborted ? null : result;
    },
    dispose() {}
  };
}

export function createCompletionClient(): CompletionClient {
  if (typeof Worker === "undefined") {
    return createLocalClient();
  }

  const worker = new Worker(new URL("./completion.worker.ts", import.meta.url), {
    type: "module"
  });
  let nextId = 1;
  const pending = new Map<number, (result: CompletionResultData | null) => void>();

  worker.addEventListener("message", (event: MessageEvent<CompletionWorkerResponse>) => {
    const response = event.data;
    const resolve = pending.get(response.id);
    if (!resolve) return;
    pending.delete(response.id);
    resolve(response.result ?? null);
  });

  return {
    request(request, signal) {
      if (signal.aborted) return Promise.resolve(null);

      const id = nextId;
      nextId += 1;

      return new Promise((resolve) => {
        pending.set(id, resolve);
        const message: CompletionWorkerMessage = {
          type: "complete",
          id,
          request
        };
        worker.postMessage(message);

        const abort = () => {
          if (!pending.has(id)) return;
          pending.delete(id);
          const abortMessage: CompletionWorkerMessage = { type: "abort", id };
          worker.postMessage(abortMessage);
          resolve(null);
        };

        signal.addEventListener("abort", abort, { once: true });
      });
    },
    dispose() {
      pending.clear();
      worker.terminate();
    }
  };
}
