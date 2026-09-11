import type { ProviderSettings } from '../../types/flow';
import { getVertexProjectConfig } from '../vertexProviderSettings';

export type VertexAuthPlatform = 'desktop' | 'mobile';
export type VertexAuthSource = 'gcloud' | 'adc-json' | 'service-account' | 'env-var' | 'none';
export type VertexAuthBlocker = 'not-vertex-mode' | 'no-project' | 'no-credential';

export interface VertexAuthStatus {
  source: VertexAuthSource;
  configured: boolean;
  blockers: VertexAuthBlocker[];
}

function hasEnvCredential(settings: ProviderSettings): boolean {
  return /(^|\n)\s*(export\s+)?GOOGLE_APPLICATION_CREDENTIALS\s*=/.test(settings.vertexEnvironmentVariables ?? '');
}

function resolveSource(settings: ProviderSettings, platform: VertexAuthPlatform): VertexAuthSource {
  if ((settings.vertexServiceAccountJson ?? '').trim()) {
    try {
      const parsed = JSON.parse(settings.vertexServiceAccountJson) as { type?: unknown };
      return parsed.type === 'service_account' ? 'service-account' : 'adc-json';
    } catch {
      return 'adc-json';
    }
  }
  if (hasEnvCredential(settings)) {
    return 'env-var';
  }
  if (platform === 'desktop') {
    return 'gcloud';
  }
  return 'none';
}

export function computeVertexAuthStatus(
  settings: ProviderSettings,
  platform: VertexAuthPlatform,
): VertexAuthStatus {
  if (settings.geminiCredentialMode !== 'vertex-adc') {
    return { source: 'none', configured: false, blockers: ['not-vertex-mode'] };
  }

  const blockers: VertexAuthBlocker[] = [];
  const source = resolveSource(settings, platform);
  const { projectId } = getVertexProjectConfig(settings);

  if (!projectId) {
    blockers.push('no-project');
  }
  if (source === 'none') {
    blockers.push('no-credential');
  }

  return { source, configured: blockers.length === 0, blockers };
}
