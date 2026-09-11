import { useCallback, useMemo, useState } from 'react';
import type { ProviderSettings } from '../../types/flow';
import { getSignalLoomNativeBridge } from '../../lib/nativeApp';
import { buildNativeVertexAuthConfig } from '../../lib/vertexProviderSettings';
import { computeVertexAuthStatus } from '../../lib/vertex/vertexAuthStatus';
import { getVertexCredentialAccessToken, parseVertexCredentialJson } from '../../lib/vertex/vertexServiceAccountAuth';

interface UseVertexAuthArgs {
  providerSettings: ProviderSettings;
  setProviderSetting: <TKey extends keyof ProviderSettings>(key: TKey, value: ProviderSettings[TKey]) => void;
  platform: 'desktop' | 'mobile';
}

export function useVertexAuth({ providerSettings, setProviderSetting, platform }: UseVertexAuthArgs) {
  const [projects, setProjects] = useState<Array<{ projectId: string; name: string }>>([]);
  const [busy, setBusy] = useState<{ login?: boolean; detect?: boolean; projects?: boolean; test?: boolean }>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [serviceAccountError, setServiceAccountError] = useState<string | undefined>(undefined);

  const status = useMemo(
    () => computeVertexAuthStatus(providerSettings, platform),
    [providerSettings, platform],
  );

  const authConfig = useMemo(() => buildNativeVertexAuthConfig(providerSettings), [providerSettings]);

  const refreshProjects = useCallback(async () => {
    const bridge = getSignalLoomNativeBridge();
    if (!bridge?.listVertexProjects) return;
    setBusy((prev) => ({ ...prev, projects: true }));
    try {
      const result = await bridge.listVertexProjects({ auth: authConfig });
      const list = result.ok ? result.projects : [];
      setProjects(list);
      if (!result.ok && result.error) {
        setTestResult({ ok: false, message: result.error });
      }
      // Auto-select a project so there's a COMMITTED vertexProjectId. A controlled <select> visually
      // shows the first option even when nothing was chosen, which otherwise leaves the status stuck at
      // "no-project" and hides Google/Vertex from every provider list until the user re-picks by hand.
      if (list.length > 0) {
        const current = providerSettings.vertexProjectId.trim();
        if (!current || !list.some((project) => project.projectId === current)) {
          setProviderSetting('vertexProjectId', list[0].projectId);
        }
      }
    } finally {
      setBusy((prev) => ({ ...prev, projects: false }));
    }
  }, [authConfig, providerSettings.vertexProjectId, setProviderSetting]);

  const signIn = useCallback(async () => {
    const bridge = getSignalLoomNativeBridge();
    if (!bridge?.loginVertex) return;
    setBusy((prev) => ({ ...prev, login: true }));
    try {
      const result = await bridge.loginVertex({ auth: authConfig });
      setTestResult(result.ok
        ? { ok: true, message: 'Signed in. Detecting credentials…' }
        : { ok: false, message: result.error ?? 'Sign-in failed.' });
      if (result.ok) {
        if (result.projectId && !providerSettings.vertexProjectId.trim()) {
          setProviderSetting('vertexProjectId', result.projectId);
        }
        await refreshProjects();
      }
    } finally {
      setBusy((prev) => ({ ...prev, login: false }));
    }
  }, [authConfig, providerSettings.vertexProjectId, refreshProjects, setProviderSetting]);

  const detect = useCallback(async () => {
    const bridge = getSignalLoomNativeBridge();
    if (!bridge?.detectVertexAdc) return;
    setBusy((prev) => ({ ...prev, detect: true }));
    try {
      const result = await bridge.detectVertexAdc({ auth: authConfig });
      setTestResult(result.ok && result.hasToken
        ? { ok: true, message: 'Credentials detected.' }
        : { ok: false, message: result.error ?? 'No usable credentials found.' });
      // A successful detect should also pull + auto-select a project, so detecting alone leaves the app
      // actually ready instead of stuck at "no-project".
      if (result.ok && result.hasToken) {
        if (result.projectId && !providerSettings.vertexProjectId.trim()) {
          setProviderSetting('vertexProjectId', result.projectId);
        }
        if (result.quotaProjectId && !providerSettings.vertexQuotaProjectId.trim()) {
          setProviderSetting('vertexQuotaProjectId', result.quotaProjectId);
        }
        await refreshProjects();
      }
    } finally {
      setBusy((prev) => ({ ...prev, detect: false }));
    }
  }, [authConfig, providerSettings.vertexProjectId, providerSettings.vertexQuotaProjectId, refreshProjects, setProviderSetting]);

  const testConnection = useCallback(async () => {
    setBusy((prev) => ({ ...prev, test: true }));
    setTestResult(null);
    try {
      if (platform === 'desktop') {
        await detect();
        return;
      }
      const minted = await getVertexCredentialAccessToken(providerSettings.vertexServiceAccountJson);
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(minted.accessToken)}`);
      setTestResult(response.ok
        ? { ok: true, message: 'ADC credentials verified.' }
        : { ok: false, message: `Token rejected (${response.status}).` });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy((prev) => ({ ...prev, test: false }));
    }
  }, [platform, detect, providerSettings.vertexServiceAccountJson]);

  const importServiceAccountText = useCallback((raw: string) => {
    setProviderSetting('vertexServiceAccountJson', raw);
    const parsed = parseVertexCredentialJson(raw);
    if (!parsed.ok) {
      setServiceAccountError(parsed.error);
      return;
    }
    setServiceAccountError(undefined);
    if (parsed.projectId && !providerSettings.vertexProjectId.trim()) {
      setProviderSetting('vertexProjectId', parsed.projectId);
    }
    if (parsed.quotaProjectId && !providerSettings.vertexQuotaProjectId.trim()) {
      setProviderSetting('vertexQuotaProjectId', parsed.quotaProjectId);
    }
  }, [setProviderSetting, providerSettings.vertexProjectId, providerSettings.vertexQuotaProjectId]);

  const onServiceAccountFile = useCallback(async (file: File) => {
    const text = await file.text();
    importServiceAccountText(text);
  }, [importServiceAccountText]);

  return {
    status,
    projects,
    busy,
    testResult,
    serviceAccountError,
    onSignIn: signIn,
    onDetect: detect,
    onRefreshProjects: refreshProjects,
    onTestConnection: testConnection,
    onServiceAccountFile,
    onServiceAccountText: importServiceAccountText,
  };
}
