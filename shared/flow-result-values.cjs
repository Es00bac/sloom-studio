'use strict';

const scalarContract = require('./flow-result-value-contract.json');

/**
 * The persisted spelling is deliberately exact. Do not trim, fold case, or
 * use truthiness here: this is a migration boundary for untrusted projects.
 */
function parseCanonicalBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === scalarContract.boolean.true) return true;
  if (value === scalarContract.boolean.false) return false;
  return undefined;
}

/**
 * Restores a persisted scalar according to its declared result type. Boolean
 * strings are only accepted at a Boolean boundary and become real booleans;
 * all other scalar result types retain their string-only representation.
 */
function restoreCanonicalScalarResult(value, resultType) {
  return resultType === 'boolean'
    ? parseCanonicalBoolean(value)
    : typeof value === 'string' ? value : undefined;
}

module.exports = {
  parseCanonicalBoolean,
  restoreCanonicalScalarResult,
};
