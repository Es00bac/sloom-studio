#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const FLOW_VERSION = 3;
const NOW = 1_784_158_400_000;
const TEXT_ACCEPTS = [
  { kind: 'text' },
  { kind: 'json' },
  { kind: 'video' },
  { kind: 'package' },
  { kind: 'envelope', item: { kind: 'text' } },
  { kind: 'envelope', item: { kind: 'package' } },
  { kind: 'envelope', item: { kind: 'mixed' } },
];
const REFERENCE_ACCEPTS = [
  { kind: 'image' },
  { kind: 'package' },
  { kind: 'envelope', item: { kind: 'image' } },
  { kind: 'envelope', item: { kind: 'package' } },
  { kind: 'envelope', item: { kind: 'mixed' } },
  { kind: 'text' },
  { kind: 'json' },
];

function textNode(id, title, prompt, x, y) {
  return {
    id,
    type: 'textNode',
    position: { x, y },
    data: {
      mode: 'prompt',
      prompt,
      systemPrompt: '',
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
      customTitle: title,
    },
    measured: { width: 260, height: 238 },
    dragging: false,
  };
}

function importedImageNode(id, title, asset, x, y, aspectRatio = '4:5') {
  return {
    id,
    type: 'imageGen',
    position: { x, y },
    data: {
      mediaMode: 'import',
      provider: 'atlas',
      modelId: 'google/nano-banana-2/reference-to-image',
      videoFrameSelection: 'last',
      aspectRatio,
      customTitle: title,
      sourceAssetName: asset.fileName,
      sourceAssetMimeType: 'image/png',
      sourceAssetId: asset.assetId,
      result: `signal-loom-asset://asset/${asset.itemId}`,
      resultType: 'image',
      resultMimeType: 'image/png',
    },
    measured: { width: 260, height: 560 },
    dragging: false,
  };
}

function generatedImageNode(id, title, modelId, aspectRatio, x, y) {
  return {
    id,
    type: 'imageGen',
    position: { x, y },
    data: {
      mediaMode: 'generate',
      provider: 'atlas',
      modelId,
      videoFrameSelection: 'last',
      aspectRatio,
      customTitle: title,
      imageOutputFormat: 'png',
    },
    measured: { width: 260, height: 1040 },
    dragging: false,
  };
}

function withApprovedResult(node, asset) {
  const result = `signal-loom-asset://asset/${asset.itemId}`;
  const historyId = `source-${asset.itemId}`;
  return {
    ...node,
    data: {
      ...node.data,
      result,
      resultType: 'image',
      resultMimeType: 'image/png',
      resultHistory: [{
        id: historyId,
        result,
        resultType: 'image',
        statusMessage: 'Approved result restored from the zine source library',
        createdAt: new Date(NOW).toISOString(),
        sourceBinItemId: asset.itemId,
      }],
      selectedResultId: historyId,
      envelopeItems: [{
        id: asset.itemId,
        index: 0,
        kind: 'image',
        label: node.data.customTitle,
        value: result,
        mimeType: 'image/png',
        sourceBinItemId: asset.itemId,
        sourceNodeId: node.id,
      }],
    },
  };
}

function edge(source, target, options = {}) {
  const targetHandle = options.targetHandle;
  const carriedKind = options.carriedKind ?? 'text';
  return {
    source,
    target,
    ...(targetHandle ? { targetHandle } : {}),
    id: `zine-edge__${source}__${target}${targetHandle ? `__${targetHandle}` : ''}`,
    type: 'typed',
    data: {
      flowContract: {
        valid: true,
        carriedType: { kind: carriedKind },
        acceptedTypes: targetHandle ? REFERENCE_ACCEPTS : TEXT_ACCEPTS,
      },
    },
  };
}

function workspace(id, name, nodes, edges) {
  return {
    id,
    name,
    createdAt: NOW,
    updatedAt: NOW,
    flow: { version: FLOW_VERSION, nodes, edges },
  };
}

function coverWorkspace(assets) {
  const nodes = [
    importedImageNode('cover-loom', 'Editorial Loom Reference', assets.hero, 0, 80, '3:4'),
    textNode('cover-loom-role', 'Loom Reference Description', 'REFERENCE ROLE — Preserve the physical loom, tactile woven signal ribbons, fine luminous traces, and premium dark-studio materiality. Use this as the structural subject and do not reproduce any existing text.', 0, 700),
    importedImageNode('cover-logo', 'Sloom Studio Logo Reference', assets.logo, 400, 80, '1:1'),
    textNode('cover-logo-role', 'Logo Reference Description', 'REFERENCE ROLE — This is the authoritative Sloom Studio emblem. Preserve the four interwoven loops and their hot-pink, orange, blue, and cyan sequence. Integrate the mark as a subtle physical maker stamp, not as floating interface chrome. Do not invent letters.', 400, 700),
    importedImageNode('cover-environment', 'Textile Studio Environment Reference', assets.environment, 800, 80, '3:2'),
    textNode('cover-environment-role', 'Environment Reference Description', 'REFERENCE ROLE — Preserve the cinematic architectural volume, translucent fabric partitions, concrete structure, and controlled blue-black lighting. Remove people and product-ad staging; this is the space for an editorial cover sculpture.', 800, 700),
    textNode('cover-composite-prompt', 'Cover Composite Art Direction', 'Create a vertical, premium independent design-magazine cover photograph with no typography. In the supplied textile studio environment, build a monumental sculptural signal loom from the supplied loom reference: cobalt, cyan, coral, orange, and magenta woven bands rise from the machine and turn into one elegant arching field of material light. Integrate the exact supplied Sloom Studio loop emblem only once as a small embossed maker mark on dark metal. Dramatic but restrained editorial lighting, tactile fibers, precise geometry, rich black negative space in the upper-left and lower-left for masthead and cover lines, strong visual center, sophisticated contemporary art direction, realistic photography, no people, no readable text, no watermark.', 1200, 80),
    generatedImageNode('cover-final', 'FINAL — Sloom Studio Origin Zine Cover', 'black-forest-labs/flux-2-pro/edit', '3:4', 1600, 160),
  ];
  const edges = [
    edge('cover-composite-prompt', 'cover-final'),
    edge('cover-loom', 'cover-final', { targetHandle: 'image-reference-1', carriedKind: 'image' }),
    edge('cover-loom-role', 'cover-final', { targetHandle: 'image-reference-1' }),
    edge('cover-logo', 'cover-final', { targetHandle: 'image-reference-2', carriedKind: 'image' }),
    edge('cover-logo-role', 'cover-final', { targetHandle: 'image-reference-2' }),
    edge('cover-environment', 'cover-final', { targetHandle: 'image-reference-3', carriedKind: 'image' }),
    edge('cover-environment-role', 'cover-final', { targetHandle: 'image-reference-3' }),
  ];
  return workspace('zine-cover', '01 — Cover / The First Signal', nodes, edges);
}

function originWorkspace(assets) {
  const approvedHero = withApprovedResult(
    generatedImageNode('origin-result', 'Signaloom Editorial Hero — Approved Result', 'black-forest-labs/flux-2-pro/text-to-image', '3:4', 420, 40),
    assets.hero,
  );
  const nodes = [
    textNode('origin-prompt', 'Signaloom Editorial Hero Prompt', 'Professional contemporary editorial hero image for a design and technology magazine. An abstract physical loom in a dark near-black studio weaves luminous cobalt, cyan, coral, orange, and magenta signal ribbons into one elegant textile-like field. Subtle interface grids and waveform traces appear as material, not screens. Swiss-modern art direction, sophisticated dramatic lighting, tactile fibers, premium print photography, controlled negative space, no people, no lettering, no logos, no watermark.', 0, 80),
    approvedHero,
    textNode('origin-caption-source', 'Editorial Usage Note', 'APPROVED EDITORIAL ASSET — Use for the opening origin-story feature, detail crops, translucent overlays, and captioned material studies. Preserve the generated Flow result without destructive replacement.', 420, 700),
  ];
  return workspace('zine-origin', '02 — Feature / From Flow to Studio', nodes, [edge('origin-prompt', 'origin-result')]);
}

function sloanWorkspace(assets) {
  const tshirt = withApprovedResult(
    generatedImageNode('sloan-tshirt', 'Sloom Studio T-shirt Reference — Approved', 'black-forest-labs/flux-2-pro/edit', '4:5', 420, 60),
    assets.tshirt,
  );
  const final = withApprovedResult(
    generatedImageNode('sloan-final', 'FINAL — Sloan Studio T-shirt Advertisement', 'black-forest-labs/flux-2-pro/edit', '3:2', 1640, 180),
    assets.sloanAd,
  );
  const nodes = [
    importedImageNode('sloan-logo', 'Sloom Studio Official Logo', assets.logo, 0, 40, '1:1'),
    textNode('sloan-tshirt-prompt', 'T-shirt Reference Prompt', 'Create a clean premium apparel reference: a heavyweight near-black unisex crew-neck T-shirt, front view, naturally shaped but unworn. Apply the exact connected Sloom Studio emblem as a small crisp chest mark. No other text, labels, invented marks, model, or props.', 0, 680),
    textNode('sloan-logo-role', 'Logo Reference Description', 'REFERENCE ROLE — Preserve the four interwoven loops, exact silhouette, and hot-pink, orange, blue, and cyan sequence. Use only as the small chest print; do not copy its rounded-square background or invent letters.', 0, 980),
    tshirt,
    importedImageNode('sloan-model', 'Fashion Model Reference', assets.model, 820, 40, '4:5'),
    textNode('sloan-model-role', 'Model Reference Description', 'REFERENCE ROLE — Preserve the same person, face, hair, body proportions, and calm three-quarter stance. Replace only the plain top with the supplied finished T-shirt.', 820, 700),
    importedImageNode('sloan-environment', 'Textile Studio Environment Reference', assets.environment, 1180, 40, '3:2'),
    textNode('sloan-environment-role', 'Environment Reference Description', 'REFERENCE ROLE — Preserve the concrete textile studio, translucent fabric panels, loom, cool cinematic lighting, and clear floor plane. Place the model naturally into this exact spatial language.', 1180, 700),
    textNode('sloan-final-prompt', 'Final Sloan Studio Ad Composite Prompt', 'Create a polished wide editorial fashion advertisement using the connected references. Dress the exact supplied model in the exact supplied finished Sloom Studio T-shirt and place them naturally in the supplied textile-studio environment. Preserve face, garment emblem, and architecture. Full-body relaxed pose on the right, generous negative space on the left, premium campaign photography, no added words or logos.', 1640, 900),
    final,
  ];
  const edges = [
    edge('sloan-tshirt-prompt', 'sloan-tshirt'),
    edge('sloan-logo', 'sloan-tshirt', { targetHandle: 'image-reference-1', carriedKind: 'image' }),
    edge('sloan-logo-role', 'sloan-tshirt', { targetHandle: 'image-reference-1' }),
    edge('sloan-final-prompt', 'sloan-final'),
    edge('sloan-tshirt', 'sloan-final', { targetHandle: 'image-reference-1', carriedKind: 'image' }),
    edge('sloan-model', 'sloan-final', { targetHandle: 'image-reference-2', carriedKind: 'image' }),
    edge('sloan-model-role', 'sloan-final', { targetHandle: 'image-reference-2' }),
    edge('sloan-environment', 'sloan-final', { targetHandle: 'image-reference-3', carriedKind: 'image' }),
    edge('sloan-environment-role', 'sloan-final', { targetHandle: 'image-reference-3' }),
  ];
  return workspace('zine-sloan-ad', '03 — Advertisement / Sloan Studio T-shirt', nodes, edges);
}

function kernWorkspace(assets) {
  const nodes = [
    textNode('kern-product-prompt', 'KERN/01 Product Reference Prompt', 'Create a premium product reference for a fictional typography field-notes kit named KERN/01: one graphite-black clothbound A5 notebook, a modular anodized-aluminum spacing gauge, two small brass movable-type blocks, and a cobalt elastic band. Precise orthographic three-quarter product photograph on a neutral seamless background. Quiet industrial design, exact materials, generous empty space, no hands, no environment, no readable words or logos, no watermark.', 0, 80),
    generatedImageNode('kern-product', 'KERN/01 Field Notes Product Reference', 'black-forest-labs/flux-2-pro/text-to-image', '4:5', 400, 40),
    textNode('kern-product-role', 'KERN/01 Product Description', 'REFERENCE ROLE — Preserve the graphite cloth notebook, anodized spacing gauge, two brass type blocks, and cobalt elastic as one coherent fictional product kit. Maintain exact proportions and material finishes. Any lettering will be added later in Paper; do not invent labels.', 400, 1180),
    importedImageNode('kern-environment', 'KERN/01 Environment Reference', assets.environment, 800, 40, '3:2'),
    textNode('kern-environment-role', 'KERN/01 Environment Description', 'REFERENCE ROLE — Use the supplied textile studio as architectural inspiration only. Restage it as a daylight typography workshop with a long pale worktable, soft fabric dividers, gridded shadows, and clean negative space. No people and no loom in the final scene.', 800, 700),
    textNode('kern-composite-prompt', 'KERN/01 Advertisement Composite Prompt', 'Create a wide, premium fictional product advertisement photograph. Place the supplied KERN/01 field-notes kit on a pale ash worktable inside the supplied architectural studio, restaged as a daylight typography workshop. Arrange the notebook open beside the anodized spacing gauge and brass type blocks; show paper grain, accurate shadows, disciplined grid-like composition, and one cobalt accent. Leave the left third quiet and slightly darker for advertising copy. Contemporary Swiss/Japanese editorial art direction, photorealistic, no people, no readable text, no logos, no watermark.', 1200, 80),
    generatedImageNode('kern-final', 'FINAL — KERN/01 Field Notes Advertisement', 'black-forest-labs/flux-2-pro/edit', '3:2', 1600, 160),
  ];
  const edges = [
    edge('kern-product-prompt', 'kern-product'),
    edge('kern-composite-prompt', 'kern-final'),
    edge('kern-product', 'kern-final', { targetHandle: 'image-reference-1', carriedKind: 'image' }),
    edge('kern-product-role', 'kern-final', { targetHandle: 'image-reference-1' }),
    edge('kern-environment', 'kern-final', { targetHandle: 'image-reference-2', carriedKind: 'image' }),
    edge('kern-environment-role', 'kern-final', { targetHandle: 'image-reference-2' }),
  ];
  return workspace('zine-kern-ad', '04 — Advertisement / KERN-01 Field Notes', nodes, edges);
}

function afterimageWorkspace(assets) {
  const nodes = [
    textNode('lamp-product-prompt', 'AFTERIMAGE Product Reference Prompt', 'Create a premium product reference for a fictional desk lamp called AFTERIMAGE: a slender matte-black cantilever task light with a translucent cyan-to-coral dichroic glass blade, a compact circular base, one tactile orange dimmer, and immaculate cable management. Three-quarter catalog photograph on a dark neutral seamless background, realistic industrial design and materials, no desk, no people, no readable lettering, no logo, no watermark.', 0, 80),
    generatedImageNode('lamp-product', 'AFTERIMAGE Desk Light Product Reference', 'black-forest-labs/flux-2-pro/text-to-image', '4:5', 400, 40),
    textNode('lamp-product-role', 'AFTERIMAGE Product Description', 'REFERENCE ROLE — Preserve the exact matte-black cantilever structure, circular base, orange dimmer, and cyan-to-coral dichroic glass light blade. The product must remain plausible and physically consistent. Do not add branding or alter the silhouette.', 400, 1180),
    importedImageNode('lamp-environment', 'AFTERIMAGE Environment Reference', assets.environment, 800, 40, '3:2'),
    textNode('lamp-environment-role', 'AFTERIMAGE Environment Description', 'REFERENCE ROLE — Adapt the supplied concrete and textile studio into a quiet midnight design desk scene. Preserve the architectural fabric layers and deep blue-black atmosphere; remove the loom, model, and garment presentation.', 800, 700),
    textNode('lamp-composite-prompt', 'AFTERIMAGE Advertisement Composite Prompt', 'Create a cinematic wide fictional advertisement photograph of the supplied AFTERIMAGE desk lamp in the supplied studio environment, transformed into a quiet midnight design desk. The lamp illuminates crop marks, translucent tracing paper, a mechanical pencil, and abstract color swatches while its dichroic blade casts a controlled cyan-to-coral afterglow. Keep the product exact, credible, and dominant. Reserve calm negative space across the upper-left for headline typography. Premium contemporary product photography, restrained atmospheric haze, no people, no readable text, no extra lamps, no logos, no watermark.', 1200, 80),
    generatedImageNode('lamp-final', 'FINAL — AFTERIMAGE Desk Light Advertisement', 'black-forest-labs/flux-2-pro/edit', '3:2', 1600, 160),
  ];
  const edges = [
    edge('lamp-product-prompt', 'lamp-product'),
    edge('lamp-composite-prompt', 'lamp-final'),
    edge('lamp-product', 'lamp-final', { targetHandle: 'image-reference-1', carriedKind: 'image' }),
    edge('lamp-product-role', 'lamp-final', { targetHandle: 'image-reference-1' }),
    edge('lamp-environment', 'lamp-final', { targetHandle: 'image-reference-2', carriedKind: 'image' }),
    edge('lamp-environment-role', 'lamp-final', { targetHandle: 'image-reference-2' }),
  ];
  return workspace('zine-afterimage-ad', '05 — Advertisement / AFTERIMAGE Desk Light', nodes, edges);
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base') output.base = argv[++index];
    else if (arg === '--output') output.output = argv[++index];
    else if (arg === '--logo') output.logo = argv[++index];
    else if (arg === '--help' || arg === '-h') output.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return output;
}

function buildSourceAsset({ itemId, assetId, fileName, sourcePath, scratchDir, label }) {
  const scratchFileName = `${itemId}-${fileName}`;
  const nativeFilePath = join(scratchDir, scratchFileName);
  copyFileSync(sourcePath, nativeFilePath);
  return {
    record: { itemId, assetId, fileName, sourcePath, scratchFileName, nativeFilePath },
    item: {
      id: itemId,
      label,
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: `signal-loom-asset://asset/${itemId}`,
      assetId,
      scratchFileName,
      nativeFilePath,
      createdAt: NOW,
    },
  };
}

export function buildOriginZineFlowProject({ baseProject, outputPath, logoPath }) {
  const outputDir = dirname(outputPath);
  const scratchDirectoryName = `${basename(outputPath, '.sloom')}.signal-loom-scratch`;
  const scratchDir = join(outputDir, scratchDirectoryName);
  mkdirSync(scratchDir, { recursive: true });

  const existingAssetDir = resolve(outputDir, 'Signaloom-Magazine-Flow-Assets');
  const sourceAssets = [
    buildSourceAsset({ itemId: 'zine-source-hero', assetId: 'zine-asset-hero', fileName: 'hero.png', sourcePath: join(existingAssetDir, 'hero.png'), scratchDir, label: 'Approved Signaloom editorial hero' }),
    buildSourceAsset({ itemId: 'zine-source-environment', assetId: 'zine-asset-environment', fileName: 'environment-reference.png', sourcePath: join(existingAssetDir, 'environment-reference.png'), scratchDir, label: 'Approved textile studio environment' }),
    buildSourceAsset({ itemId: 'zine-source-tshirt', assetId: 'zine-asset-tshirt', fileName: 'tshirt-reference.png', sourcePath: join(existingAssetDir, 'tshirt-reference.png'), scratchDir, label: 'Approved Sloan Studio T-shirt reference' }),
    buildSourceAsset({ itemId: 'zine-source-model', assetId: 'zine-asset-model', fileName: 'model-reference.png', sourcePath: join(existingAssetDir, 'model-reference.png'), scratchDir, label: 'Approved Sloan Studio model reference' }),
    buildSourceAsset({ itemId: 'zine-source-sloan-ad', assetId: 'zine-asset-sloan-ad', fileName: 'ad-composite.png', sourcePath: join(existingAssetDir, 'ad-composite.png'), scratchDir, label: 'Approved Sloan Studio advertisement composite' }),
    buildSourceAsset({ itemId: 'zine-source-logo', assetId: 'zine-asset-logo', fileName: 'sloom-studio-logo.png', sourcePath: logoPath, scratchDir, label: 'Official Sloom Studio logo' }),
  ];
  const assets = Object.fromEntries(sourceAssets.map(({ record }) => {
    const key = record.assetId.replace('zine-asset-', '').replace('sloan-ad', 'sloanAd');
    return [key, record];
  }));
  const workspaces = [
    coverWorkspace(assets),
    originWorkspace(assets),
    sloanWorkspace(assets),
    kernWorkspace(assets),
    afterimageWorkspace(assets),
  ];
  const activeWorkspace = workspaces[0];
  const sourceBin = {
    bins: [{
      id: 'default',
      name: 'Source Library',
      items: sourceAssets.map(({ item }) => item),
      createdAt: NOW,
    }],
    dismissedSourceKeys: [],
  };
  return {
    ...baseProject,
    id: 'sloom-studio-origin-zine-assets',
    name: 'Sloom Studio Origin Zine — Flow Assets',
    savedAt: NOW,
    flow: activeWorkspace.flow,
    flowWorkspaces: workspaces,
    activeFlowWorkspaceId: activeWorkspace.id,
    sourceBin,
    usageLedger: { version: 1, entries: [] },
    paper: undefined,
    imageEditor: undefined,
    fileSystem: {
      projectDirectoryName: basename(outputDir),
      scratchDirectoryName,
      lastSavedToFolderAt: NOW,
      scratchAssetCount: sourceAssets.length,
    },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.base || !options.output || !options.logo) {
    process.stdout.write('Usage: node scripts/create-sloom-origin-zine-flow-project.mjs --base <existing-project.sloom> --logo <logo.png> --output <zine-assets.sloom>\n');
    process.exitCode = options.help ? 0 : 1;
    return;
  }
  const baseProject = JSON.parse(readFileSync(resolve(options.base), 'utf8'));
  const outputPath = resolve(options.output);
  const project = buildOriginZineFlowProject({
    baseProject,
    outputPath,
    logoPath: resolve(options.logo),
  });
  writeFileSync(outputPath, `${JSON.stringify(project, null, 2)}\n`);
  process.stdout.write(`${outputPath}\n`);
}

if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? '')}`).href) {
  main();
}
