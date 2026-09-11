'use strict';

/**
 * Electron Builder requires SemVer package metadata, while Sloom Studio's
 * internal desktop builds use a compact human-facing suffix such as 0.9.12e.
 */
function formatInternalBuildVersion(version) {
  const value = typeof version === 'string' ? version.trim() : '';
  return value.replace(/-([a-z])$/i, '$1');
}

module.exports = { formatInternalBuildVersion };
