// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/rust-fallback.ts
var MAX_FALLBACK_TAGS = 32;
var MAX_FALLBACK_NOTICES_PER_TAG = 4;
var DIAGNOSTIC_FIELD = /^[A-Za-z0-9._-]{1,64}$/u;
var emittedNotices = new Map;
function boundedField(value) {
  return DIAGNOSTIC_FIELD.test(value) ? value : "other";
}
function emitOhRustFallback(notice) {
  const tag = boundedField(notice.tag);
  const reason = boundedField(notice.reason);
  const inputClass = notice.inputClass === undefined ? undefined : boundedField(notice.inputClass);
  const diagnostic = inputClass === undefined ? reason : `${reason}:${inputClass}`;
  let seen = emittedNotices.get(tag);
  if (seen === undefined) {
    if (emittedNotices.size >= MAX_FALLBACK_TAGS)
      return;
    seen = new Set;
    emittedNotices.set(tag, seen);
  }
  if (seen.has(diagnostic) || seen.size >= MAX_FALLBACK_NOTICES_PER_TAG)
    return;
  seen.add(diagnostic);
  try {
    if (typeof process !== "undefined" && typeof process.stderr?.write === "function") {
      const detail = inputClass === undefined ? reason : `${reason} input=${inputClass}`;
      process.stderr.write(`[${tag}] ${detail}
`);
    }
  } catch {}
}
export {
  emitOhRustFallback
};
