export const OH_OPERATION_SIZE_ERROR_CODE_V1 = "oh.operation-size.v1" as const;

const OH_CONFLICT_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhConflictError/v1");
const OH_DEPENDENCY_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhDependencyError/v1");
const OH_INTEGRITY_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhIntegrityError/v1");
const OH_OPERATION_SIZE_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhOperationSizeError/v1");
const OH_PROFILE_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhProfileError/v1");

function immutableOwnValue(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined
      && descriptor.get === undefined
      && descriptor.set === undefined
      && descriptor.configurable === false
      && descriptor.writable === false
    ? descriptor.value
    : undefined;
}

function brandNativeError(value: Error, brand: symbol): void {
  Object.defineProperty(value, brand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
}

function hasNativeErrorBrand(value: unknown, brand: symbol): boolean {
  try {
    return Error.isError(value) && immutableOwnValue(value, brand) === true;
  } catch {
    return false;
  }
}

function hasNativeSubclassInstance(constructor: Function, value: unknown): boolean {
  return Function.prototype[Symbol.hasInstance].call(constructor, value);
}

/** Recognizes a compare-and-swap conflict across separately bundled Oh entrypoints. */
export function isOhConflictError(value: unknown): value is OhConflictError {
  return hasNativeErrorBrand(value, OH_CONFLICT_ERROR_BRAND_V1);
}

export class OhConflictError extends Error {
  static override [Symbol.hasInstance](value: unknown): boolean {
    return this === OhConflictError
      ? isOhConflictError(value)
      : hasNativeSubclassInstance(this, value);
  }

  constructor(message: string) {
    super(message);
    this.name = "OhConflictError";
    brandNativeError(this, OH_CONFLICT_ERROR_BRAND_V1);
  }
}

/** Recognizes an authority-integrity failure across separately bundled Oh entrypoints. */
export function isOhIntegrityError(value: unknown): value is OhIntegrityError {
  return hasNativeErrorBrand(value, OH_INTEGRITY_ERROR_BRAND_V1);
}

export class OhIntegrityError extends Error {
  static override [Symbol.hasInstance](value: unknown): boolean {
    return this === OhIntegrityError
      ? isOhIntegrityError(value)
      : hasNativeSubclassInstance(this, value);
  }

  constructor(message: string) {
    super(message);
    this.name = "OhIntegrityError";
    brandNativeError(this, OH_INTEGRITY_ERROR_BRAND_V1);
  }
}

/** Recognizes a missing-dependency failure across separately bundled Oh entrypoints. */
export function isOhDependencyError(value: unknown): value is OhDependencyError {
  return hasNativeErrorBrand(value, OH_DEPENDENCY_ERROR_BRAND_V1);
}

export class OhDependencyError extends Error {
  static override [Symbol.hasInstance](value: unknown): boolean {
    return this === OhDependencyError
      ? isOhDependencyError(value)
      : hasNativeSubclassInstance(this, value);
  }

  constructor(message: string) {
    super(message);
    this.name = "OhDependencyError";
    brandNativeError(this, OH_DEPENDENCY_ERROR_BRAND_V1);
  }
}

/** Recognizes a store-profile refusal across separately bundled Oh entrypoints. */
export function isOhProfileError(value: unknown): value is OhProfileError {
  return hasNativeErrorBrand(value, OH_PROFILE_ERROR_BRAND_V1);
}

export class OhProfileError extends Error {
  static override [Symbol.hasInstance](value: unknown): boolean {
    return this === OhProfileError
      ? isOhProfileError(value)
      : hasNativeSubclassInstance(this, value);
  }

  constructor(message: string) {
    super(message);
    this.name = "OhProfileError";
    brandNativeError(this, OH_PROFILE_ERROR_BRAND_V1);
  }
}

/**
 * Recognizes this precommit refusal across separately bundled Oh entrypoints.
 * Native Error identity plus immutable branded fields excludes copied plain
 * objects while preserving one stable discriminator for package consumers.
 */
export function isOhOperationSizeError(value: unknown): value is OhOperationSizeError {
  try {
    if (!Error.isError(value) || !(value instanceof RangeError)) return false;
    const operationBytes = immutableOwnValue(value, "operationBytes");
    const maximumOperationBytes = immutableOwnValue(value, "maximumOperationBytes");
    return immutableOwnValue(value, OH_OPERATION_SIZE_ERROR_BRAND_V1) === true
      && immutableOwnValue(value, "code") === OH_OPERATION_SIZE_ERROR_CODE_V1
      && Number.isSafeInteger(operationBytes)
      && (operationBytes as number) > 0
      && Number.isSafeInteger(maximumOperationBytes)
      && (maximumOperationBytes as number) > 0
      && (operationBytes as number) > (maximumOperationBytes as number);
  } catch {
    return false;
  }
}

export class OhOperationSizeError extends RangeError {
  declare readonly code: typeof OH_OPERATION_SIZE_ERROR_CODE_V1;
  declare readonly maximumOperationBytes: number;
  declare readonly operationBytes: number;

  static override [Symbol.hasInstance](value: unknown): boolean {
    return this === OhOperationSizeError
      ? isOhOperationSizeError(value)
      : hasNativeSubclassInstance(this, value);
  }

  constructor(operationBytes: number, maximumOperationBytes: number) {
    if (!Number.isSafeInteger(operationBytes) || operationBytes < 1
      || !Number.isSafeInteger(maximumOperationBytes) || maximumOperationBytes < 1
      || operationBytes <= maximumOperationBytes) {
      throw new TypeError("Invalid Oh operation size refusal.");
    }
    super(`The ${operationBytes}-byte operation exceeds the host-declared ${maximumOperationBytes}-byte canonical bound.`);
    this.name = "OhOperationSizeError";
    Object.defineProperties(this, {
      [OH_OPERATION_SIZE_ERROR_BRAND_V1]: {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false,
      },
      code: {
        configurable: false,
        enumerable: true,
        value: OH_OPERATION_SIZE_ERROR_CODE_V1,
        writable: false,
      },
      maximumOperationBytes: {
        configurable: false,
        enumerable: true,
        value: maximumOperationBytes,
        writable: false,
      },
      operationBytes: {
        configurable: false,
        enumerable: true,
        value: operationBytes,
        writable: false,
      },
    });
  }
}
