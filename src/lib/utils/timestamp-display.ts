import {
  formatTimestampForDisplay,
  type TimestampDisplayOptions
} from "$lib/utils/timestamp";

export function applyTimestampDisplayValue(
  value: unknown,
  options: TimestampDisplayOptions
): unknown {
  if (typeof value === "string") {
    const formatted = formatTimestampForDisplay(value, options);
    return formatted ?? value;
  }
  if (value instanceof Date) {
    const iso = value.toISOString();
    const formatted = formatTimestampForDisplay(iso, options);
    return formatted ?? iso;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => applyTimestampDisplayValue(entry, options));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = applyTimestampDisplayValue(entry, options);
    }
    return output;
  }
  return value;
}
