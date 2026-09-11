// Provider catalog sync — fetches each configured provider's live /models list and
// writes src/data/providerModelCatalog.generated.json, printing drift vs the last snapshot.
//
// Usage: ATLAS_API_KEY=... OPENAI_API_KEY=... GEMINI_API_KEY=... npm run sync:catalog
//
// Capabilities are NOT inferred from model names. Curated request contracts in
// src/lib/modelContracts remain the authority; this snapshot only detects provider-list drift.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUTPUT_URL = new URL('../src/data/providerModelCatalog.generated.json', import.meta.url);

// --- pure helpers (exported for tests) ---

export function diffModelIds(current, discovered) {
  const currentSet = new Set(current);
  const discoveredSet = new Set(discovered);
  return {
    added: discovered.filter((id) => !currentSet.has(id)),
    removed: current.filter((id) => !discoveredSet.has(id)),
  };
}

export function hasCatalogDrift(perProviderDrift) {
  return Object.values(perProviderDrift).some((drift) => drift.added.length > 0 || drift.removed.length > 0);
}

export function extractModelIds(provider, payload) {
  if (provider === 'gemini') {
    return (payload?.models ?? [])
      .map((model) => String(model?.name ?? '').replace(/^models\//, ''))
      .filter(Boolean);
  }
  if (provider === 'elevenlabs') {
    const models = Array.isArray(payload) ? payload : payload?.models ?? [];
    return models
      .map((model) => String(model?.model_id ?? model?.modelId ?? ''))
      .filter(Boolean);
  }
  return (payload?.data ?? [])
    .map((model) => String(model?.id ?? ''))
    .filter(Boolean);
}

export function buildProviderCatalogSnapshot(perProvider, fetchedAt) {
  const providers = {};
  for (const [provider, ids] of Object.entries(perProvider)) {
    providers[provider] = [...new Set(ids)].sort();
  }
  return { generatedBy: 'sync-provider-catalog', fetchedAt, providers };
}

// --- provider endpoints ---

const PROVIDER_ENDPOINTS = {
  gemini: (key) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`,
    headers: {},
  }),
  openai: (key) => ({ url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${key}` } }),
  atlas: (key) => ({ url: 'https://api.atlascloud.ai/api/v1/models', headers: { Authorization: `Bearer ${key}` } }),
  elevenlabs: (key) => ({ url: 'https://api.elevenlabs.io/v1/models', headers: { 'xi-api-key': key } }),
};

async function fetchProviderModelIds(provider, key) {
  const endpoint = PROVIDER_ENDPOINTS[provider](key);
  const response = await fetch(endpoint.url, { headers: endpoint.headers });
  if (!response.ok) {
    throw new Error(`${provider} /models failed: HTTP ${response.status}`);
  }
  return extractModelIds(provider, await response.json());
}

async function readPreviousSnapshot() {
  try {
    return JSON.parse(await readFile(OUTPUT_URL, 'utf8'));
  } catch {
    return { providers: {} };
  }
}

async function main() {
  const keys = {
    gemini: process.env.GEMINI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    atlas: process.env.ATLAS_API_KEY,
    elevenlabs: process.env.ELEVENLABS_API_KEY,
  };
  const checkOnly = process.argv.includes('--check');
  const previous = await readPreviousSnapshot();
  const perProvider = {};
  const perProviderDrift = {};

  for (const [provider, key] of Object.entries(keys)) {
    if (!key) {
      console.log(`- ${provider}: no API key in env (skipped)`);
      continue;
    }
    try {
      const ids = await fetchProviderModelIds(provider, key);
      perProvider[provider] = ids;
      const drift = diffModelIds(previous.providers?.[provider] ?? [], ids);
      perProviderDrift[provider] = drift;
      console.log(`- ${provider}: ${ids.length} models (+${drift.added.length} / -${drift.removed.length})`);
      if (drift.added.length) console.log(`    added: ${drift.added.join(', ')}`);
      if (drift.removed.length) console.log(`    removed: ${drift.removed.join(', ')}`);
    } catch (error) {
      console.error(`- ${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (Object.keys(perProvider).length === 0) {
    console.log('No providers fetched (set GEMINI_API_KEY / OPENAI_API_KEY / ATLAS_API_KEY / ELEVENLABS_API_KEY). Nothing written.');
    if (checkOnly) process.exitCode = 2;
    return;
  }

  if (checkOnly) {
    if (hasCatalogDrift(perProviderDrift)) {
      console.error('Provider model catalog drift detected. Run npm run sync:catalog, audit new/removed IDs, and update contracts before committing the snapshot.');
      process.exitCode = 1;
    } else {
      console.log('No provider model catalog drift detected.');
    }
    return;
  }

  const snapshot = buildProviderCatalogSnapshot(perProvider, new Date().toISOString());
  await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
  await writeFile(OUTPUT_URL, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Wrote ${fileURLToPath(OUTPUT_URL)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
