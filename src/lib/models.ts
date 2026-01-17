export type ConnectionAuth = {
  mode: "serviceAccount" | "apiKeyUserLogin" | "emulator";
  encryptedPayloadRef: string;
};

export type ConnectionProfile = {
  id: string;
  name: string;
  projectId: string;
  kind: "firestore" | "rtdb";
  auth: ConnectionAuth;
  ui: { colorTag?: string; badgeText?: string };
  lastOpenedAt?: number;
};

export type TabViewState = {
  selectedColumns?: string[];
  columnWidths?: Record<string, number>;
};

export type TabState = {
  id: string;
  title: string;
  connectionId: string;
  collectionPath: string;
  queryText: string;
  lastRunAt?: number;
  view?: TabViewState;
};

export type WorkspaceState = {
  id: string;
  connectionId: string;
  openConnectionIds: string[];
  tabs: TabState[];
  activeTabId: string | null;
  collections?: string[];
};

export type AppState = {
  activeConnectionId: string | null;
  openConnectionIds: string[];
};
