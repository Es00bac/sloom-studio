import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER_SETTINGS } from '../providerCatalog';
import { computeVertexAuthStatus } from './vertexAuthStatus';
import type { ProviderSettings } from '../../types/flow';

function settings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return { ...DEFAULT_PROVIDER_SETTINGS, ...overrides };
}

describe('computeVertexAuthStatus', () => {
  it('flags not-vertex-mode when credential mode is api-key', () => {
    const status = computeVertexAuthStatus(settings({ geminiCredentialMode: 'api-key' }), 'desktop');
    expect(status.source).toBe('none');
    expect(status.configured).toBe(false);
    expect(status.blockers).toContain('not-vertex-mode');
  });

  it('treats desktop vertex-adc with a project as gcloud-configured', () => {
    const status = computeVertexAuthStatus(
      settings({ geminiCredentialMode: 'vertex-adc', vertexProjectId: 'proj-1' }),
      'desktop',
    );
    expect(status.source).toBe('gcloud');
    expect(status.configured).toBe(true);
    expect(status.blockers).toEqual([]);
  });

  it('flags no-project on desktop when project is empty and no env project is set', () => {
    const status = computeVertexAuthStatus(
      settings({ geminiCredentialMode: 'vertex-adc', vertexProjectId: '', vertexEnvironmentVariables: '' }),
      'desktop',
    );
    expect(status.blockers).toContain('no-project');
    expect(status.configured).toBe(false);
  });

  it('reports service-account source on mobile when JSON is present', () => {
    const status = computeVertexAuthStatus(
      settings({ geminiCredentialMode: 'vertex-adc', vertexProjectId: 'proj-1', vertexServiceAccountJson: '{"type":"service_account"}' }),
      'mobile',
    );
    expect(status.source).toBe('service-account');
    expect(status.configured).toBe(true);
  });

  it('reports imported ADC JSON distinctly from service accounts', () => {
    const status = computeVertexAuthStatus(
      settings({ geminiCredentialMode: 'vertex-adc', vertexProjectId: 'proj-1', vertexServiceAccountJson: '{"type":"authorized_user"}' }),
      'desktop',
    );
    expect(status.source).toBe('adc-json');
    expect(status.configured).toBe(true);
  });

  it('flags no-credential on mobile without service-account JSON', () => {
    const status = computeVertexAuthStatus(
      settings({ geminiCredentialMode: 'vertex-adc', vertexProjectId: 'proj-1', vertexServiceAccountJson: '' }),
      'mobile',
    );
    expect(status.source).toBe('none');
    expect(status.blockers).toContain('no-credential');
  });

  it('detects env-var credential source when GOOGLE_APPLICATION_CREDENTIALS is set', () => {
    const status = computeVertexAuthStatus(
      settings({
        geminiCredentialMode: 'vertex-adc',
        vertexProjectId: 'proj-1',
        vertexEnvironmentVariables: 'GOOGLE_APPLICATION_CREDENTIALS=/secure/sa.json',
      }),
      'desktop',
    );
    expect(status.source).toBe('env-var');
    expect(status.configured).toBe(true);
  });
});
