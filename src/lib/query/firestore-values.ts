import { normalizeTimestampToUtcIso } from "$lib/utils/timestamp";

export type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  referenceValue?: string;
  geoPointValue?: { latitude: number; longitude: number };
  bytesValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type EncodeFirestoreValueOptions = {
  coerceTimestampStrings?: boolean;
};

export function encodeFirestoreValue(
  value: unknown,
  options: EncodeFirestoreValueOptions = {}
): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (value === undefined) return { nullValue: null };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { nullValue: null };
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: { values: value.map((entry) => encodeFirestoreValue(entry, options)) }
    };
  }
  if (typeof value === "string") {
    if (options.coerceTimestampStrings) {
      const normalizedTimestamp = normalizeTimestampToUtcIso(value);
      if (normalizedTimestamp) {
        return { timestampValue: normalizedTimestamp };
      }
    }
    return { stringValue: value };
  }
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: value.toString() };
    return { doubleValue: value };
  }
  if (typeof value === "object") {
    const fields: Record<string, FirestoreValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      fields[key] = encodeFirestoreValue(entry, options);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function encodeFirestoreFields(
  data: Record<string, unknown>,
  options: EncodeFirestoreValueOptions = {}
): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(data)) {
    fields[key] = encodeFirestoreValue(value, options);
  }
  return fields;
}
