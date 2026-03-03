const AUTO_ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const AUTO_ID_LENGTH = 20;

function randomIndex(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0;
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

export function generateFirestoreDocumentId(): string {
  let output = "";
  for (let index = 0; index < AUTO_ID_LENGTH; index += 1) {
    output += AUTO_ID_ALPHABET[randomIndex(AUTO_ID_ALPHABET.length)];
  }
  return output;
}
