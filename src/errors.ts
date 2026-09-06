export const OH_OPERATION_SIZE_ERROR_CODE_V1 = "oh.operation-size.v1" as const;

const OH_OPERATION_SIZE_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhOperationSizeError/v1");

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
    return isOhOperationSizeError(value);
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
