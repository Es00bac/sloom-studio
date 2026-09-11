import React from 'react';
import { LoaderCircle } from 'lucide-react';
import { Section } from './SettingsInputs';
import type { OssLicenseEntry } from '../../generated/ossLicenses';

interface LoadedLicenses {
  generatedAt: string;
  native: OssLicenseEntry[];
  npm: OssLicenseEntry[];
}

export function OssLicensesSection() {
  const [expanded, setExpanded] = React.useState(false);
  const [licenses, setLicenses] = React.useState<LoadedLicenses | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!expanded || licenses || loadError) return;
    let cancelled = false;
    import('../../generated/ossLicenses')
      .then((module) => {
        if (cancelled) return;
        setLicenses({
          generatedAt: module.OSS_LICENSE_GENERATED_AT,
          native: module.OSS_NATIVE_COMPONENTS,
          npm: module.OSS_NPM_PACKAGES,
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load the license inventory.');
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, licenses, loadError]);

  return (
    <Section title="Open-Source Licenses">
      <p className="text-sm text-gray-400">
        Sloom Studio is built on open-source software. This inventory covers every production
        npm package shipped in the app plus the native engines and models it bundles or
        downloads (desktop local upscaler, Android on-device upscaler, FFmpeg core).
      </p>
      <button
        className="mt-3 rounded-lg border border-gray-700 bg-[#111217]/60 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        {expanded ? 'Hide license inventory' : 'View license inventory'}
      </button>
      {expanded ? (
        loadError ? (
          <p className="mt-3 text-sm text-rose-300">{loadError}</p>
        ) : !licenses ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-gray-400">
            <LoaderCircle className="animate-spin" size={14} /> Loading license inventory…
          </p>
        ) : (
          <div className="mt-3 max-h-96 space-y-4 overflow-y-auto rounded-lg border border-gray-800 bg-[#0b1018] p-3">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Native engines, models &amp; runtimes ({licenses.native.length})
              </h4>
              <ul className="mt-2 space-y-2">
                {licenses.native.map((entry) => (
                  <li key={entry.name} className="text-sm">
                    <LicenseEntryHeader entry={entry} />
                    {entry.notes ? <p className="mt-0.5 text-xs text-gray-500">{entry.notes}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                npm packages ({licenses.npm.length}) — inventory generated {licenses.generatedAt}
              </h4>
              <ul className="mt-2 space-y-1">
                {licenses.npm.map((entry) => (
                  <li key={`${entry.name}@${entry.version ?? ''}`} className="text-sm">
                    {entry.licenseText ? (
                      <details>
                        <summary className="cursor-pointer select-none">
                          <LicenseEntryHeader entry={entry} inline />
                        </summary>
                        <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-gray-800 bg-black/30 p-2 text-[11px] leading-snug text-gray-400">
                          {entry.licenseText}
                        </pre>
                      </details>
                    ) : (
                      <LicenseEntryHeader entry={entry} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      ) : null}
    </Section>
  );
}

function LicenseEntryHeader({ entry, inline }: { entry: OssLicenseEntry; inline?: boolean }) {
  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper className="text-gray-200">
      {entry.url ? (
        <a className="text-blue-300 hover:underline" href={entry.url} rel="noreferrer" target="_blank">
          {entry.name}
        </a>
      ) : (
        <span>{entry.name}</span>
      )}
      {entry.version ? <span className="text-gray-500"> {entry.version}</span> : null}
      <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-300">{entry.license}</span>
    </Wrapper>
  );
}
