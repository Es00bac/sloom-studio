import path from 'node:path';

export const RELEASE_GATE_PROFILES = {
  local: [
    { script: 'build', label: 'TypeScript and Vite production build' },
    { script: 'lint', label: 'ESLint' },
    { script: 'test', label: 'Vitest unit suite' },
    { script: 'test:smoke', label: 'Browser smoke contracts' },
  ],
  native: [
    { script: 'smoke:native', label: 'Native save/open/import/Paper export smoke' },
    { script: 'smoke:native:video-render', label: 'Native Video render smoke' },
    { script: 'smoke:native:project', label: 'Native real-project startup smoke' },
    { script: 'smoke:native:stress', label: 'Native source-library stress smoke' },
    { script: 'smoke:native:project:soak', label: 'Native real-project soak smoke' },
    { script: 'smoke:native:paper:pdf-parity', label: 'Native Paper PDF parity evidence smoke' },
  ],
};

export const RELEASE_GATE_LEDGER_SCHEMA_VERSION = 1;
export const RELEASE_GATE_LEDGER_RELATIVE_DIR = 'output/dev-dashboard/release-gates';
export const RELEASE_GATE_STEP_OUTPUT_MAX_LENGTH = 4000;

export function parseReleaseGateArgs(argv) {
  const args = [...argv];
  const profileArg = args.find((arg) => !arg.startsWith('--')) ?? 'local';
  const profile = normalizeProfile(profileArg);

  return {
    profile,
    dryRun: args.includes('--dry-run'),
    continueOnError: args.includes('--continue-on-error'),
  };
}

export function buildReleaseGatePlan(profile) {
  const normalizedProfile = normalizeProfile(profile);

  if (normalizedProfile === 'release') {
    return [
      ...RELEASE_GATE_PROFILES.local,
      ...RELEASE_GATE_PROFILES.native,
    ];
  }

  return [...RELEASE_GATE_PROFILES[normalizedProfile]];
}

export function formatReleaseGatePlan(profile, steps) {
  const lines = [`Signal Loom ${profile} gate: ${steps.length} step${steps.length === 1 ? '' : 's'}`];

  for (const [index, step] of steps.entries()) {
    lines.push(`${index + 1}. npm run ${step.script} - ${step.label}`);
  }

  return lines.join('\n');
}

export function buildReleaseGateLedgerPaths(repoRoot, profile) {
  const normalizedProfile = normalizeProfile(profile);
  const directory = path.join(repoRoot, RELEASE_GATE_LEDGER_RELATIVE_DIR);

  return {
    directory,
    latest: path.join(directory, 'latest.json'),
    profileLatest: path.join(directory, `latest-${normalizedProfile}.json`),
  };
}

export function createReleaseGateLedger({
  profile,
  steps,
  options = {},
  startedAt = new Date(),
  environment = {},
} = {}) {
  const normalizedProfile = normalizeProfile(profile);
  const startedAtIso = toIsoString(startedAt);

  return {
    schemaVersion: RELEASE_GATE_LEDGER_SCHEMA_VERSION,
    profile: normalizedProfile,
    status: 'running',
    ok: false,
    startedAt: startedAtIso,
    endedAt: null,
    durationMs: null,
    options: {
      dryRun: Boolean(options.dryRun),
      continueOnError: Boolean(options.continueOnError),
    },
    environment: normalizeReleaseGateEnvironment(environment),
    steps: steps.map((step, index) => ({
      index: index + 1,
      script: step.script,
      label: step.label,
      command: `npm run ${step.script}`,
      status: options.dryRun ? 'planned' : 'pending',
      exitCode: null,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      stdout: '',
      stderr: '',
    })),
  };
}

export function markReleaseGateStepStarted(ledger, script, startedAt = new Date()) {
  return updateReleaseGateStep(ledger, script, (step) => ({
    ...step,
    status: 'running',
    startedAt: toIsoString(startedAt),
    endedAt: null,
    durationMs: null,
    exitCode: null,
    stdout: '',
    stderr: '',
  }));
}

export function markReleaseGateStepFinished(ledger, script, {
  exitCode,
  stdout = '',
  stderr = '',
  endedAt = new Date(),
} = {}) {
  const endedAtIso = toIsoString(endedAt);

  return updateReleaseGateStep(ledger, script, (step) => ({
    ...step,
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    endedAt: endedAtIso,
    durationMs: step.startedAt ? Math.max(0, new Date(endedAtIso).getTime() - new Date(step.startedAt).getTime()) : null,
    stdout: compactReleaseGateOutput(stdout),
    stderr: compactReleaseGateOutput(stderr),
  }));
}

export function compactReleaseGateOutput(value, maxLength = RELEASE_GATE_STEP_OUTPUT_MAX_LENGTH) {
  const text = redactReleaseGateOutput(value).trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function finalizeReleaseGateLedger(ledger, {
  endedAt = new Date(),
  ok,
} = {}) {
  const endedAtIso = toIsoString(endedAt);
  const steps = ledger.steps.map((step) => step.status === 'running'
    ? { ...step, status: 'failed', endedAt: endedAtIso, durationMs: step.startedAt ? Math.max(0, new Date(endedAtIso).getTime() - new Date(step.startedAt).getTime()) : null }
    : step);
  const failed = steps.some((step) => step.status === 'failed');
  const allPlanned = steps.every((step) => step.status === 'planned');
  const passed = ok ?? (!failed && steps.every((step) => step.status === 'passed' || step.status === 'planned'));

  return {
    ...ledger,
    status: allPlanned ? 'planned' : passed ? 'passed' : 'failed',
    ok: passed,
    endedAt: endedAtIso,
    durationMs: ledger.startedAt ? Math.max(0, new Date(endedAtIso).getTime() - new Date(ledger.startedAt).getTime()) : null,
    steps,
  };
}

function normalizeProfile(profile) {
  if (profile === 'local' || profile === 'native' || profile === 'release') {
    return profile;
  }

  throw new Error(`Unknown release gate profile "${profile}". Use local, native, or release.`);
}

function updateReleaseGateStep(ledger, script, update) {
  let found = false;
  const steps = ledger.steps.map((step) => {
    if (step.script !== script) return step;
    found = true;
    return update(step);
  });

  if (!found) {
    throw new Error(`Release gate ledger does not contain step "${script}".`);
  }

  return { ...ledger, steps };
}

function normalizeReleaseGateEnvironment(environment) {
  return {
    nativeRealProjectPath: String(environment.SIGNAL_LOOM_NATIVE_REAL_PROJECT_PATH || '').trim(),
    ci: String(environment.CI || '').trim(),
  };
}

function redactReleaseGateOutput(value) {
  return String(value ?? '')
    .replace(/Authorization:\s*Bearer\s+[^\s'"`]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/(X-Signal-Loom-[A-Za-z-]*Token:\s*)[^\s'"`]+/gi, '$1<redacted>')
    .replace(/--token=([^\s'"`]+)/g, '--token=<redacted>')
    .replace(/--token\s+([^\s'"`]+)/g, '--token <redacted>')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|AUTH_KEY)[A-Z0-9_]*=)[^\s'"`]+/gi, '$1<redacted>');
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
