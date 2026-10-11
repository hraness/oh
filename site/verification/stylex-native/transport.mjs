import assert from 'node:assert/strict';

// This function is embedded with the unchanged synchronous native capture.
// Its dictionary belongs to one sample, never a previous node or generation.
export function encodeSnapshot(snapshot) {
  const keys = [], indices = new Map(), active = new Set();
  let values = 0;
  const fail = () => { throw new Error('Unsupported native snapshot transport value'); };
  const visit = (value, depth) => {
    if (++values > 4_000_000 || depth > 64) fail();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (Object.is(value, -0)) return [2, '-0'];
      if (Number.isNaN(value)) return [2, 'nan'];
      if (value === Infinity) return [2, '+inf'];
      if (value === -Infinity) return [2, '-inf'];
      return value;
    }
    if (value === undefined) return [2, 'undefined'];
    if (typeof value !== 'object' || active.has(value)) fail();
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) fail();
    if (Object.getOwnPropertySymbols(value).length) fail();
    active.add(value);
    let encoded;
    if (array) {
      if (Object.getOwnPropertyNames(value).length !== Object.keys(value).length + 1) fail();
      if (Object.keys(value).some((key) => !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) fail();
      if (value.length > 4_000_000 - values) fail();
      encoded = [1];
      for (let index = 0; index < value.length; index++) {
        const property = Object.getOwnPropertyDescriptor(value, String(index));
        if (property && (!Object.hasOwn(property, 'value') || !property.enumerable)) fail();
        encoded.push(property ? visit(property.value, depth + 1) : [2, 'hole']);
      }
    } else {
      const names = Object.getOwnPropertyNames(value);
      encoded = [prototype === null ? 3 : 0];
      for (const key of names) {
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (!Object.hasOwn(property, 'value') || !property.enumerable) fail();
        if (!indices.has(key)) {
          if (keys.length >= 65_536) fail();
          indices.set(key, keys.length); keys.push(key);
        }
        encoded.push(indices.get(key), visit(property.value, depth + 1));
      }
    }
    active.delete(value);
    return encoded;
  };
  const encoded = visit(snapshot, 0);
  const wire = JSON.stringify([1, keys, encoded]);
  if (wire.length > 64 * 1024 * 1024) fail();
  return wire;
}

export function decodeSnapshot(wire) {
  assert.ok(typeof wire === 'string' && Buffer.byteLength(wire) <= 64 * 1024 * 1024, 'Invalid snapshot wire size/type');
  const envelope = JSON.parse(wire);
  assert.ok(Array.isArray(envelope) && envelope.length === 3 && envelope[0] === 1, 'Unknown snapshot wire version');
  const keys = envelope[1];
  assert.ok(Array.isArray(keys) && keys.length <= 65_536 && keys.every((key) => typeof key === 'string'), 'Invalid snapshot key dictionary');
  assert.equal(new Set(keys).size, keys.length, 'Duplicate snapshot dictionary key');
  const used = new Set(); let values = 0;
  const visit = (value, depth) => {
    assert.ok(++values <= 4_000_000 && depth <= 64, 'Snapshot wire exceeds structural bound');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value) && !Object.is(value, -0), 'Noncanonical snapshot number');
      return value;
    }
    assert.ok(Array.isArray(value), 'Invalid snapshot wire value');
    if (value[0] === 2) {
      assert.equal(value.length, 2, 'Invalid snapshot scalar arity');
      switch (value[1]) {
        case '-0': return -0;
        case 'nan': return NaN;
        case '+inf': return Infinity;
        case '-inf': return -Infinity;
        case 'undefined': return undefined;
        default: assert.fail('Unknown snapshot scalar');
      }
    }
    if (value[0] === 1) {
      const result = new Array(value.length - 1);
      for (let index = 1; index < value.length; index++) {
        const item = value[index];
        if (Array.isArray(item) && item.length === 2 && item[0] === 2 && item[1] === 'hole') {
          assert.ok(++values <= 4_000_000, 'Snapshot wire exceeds structural bound');
        } else result[index - 1] = visit(item, depth + 1);
      }
      return result;
    }
    assert.ok((value[0] === 0 || value[0] === 3) && value.length % 2 === 1, 'Invalid snapshot object tuple');
    const result = value[0] === 3 ? Object.create(null) : {}, seen = new Set();
    for (let index = 1; index < value.length; index += 2) {
      const key = value[index];
      assert.ok(Number.isSafeInteger(key) && key >= 0 && key < keys.length && !seen.has(key), 'Invalid/duplicate snapshot key reference');
      if (!used.has(key)) { assert.equal(key, used.size, 'Noncanonical snapshot dictionary order'); used.add(key); }
      seen.add(key);
      Object.defineProperty(result, keys[key], { value: visit(value[index + 1], depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return result;
  };
  const snapshot = visit(envelope[2], 0);
  assert.equal(used.size, keys.length, 'Unused snapshot dictionary key');
  return snapshot;
}

export function snapshotTransportFunction(capture) {
  assert.equal(typeof capture, 'function');
  // Both authored functions are lexical-self-contained. No browser global,
  // stylesheet, DOM node, script-mode flag or deadline is changed here.
  return new Function('body', 'expected', '"use strict"; return (' + encodeSnapshot.toString()
    + ')((' + capture.toString() + ')(body, expected));');
}
