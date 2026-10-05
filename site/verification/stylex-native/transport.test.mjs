import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { decodeSnapshot, encodeSnapshot, snapshotTransportFunction } from './transport.mjs';

test('snapshot wire preserves complete ordered values, exceptional numbers, holes and collision-like keys', () => {
  const sparse = [undefined, , -0, NaN, Infinity, -Infinity];
  const nullObject = Object.assign(Object.create(null), { color: 'red' });
  const source = { nodes: [{ styles: { color: 'black', 'border-width': '1px' }, pseudo: { '::before': { content: '"[2,undefined]"' } } }],
    media: { coarse: false }, viewport: { x: -0, y: 0 }, text: 'é😀\u0000', arrays: [[], sparse], nullObject,
    structuredData: JSON.parse('{"__proto__":{"polluted":true},"constructor":"literal","0":"zero"}') };
  const restored = decodeSnapshot(encodeSnapshot(source));
  assert.deepEqual(restored, source); assert.equal(Object.hasOwn(restored.arrays[1], 1), false);
  assert.equal(Object.hasOwn(restored.arrays[1], 0), true); assert.equal(Object.is(restored.viewport.x, -0), true);
  assert.equal(Object.getPrototypeOf(restored.nullObject), null); assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(restored.nodes[0].styles), Object.keys(source.nodes[0].styles));
  assert.equal(encodeSnapshot(restored), encodeSnapshot(source));
  for (const value of [undefined, -0, NaN, Infinity, -Infinity, null, true, false, 'text', 123])
    assert.deepEqual(decodeSnapshot(encodeSnapshot(value)), value);
});

test('dictionary is sample-local and retains every style and pseudo property before reconstruction', () => {
  const style = Object.fromEntries(Array.from({ length: 475 }, (_, index) => ['native-property-' + index, String(index)]));
  const source = { nodes: Array.from({ length: 350 }, (_, index) => ({ index, styles: { ...style },
    pseudo: Object.fromEntries(['::before', '::after', '::marker'].map((name) => [name, { ...style }])) })) };
  const wire = encodeSnapshot(source), restored = decodeSnapshot(wire);
  assert.deepEqual(restored, source);
  assert.equal(restored.nodes.reduce((sum, node) => sum + Object.keys(node.styles).length
    + Object.values(node.pseudo).reduce((count, map) => count + Object.keys(map).length, 0), 0), 665_000);
  assert.ok(Buffer.byteLength(wire) < Buffer.byteLength(JSON.stringify(source)) / 2);
  assert.deepEqual(JSON.parse(encodeSnapshot({ different: 1 }))[1], ['different']);
  restored.nodes[0].styles['native-property-0'] = 'changed';
  assert.equal(restored.nodes[1].styles['native-property-0'], '0');
});

test('unsupported prototypes, hidden values, accessors and cycles fail without invoking hooks', () => {
  const cycle = {}; cycle.self = cycle;
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  let called = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { called++; return 1; } });
  const toJSON = { toJSON() { called++; return {}; } };
  const symbolic = { [Symbol('hidden')]: 1 };
  const arrayExtra = []; arrayExtra.extra = 1;
  const arrayGetter = []; Object.defineProperty(arrayGetter, '0', { enumerable: true, get() { called++; return 1; } });
  for (const value of [cycle, hidden, accessor, toJSON, symbolic, arrayExtra, arrayGetter, new Date(), new Map(), /x/, 1n, () => 1, Symbol()])
    assert.throws(() => encodeSnapshot(value), /Unsupported native snapshot/);
  assert.equal(called, 0);
  let deep = null; for (let index = 0; index < 66; index++) deep = [deep];
  assert.throws(() => encodeSnapshot(deep), /Unsupported native snapshot/);
});

test('decoder rejects malformed dictionaries, tuples, tags, references and unsafe object writes', () => {
  for (const envelope of [null, {}, [], [2, [], null], [1, [], null, 1], [1, ['x', 'x'], [0]],
    [1, [1], [0]], [1, ['unused'], null], [1, [], {}], [1, [], []], [1, [], [9]],
    [1, [], [2, 'hole']], [1, [], [2, 'unknown']], [1, [], [2, 'nan', 1]],
    [1, ['x'], [0, 0]], [1, ['x'], [0, 1, null]], [1, ['x'], [0, -1, null]],
    [1, ['x'], [0, 0.1, null]], [1, ['x'], [0, 0, 1, 0, 2]], [1, ['x', 'y'], [0, 1, 1, 0, 2]]])
    assert.throws(() => decodeSnapshot(JSON.stringify(envelope)));
  assert.throws(() => decodeSnapshot('[1,[],1e999]'), /Noncanonical snapshot number/);
  assert.throws(() => decodeSnapshot('[1,[],-0]'), /Noncanonical snapshot number/);
  assert.throws(() => decodeSnapshot(1), /size\/type/);
  let deep = null; for (let index = 0; index < 66; index++) deep = [1, deep];
  assert.throws(() => decodeSnapshot(JSON.stringify([1, [], deep])), /structural bound/);
});

test('serialized synchronous callback reconstructs the exact capture and references no host imports', () => {
  const capture = (body, expected) => ({ body, expected, value: -0, missing: undefined });
  const source = '(' + snapshotTransportFunction(capture).toString() + ')(body, { width: 375 })';
  const wire = runInNewContext(source, { body: 'native body' });
  assert.equal(typeof wire, 'string');
  assert.deepEqual(decodeSnapshot(wire), capture('native body', { width: 375 }));
  assert.doesNotMatch(source, /\b(?:await|requestAnimationFrame|fonts\.ready)\b/);
  const collector = readFileSync(new URL('./collect.mjs', import.meta.url), 'utf8');
  assert.match(collector, /decodeSnapshot\(await page\.locator\('body'\)\.evaluate\(captureWire, expectedMedia\(settings\)\)\)/);
  assert.match(collector, /'\.\/transport\.mjs'/);
});
