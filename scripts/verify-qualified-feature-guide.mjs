import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');
const ledger = JSON.parse(read('ops/team/features.json'));
const guidePath = 'docs/userguide/15-qualified-missing-hundred-features.md';
const maturityPath = 'docs/userguide/16-feature-maturity-reference.md';
const guide = read(guidePath);
const maturity = read(maturityPath);
const features = ledger.features;

assert.equal(features.length, 100, 'the canonical ledger must retain all 100 source rows');

const actionable = features.filter((feature) => !feature.ownerExcluded);
const qualifiedIds = actionable
  .filter((feature) => feature.state === 'QUALIFIED')
  .map((feature) => feature.id)
  .sort();
const guideIds = [...guide.matchAll(/^### (MH-\d{3})\b/gm)].map((match) => match[1]);
const uniqueGuideIds = [...new Set(guideIds)].sort();

assert.equal(guideIds.length, uniqueGuideIds.length, 'the qualified guide must not repeat a feature ID');
assert.deepEqual(uniqueGuideIds, qualifiedIds, 'the qualified-guide sections must exactly match actionable QUALIFIED ledger rows');
const guideHeading = guide.match(/^# The (\d+) qualified Missing Hundred features$/m);
assert.ok(guideHeading, 'the qualified guide needs a count-bearing heading');
assert.equal(Number(guideHeading[1]), qualifiedIds.length, 'the guide heading must match qualified ledger rows');

const stateCounts = new Map();
for (const feature of actionable) {
  stateCounts.set(feature.state, (stateCounts.get(feature.state) ?? 0) + 1);
}
for (const state of ['QUALIFIED', 'EXECUTABLE', 'WIRED', 'MODELLED', 'ABSENT']) {
  const match = maturity.match(new RegExp(`^\\| ${state[0]}${state.slice(1).toLowerCase()} \\| (\\d+) \\|`, 'm'));
  assert.ok(match, `the maturity summary must include ${state}`);
  assert.equal(Number(match[1]), stateCounts.get(state) ?? 0, `the maturity summary must match ${state} ledger count`);
}

const maturityRows = [...maturity.matchAll(/^\| (MH-\d{3}) \| [^|]+ \| ([^|]+) \|/gm)];
const maturityStates = new Map(maturityRows.map((match) => [match[1], match[2].trim().toUpperCase()]));
assert.equal(maturityStates.size, actionable.length, 'the maturity index must contain every actionable source row once');
for (const feature of actionable) {
  assert.equal(maturityStates.get(feature.id), feature.state, `the maturity index must match ${feature.id}`);
}

for (const match of guide.matchAll(/]\(([^)#]+)(?:#[^)]+)?\)/g)) {
  const target = match[1];
  if (/^[a-z]+:/i.test(target) || target.startsWith('/')) continue;
  assert.ok(existsSync(path.resolve(root, path.dirname(guidePath), target)), `broken local guide link: ${target}`);
}

console.log(`qualified-guide validator passed: ${qualifiedIds.length}/${actionable.length} actionable qualified rows; ${guideIds.length} guide sections; ${maturityStates.size} maturity rows.`);
