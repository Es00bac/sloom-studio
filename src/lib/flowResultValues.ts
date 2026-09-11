import type { ResultType, ResultValue } from '../types/flow';
import scalarContract from '../../shared/flow-result-value-contract.json';

/** Returns a Boolean only for the canonical, persisted Boolean spellings. */
export function parseCanonicalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === scalarContract.boolean.true) return true;
  if (value === scalarContract.boolean.false) return false;
  return undefined;
}

/**
 * The one persisted scalar restoration boundary shared with Electron. It is
 * type-aware: legacy Boolean strings are accepted only for Boolean results.
 */
export function restoreResultValue(value: unknown, resultType: ResultType): ResultValue | undefined {
  return resultType === 'boolean'
    ? parseCanonicalBoolean(value)
    : typeof value === 'string' ? value : undefined;
}

/** A container payload is always a string, including Boolean list/envelope items. */
export function serializeResultValueForContainer(value: ResultValue, resultType: ResultType): string {
  if (resultType === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new Error('Boolean result containers require a canonical Boolean value.');
    }
    return value ? 'true' : 'false';
  }
  if (typeof value !== 'string') {
    throw new Error(`${resultType} result containers require a string value.`);
  }
  return value;
}

/** Restores a container payload at a scalar node/history/project boundary. */
export function deserializeResultValueFromContainer(
  value: string,
  resultType: ResultType,
): ResultValue | undefined {
  return restoreResultValue(value, resultType);
}

/** Media APIs only accept URLs/data URLs; Boolean values must never flow into them. */
export function resultValueAsMediaUrl(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function resultValueForType(value: unknown, resultType: ResultType): ResultValue | undefined {
  return restoreResultValue(value, resultType);
}
