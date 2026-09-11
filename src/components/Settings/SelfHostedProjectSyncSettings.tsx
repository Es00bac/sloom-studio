import React from 'react';
import {
  SelfHostedProjectSyncError,
  selfHostedProjectSyncClient,
} from '../../lib/selfHostedProjectSyncClient';
import { Section, TextInput } from './SettingsInputs';

function messageFor(error: unknown): string {
  if (error instanceof SelfHostedProjectSyncError) return error.message;
  return 'The self-hosted authority is unavailable. Local projects remain unchanged.';
}

/**
 * Endpoint and account setup only. Automatic project publication is deliberately not enabled from
 * Settings: callers must use the explicit client API with a known project revision, so an offline
 * or stale browser can never silently overwrite an authority-owned project.
 */
export function SelfHostedProjectSyncSettings(): React.JSX.Element {
  const client = React.useMemo(() => selfHostedProjectSyncClient(), []);
  const [endpoint, setEndpoint] = React.useState(() => client.getConfiguration()?.endpoint ?? 'http://127.0.0.1:8787');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('Remote project writes are disabled until this self-hosted authority is reachable and you sign in.');
  const [signedIn, setSignedIn] = React.useState(() => client.getSession());

  const configureAndCheck = async () => {
    client.setConfiguration({ endpoint });
    const health = await client.health();
    setNotice(
      health.recoveredFromBackup
        ? 'Authority reached after durable backup recovery. Review remote revisions before publishing.'
        : 'Authority reached. Sign in to enable explicit revisioned project operations.',
    );
  };

  async function handleConnect(): Promise<void> {
    setBusy(true);
    try {
      await configureAndCheck();
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(): Promise<void> {
    setBusy(true);
    try {
      client.setConfiguration({ endpoint });
      await client.register(email, password);
      const session = await client.signIn(email, password);
      setSignedIn(session);
      setPassword('');
      setNotice(`Signed in as ${session.account.email}. Explicit revision checks protect remote projects from stale writes.`);
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignIn(): Promise<void> {
    setBusy(true);
    try {
      client.setConfiguration({ endpoint });
      const session = await client.signIn(email, password);
      setSignedIn(session);
      setPassword('');
      setNotice(`Signed in as ${session.account.email}. Pending reconnect work can resume only through matching project revisions.`);
    } catch (error) {
      setNotice(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setBusy(true);
    try {
      await client.signOut();
      setSignedIn(null);
      setNotice('Signed out. Remote project operations now fail closed until you sign in again.');
    } catch (error) {
      client.clearSession();
      setSignedIn(null);
      setNotice(`${messageFor(error)} The local project remains unchanged and remote writes are disabled.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Self-hosted project authority">
      <div className="space-y-4 rounded-xl border border-sky-400/20 bg-sky-500/[0.04] p-4">
        <p className="text-sm leading-6 text-slate-300">
          Connect only to an authority you operate. It keeps account sessions, revisioned project blobs, and a bounded recovery log on that server.
          This is not Sloom-hosted cloud storage, an internet continuity service, an external identity provider, or end-to-end encryption.
        </p>
        <TextInput
          label="Self-hosted authority URL"
          value={endpoint}
          onChange={setEndpoint}
          placeholder="http://127.0.0.1:8787"
        />
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/70 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void handleConnect()}
            type="button"
          >
            Check authority
          </button>
          {signedIn ? (
            <button
              className="rounded-lg border border-gray-600 px-3 py-2 text-sm font-medium text-gray-200 hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={() => void handleSignOut()}
              type="button"
            >
              Sign out {signedIn.account.email}
            </button>
          ) : null}
        </div>

        {!signedIn ? (
          <div className="grid gap-3 border-t border-gray-800 pt-4 md:grid-cols-2">
            <TextInput label="Account email" value={email} onChange={setEmail} placeholder="artist@example.com" />
            <label className="grid gap-1.5 text-sm font-medium text-gray-300">
              Password
              <input
                autoComplete="current-password"
                className="rounded-lg border border-gray-700 bg-[#0c0d11] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-sky-400"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <button
                className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:border-emerald-300/70 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || !email.trim() || !password}
                onClick={() => void handleRegister()}
                type="button"
              >
                Create local authority account
              </button>
              <button
                className="rounded-lg border border-gray-600 px-3 py-2 text-sm font-medium text-gray-200 hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || !email.trim() || !password}
                onClick={() => void handleSignIn()}
                type="button"
              >
                Sign in
              </button>
            </div>
          </div>
        ) : null}

        <p aria-live="polite" className="rounded-lg border border-gray-800 bg-[#0c0d11]/70 px-3 py-2 text-xs leading-5 text-gray-300">
          {notice}
        </p>
        <p className="text-xs leading-5 text-gray-500">
          The browser stores only the endpoint and a bounded retry journal; the bearer session stays in this browser session. Cancelled or unavailable operations remain local and do not fall back to another server.
        </p>
      </div>
    </Section>
  );
}
