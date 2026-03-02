import type { TimestampDisplayOptions } from "$lib/utils/timestamp";

export const TIMESTAMP_DISPLAY_LOCAL_STORAGE_KEY = "firewhale:timestamp-display-local";
export const TIMESTAMP_TIMEZONE_STORAGE_KEY = "firewhale:timestamp-timezone";

export function resolveSystemTimezone(): string {
  if (typeof Intl === "undefined") return "UTC";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timezone || "UTC";
}

export function resolveTimezoneOptions(systemTimezone: string): string[] {
  const fallback = [systemTimezone, "UTC"];
  if (typeof Intl === "undefined" || !("supportedValuesOf" in Intl)) {
    return Array.from(new Set(fallback));
  }
  try {
    const values = Intl.supportedValuesOf("timeZone");
    if (values.includes(systemTimezone)) return values;
    return [systemTimezone, ...values];
  } catch {
    return Array.from(new Set(fallback));
  }
}

export function parseStoredBoolean(value: string | null, fallback: boolean): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function readTimestampDisplayOptions(): TimestampDisplayOptions {
  const systemTimezone = resolveSystemTimezone();
  if (typeof window === "undefined") {
    return { useLocalTimezone: true, timezone: systemTimezone };
  }

  const timezoneOptions = resolveTimezoneOptions(systemTimezone);
  const storedTimezone = window.localStorage.getItem(TIMESTAMP_TIMEZONE_STORAGE_KEY);
  const timezone =
    storedTimezone && timezoneOptions.includes(storedTimezone)
      ? storedTimezone
      : systemTimezone;

  const storedDisplayLocal = window.localStorage.getItem(
    TIMESTAMP_DISPLAY_LOCAL_STORAGE_KEY
  );
  const useLocalTimezone = parseStoredBoolean(storedDisplayLocal, true);

  return { useLocalTimezone, timezone };
}
