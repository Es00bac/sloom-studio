import { describe, expect, it } from 'vitest';
import {
  buildReleaseGateLedgerPaths,
  buildReleaseGatePlan,
  createReleaseGateLedger,
  finalizeReleaseGateLedger,
  formatReleaseGatePlan,
  markReleaseGateStepFinished,
  markReleaseGateStepStarted,
  parseReleaseGateArgs,
} from './release-gate-lib.mjs';

describe('release gate helpers', () => {
  it('builds the local gate from build, lint, unit tests, and browser smoke', () => {
    expect(buildReleaseGatePlan('local').map((step) => step.script)).toEqual([
      'build',
      'lint',
      'test',
      'test:smoke',
    ]);
  });

  it('builds the native gate from existing Electron smoke surfaces', () => {
    expect(buildReleaseGatePlan('native').map((step) => step.script)).toEqual([
      'smoke:native',
      'smoke:native:video-render',
      'smoke:native:project',
      'smoke:native:stress',
      'smoke:native:project:soak',
      'smoke:native:paper:pdf-parity',
    ]);
  });

  it('builds the release gate as local checks followed by native checks', () => {
    expect(buildReleaseGatePlan('release').map((step) => step.script)).toEqual([
      ...buildReleaseGatePlan('local').map((step) => step.script),
      ...buildReleaseGatePlan('native').map((step) => step.script),
    ]);
  });

  it('parses profile and control flags', () => {
    expect(parseReleaseGateArgs(['release', '--dry-run', '--continue-on-error'])).toEqual({
      profile: 'release',
      dryRun: true,
      continueOnError: true,
    });
  });

  it('formats the runnable gate plan for dry-run logs', () => {
    expect(formatReleaseGatePlan('local', buildReleaseGatePlan('local'))).toContain('npm run build');
    expect(formatReleaseGatePlan('local', buildReleaseGatePlan('local'))).toContain('Browser smoke contracts');
  });

  it('builds repo-local release gate ledger paths by profile', () => {
    expect(buildReleaseGateLedgerPaths('/repo', 'native')).toEqual({
      directory: '/repo/output/dev-dashboard/release-gates',
      latest: '/repo/output/dev-dashboard/release-gates/latest.json',
      profileLatest: '/repo/output/dev-dashboard/release-gates/latest-native.json',
    });
  });

  it('tracks release gate step status and duration in a JSON-friendly ledger', () => {
    const steps = buildReleaseGatePlan('local').slice(0, 1);
    let ledger = createReleaseGateLedger({
      profile: 'local',
      steps,
      startedAt: new Date('2026-06-04T10:00:00.000Z'),
      environment: {
        SIGNAL_LOOM_NATIVE_REAL_PROJECT_PATH: '/projects/Chronicle.sloom',
        CI: 'false',
      },
    });

    ledger = markReleaseGateStepStarted(ledger, 'build', new Date('2026-06-04T10:00:01.000Z'));
    ledger = markReleaseGateStepFinished(ledger, 'build', {
      exitCode: 0,
      endedAt: new Date('2026-06-04T10:00:04.500Z'),
    });
    ledger = finalizeReleaseGateLedger(ledger, {
      endedAt: new Date('2026-06-04T10:00:05.000Z'),
    });

    expect(ledger.status).toBe('passed');
    expect(ledger.ok).toBe(true);
    expect(ledger.durationMs).toBe(5000);
    expect(ledger.environment.nativeRealProjectPath).toBe('/projects/Chronicle.sloom');
    expect(ledger.steps[0]).toMatchObject({
      command: 'npm run build',
      status: 'passed',
      exitCode: 0,
      durationMs: 3500,
      stdout: '',
      stderr: '',
    });
  });

  it('records compact redacted release gate stdout and stderr for dashboard evidence', () => {
    const steps = buildReleaseGatePlan('local').slice(0, 1);
    let ledger = createReleaseGateLedger({
      profile: 'local',
      steps,
      startedAt: new Date('2026-06-04T10:00:00.000Z'),
    });

    ledger = markReleaseGateStepStarted(ledger, 'build', new Date('2026-06-04T10:00:01.000Z'));
    ledger = markReleaseGateStepFinished(ledger, 'build', {
      exitCode: 1,
      stdout: `${'build output\n'.repeat(500)}--token=super-secret-token`,
      stderr: 'Authorization: Bearer super-secret-token failed',
      endedAt: new Date('2026-06-04T10:00:04.500Z'),
    });

    expect(ledger.steps[0]).toMatchObject({
      status: 'failed',
      stdout: expect.stringContaining('build output'),
      stderr: 'Authorization: Bearer <redacted> failed',
    });
    expect(ledger.steps[0].stdout).toHaveLength(4000);
    expect(ledger.steps[0].stdout.endsWith('…')).toBe(true);
    expect(JSON.stringify(ledger)).not.toContain('super-secret-token');
  });

  it('finalizes dry-run ledgers as planned instead of passed execution', () => {
    const ledger = finalizeReleaseGateLedger(createReleaseGateLedger({
      profile: 'native',
      steps: buildReleaseGatePlan('native'),
      options: { dryRun: true },
      startedAt: new Date('2026-06-04T10:00:00.000Z'),
    }), {
      endedAt: new Date('2026-06-04T10:00:00.000Z'),
      ok: true,
    });

    expect(ledger.status).toBe('planned');
    expect(ledger.steps.every((step) => step.status === 'planned')).toBe(true);
  });
});
