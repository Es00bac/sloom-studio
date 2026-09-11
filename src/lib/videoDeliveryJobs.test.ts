import { describe, expect, it } from 'vitest';
import {
  cancelVideoDeliveryJob,
  failVideoDeliveryOutput,
  isVideoDeliveryJobForCompositionSignature,
  MAX_CONCURRENT_NATIVE_VIDEO_DELIVERY_JOBS,
  planVideoDeliveryJob,
  resolveVideoDeliveryFileName,
  retryFailedVideoDeliveryOutputs,
  selectNextVideoDeliveryWork,
  startVideoDeliveryOutput,
  succeedVideoDeliveryOutput,
  type VideoDeliveryPlanningEnvironment,
  type VideoDeliveryProfile,
} from './videoDeliveryJobs';

const environment: VideoDeliveryPlanningEnvironment = {
  native: {
    available: true,
    capabilities: ['encode:h264', 'encode:prores', 'mux:mp4', 'mux:mov', 'checksum:sha256'],
  },
  browser: {
    available: true,
    capabilities: ['encode:h264', 'mux:mp4'],
  },
};

function profile(outputs: VideoDeliveryProfile['outputs']): VideoDeliveryProfile {
  return {
    version: 1,
    id: 'delivery-profile',
    name: 'Editorial delivery',
    fileNameTemplate: '{project}-{composition}-{deliverable}-{date}',
    outputs,
  };
}

function plan(outputs: VideoDeliveryProfile['outputs']) {
  return planVideoDeliveryJob({
    jobId: 'job-001',
    createdAt: '2026-08-16T12:00:00.000Z',
    profile: profile(outputs),
    composition: {
      compositionId: 'composition-1',
      compositionName: 'Final Cut',
      compositionSignature: 'sha256:frozen-composition',
      revision: 'r7',
    },
    environment,
    fileNameTokens: {
      project: 'Feature Project',
      date: '2026-08-16',
    },
  });
}

describe('Video delivery planning', () => {
  it('freezes a composition signature and plans native and browser outputs truthfully', () => {
    const job = plan([
      {
        id: 'master',
        label: 'Master',
        extension: 'mov',
        container: 'QuickTime',
        codec: 'ProRes 422 HQ',
        requestedTarget: 'native',
        requiredCapabilities: ['encode:prores', 'mux:mov'],
      },
      {
        id: 'review',
        label: 'Review',
        extension: 'mp4',
        container: 'MP4',
        codec: 'H.264',
        requestedTarget: 'browser',
        requiredCapabilities: ['encode:h264', 'mux:mp4'],
        checksum: 'none',
      },
    ]);

    expect(job.frozenCompositionSignature).toBe('sha256:frozen-composition');
    expect(isVideoDeliveryJobForCompositionSignature(job, 'sha256:frozen-composition')).toBe(true);
    expect(job.outputs[0]).toMatchObject({ target: 'native', executionDurability: 'native-host-resume-required', status: 'queued' });
    expect(job.outputs[0].truthfulnessNote).toContain('planner performs no IPC');
    expect(job.outputs[1]).toMatchObject({ target: 'browser', executionDurability: 'browser-session-only', status: 'queued' });
    expect(job.outputs[1].truthfulnessNote).toContain('cannot resume');
    expect(job.manifestIntent).toEqual({
      format: 'sloom-video-delivery-manifest-v1',
      includeFrozenCompositionSignature: true,
      includeOutputChecksums: true,
    });
    expect(Object.isFrozen(job)).toBe(true);
    expect(Object.isFrozen(job.outputs)).toBe(true);
    expect(Object.isFrozen(job.outputs[0])).toBe(true);
  });

  it('resolves filename tokens, unsafe characters, and case-insensitive collisions', () => {
    const job = planVideoDeliveryJob({
      jobId: 'job-collisions',
      createdAt: '2026-08-16T12:00:00Z',
      profile: profile([
        { id: 'review-a', label: 'Review', extension: '.MP4', container: 'MP4', codec: 'H.264' },
        { id: 'review-b', label: 'Review', extension: 'mp4', container: 'MP4', codec: 'H.264' },
      ]),
      composition: {
        compositionId: 'comp',
        compositionName: 'Cut: 01',
        compositionSignature: 'signature',
      },
      environment,
      fileNameTokens: { project: 'Feature/Project', date: '2026-08-16' },
      existingFileNames: ['feature-project-cut-01-review-2026-08-16.mp4'],
    });

    expect(job.outputs.map((output) => output.fileName)).toEqual([
      'Feature-Project-Cut-01-Review-2026-08-16-2.mp4',
      'Feature-Project-Cut-01-Review-2026-08-16-3.mp4',
    ]);
    expect(() => resolveVideoDeliveryFileName({
      template: '{project}-{unknown}',
      extension: 'mp4',
      tokens: { project: 'Feature', date: '2026-08-16' },
    })).toThrow(/Unknown delivery filename token/);
  });

  it('blocks unsupported outputs with explicit missing capabilities', () => {
    const job = plan([
      {
        id: 'imf',
        label: 'IMF package',
        extension: 'mxf',
        container: 'IMF',
        codec: 'JPEG 2000',
        requestedTarget: 'native',
        supportedTargets: ['native'],
        requiredCapabilities: ['encode:j2k', 'mux:imf'],
      },
    ]);
    expect(job.status).toBe('blocked');
    expect(job.outputs[0]).toMatchObject({
      status: 'blocked',
      executionDurability: 'blocked',
      missingCapabilities: ['encode:j2k', 'mux:imf'],
    });
    expect(job.outputs[0].blockedReason).toContain('No available native target provides');
  });
});

describe('Video delivery immutable execution state', () => {
  const outputs: VideoDeliveryProfile['outputs'] = [
    {
      id: 'master',
      label: 'Master',
      extension: 'mov',
      container: 'QuickTime',
      codec: 'ProRes',
      requestedTarget: 'native',
      requiredCapabilities: ['encode:prores', 'mux:mov'],
    },
    {
      id: 'review',
      label: 'Review',
      extension: 'mp4',
      container: 'MP4',
      codec: 'H.264',
      requestedTarget: 'native',
      requiredCapabilities: ['encode:h264', 'mux:mp4'],
    },
  ];

  it('handles partial failure and retries only failed deliverables', () => {
    const initial = plan(outputs);
    const masterRunning = startVideoDeliveryOutput(initial, 'master');
    const masterDone = succeedVideoDeliveryOutput(masterRunning, 'master', {
      byteSize: 5_000,
      checksum: 'abc123',
      manifestPath: '/delivery/master.manifest.json',
    });
    const reviewRunning = startVideoDeliveryOutput(masterDone, 'review');
    const partial = failVideoDeliveryOutput(reviewRunning, 'review', 'Encoder exited with code 1.');

    expect(initial.outputs[0].status).toBe('queued');
    expect(masterRunning.outputs[0]).toMatchObject({ status: 'running', attempts: 1 });
    expect(masterDone.outputs[0].result).toEqual({
      byteSize: 5_000,
      checksum: 'abc123',
      manifestPath: '/delivery/master.manifest.json',
    });
    expect(partial.status).toBe('partial-failure');
    expect(partial.outputs.map((output) => output.status)).toEqual(['succeeded', 'failed']);

    const retried = retryFailedVideoDeliveryOutputs(partial);
    expect(retried.status).toBe('queued');
    expect(retried.outputs.map((output) => output.status)).toEqual(['succeeded', 'queued']);
    const completed = succeedVideoDeliveryOutput(startVideoDeliveryOutput(retried, 'review'), 'review');
    expect(completed.status).toBe('completed');
    expect(completed.outputs[1].attempts).toBe(2);
  });

  it('enforces one native job at a time and browser session availability', () => {
    const nativeJob = plan(outputs.slice(0, 1));
    expect(MAX_CONCURRENT_NATIVE_VIDEO_DELIVERY_JOBS).toBe(1);
    expect(selectNextVideoDeliveryWork([nativeJob], { activeNativeJobs: 1 })).toBeUndefined();
    expect(() => startVideoDeliveryOutput(nativeJob, 'master', { activeNativeJobs: 1 }))
      .toThrow(/Only one native/);

    const firstRunning = startVideoDeliveryOutput(plan(outputs), 'master');
    expect(selectNextVideoDeliveryWork([firstRunning])).toBeUndefined();
    expect(() => startVideoDeliveryOutput(firstRunning, 'review')).toThrow(/Only one native/);

    const browserJob = plan([{
      id: 'browser-review',
      label: 'Browser Review',
      extension: 'mp4',
      container: 'MP4',
      codec: 'H.264',
      requestedTarget: 'browser',
      requiredCapabilities: ['encode:h264', 'mux:mp4'],
    }]);
    expect(selectNextVideoDeliveryWork([browserJob], { browserSessionAvailable: false })).toBeUndefined();
    expect(() => startVideoDeliveryOutput(browserJob, 'browser-review', { browserSessionAvailable: false }))
      .toThrow(/active renderer session/);
  });

  it('cancels queued/running work without mutating succeeded output state', () => {
    const initial = plan(outputs);
    const masterDone = succeedVideoDeliveryOutput(startVideoDeliveryOutput(initial, 'master'), 'master');
    const canceled = cancelVideoDeliveryJob(masterDone);
    expect(canceled.status).toBe('canceled');
    expect(canceled.outputs.map((output) => output.status)).toEqual(['succeeded', 'canceled']);
    expect(masterDone.outputs.map((output) => output.status)).toEqual(['succeeded', 'queued']);
  });
});
