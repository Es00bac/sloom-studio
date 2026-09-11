#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DEFAULT_PROJECT_PATH = 'output/signal-loom-demo/neon-grimoire/Neon-Grimoire-Signal-Loom-Demo.sloom';
const REQUIRED_ASSET_SECTIONS = ['characters', 'environments', 'objects', 'effects', 'previousFrames'];

async function main() {
  const projectPath = resolve(process.argv[2] ?? DEFAULT_PROJECT_PATH);
  const project = JSON.parse(await readFile(projectPath, 'utf8'));
  const failures = validateProject(project);
  if (failures.length > 0) {
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    projectPath,
    panelCount: project.flow.nodes.filter((node) => node.type === 'imageGen').length,
  }, null, 2));
}

export function validateProject(project) {
  const failures = [];
  const nodes = Array.isArray(project.flow?.nodes) ? project.flow.nodes : [];
  const imageNodes = nodes.filter((node) => node.type === 'imageGen' && /^image-p\d\d$/.test(node.id));
  const sourceItems = new Map((project.sourceBin?.bins ?? []).flatMap((bin) => bin.items ?? []).map((item) => [item.id, item]));

  if (imageNodes.length !== 10) failures.push(`expected 10 comic panel image nodes, found ${imageNodes.length}`);

  for (const node of imageNodes) {
    const manifest = node.data?.assetManifest;
    if (!manifest || typeof manifest !== 'object') {
      failures.push(`${node.id} is missing data.assetManifest`);
      continue;
    }
    for (const section of REQUIRED_ASSET_SECTIONS) {
      if (!Array.isArray(manifest[section])) {
        failures.push(`${node.id} assetManifest.${section} must be an array`);
      }
    }
    const referenceAssetIds = Array.isArray(manifest.referenceAssetIds) ? manifest.referenceAssetIds : [];
    if (referenceAssetIds.length === 0) {
      failures.push(`${node.id} has no referenceAssetIds`);
    }
    for (const referenceId of referenceAssetIds) {
      if (!sourceItems.has(referenceId)) failures.push(`${node.id} references missing Source Library item ${referenceId}`);
    }
  }

  const referenceItems = [...sourceItems.values()].filter((item) => item.sourceKey?.startsWith('demo:neon-grimoire:reference:'));
  if (referenceItems.length < 8) failures.push(`expected at least 8 generated reference assets, found ${referenceItems.length}`);
  for (const item of referenceItems) {
    const isRootStyle = item.sourceKey === 'demo:neon-grimoire:reference:style-neon-arcana';
    if (!isRootStyle && (!Array.isArray(item.dependsOn) || item.dependsOn.length === 0)) {
      failures.push(`${item.id} must declare upstream visual dependencies`);
    }
    if (!isRootStyle && (!Array.isArray(item.usedReferenceIds) || item.usedReferenceIds.length === 0)) {
      failures.push(`${item.id} must record usedReferenceIds`);
    }
  }

  const sequence = project.demoVerification?.sequence;
  if (!sequence?.pass) failures.push('demoVerification.sequence.pass must be true');

  const panelVerification = project.demoVerification?.panels;
  if (!Array.isArray(panelVerification) || panelVerification.length !== 10) {
    failures.push('demoVerification.panels must contain 10 entries');
  } else {
    for (const verification of panelVerification) {
      if (!verification.pass) failures.push(`${verification.id} panel consistency verification did not pass`);
      if (!Array.isArray(verification.assetCoverage) || verification.assetCoverage.length === 0) {
        failures.push(`${verification.id} verification is missing assetCoverage`);
      } else {
        for (const asset of verification.assetCoverage) {
          if (asset?.pass !== true) {
            failures.push(`${verification.id} asset ${asset?.id ?? 'unknown'} failed consistency coverage`);
          }
        }
      }
    }
  }

  const portals = nodes.filter((node) => node.type === 'portal');
  if (portals.length !== 4) failures.push(`expected 4 named portal nodes, found ${portals.length}`);
  if (portals.some((node) => !node.data?.portalLabel || !node.data?.customTitle)) {
    failures.push('every portal must have a customTitle and portalLabel');
  }

  const bookmarks = nodes.filter((node) => typeof node.data?.customTitle === 'string' && node.data.customTitle.includes('Bookmark:'));
  if (bookmarks.length < 18) failures.push(`expected at least 18 named bookmarks, found ${bookmarks.length}`);

  const pages = project.paper?.document?.pages;
  if (!Array.isArray(pages) || pages.length !== 2) failures.push('Paper document must have exactly 2 pages');
  if (Array.isArray(pages) && pages.some((page) => !Array.isArray(page.frames) || page.frames.filter((frame) => frame.kind === 'image').length !== 5)) {
    failures.push('each Paper page must contain exactly 5 image frames');
  }

  return failures;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
