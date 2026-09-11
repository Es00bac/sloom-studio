import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VertexAuthPanel } from './VertexAuthPanel';
import { DEFAULT_PROVIDER_SETTINGS } from '../../lib/providerCatalog';
import type { VertexAuthStatus } from '../../lib/vertex/vertexAuthStatus';

const baseStatus: VertexAuthStatus = { source: 'gcloud', configured: true, blockers: [] };

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'desktop' as const,
    providerSettings: { ...DEFAULT_PROVIDER_SETTINGS, vertexProjectId: 'proj-1' },
    setProviderSetting: vi.fn(),
    status: baseStatus,
    projects: [{ projectId: 'proj-1', name: 'Project One' }],
    busy: {},
    testResult: null,
    serviceAccountError: undefined,
    onSignIn: vi.fn(),
    onDetect: vi.fn(),
    onRefreshProjects: vi.fn(),
    onTestConnection: vi.fn(),
    onServiceAccountFile: vi.fn(),
    ...overrides,
  };
}

describe('VertexAuthPanel', () => {
  it('renders browser sign-in, built-in ADC import, and the project picker on desktop', () => {
    const html = renderToStaticMarkup(<VertexAuthPanel {...baseProps()} />);
    expect(html).toContain('Google browser sign-in');
    expect(html).toContain('Built-in ADC import works without a terminal');
    expect(html).toContain('Project One');
    expect(html).toContain('Test connection');
  });

  it('renders ADC import on mobile and hides browser sign-in', () => {
    const html = renderToStaticMarkup(<VertexAuthPanel {...baseProps({
      platform: 'mobile',
      status: { source: 'none', configured: false, blockers: ['no-credential'] },
    })} />);
    expect(html).toContain('ADC authorized-user or service-account JSON');
    expect(html).not.toContain('Google browser sign-in');
  });

  it('shows the status badge text derived from status', () => {
    const html = renderToStaticMarkup(<VertexAuthPanel {...baseProps({
      status: { source: 'none', configured: false, blockers: ['no-project', 'no-credential'] },
    })} />);
    expect(html.toLowerCase()).toContain('not');
  });

  it('shows a service-account validation error when provided', () => {
    const html = renderToStaticMarkup(<VertexAuthPanel {...baseProps({
      platform: 'mobile',
      serviceAccountError: 'Service-account key is missing project_id.',
    })} />);
    expect(html).toContain('missing project_id');
  });
});
