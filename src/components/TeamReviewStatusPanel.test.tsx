// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/deviceIdentity', () => ({ getLocalDeviceId: () => 'desktop-1' }));
vi.mock('../lib/androidLanServer', () => ({ isAndroidLanServerAvailable: () => false }));
vi.mock('../lib/teamReviewSync', () => ({
  getTeamReviewState: () => ({ version: 1, revision: 3, members: [{ actorId: 'desktop-1', label: 'Desktop browser', role: 'reviewer', joinedAt: 1 }], threads: [], appliedOperationIds: [] }),
  makeTeamReviewOperation: vi.fn(),
  submitTeamReviewOperation: vi.fn(async () => true),
  subscribeTeamReviewState: vi.fn(() => () => undefined),
}));

import { TeamReviewStatusPanel } from './TeamReviewStatusPanel';

describe('TeamReviewStatusPanel', () => {
  it('mounts the paired authoritative review status and its honest boundary', () => {
    const markup = renderToStaticMarkup(<TeamReviewStatusPanel />);
    expect(markup).toContain('data-team-review-panel="true"');
    expect(markup).toContain('Phone-authoritative');
    expect(markup).toContain('hosted cloud accounts and internet continuity are not included');
    expect(markup).toContain('Start review thread');
  });
});
