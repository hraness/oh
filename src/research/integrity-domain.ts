declare const sha256HexBrand: unique symbol;

export type Sha256Hex = string & {
  readonly [sha256HexBrand]: "Sha256Hex";
};

export const SPONGE_SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
export const SPONGE_CANONICAL_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const utf8 = new TextEncoder();

/** Locale-independent UTF-16 code-unit order for canonical collections. */
export function compareUtf16CodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function parseSha256Hex(value: unknown): Sha256Hex | null {
  return typeof value === "string" && SPONGE_SHA256_HEX_PATTERN.test(value)
    ? value as Sha256Hex
    : null;
}

export function parseCanonicalInstantV1(value: unknown): string | null {
  if (
    typeof value !== "string"
    || !SPONGE_CANONICAL_INSTANT_PATTERN.test(value)
  ) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : null;
}

export function utf8ByteLength(value: string): number {
  return utf8.encode(value).byteLength;
}

export async function sha256Hex(bytes: Uint8Array): Promise<Sha256Hex> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("") as Sha256Hex;
}

export async function sha256Text(value: string): Promise<Sha256Hex> {
  return sha256Hex(utf8.encode(value));
}
