import { derived, get, writable } from "svelte/store";
import type { ConnectionProfile } from "$lib/models";
import { loadAppState, loadConnections, removeConnectionStorage, saveAppState, saveConnections } from "$lib/storage/storage";
import { createId } from "$lib/utils/state";

const connections = writable<ConnectionProfile[]>([]);
const activeConnectionId = writable<string | null>(null);
const openConnectionIds = writable<string[]>([]);
const isReady = writable(false);

const activeConnection = derived(
  [connections, activeConnectionId],
  ([$connections, $activeId]) =>
    $connections.find((connection) => connection.id === $activeId) ?? null
);

async function persistAppState(): Promise<void> {
  await saveAppState({
    activeConnectionId: get(activeConnectionId),
    openConnectionIds: get(openConnectionIds)
  });
}

export async function initConnections(): Promise<void> {
  const [connectionsData, appState] = await Promise.all([
    loadConnections(),
    loadAppState()
  ]);

  connections.set(connectionsData);
  let nextOpenIds = appState.openConnectionIds ?? [];

  let nextActive = appState.activeConnectionId;
  if (!nextActive && connectionsData.length > 0) {
    nextActive = connectionsData[0].id;
  }
  if (nextActive && !nextOpenIds.includes(nextActive)) {
    nextOpenIds = [...nextOpenIds, nextActive];
  }
  openConnectionIds.set(nextOpenIds);
  activeConnectionId.set(nextActive ?? null);

  await persistAppState();
  isReady.set(true);
}

export async function createConnection(input: {
  name: string;
  projectId: string;
  badgeText?: string;
  colorTag?: string;
  serviceAccountPath: string;
}): Promise<ConnectionProfile> {
  const connection: ConnectionProfile = {
    id: createId(),
    name: input.name.trim(),
    projectId: input.projectId.trim(),
    kind: "firestore",
    auth: {
      mode: "serviceAccount",
      encryptedPayloadRef: input.serviceAccountPath.trim()
    },
    ui: {
      colorTag: input.colorTag,
      badgeText: input.badgeText?.trim() || input.name.trim()
    },
    lastOpenedAt: Date.now()
  };

  const nextConnections = [...get(connections), connection];
  connections.set(nextConnections);
  await saveConnections(nextConnections);
  await selectConnection(connection.id);

  return connection;
}

export async function updateConnection(
  connectionId: string,
  patch: Partial<ConnectionProfile>
): Promise<void> {
  const nextConnections = get(connections).map((connection) =>
    connection.id === connectionId
      ? {
          ...connection,
          ...patch,
          ui: { ...connection.ui, ...patch.ui }
        }
      : connection
  );
  connections.set(nextConnections);
  await saveConnections(nextConnections);
}

export async function removeConnection(connectionId: string): Promise<void> {
  const nextConnections = get(connections).filter(
    (connection) => connection.id !== connectionId
  );
  connections.set(nextConnections);
  await saveConnections(nextConnections);

  const remainingOpen = get(openConnectionIds).filter((id) => id !== connectionId);
  openConnectionIds.set(remainingOpen);

  if (get(activeConnectionId) === connectionId) {
    activeConnectionId.set(nextConnections[0]?.id ?? null);
  }

  await persistAppState();
  await removeConnectionStorage(connectionId);
}

export async function selectConnection(connectionId: string): Promise<void> {
  activeConnectionId.set(connectionId);
  openConnectionIds.update((ids) =>
    ids.includes(connectionId) ? ids : [...ids, connectionId]
  );

  await updateConnection(connectionId, { lastOpenedAt: Date.now() });
  await persistAppState();
}

export { connections, activeConnection, activeConnectionId, openConnectionIds, isReady };
