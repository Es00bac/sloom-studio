import { LoaderCircle, RefreshCcw } from 'lucide-react';
import type { ProviderSettings } from '../../types/flow';
import { VERTEX_AUTH_MODE_OPTIONS } from '../../lib/providerCatalog';
import { Section, TextInput, TextAreaInput, SelectInput } from './SettingsInputs';
import { VERTEX_REGIONS, VERTEX_REGION_CUSTOM_VALUE, isKnownVertexRegion } from '../../lib/vertex/vertexRegions';
import type { VertexAuthStatus } from '../../lib/vertex/vertexAuthStatus';

export interface VertexAuthPanelProps {
  platform: 'desktop' | 'mobile';
  providerSettings: ProviderSettings;
  setProviderSetting: <TKey extends keyof ProviderSettings>(key: TKey, value: ProviderSettings[TKey]) => void;
  status: VertexAuthStatus;
  projects: Array<{ projectId: string; name: string }>;
  busy: { login?: boolean; detect?: boolean; projects?: boolean; test?: boolean };
  testResult: { ok: boolean; message: string } | null;
  serviceAccountError?: string;
  onSignIn: () => void;
  onDetect: () => void;
  onRefreshProjects: () => void;
  onTestConnection: () => void;
  onServiceAccountFile: (file: File) => void;
  onServiceAccountText?: (raw: string) => void;
}

const STATUS_LABEL: Record<VertexAuthStatus['source'], string> = {
  gcloud: 'Signed in with gcloud',
  'adc-json': 'Imported ADC credentials loaded',
  'service-account': 'Service account loaded',
  'env-var': 'Using environment credentials',
  none: 'Not configured',
};

function StatusBadge({ status }: { status: VertexAuthStatus }) {
  const ok = status.configured;
  const text = ok ? STATUS_LABEL[status.source] : `Not ready — ${status.blockers.join(', ')}`;
  return (
    <div className={`rounded-lg px-3 py-2 text-xs font-medium ${ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
      {text}
    </div>
  );
}

export function VertexAuthPanel(props: VertexAuthPanelProps) {
  const { platform, providerSettings, setProviderSetting, status, projects, busy } = props;

  const regionIsCustom = !isKnownVertexRegion(providerSettings.vertexLocation) && providerSettings.vertexLocation !== '';
  const regionSelectValue = regionIsCustom ? VERTEX_REGION_CUSTOM_VALUE : (providerSettings.vertexLocation || 'global');

  return (
    <Section title="Vertex AI authentication">
      <div className="grid gap-4">
        <StatusBadge status={status} />

        {platform === 'desktop' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={props.onSignIn}
              disabled={busy.login}
              className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy.login ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              Google browser sign-in
            </button>
            <button
              type="button"
              onClick={props.onDetect}
              disabled={busy.detect}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-60"
            >
              {busy.detect ? 'Detecting…' : 'Detect ADC'}
            </button>

            <div className="grid gap-2 rounded-lg border border-gray-800 bg-[#111217]/40 p-3 md:col-span-2">
              <p className="text-xs text-gray-300">
                Built-in ADC import works without a terminal. Choose an Application Default Credentials, authorized-user, workload-identity, or service-account JSON file; the encrypted settings store keeps it at rest.
              </p>
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) props.onServiceAccountFile(file);
                }}
                className="text-xs text-gray-300"
              />
              <details>
                <summary className="cursor-pointer text-xs text-gray-400">Paste credential JSON instead</summary>
                <div className="mt-2">
                  <TextAreaInput
                    label="ADC credential JSON"
                    value={providerSettings.vertexServiceAccountJson}
                    onChange={(value) => (props.onServiceAccountText ?? ((v) => setProviderSetting('vertexServiceAccountJson', v)))(value)}
                    placeholder='{ "type": "authorized_user", "client_id": "…", "refresh_token": "…" }'
                  />
                </div>
              </details>
              {props.serviceAccountError ? <p className="text-xs text-red-400">{props.serviceAccountError}</p> : null}
            </div>

            <SelectInput
              label="Vertex authentication mode"
              value={providerSettings.vertexAuthMode}
              onChange={(value) => setProviderSetting('vertexAuthMode', value as ProviderSettings['vertexAuthMode'])}
              options={VERTEX_AUTH_MODE_OPTIONS}
            />

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <SelectInput
                  label="Project"
                  value={providerSettings.vertexProjectId}
                  onChange={(value) => setProviderSetting('vertexProjectId', value)}
                  options={projects.length
                    ? projects.map((p) => ({ value: p.projectId, label: p.name ? `${p.name} (${p.projectId})` : p.projectId }))
                    : [{ value: providerSettings.vertexProjectId, label: providerSettings.vertexProjectId || 'No projects listed' }]}
                />
              </div>
              <button
                type="button"
                onClick={props.onRefreshProjects}
                disabled={busy.projects}
                className="mb-1 rounded-lg border border-gray-700 p-2 text-gray-300 hover:bg-gray-800 disabled:opacity-60"
                aria-label="Refresh projects"
              >
                <RefreshCcw className={`h-4 w-4 ${busy.projects ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <TextInput
              label="Project (manual override)"
              value={providerSettings.vertexProjectId}
              onChange={(value) => setProviderSetting('vertexProjectId', value)}
              placeholder="gen-lang-client-0529114074"
            />
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-xs text-gray-400">
              Import ADC authorized-user or service-account JSON to authenticate directly from this device without a terminal.
            </p>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  props.onServiceAccountFile(file);
                }
              }}
              className="text-xs text-gray-300"
            />
            <TextAreaInput
              label="ADC credential JSON"
              value={providerSettings.vertexServiceAccountJson}
              onChange={(value) => (props.onServiceAccountText ?? ((v) => setProviderSetting('vertexServiceAccountJson', v)))(value)}
              placeholder='{ "type": "authorized_user" or "service_account", "project_id": "…" }'
            />
            {props.serviceAccountError ? (
              <p className="text-xs text-red-400">{props.serviceAccountError}</p>
            ) : null}
            <TextInput
              label="Project"
              value={providerSettings.vertexProjectId}
              onChange={(value) => setProviderSetting('vertexProjectId', value)}
              placeholder="Prefilled from the key’s project_id"
            />
          </div>
        )}

        <SelectInput
          label="Region"
          value={regionSelectValue}
          onChange={(value) => {
            if (value === VERTEX_REGION_CUSTOM_VALUE) {
              setProviderSetting('vertexLocation', '');
              return;
            }
            setProviderSetting('vertexLocation', value);
          }}
          options={[...VERTEX_REGIONS, { value: VERTEX_REGION_CUSTOM_VALUE, label: 'Custom…' }]}
        />
        {regionSelectValue === VERTEX_REGION_CUSTOM_VALUE ? (
          <TextInput
            label="Custom region"
            value={providerSettings.vertexLocation}
            onChange={(value) => setProviderSetting('vertexLocation', value)}
            placeholder="us-central1"
          />
        ) : null}

        <TextInput
          label="Quota project override"
          value={providerSettings.vertexQuotaProjectId}
          onChange={(value) => setProviderSetting('vertexQuotaProjectId', value)}
          placeholder="Optional billing/quota project"
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={props.onTestConnection}
            disabled={busy.test}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-60"
          >
            {busy.test ? 'Testing…' : 'Test connection'}
          </button>
          {props.testResult ? (
            <span className={`text-xs ${props.testResult.ok ? 'text-emerald-300' : 'text-red-400'}`}>
              {props.testResult.message}
            </span>
          ) : null}
        </div>

        <details className="rounded-lg border border-gray-800 bg-[#111217]/50 px-3 py-2">
          <summary className="cursor-pointer text-xs text-gray-300">Advanced — environment variables</summary>
          <div className="mt-3">
            <TextAreaInput
              label="Vertex environment variables"
              value={providerSettings.vertexEnvironmentVariables}
              onChange={(value) => setProviderSetting('vertexEnvironmentVariables', value)}
              placeholder={['GCLOUD_BIN=/home/me/google-cloud-sdk/bin/gcloud', 'GOOGLE_CLOUD_PROJECT=my-project-id'].join('\n')}
            />
          </div>
        </details>
      </div>
    </Section>
  );
}
