import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { assertListenerOwner, bounded, observeChild, OwnedProcesses, parseListenerPids, parseProcessRows, preservingCleanup, ResourceTracker } from './support.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const identity = (pid, ppid, started = 'Wed Sep 9 12:00:00 2026') => ({ pid, ppid, started, command: '/exact/task/node' });
const request = (path = '/font.woff2') => ({ url: () => `http://127.0.0.1:1234${path}` });
const reply = (req, status = 200, completion = Promise.resolve(null)) => ({ url: req.url, status: () => status, finished: () => completion });

test('primary and cleanup outcomes remain separate and ordered', async () => {
  const primary = new Error('primary'), cleanup = new Error('cleanup');
  let collections = 0;
  for (const failBody of [false, true]) for (const failCleanup of [false, true]) {
    const result = preservingCleanup(async () => { if (failBody) throw primary; return 7; }, async () => { collections++; if (failCleanup) throw cleanup; });
    if (failBody && failCleanup) await assert.rejects(result, (error) => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup);
    else if (failBody || failCleanup) await assert.rejects(result, (error) => error === (failBody ? primary : cleanup));
    else assert.equal(await result, 7);
  }
  assert.equal(collections, 4);
});

test('cancelled wrapper retains the actual pending operation for collection', async () => {
  const actual = deferred(), controller = new AbortController(), failure = new Error('signal');
  const waiting = bounded(actual.promise, 1000, 'case', controller.signal);
  controller.abort(failure);
  await assert.rejects(waiting, (error) => error === failure);
  actual.resolve(19);
  assert.equal(await actual.promise, 19);
});

test('bounded timeout rejects without replacing a later original failure', async () => {
  const actual = deferred();
  await assert.rejects(bounded(actual.promise, 1, 'case'), /Timeout: case/);
  const original = new Error('original late failure');
  actual.reject(original);
  await assert.rejects(actual.promise, (error) => error === original);
});

test('OS process row parser retains start identity and rejects malformed rows', () => {
  assert.deepEqual(parseProcessRows(' 42 5 Wed Sep  9 12:00:00 2026 /exact/task/node\n'), [identity(42, 5)]);
  assert.throws(() => parseProcessRows('42 5 node'), /Unsupported/);
});

test('listener proof requires exact observed root or descendant, never another sibling', () => {
  assert.deepEqual(parseListenerPids('p42\np43\n'), [42, 43]);
  assert.deepEqual(parseListenerPids(''), []);
  for (const value of ['42', 'p1', 'p42\np42', 'p42\ncnode', 'p-9', 'p9007199254740993']) assert.throws(() => parseListenerPids(value));
  const owned = [{ pid: 42, admittedParent: 5 }, { pid: 43, admittedParent: 42 }, { pid: 44, admittedParent: 5 }];
  assertListenerOwner([42, 43], owned, 42);
  for (const pids of [[], [44], [77]]) assert.throws(() => assertListenerOwner(pids, owned, 42));
  assert.throws(() => assertListenerOwner([43], [{ pid: 43, admittedParent: 43 }], 42), /cycle/);
  assert.throws(() => assertListenerOwner([43], [{ pid: 43, admittedParent: 42 }], 42), /root identity/);
});

function fakeProcesses(onSignal = () => {}) {
  let time = 0;
  const fixture = { rows: [identity(10, 1), identity(11, 10), identity(99, 1)], signals: [], waits: [] };
  fixture.owner = new OwnedProcesses({
    census: async () => fixture.rows.map((row) => ({ ...row })),
    signal: async (pid, signal) => { fixture.signals.push({ pid, signal }); onSignal(fixture, pid, signal); },
    wait: async (ms) => { fixture.waits.push(ms); time += ms; fixture.onWait?.(); },
    now: () => time,
  });
  return fixture;
}

test('TERM collects only exact owned roots and descendants, never siblings', async () => {
  const fixture = fakeProcesses((state, pid) => { state.rows = state.rows.filter((row) => row.pid !== pid); });
  await fixture.owner.add(10, 1, 'build');
  const result = await fixture.owner.stop({ grace: 100, killGrace: 100 });
  assert.deepEqual(fixture.signals, [{ pid: 11, signal: 'SIGTERM' }, { pid: 10, signal: 'SIGTERM' }]);
  assert.deepEqual(fixture.rows.map((row) => row.pid), [99]);
  assert.deepEqual(result.survivors, []);
});

test('unresponsive owned processes escalate only after finite TERM grace', async () => {
  const fixture = fakeProcesses((state, pid, signal) => { if (signal === 'SIGKILL') state.rows = state.rows.filter((row) => row.pid !== pid); });
  await fixture.owner.add(10, 1, 'server');
  await fixture.owner.stop({ grace: 200, killGrace: 100 });
  assert.deepEqual(fixture.signals.map((row) => row.signal), ['SIGTERM', 'SIGTERM', 'SIGKILL', 'SIGKILL']);
  assert.equal(fixture.waits.reduce((sum, value) => sum + value, 0), 300);
  assert.ok(fixture.signals.every((row) => row.pid === 10 || row.pid === 11));
});

test('PID reuse immediately before a signal is rejected without signalling', async () => {
  const fixture = fakeProcesses();
  await fixture.owner.add(10, 1, 'server');
  const expected = fixture.owner.owned.get(10);
  fixture.rows = [identity(10, 1, 'Wed Sep 9 12:00:01 2026')];
  await assert.rejects(fixture.owner.send(expected, 'SIGKILL'), /Refusing reused PID/);
  assert.deepEqual(fixture.signals, []);
});

test('late positively-owned descendant is discovered and collected during grace', async () => {
  const fixture = fakeProcesses((state, pid, signal) => { if (signal === 'SIGKILL') state.rows = state.rows.filter((row) => row.pid !== pid); });
  let admitted = false;
  fixture.onWait = () => { if (!admitted) { fixture.rows.push(identity(12, 10)); admitted = true; } };
  await fixture.owner.add(10, 1, 'server');
  const result = await fixture.owner.stop({ grace: 200, killGrace: 100 });
  assert.ok(result.identities.some((row) => row.pid === 12 && row.admittedParent === 10));
  assert.ok(fixture.signals.some((row) => row.pid === 12 && row.signal === 'SIGTERM'));
  assert.ok(fixture.signals.some((row) => row.pid === 12 && row.signal === 'SIGKILL'));
});

test('survivor after TERM and KILL remains red', async () => {
  const fixture = fakeProcesses();
  await fixture.owner.add(10, 1, 'server');
  await assert.rejects(fixture.owner.stop({ grace: 100, killGrace: 100 }), (error) => error instanceof AggregateError && error.errors.some((child) => /Owned survivors/.test(child.message)));
});

test('admission refuses an unrelated same-PID candidate with wrong parent', async () => {
  const fixture = fakeProcesses();
  await assert.rejects(fixture.owner.add(99, 10, 'server'), /Unproven direct child/);
  assert.equal(fixture.owner.owned.size, 0);
});

test('controller anchor discovers acquisition children but is never signalled', async () => {
  const fixture = fakeProcesses((state, pid) => { state.rows = state.rows.filter((row) => row.pid !== pid); });
  await fixture.owner.add(10, 1, 'controller', { controlOnly: true });
  await fixture.owner.stop({ grace: 100, killGrace: 100 });
  assert.deepEqual(fixture.signals, [{ pid: 11, signal: 'SIGTERM' }]);
  await assert.rejects(fixture.owner.send(fixture.owner.owned.get(10), 'SIGTERM'), /never a signal target/);
});

test('a reused PID needs a new positive parent join; old identity still cannot signal it', async () => {
  const fixture = fakeProcesses();
  await fixture.owner.add(10, 1, 'controller', { controlOnly: true });
  const original = fixture.owner.owned.get(11);
  fixture.rows = [identity(10, 1), identity(11, 10, 'Wed Sep 9 12:00:02 2026')];
  await fixture.owner.scan();
  assert.notEqual(fixture.owner.owned.get(11).started, original.started);
  assert.equal(fixture.owner.history.filter((row) => row.pid === 11).length, 2);
  await assert.rejects(fixture.owner.send(original, 'SIGKILL'), /Refusing reused PID/);
  assert.deepEqual(fixture.signals, []);
});

function fakeChild() {
  const child = new EventEmitter(); child.pid = 10; child.exitCode = null; child.signalCode = null;
  for (const key of ['stdout', 'stderr']) { child[key] = new EventEmitter(); child[key].resume = () => {}; }
  return child;
}

test('child completion requires exit, close, and both EOFs', async () => {
  const child = fakeChild(), observed = observeChild(child, 'build');
  let complete = false; observed.complete.then(() => { complete = true; });
  child.emit('exit', 0, null); child.emit('close'); child.stdout.emit('end');
  await Promise.resolve(); assert.equal(complete, false);
  child.stderr.emit('end');
  const result = await observed.complete;
  assert.equal(result.closed && result.stdoutEOF && result.stderrEOF, true);
  assert.deepEqual(result.exit, { code: 0, signal: null });
});

test('pipe closure without EOF is a collection failure', async () => {
  const child = fakeChild(), observed = observeChild(child, 'build');
  child.emit('exit', 0, null); child.emit('close'); child.stdout.emit('close'); child.stderr.emit('end');
  await assert.rejects(observed.complete, /closed without EOF/);
});

test('local font HTTP failures cannot form an accepted resource census', async () => {
  for (const status of [404, 500]) {
    const tracker = new ResourceTracker('http://127.0.0.1:1234'), req = request();
    tracker.start(req); tracker.response(reply(req, status)); tracker.finish(req);
    await assert.rejects(tracker.settle({ wait: async () => {} }), (error) => error instanceof AggregateError && error.errors.some((entry) => entry.message.includes(`HTTP ${status}`)));
    assert.throws(() => tracker.seal(), AggregateError);
  }
});

test('failed, incomplete, external, and post-seal requests fail closed', async () => {
  const failed = new ResourceTracker('http://127.0.0.1:1234'), req = request();
  failed.start(req); failed.finish(req, 'net::ERR_FAILED'); assert.throws(() => failed.assertClean(), AggregateError);
  const incomplete = new ResourceTracker('http://127.0.0.1:1234');
  incomplete.start(req); incomplete.response(reply(req, 200, Promise.resolve(new Error('closed')))); incomplete.finish(req);
  await assert.rejects(incomplete.settle({ wait: async () => {} }), AggregateError);
  const external = new ResourceTracker('http://127.0.0.1:1234');
  external.start({ url: () => 'https://foreign.invalid/font.woff2' }); assert.throws(() => external.assertClean(), AggregateError);
  const sealed = new ResourceTracker('http://127.0.0.1:1234'); sealed.seal(); sealed.start(req); assert.throws(() => sealed.assertClean(), AggregateError);
});

test('settlement collects tasks admitted during an earlier completion', async () => {
  const tracker = new ResourceTracker('http://127.0.0.1:1234'), first = request('/first'), second = request('/second');
  const done = deferred(); let round = 0;
  tracker.start(first); tracker.response(reply(first)); tracker.finish(first);
  const settling = tracker.settle({ wait: async () => {
    if (round++ === 0) {
      tracker.start(second); tracker.response(reply(second, 200, done.promise));
      queueMicrotask(() => { tracker.finish(second); done.resolve(null); });
    }
  } });
  await settling; tracker.seal();
  assert.deepEqual(tracker.records.map((row) => row.url), [first.url(), second.url()]);
});

test('never-completing request cannot pass a bounded quiet fence', async () => {
  let now = 0;
  const tracker = new ResourceTracker('http://127.0.0.1:1234'); tracker.start(request());
  await assert.rejects(tracker.settle({ milliseconds: 5, now: () => now, wait: async () => { now++; } }), /Resource settlement timeout/);
});

test('failed quiet wrapper retains original response/route tasks until post-close drain', async () => {
  const tracker = new ResourceTracker('http://127.0.0.1:1234'), req = request(), responseDone = deferred(), routeDone = deferred();
  tracker.start(req); tracker.response(reply(req, 200, responseDone.promise)); tracker.task(routeDone.promise);
  await assert.rejects(tracker.settle({ milliseconds: 2, wait: async () => {} }), /Timeout/);
  assert.equal(tracker.tasks.size, 2);
  let collected = false; const drain = tracker.drain().then(() => { collected = true; });
  tracker.finish(req); responseDone.resolve(null); await Promise.resolve(); assert.equal(collected, false);
  routeDone.resolve(); await drain; assert.equal(collected, true); assert.equal(tracker.tasks.size, 0);
  const unfinished = new ResourceTracker('http://127.0.0.1:1234'); unfinished.start(req);
  await assert.rejects(unfinished.drain(), /Uncollected original resource/);
});

test('404 exception is exact one qualified document identity, never a subresource', async () => {
  const tracker = new ResourceTracker('http://127.0.0.1:1234');
  const document = { ...request('/__stylex-baseline-missing__'), isNavigationRequest: () => true, resourceType: () => 'document' };
  tracker.allowMissingDocument(document); tracker.start(document);
  tracker.response({ ...reply(document, 404), request: () => document }); tracker.finish(document);
  await tracker.settle({ wait: async () => {} }); tracker.seal();
  tracker.assertConsole([{ text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: document.url() }]);
  assert.throws(() => tracker.assertConsole([{ text: 'Other error', url: document.url() }]));
  assert.throws(() => tracker.assertConsole([{ text: 'Failed to load resource: the server responded with a status of 404 (Not Found)', url: 'http://127.0.0.1:1234/font.woff2' }]));
  assert.throws(() => tracker.allowMissingDocument(document));
  const other = new ResourceTracker('http://127.0.0.1:1234'), impostor = { ...document };
  other.allowMissingDocument(document); other.start(impostor); other.response({ ...reply(impostor, 404), request: () => impostor }); other.finish(impostor);
  await assert.rejects(other.settle({ wait: async () => {} }), AggregateError);
  for (const candidate of [request('/favicon.ico'), { ...document, isNavigationRequest: () => false }, { ...document, resourceType: () => 'image' }]) {
    assert.throws(() => new ResourceTracker('http://127.0.0.1:1234').allowMissingDocument(candidate));
  }
});
