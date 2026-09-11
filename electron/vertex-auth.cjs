const { accessSync, constants, existsSync, readFileSync, statSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const VALID_VERTEX_AUTH_MODES = new Set(['gcloud-user', 'gcloud-adc']);
const WINDOWS_PLATFORM = process.platform === 'win32';
const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function stripOptionalQuotes(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    if (trimmed.length > 1) {
      return trimmed.slice(1, -1);
    }
    return '';
  }

  return trimmed;
}

function expandHomePath(value) {
  const trimmed = stripOptionalQuotes(value);
  if (!trimmed) {
    return '';
  }

  if (!trimmed.startsWith('~')) {
    return trimmed;
  }

  const rest = trimmed.slice(1);
  if (!rest) {
    return homedir();
  }

  const normalizedRest = rest.startsWith('/') || rest.startsWith('\\') ? rest.slice(1) : rest;
  return join(homedir(), normalizedRest);
}

function toExecutableCandidates(values, extensions) {
  return values
    .map(expandHomePath)
    .filter(Boolean)
    .flatMap((candidate) => {
      if (!extensions.length) {
        return [candidate];
      }

      const candidates = [];
      for (const extension of extensions) {
        candidates.push(candidate.endsWith(extension) ? candidate : `${candidate}${extension}`);
      }
      return candidates;
    });
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      if (existsSync(candidate)) {
        try {
          if (statSync(candidate).isFile()) {
            return candidate;
          }
        } catch {
          continue;
        }
      }
    }
  }

  return undefined;
}

function readVertexAuthValue(candidateValues) {
  for (const candidate of candidateValues) {
    const value = stripOptionalQuotes(candidate);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function resolveGcloudCommand(auth = {}) {
  const environment = parseVertexEnvironmentVariables(auth.environmentVariables);
  const commandExtensions = WINDOWS_PLATFORM
    ? ['.cmd', '.exe', '']
    : [''];

  const explicitCandidates = toExecutableCandidates([
    environment.GCLOUD_BIN,
    environment.GCLOUD_BINARY,
    environment.CLOUDSDK_GCLOUD_BIN,
    process.env.GCLOUD_BIN,
    process.env.GCLOUD_BINARY,
    process.env.SIGNAL_LOOM_GCLOUD_BIN,
    process.env.CLOUDSDK_GCLOUD_BIN,
  ], commandExtensions);

  const explicitResolved = findExecutable(explicitCandidates);
  if (explicitResolved) {
    return explicitResolved;
  }

  const sdkRoots = [
    environment.CLOUDSDK_ROOT,
    environment.CLOUDSDK_HOME,
    environment.CLOUDSDK_ROOT_DIR,
    environment.GOOGLE_CLOUD_SDK,
    environment.GOOGLE_CLOUD_SDK_ROOT,
    process.env.CLOUDSDK_ROOT,
    process.env.CLOUDSDK_HOME,
    process.env.CLOUDSDK_ROOT_DIR,
    process.env.GOOGLE_CLOUD_SDK,
    process.env.GOOGLE_CLOUD_SDK_ROOT,
    join(homedir(), '.config', 'gcloud'),
    join(homedir(), '.local', 'bin'),
    join(homedir(), 'google-cloud-sdk'),
  ];

  const rootCandidates = sdkRoots
    .filter(Boolean)
    .flatMap((root) => [
      join(root, 'bin', 'gcloud'),
      join(root, 'google-cloud-sdk', 'bin', 'gcloud'),
    ]);

  const globalCandidates = WINDOWS_PLATFORM
    ? [
      join('C:/Program Files', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud'),
      join('C:/Program Files (x86)', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud'),
      join(process.env.LOCALAPPDATA || homedir(), 'Programs', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud'),
    ]
    : [
      '/usr/bin/gcloud',
      '/usr/local/bin/gcloud',
      '/opt/google-cloud-sdk/bin/gcloud',
      '/opt/homebrew/bin/gcloud',
      '/snap/bin/gcloud',
    ];

  const fallbackResolved = findExecutable(toExecutableCandidates([...rootCandidates, ...globalCandidates], commandExtensions));
  return fallbackResolved || 'gcloud';
}

function normalizeVertexAuthMode(mode) {
  return VALID_VERTEX_AUTH_MODES.has(mode) ? mode : 'gcloud-user';
}

function resolveVertexAccount(auth = {}) {
  const environment = parseVertexEnvironmentVariables(auth.environmentVariables);
  return readVertexAuthValue([
    environment.GCLOUD_ACCOUNT,
    environment.CLOUDSDK_ACCOUNT,
    environment.GOOGLE_CLOUD_ACCOUNT,
    process.env.GCLOUD_ACCOUNT,
    process.env.CLOUDSDK_ACCOUNT,
    process.env.GOOGLE_CLOUD_ACCOUNT,
  ]);
}

function buildVertexAccessTokenCommand(auth = {}) {
  const environment = parseVertexEnvironmentVariables(auth.environmentVariables);
  const mode = normalizeVertexAuthMode(auth.mode);
  const command = resolveGcloudCommand(auth);
  const account = readVertexAuthValue([
    environment.GCLOUD_ACCOUNT,
    environment.CLOUDSDK_ACCOUNT,
    environment.GOOGLE_CLOUD_ACCOUNT,
    process.env.GCLOUD_ACCOUNT,
    process.env.CLOUDSDK_ACCOUNT,
    process.env.GOOGLE_CLOUD_ACCOUNT,
  ]);

  if (mode === 'gcloud-adc') {
    return {
      command,
      args: ['auth', 'application-default', 'print-access-token'],
    };
  }

  const args = ['auth', 'print-access-token'];
  if (account) {
    args.push('--account', account);
  }

  return {
    command,
    args,
  };
}

function buildVertexLoginCommand(auth = {}) {
  const mode = normalizeVertexAuthMode(auth.mode);
  const command = resolveGcloudCommand(auth);

  if (mode === 'gcloud-adc') {
    return { command, args: ['auth', 'application-default', 'login'] };
  }

  const args = ['auth', 'login'];
  const account = resolveVertexAccount(auth);
  if (account) {
    args.push('--account', account);
  }
  return { command, args };
}

function buildVertexListProjectsCommand(auth = {}) {
  return {
    command: resolveGcloudCommand(auth),
    args: ['projects', 'list', '--format=json'],
  };
}

function parseGcloudProjectsList(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? '[]'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((entry) => ({
      projectId: entry && typeof entry.projectId === 'string' ? entry.projectId : '',
      name: entry && typeof entry.name === 'string' ? entry.name : '',
    }))
    .filter((entry) => entry.projectId);
}

function parseVertexEnvironmentVariables(value) {
  const entries = {};
  const lines = String(value ?? '').split(/\r?\n/g);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const exportAwareLine = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = exportAwareLine.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = exportAwareLine.slice(0, separatorIndex).trim();
    const envValue = stripOptionalQuotes(exportAwareLine.slice(separatorIndex + 1).trim());

    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      continue;
    }

    entries[key] = envValue;
  }

  return entries;
}

function buildVertexAuthEnvironment(auth = {}, baseEnv = process.env) {
  return {
    ...baseEnv,
    ...parseVertexEnvironmentVariables(auth.environmentVariables),
  };
}

function resolveVertexAdcPathCandidates(auth = {}, deps = {}) {
  const platform = deps.platform || process.platform;
  const baseEnv = deps.env || process.env;
  const homeDirectory = deps.homeDirectory || homedir();
  const environment = {
    ...baseEnv,
    ...parseVertexEnvironmentVariables(auth.environmentVariables),
  };
  const candidates = [];
  const explicit = stripOptionalQuotes(environment.GOOGLE_APPLICATION_CREDENTIALS);
  if (explicit) candidates.push(expandHomePath(explicit));

  const cloudSdkConfig = stripOptionalQuotes(environment.CLOUDSDK_CONFIG);
  if (cloudSdkConfig) {
    candidates.push(join(expandHomePath(cloudSdkConfig), 'application_default_credentials.json'));
  }

  if (platform === 'win32') {
    const appData = stripOptionalQuotes(environment.APPDATA) || join(homeDirectory, 'AppData', 'Roaming');
    candidates.push(join(appData, 'gcloud', 'application_default_credentials.json'));
  } else {
    const xdgConfig = stripOptionalQuotes(environment.XDG_CONFIG_HOME) || join(homeDirectory, '.config');
    candidates.push(join(xdgConfig, 'gcloud', 'application_default_credentials.json'));
  }

  return [...new Set(candidates.filter(Boolean))];
}

function parseCredentialMetadata(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The imported Vertex credential file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    throw new Error('The imported Vertex credential JSON is missing its credential type.');
  }
  return {
    credential: parsed,
    projectId: readVertexAuthValue([parsed.project_id, parsed.quota_project_id]),
    quotaProjectId: readVertexAuthValue([parsed.quota_project_id]),
    account: readVertexAuthValue([parsed.account, parsed.client_email]),
  };
}

function normalizeGoogleAccessToken(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value.token === 'string' && value.token.trim()) return value.token.trim();
  if (value && typeof value.access_token === 'string' && value.access_token.trim()) return value.access_token.trim();
  return '';
}

async function getVertexAccessTokenFromAdc(auth = {}, deps = {}) {
  const GoogleAuth = deps.GoogleAuth || require('google-auth-library').GoogleAuth;
  const pathExists = deps.existsSync || existsSync;
  const readCredentialFile = deps.readFileSync || readFileSync;
  const rawImported = typeof auth.credentialJson === 'string' ? auth.credentialJson.trim() : '';
  let metadata = {};
  let source = 'application-default';
  let options = { scopes: [VERTEX_SCOPE] };

  if (rawImported) {
    metadata = parseCredentialMetadata(rawImported);
    options = { ...options, credentials: metadata.credential };
    source = 'imported-json';
  } else {
    const keyFile = resolveVertexAdcPathCandidates(auth, deps).find((candidate) => pathExists(candidate));
    if (keyFile) {
      const raw = String(readCredentialFile(keyFile, 'utf8'));
      metadata = parseCredentialMetadata(raw);
      options = { ...options, keyFile };
      source = 'adc-file';
    } else if (normalizeVertexAuthMode(auth.mode) !== 'gcloud-adc') {
      return undefined;
    }
  }

  const googleAuth = new GoogleAuth(options);
  const client = await googleAuth.getClient();
  const token = normalizeGoogleAccessToken(await client.getAccessToken());
  if (!token) {
    throw new Error('Google Application Default Credentials returned an empty access token.');
  }

  let detectedProjectId = metadata.projectId;
  if (typeof googleAuth.getProjectId === 'function') {
    try {
      detectedProjectId = (await googleAuth.getProjectId()) || detectedProjectId;
    } catch {
      // Some authorized-user ADC files intentionally have no discoverable project; the UI can list one.
    }
  }

  return {
    token,
    source,
    ...(detectedProjectId ? { projectId: detectedProjectId } : {}),
    ...(metadata.quotaProjectId ? { quotaProjectId: metadata.quotaProjectId } : {}),
    ...(metadata.account ? { account: metadata.account } : {}),
  };
}

module.exports = {
  buildVertexAccessTokenCommand,
  resolveGcloudCommand,
  buildVertexAuthEnvironment,
  normalizeVertexAuthMode,
  parseVertexEnvironmentVariables,
  buildVertexLoginCommand,
  buildVertexListProjectsCommand,
  parseGcloudProjectsList,
  resolveVertexAdcPathCandidates,
  getVertexAccessTokenFromAdc,
};
