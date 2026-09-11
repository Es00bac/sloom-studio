/**
 * A persisted API Requester credential is deliberately represented by an exact
 * machine marker, not a display string.  `[redacted]` is ordinary editorial
 * text and must remain runnable when it appears in a prompt or other safe
 * request field.
 */
export const API_REQUESTER_PERSISTED_CREDENTIAL_MARKER = '__SLOOM_API_REQUESTER_CREDENTIAL_REDACTED__';

const CREDENTIAL_FIELD_NAMES = new Set([
  'apikey',
  'authorization',
  'auth',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'password',
  'secret',
  'token',
  'cookie',
  'setcookie',
]);

function normalizeCredentialFieldName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '');
}

export function isApiRequesterCredentialFieldName(name: string): boolean {
  return CREDENTIAL_FIELD_NAMES.has(normalizeCredentialFieldName(name));
}

export function isApiRequesterSensitiveHeaderName(name: string): boolean {
  return isApiRequesterCredentialFieldName(name)
    || /^x-(?:api-key|client-secret|access-token|auth-token)$/i.test(name.trim());
}

export function isPersistedApiRequesterCredential(value: unknown): boolean {
  return value === API_REQUESTER_PERSISTED_CREDENTIAL_MARKER;
}
