import { describe, expect, test } from "bun:test";

import {
  isOhConflictError,
  isOhDependencyError,
  isOhIntegrityError,
  isOhOperationSizeError,
  isOhProfileError,
  OhConflictError,
  OhDependencyError,
  OhIntegrityError,
  OhOperationSizeError,
  OhProfileError,
} from "./errors";

const CORE_ERRORS = [
  {
    brand: "@hraness/oh/OhConflictError/v1",
    ErrorClass: OhConflictError,
    guard: isOhConflictError,
    name: "OhConflictError",
  },
  {
    brand: "@hraness/oh/OhIntegrityError/v1",
    ErrorClass: OhIntegrityError,
    guard: isOhIntegrityError,
    name: "OhIntegrityError",
  },
  {
    brand: "@hraness/oh/OhDependencyError/v1",
    ErrorClass: OhDependencyError,
    guard: isOhDependencyError,
    name: "OhDependencyError",
  },
  {
    brand: "@hraness/oh/OhProfileError/v1",
    ErrorClass: OhProfileError,
    guard: isOhProfileError,
    name: "OhProfileError",
  },
] as const;

describe("Oh public error identity", () => {
  for (const { brand, ErrorClass, guard, name } of CORE_ERRORS) {
    test(`brands ${name} without changing its public constructor`, () => {
      const error = new ErrorClass("preserved message");
      expect(Error.isError(error)).toBe(true);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ErrorClass);
      expect(guard(error)).toBe(true);
      expect(error).toMatchObject({ message: "preserved message", name });
      expect(Object.keys(error)).toEqual(["name"]);

      const copied = Object.create(Error.prototype) as Record<PropertyKey, unknown>;
      Object.defineProperty(copied, Symbol.for(brand), {
        configurable: false,
        value: true,
        writable: false,
      });
      expect(Error.isError(copied)).toBe(false);
      expect(guard(copied)).toBe(false);
      expect(copied instanceof ErrorClass).toBe(false);
    });
  }

  test("preserves native subclass identity while exposing the branded base", () => {
    class NarrowConflictError extends OhConflictError {}

    const base = new OhConflictError("base");
    const narrow = new NarrowConflictError("narrow");
    expect(base).not.toBeInstanceOf(NarrowConflictError);
    expect(narrow).toBeInstanceOf(NarrowConflictError);
    expect(narrow).toBeInstanceOf(OhConflictError);
    expect(isOhConflictError(narrow)).toBe(true);
  });

  test("does not make every operation-size error an instance of a subclass", () => {
    class NarrowSizeError extends OhOperationSizeError {}

    const base = new OhOperationSizeError(2, 1);
    const narrow = new NarrowSizeError(2, 1);
    expect(base).not.toBeInstanceOf(NarrowSizeError);
    expect(narrow).toBeInstanceOf(NarrowSizeError);
    expect(narrow).toBeInstanceOf(OhOperationSizeError);
    expect(isOhOperationSizeError(narrow)).toBe(true);
  });
});
