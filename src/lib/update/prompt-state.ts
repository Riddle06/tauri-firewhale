export const UPDATE_PROMPT_LAST_DATE_KEY = "firewhale.update.lastPromptDate";
export const UPDATE_PROMPT_SKIPPED_VERSION_KEY = "firewhale.update.skippedVersion";

export type UpdatePromptState = {
  lastPromptDate: string | null;
  skippedVersion: string | null;
};

function readStorageValue(storage: Storage, key: string): string | null {
  try {
    const value = storage.getItem(key);
    if (!value) {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function writeStorageValue(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage write failures (private mode/quota errors).
  }
}

export function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readUpdatePromptState(storage: Storage): UpdatePromptState {
  return {
    lastPromptDate: readStorageValue(storage, UPDATE_PROMPT_LAST_DATE_KEY),
    skippedVersion: readStorageValue(storage, UPDATE_PROMPT_SKIPPED_VERSION_KEY)
  };
}

export function shouldShowUpdatePrompt(
  state: UpdatePromptState,
  latestVersion: string,
  todayKey: string
): boolean {
  if (state.skippedVersion === latestVersion) {
    return false;
  }
  if (state.lastPromptDate === todayKey) {
    return false;
  }
  return true;
}

export function markUpdatePromptShown(
  storage: Storage,
  dateKey: string = getLocalDateKey()
): void {
  writeStorageValue(storage, UPDATE_PROMPT_LAST_DATE_KEY, dateKey);
}

export function skipUpdateVersion(storage: Storage, version: string): void {
  writeStorageValue(storage, UPDATE_PROMPT_SKIPPED_VERSION_KEY, version);
}
