#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const sourceVersion = packageJson.version;

assert.equal(sourceVersion, '0.9.16-b', 'update the documentation baseline when the package version changes');

const docsRoot = path.join(root, 'docs');
const walkMarkdown = (directory, relative = '') => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const entryRelative = path.join(relative, entry.name).replaceAll(path.sep, '/');
  const entryPath = path.join(directory, entry.name);
  if (entry.isDirectory()) return walkMarkdown(entryPath, entryRelative);
  return entry.isFile() && entry.name.endsWith('.md') ? [entryRelative] : [];
}).sort();

const historicalPrefixes = ['audits/', 'coordination/', 'notes/', 'prototypes/', 'research/', 'superpowers/'];
const historicalFiles = new Set([
  'gpu-frame-server-export-brief.md',
  'release/KIMI-BRIEF-android-apk-and-play-internal-2026-07-08.md',
  'release/website/KIMI-BRIEF-feature-update-2026-07-08.md',
  'release/play/0.9.14-en-US.md',
  'release/play/0.9.14-ja-JP.md',
  'render-parity/README.md',
]);
const currentFiles = new Set([
  'ELEVENLABS_FEATURES.md',
  'FEATURE_BREAKDOWN.md',
  'HANDOFF.md',
  'PRINT-STATUS.md',
  'PROJECT_DOCUMENTATION.md',
  'README.md',
  'TASK_LIST.md',
  'TEAM_OPERATING_MODEL.md',
  'provider-pack-author-reference.md',
  'provider-pack-security-and-privacy.md',
  'release/provider-pack-community-distribution.md',
  'release/website/sloom-studio/README.md',
  'vertex-authentication.md',
]);
const currentPrefixes = ['packaging/', 'user-manual-bilingual/', 'userguide/'];

function classifyDoc(relativePath) {
  if (historicalFiles.has(relativePath) || historicalPrefixes.some((prefix) => relativePath.startsWith(prefix))) return 'historical';
  if (currentFiles.has(relativePath) || currentPrefixes.some((prefix) => relativePath.startsWith(prefix))) return 'current';
  return null;
}

const allMarkdown = walkMarkdown(docsRoot);
const classification = new Map(allMarkdown.map((relativePath) => [relativePath, classifyDoc(relativePath)]));
const unclassified = allMarkdown.filter((relativePath) => !classification.get(relativePath));
assert.deepEqual(unclassified, [], `every docs/**/*.md must be classified as current or preserved historical; unclassified: ${unclassified.join(', ')}`);
const currentMarkdown = allMarkdown.filter((relativePath) => classification.get(relativePath) === 'current');
const historicalMarkdown = allMarkdown.filter((relativePath) => classification.get(relativePath) === 'historical');

const baselineFiles = [
  'README.md',
  'docs/PROJECT_DOCUMENTATION.md',
  'docs/FEATURE_BREAKDOWN.md',
  'docs/userguide/README.md',
  'docs/release/website/sloom-studio/docs.html',
  'docs/release/website/sloom-studio/ja/docs.html',
  'docs/release/website/sloom-studio/changelog.html',
  'docs/release/website/sloom-studio/ja/changelog.html',
];

for (const relativePath of baselineFiles) {
  assert.ok(read(relativePath).includes(sourceVersion), `${relativePath} must identify source baseline ${sourceVersion}`);
}

const userGuideRoot = path.join(root, 'docs/userguide');
const userGuideFiles = readdirSync(userGuideRoot)
  .filter((name) => name.endsWith('.md'))
  .map((name) => `docs/userguide/${name}`)
  .sort();
const repositoryDocs = ['README.md', 'docs/PROJECT_DOCUMENTATION.md', 'docs/FEATURE_BREAKDOWN.md', ...userGuideFiles];

const linkDocs = [...new Set(['README.md', ...currentMarkdown.map((relativePath) => `docs/${relativePath}`), ...repositoryDocs])];
for (const relativePath of linkDocs) {
  const markdown = read(relativePath);
  for (const match of markdown.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    const targetWithoutTitle = rawTarget.replace(/\s+["'][^"']*["']$/, '');
    if (!targetWithoutTitle || targetWithoutTitle.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(targetWithoutTitle)) continue;
    const target = decodeURIComponent(targetWithoutTitle.split('#')[0]);
    if (!target) continue;
    const resolved = path.resolve(root, path.dirname(relativePath), target);
    assert.ok(existsSync(resolved), `${relativePath} has a broken local link: ${rawTarget}`);
  }
}

const manualSourceRoot = path.join(root, 'docs/user-manual-bilingual');
const manualOutputRoot = path.join(root, 'docs/release/website/sloom-studio/manual');
const manualChapters = {};
for (const language of ['en', 'ja']) {
  manualChapters[language] = readdirSync(path.join(manualSourceRoot, language))
    .filter((name) => /^\d{2}-.*\.md$/.test(name))
    .sort();
  assert.equal(manualChapters[language].length, 11, `${language} manual must contain exactly 11 numbered chapters`);
}
assert.deepEqual(manualChapters.ja, manualChapters.en, 'English and Japanese manual chapter filenames must match exactly');
for (const language of ['en', 'ja']) {
  for (const filename of manualChapters[language]) {
    const sourcePath = path.join(manualSourceRoot, language, filename);
    const source = readFileSync(sourcePath);
    const sourceText = source.toString('utf8');
    assert.ok(sourceText.includes(sourceVersion), `${language}/${filename} must identify source baseline ${sourceVersion}`);
    const hash = createHash('sha256').update(source).digest('hex');
    const outputPath = path.join(manualOutputRoot, language, filename.replace(/\.md$/, '.html'));
    assert.ok(existsSync(outputPath), `generated public manual page is missing: manual/${language}/${filename.replace(/\.md$/, '.html')}`);
    const html = readFileSync(outputPath, 'utf8');
    assert.ok(html.includes(`data-docs-source-version="${sourceVersion}"`), `manual/${language}/${filename} has the wrong source version marker`);
    assert.ok(html.includes(`data-manual-source-sha256="${hash}"`), `manual/${language}/${filename} is not bound to its source SHA-256`);
    assert.ok(html.includes(`source SHA-256: ${hash}`), `manual/${language}/${filename} is missing its visible source hash`);
    assert.ok(html.includes('class="manual-article"') && html.length > 4_000, `manual/${language}/${filename} is not substantive HTML`);
  }
}

const guideIndex = read('docs/userguide/README.md');
const numberedGuides = userGuideFiles
  .map((relativePath) => path.basename(relativePath))
  .filter((name) => /^\d{2}-/.test(name));
for (const guide of numberedGuides) {
  assert.ok(guideIndex.includes(`](${guide})`), `the User Guide index must link ${guide}`);
}
for (const requiredGuide of [
  '12-troubleshooting-and-recovery.md',
  '13-accessibility-collaboration-and-automation.md',
  '15-qualified-missing-hundred-features.md',
  '16-feature-maturity-reference.md',
]) {
  assert.ok(numberedGuides.includes(requiredGuide), `missing required current guide: ${requiredGuide}`);
}

const ledger = JSON.parse(read('ops/team/features.json'));
assert.equal(ledger.features.length, 100, 'the canonical feature ledger must retain 100 historical rows');
const actionable = ledger.features.filter((feature) => !feature.ownerExcluded);
const qualified = actionable.filter((feature) => feature.state === 'QUALIFIED');
assert.equal(actionable.length, 97, 'the documented actionable denominator must remain 97');
assert.equal(qualified.length, 97, 'every actionable row must be qualified before docs claim 97 qualified rows');

const qualifiedGuide = read('docs/userguide/15-qualified-missing-hundred-features.md');
const documentedIds = [...qualifiedGuide.matchAll(/^### (MH-\d{3})\b/gm)].map((match) => match[1]);
assert.equal(new Set(documentedIds).size, 97, 'the qualified guide must document 97 unique actionable IDs');
assert.deepEqual(
  [...new Set(documentedIds)].sort(),
  qualified.map((feature) => feature.id).sort(),
  'the qualified guide IDs must exactly match the actionable qualified ledger',
);

const englishDocs = read('docs/release/website/sloom-studio/docs.html');
const japaneseDocs = read('docs/release/website/sloom-studio/ja/docs.html');
const sectionIds = (html) => [...html.matchAll(/<section\s+id="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(sectionIds(japaneseDocs), sectionIds(englishDocs), 'English and Japanese Docs section order must match');
for (const requiredSection of ['getting-started', 'feature-status', 'projects', 'api-keys', 'flow', 'image', 'paper', 'video', 'library']) {
  assert.ok(sectionIds(englishDocs).includes(requiredSection), `Docs pages must include #${requiredSection}`);
  assert.ok(englishDocs.includes(`href="#${requiredSection}"`), `English Docs sidebar must link #${requiredSection}`);
  assert.ok(japaneseDocs.includes(`href="#${requiredSection}"`), `Japanese Docs sidebar must link #${requiredSection}`);
}

const staleClaims = [
  ['docs/release/website/sloom-studio/docs.html', 'Paper and Video do not run generation directly'],
  ['docs/release/website/sloom-studio/docs.html', 'IDML <em>import</em> is not yet supported'],
  ['docs/release/website/sloom-studio/ja/docs.html', 'IDML<em>インポート</em>はまだ未対応です'],
  ['docs/release/website/sloom-studio/docs.html', 'There are no Sloom user accounts or project cloud-sync services'],
  ['docs/release/website/sloom-studio/ja/docs.html', 'Sloomユーザーアカウントもプロジェクト用クラウド同期もありません'],
  ['docs/release/website/sloom-studio/docs.html', 'Free tier available for testing'],
  ['docs/userguide/README.md', 'no servers of its own'],
  ['docs/userguide/01-overview.md', 'does not generate anything by itself and has no servers'],
  ['docs/FEATURE_BREAKDOWN.md', 'app version **0.9.6**'],
];
for (const [relativePath, claim] of staleClaims) {
  assert.ok(!read(relativePath).includes(claim), `${relativePath} retains stale claim: ${claim}`);
}

const helpContent = read('src/lib/helpContent.ts');
for (const marker of ['Flow orchestration', 'layered Image editing', 'Video finishing', 'Paper publishing', 'Autosave', 'self-hosted', 'VA-API', 'durable render queue']) {
  assert.ok(helpContent.includes(marker), `in-app help must document: ${marker}`);
}

console.log(`user-docs verification passed: ${baselineFiles.length} versioned surfaces, ${allMarkdown.length} Markdown files classified (${currentMarkdown.length} current, ${historicalMarkdown.length} preserved historical), ${userGuideFiles.length} guide files, ${documentedIds.length} qualified feature sections, 22 source-bound public manual pages, bilingual Docs parity, local links and stale-claim guards OK.`);
