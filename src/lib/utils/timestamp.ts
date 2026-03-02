import { DateTime } from "luxon";

const ISO_TIMESTAMP_WITH_ZONE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export type TimestampDisplayOptions = {
  useLocalTimezone: boolean;
  timezone: string;
};

function parseTimestampWithZone(value: string): DateTime | null {
  if (!ISO_TIMESTAMP_WITH_ZONE_PATTERN.test(value)) return null;
  const parsed = DateTime.fromISO(value, { setZone: true });
  if (!parsed.isValid) return null;
  return parsed;
}

export function normalizeTimestampToUtcIso(value: string): string | null {
  const parsed = parseTimestampWithZone(value);
  if (!parsed) return null;
  return (
    parsed.toUTC().toISO({
      suppressMilliseconds: parsed.millisecond === 0
    }) ?? null
  );
}

export function formatTimestampForDisplay(
  value: string,
  options: TimestampDisplayOptions
): string | null {
  const parsed = parseTimestampWithZone(value);
  if (!parsed) return null;

  if (!options.useLocalTimezone) {
    return normalizeTimestampToUtcIso(value);
  }

  const zoned = parsed.setZone(options.timezone);
  if (!zoned.isValid) return null;
  const format =
    zoned.millisecond === 0
      ? "yyyy-MM-dd'T'HH:mm:ssZZ"
      : "yyyy-MM-dd'T'HH:mm:ss.SSSZZ";
  return zoned.toFormat(format);
}
