import type { ProviderSettings, VertexAuthMode, VertexNativeAuthConfig } from '../types/flow';

export function normalizeVertexAuthMode(mode: ProviderSettings['vertexAuthMode'] | undefined): VertexAuthMode {
  return mode === 'gcloud-adc' ? 'gcloud-adc' : 'gcloud-user';
}

export function buildNativeVertexAuthConfig(providerSettings: ProviderSettings): VertexNativeAuthConfig {
  const environment = parseVertexEnvironmentVariables(providerSettings.vertexEnvironmentVariables);
  const quotaProjectId = providerSettings.vertexQuotaProjectId.trim();
  const environmentVariables = providerSettings.vertexEnvironmentVariables.trim();
  const credentialJson = providerSettings.vertexServiceAccountJson.trim();

  return {
    mode: normalizeVertexAuthMode(providerSettings.vertexAuthMode),
    ...(quotaProjectId || environment.GOOGLE_CLOUD_QUOTA_PROJECT
      ? { quotaProjectId: quotaProjectId || environment.GOOGLE_CLOUD_QUOTA_PROJECT }
      : {}),
    ...(environmentVariables ? { environmentVariables } : {}),
    ...(credentialJson ? { credentialJson } : {}),
  };
}

export function getVertexProjectConfig(providerSettings: ProviderSettings): {
  projectId: string;
  location: string;
  auth: VertexNativeAuthConfig;
} {
  const environment = parseVertexEnvironmentVariables(providerSettings.vertexEnvironmentVariables);

  return {
    projectId:
      providerSettings.vertexProjectId.trim()
      || environment.GOOGLE_CLOUD_PROJECT
      || environment.CLOUDSDK_CORE_PROJECT
      || environment.CLOUDSDK_PROJECT
      || environment.GCLOUD_PROJECT
      || '',
    location:
      providerSettings.vertexLocation.trim()
      || environment.GOOGLE_CLOUD_LOCATION
      || environment.CLOUDSDK_COMPUTE_REGION
      || 'global',
    auth: buildNativeVertexAuthConfig(providerSettings),
  };
}

export function isVertexProjectConfigured(providerSettings: ProviderSettings): boolean {
  const { projectId } = getVertexProjectConfig(providerSettings);
  return providerSettings.geminiCredentialMode === 'vertex-adc' && Boolean(projectId);
}

function parseVertexEnvironmentVariables(value: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of value.split(/\r?\n/g)) {
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
    if (/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      entries[key] = envValue;
    }
  }
  return entries;
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    if (trimmed.length === 1) {
      return '';
    }
    return trimmed.slice(1, -1);
  }

  return trimmed;
}
