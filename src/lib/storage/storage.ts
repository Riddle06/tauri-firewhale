import { isTauri } from "@tauri-apps/api/core";
import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  remove,
  writeTextFile
} from "@tauri-apps/plugin-fs";
import type { AppState, ConnectionProfile, WorkspaceState } from "$lib/models";

const STORAGE_DIR = "firewhale";
const CONNECTIONS_DIR = `${STORAGE_DIR}/connections`;
const CONNECTIONS_FILE = `${STORAGE_DIR}/connections.json`;
const APP_STATE_FILE = `${STORAGE_DIR}/appState.json`;

const DEFAULT_APP_STATE: AppState = {
  activeConnectionId: null,
  openConnectionIds: []
};

function storageKey(path: string): string {
  return `fw:${path}`;
}

async function ensureDir(path: string): Promise<void> {
  if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) {
    await mkdir(path, { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

async function ensureBaseDirs(): Promise<void> {
  await ensureDir(STORAGE_DIR);
  await ensureDir(CONNECTIONS_DIR);
}

async function readText(path: string): Promise<string | null> {
  if (isTauri()) {
    if (!(await exists(path, { baseDir: BaseDirectory.AppData }))) {
      return null;
    }
    return readTextFile(path, { baseDir: BaseDirectory.AppData });
  }

  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(storageKey(path));
}

async function writeText(path: string, data: string): Promise<void> {
  if (isTauri()) {
    await ensureBaseDirs();
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) await ensureDir(dir);
    await writeTextFile(path, data, { baseDir: BaseDirectory.AppData });
    return;
  }

  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey(path), data);
}

async function removePath(path: string): Promise<void> {
  if (isTauri()) {
    if (await exists(path, { baseDir: BaseDirectory.AppData })) {
      await remove(path, { baseDir: BaseDirectory.AppData, recursive: true });
    }
    return;
  }

  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(storageKey(path));
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const raw = await readText(path);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadConnections(): Promise<ConnectionProfile[]> {
  return readJson(CONNECTIONS_FILE, [] as ConnectionProfile[]);
}

export async function saveConnections(connections: ConnectionProfile[]): Promise<void> {
  await writeText(CONNECTIONS_FILE, JSON.stringify(connections, null, 2));
}

export async function loadAppState(): Promise<AppState> {
  return readJson(APP_STATE_FILE, DEFAULT_APP_STATE);
}

export async function saveAppState(state: AppState): Promise<void> {
  await writeText(APP_STATE_FILE, JSON.stringify(state, null, 2));
}

export async function loadWorkspace(connectionId: string): Promise<WorkspaceState | null> {
  const workspacePath = `${CONNECTIONS_DIR}/${connectionId}/workspace.json`;
  const raw = await readText(workspacePath);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkspaceState;
  } catch {
    return null;
  }
}

export async function saveWorkspace(
  connectionId: string,
  workspace: WorkspaceState
): Promise<void> {
  const workspacePath = `${CONNECTIONS_DIR}/${connectionId}/workspace.json`;
  await writeText(workspacePath, JSON.stringify(workspace, null, 2));
}

export async function removeConnectionStorage(connectionId: string): Promise<void> {
  const workspacePath = `${CONNECTIONS_DIR}/${connectionId}/workspace.json`;
  const connectionPath = `${CONNECTIONS_DIR}/${connectionId}`;
  await removePath(workspacePath);
  await removePath(connectionPath);
}
