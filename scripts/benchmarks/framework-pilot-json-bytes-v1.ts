import { createHash, type Hash } from "node:crypto";

export const FRAMEWORK_PILOT_JSON_LIMITS_V1 = Object.freeze({
  maximumBytes: 300 * 1024 * 1024, maximumDepth: 32, maximumValues: 4_000_000,
  maximumObjectKeys: 64, maximumKeyBytes: 1_024,
});
export type FrameworkPilotJsonSpanV1 = Readonly<{ start: number; end: number }>;

function fail(reason: string): never { throw new TypeError(`Framework pilot JSON bytes: ${reason}.`); }
const white = (byte: number | undefined): boolean => byte === 32 || byte === 9 || byte === 10 || byte === 13;
const digit = (byte: number | undefined): boolean => byte !== undefined && byte >= 48 && byte <= 57;
const simpleEscapes = new Map<number, number>([[34, 34], [92, 92], [47, 47], [98, 8], [102, 12], [110, 10], [114, 13], [116, 9]]);
function hex(byte: number | undefined): number {
  if (byte !== undefined && byte >= 48 && byte <= 57) return byte - 48;
  if (byte !== undefined && byte >= 65 && byte <= 70) return byte - 55;
  if (byte !== undefined && byte >= 97 && byte <= 102) return byte - 87;
  return fail("invalid Unicode escape");
}

/** Validates JSON without materializing value strings. Even duplicate-key checks
 * hash decoded key bytes directly; excluded nested keys need not become text.
 * Only text() and objectFields() decode explicit, issued scalar/key spans.
 * The scanner owns a detached copy, so later caller mutation cannot invalidate
 * its validated boundaries. This is JSON validation, not source provenance. */
export class FrameworkPilotJsonBytesV1 {
  readonly #raw: Buffer;
  readonly #issued = new WeakSet<object>();
  readonly root: FrameworkPilotJsonSpanV1;
  readonly bytes: number;
  readonly sha256: string;
  #values = 0;

  constructor(input: Uint8Array) {
    if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > FRAMEWORK_PILOT_JSON_LIMITS_V1.maximumBytes
      || input.buffer instanceof SharedArrayBuffer) fail("invalid bounded private byte input");
    this.#raw = Buffer.from(input); this.bytes = this.#raw.length;
    const start = this.#white(0), end = this.#value(start, 0);
    if (this.#white(end) !== this.bytes) fail("trailing bytes");
    this.root = this.#span(start, end);
    this.sha256 = createHash("sha256").update(this.#raw).digest("hex");
  }

  #white(position: number): number { while (white(this.#raw[position])) position++; return position; }
  #span(start: number, end: number): FrameworkPilotJsonSpanV1 {
    const span = Object.freeze({ start, end }); this.#issued.add(span); return span;
  }
  #own(span: FrameworkPilotJsonSpanV1, token: number): void {
    if (span === null || typeof span !== "object" || !this.#issued.has(span) || this.#raw[span.start] !== token) fail("invalid issued span type");
  }
  #unicode(position: number): number {
    return hex(this.#raw[position]) * 4096 + hex(this.#raw[position + 1]) * 256
      + hex(this.#raw[position + 2]) * 16 + hex(this.#raw[position + 3]);
  }
  #keyScalar(hash: Hash, scalar: number): number {
    const bytes = Buffer.allocUnsafe(4);
    let length: number;
    if (scalar < 0x80) { bytes[0] = scalar; length = 1; }
    else if (scalar < 0x800) { bytes[0] = 0xc0 | scalar >> 6; bytes[1] = 0x80 | scalar & 63; length = 2; }
    else if (scalar < 0x10000) {
      bytes[0] = 0xe0 | scalar >> 12; bytes[1] = 0x80 | scalar >> 6 & 63; bytes[2] = 0x80 | scalar & 63; length = 3;
    } else {
      bytes[0] = 0xf0 | scalar >> 18; bytes[1] = 0x80 | scalar >> 12 & 63;
      bytes[2] = 0x80 | scalar >> 6 & 63; bytes[3] = 0x80 | scalar & 63; length = 4;
    }
    hash.update(bytes.subarray(0, length)); return length;
  }
  #string(start: number, key = false): { end: number; keyHash: string | null } {
    if (this.#raw[start] !== 34) fail("string required");
    const hash = key ? createHash("sha256") : null;
    let position = start + 1, keyBytes = 0;
    while (position < this.bytes) {
      if (key && (keyBytes > FRAMEWORK_PILOT_JSON_LIMITS_V1.maximumKeyBytes
        || position - start > FRAMEWORK_PILOT_JSON_LIMITS_V1.maximumKeyBytes * 6 + 1)) fail("object key byte bound exceeded");
      const byte = this.#raw[position]!;
      if (byte === 34) return { end: position + 1, keyHash: hash?.digest("hex") ?? null };
      if (byte === 92) {
        const escaped = this.#raw[++position]; position++;
        let scalar: number;
        if (escaped === 117) {
          scalar = this.#unicode(position); position += 4;
          if (scalar >= 0xd800 && scalar <= 0xdbff) {
            if (this.#raw[position] !== 92 || this.#raw[position + 1] !== 117) fail("unpaired high surrogate");
            const low = this.#unicode(position + 2); position += 6;
            if (low < 0xdc00 || low > 0xdfff) fail("unpaired high surrogate");
            scalar = 0x10000 + (scalar - 0xd800) * 1024 + low - 0xdc00;
          } else if (scalar >= 0xdc00 && scalar <= 0xdfff) fail("unpaired low surrogate");
        } else {
          const value = escaped === undefined ? undefined : simpleEscapes.get(escaped);
          if (value === undefined) fail("invalid string escape");
          scalar = value;
        }
        if (hash !== null) keyBytes += this.#keyScalar(hash, scalar);
      } else if (byte < 0x20) fail("unescaped control byte");
      else if (byte < 0x80) {
        const from = position++;
        while (position < this.bytes) {
          const next = this.#raw[position]!;
          if (next < 0x20 || next >= 0x80 || next === 34 || next === 92) break;
          position++;
        }
        if (hash !== null) {
          keyBytes += position - from;
          if (keyBytes > FRAMEWORK_PILOT_JSON_LIMITS_V1.maximumKeyBytes) fail("object key byte bound exceeded");
          hash.update(this.#raw.subarray(from, position));
        }
      } else {
        const length = byte >= 0xc2 && byte <= 0xdf ? 2 : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : 0;
        if (length === 0 || position + length > this.bytes) fail("invalid UTF-8 lead or length");
        for (let index = 1; index < length; index++) {
          const continuation = this.#raw[position + index]!;
          if (continuation < 0x80 || continuation > 0xbf) fail("invalid UTF-8 continuation");
        }
        const second = this.#raw[position + 1]!;
        if (byte === 0xe0 && second < 0xa0 || byte === 0xed && second > 0x9f
          || byte === 0xf0 && second < 0x90 || byte === 0xf4 && second > 0x8f) fail("non-scalar or overlong UTF-8");
        if (hash !== null) { hash.update(this.#raw.subarray(position, position + length)); keyBytes += length; }
        position += length;
      }
    }
    return fail("unterminated string");
  }
  #value(start: number, depth: number): number {
    if (++this.#values > FRAMEWORK_PILOT_JSON_LIMITS_V1.maximumValues || depth > FRAMEWORK_PILOT_JSON_LIMITS_V1.maximumDepth) fail("structure bound exceeded");
    const token = this.#raw[start];
    if (token === 34) return this.#string(start).end;
    if (token === 123) {
      let position = this.#white(start + 1);
      const keys = new Set<string>();
      if (this.#raw[position] === 125) return position + 1;
      while (true) {
        const key = this.#string(position, true);
        if (keys.has(key.keyHash!)) fail("duplicate object key");
        keys.add(key.keyHash!);
        if (keys.size > FRAMEWORK_PILOT_JSON_LIMITS_V1.maximumObjectKeys) fail("object key count exceeded");
        position = this.#white(key.end);
        if (this.#raw[position] !== 58) fail("object colon required");
        position = this.#white(this.#value(this.#white(position + 1), depth + 1));
        if (this.#raw[position] === 125) return position + 1;
        if (this.#raw[position] !== 44) fail("object comma required");
        position = this.#white(position + 1);
      }
    }
    if (token === 91) {
      let position = this.#white(start + 1);
      if (this.#raw[position] === 93) return position + 1;
      while (true) {
        position = this.#white(this.#value(position, depth + 1));
        if (this.#raw[position] === 93) return position + 1;
        if (this.#raw[position] !== 44) fail("array comma required");
        position = this.#white(position + 1);
      }
    }
    if (token === 116 || token === 102 || token === 110) {
      const expected = token === 116 ? [116, 114, 117, 101] : token === 102 ? [102, 97, 108, 115, 101] : [110, 117, 108, 108];
      if (expected.some((byte, index) => this.#raw[start + index] !== byte)) fail("invalid JSON literal");
      return start + expected.length;
    }
    let position = start;
    if (this.#raw[position] === 45) position++;
    if (this.#raw[position] === 48) position++;
    else {
      if (!digit(this.#raw[position]) || this.#raw[position] === 48) fail("invalid JSON value");
      while (digit(this.#raw[position])) position++;
    }
    if (this.#raw[position] === 46) {
      position++;
      if (!digit(this.#raw[position])) fail("fraction digit required");
      while (digit(this.#raw[position])) position++;
    }
    if (this.#raw[position] === 69 || this.#raw[position] === 101) {
      position++;
      if (this.#raw[position] === 43 || this.#raw[position] === 45) position++;
      if (!digit(this.#raw[position])) fail("exponent digit required");
      while (digit(this.#raw[position])) position++;
    }
    if (position - start > 128) fail("number byte bound exceeded");
    return position;
  }

  // All callers use issued spans into the private, completely validated bytes.
  #stringEnd(start: number): number {
    let position = start + 1;
    while (this.#raw[position] !== 34) position += this.#raw[position] === 92 ? 2 : 1;
    return position + 1;
  }
  #skip(start: number): number {
    const token = this.#raw[start];
    if (token === 34) return this.#stringEnd(start);
    if (token === 91 || token === 123) {
      let depth = 1, position = start + 1;
      while (depth > 0) {
        const current = this.#raw[position];
        if (current === 34) { position = this.#stringEnd(position); continue; }
        if (current === 91 || current === 123) depth++;
        if (current === 93 || current === 125) depth--;
        position++;
      }
      return position;
    }
    let position = start;
    while (position < this.bytes && !white(this.#raw[position]) && ![44, 93, 125].includes(this.#raw[position]!)) position++;
    return position;
  }
  text(span: FrameworkPilotJsonSpanV1, maximumBytes: number): string {
    this.#own(span, 34);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 524_288
      || span.end - span.start > maximumBytes * 6 + 2) fail("selected string byte bound exceeded");
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(this.#raw.subarray(span.start, span.end)));
    if (typeof value !== "string" || Buffer.byteLength(value) > maximumBytes) fail("selected string byte bound exceeded");
    return value;
  }
  objectFields(span: FrameworkPilotJsonSpanV1): ReadonlyMap<string, FrameworkPilotJsonSpanV1> {
    this.#own(span, 123);
    const fields = new Map<string, FrameworkPilotJsonSpanV1>();
    let position = this.#white(span.start + 1);
    while (this.#raw[position] !== 125) {
      const keyEnd = this.#stringEnd(position), key = this.text(this.#span(position, keyEnd), FRAMEWORK_PILOT_JSON_LIMITS_V1.maximumKeyBytes);
      position = this.#white(this.#white(keyEnd) + 1);
      const end = this.#skip(position); fields.set(key, this.#span(position, end));
      position = this.#white(end);
      if (this.#raw[position] === 44) position = this.#white(position + 1);
    }
    return fields;
  }
  arrayItems(span: FrameworkPilotJsonSpanV1, maximum: number): readonly FrameworkPilotJsonSpanV1[] {
    this.#own(span, 91);
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 8_192) fail("invalid array bound");
    const items: FrameworkPilotJsonSpanV1[] = [];
    let position = this.#white(span.start + 1);
    while (this.#raw[position] !== 93) {
      if (items.length === maximum) fail("array item bound exceeded");
      const end = this.#skip(position); items.push(this.#span(position, end));
      position = this.#white(end);
      if (this.#raw[position] === 44) position = this.#white(position + 1);
    }
    return Object.freeze(items);
  }
}
