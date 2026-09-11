#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_OUTPUT_DIR = 'output/signal-loom-demo/neon-grimoire';
const DEFAULT_PROJECT_PATH = '/home/cabewse/Documents/Loom Workspace/Signal Loom Demos/Neon Grimoire Signal Loom Demo.sloom';
const TEXT_MODEL = 'gemini-2.5-flash';
const VERIFY_MODEL = 'gemini-2.5-flash';
const UPSCALE_MODEL = 'imagen-4.0-upscale-preview';
const ATLAS_DEFAULT_BASE_URL = 'https://api.atlascloud.ai/api/v1';
const VERTEX_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || process.env.CLOUDSDK_COMPUTE_REGION || 'global';
const VERTEX_PROJECT = process.env.GOOGLE_CLOUD_PROJECT
  || process.env.GCLOUD_PROJECT
  || process.env.CLOUDSDK_CORE_PROJECT
  || process.env.CLOUDSDK_PROJECT;

const MODEL_PLAN = [
  { id: 'p01', page: 1, panel: 1, aspectRatio: '4:3', model: 'gemini-3-pro-image-preview', route: 'gemini-image', slot: 'top-left' },
  { id: 'p02', page: 1, panel: 2, aspectRatio: '4:3', model: 'gemini-3-pro-image-preview', route: 'gemini-image', slot: 'top-right' },
  { id: 'p03', page: 1, panel: 3, aspectRatio: '16:9', provider: 'bfl', model: 'flux-2-pro', route: 'bfl-flux-2-pro', slot: 'middle-wide' },
  { id: 'p04', page: 1, panel: 4, aspectRatio: '4:5', model: 'gemini-2.5-flash-image', route: 'gemini-image', slot: 'bottom-left' },
  { id: 'p05', page: 1, panel: 5, aspectRatio: '4:5', provider: 'bfl', model: 'flux-2-pro', route: 'bfl-flux-2-pro', slot: 'bottom-right' },
  { id: 'p06', page: 2, panel: 1, aspectRatio: '4:3', model: 'gemini-3-pro-image-preview', route: 'gemini-image', slot: 'top-left' },
  { id: 'p07', page: 2, panel: 2, aspectRatio: '4:3', model: 'gemini-3-pro-image-preview', route: 'gemini-image', slot: 'top-right' },
  { id: 'p08', page: 2, panel: 3, aspectRatio: '16:9', model: 'gemini-3-pro-image-preview', route: 'gemini-image', slot: 'middle-wide' },
  { id: 'p09', page: 2, panel: 4, aspectRatio: '4:5', model: 'gemini-3-pro-image-preview', route: 'gemini-image', slot: 'bottom-left' },
  { id: 'p10', page: 2, panel: 5, aspectRatio: '4:5', model: 'gemini-2.5-flash-image', route: 'gemini-image', slot: 'bottom-right' },
];

const BASE_BEATS = [
  'A rain-slick megacity alley shrine flickers as Nyx, a hacker-mage, discovers an occult zero-day hidden in a public terminal.',
  'Nyx opens a wrist deck. A familiar drone named Hex projects a sigil map over corporate leyline firewalls.',
  'Inside a neon spellgrid, Nyx writes a loop that scrapes glyphs, validates runes, and branches when ward strength spikes.',
  'A spell-script compiler creates three model routes: fast layouts, premium hero frames, and reference-guided fixes.',
  'Hex becomes a cyber-familiar made of code and blue flame as the first page ends on an alarmed corporate ward.',
  'Nyx enters the Obsidian Tower mainframe where ICE golems patrol a cathedral of black glass and luminous runes.',
  'A failed branch creates glitch spirits. Nyx routes the panel through fallback logic while keeping character continuity.',
  'The exploit blooms as a daemon pentacle unlocks the city spellgrid and turns hostile wards into public light.',
  'Citizens across the undercity receive open magic access on cracked phones and floating talismans.',
  'At dawn, Nyx and Hex stand on a rooftop above the freed grid. The terminal reads root access granted in abstract light only, with no readable text.',
];

const GLOBAL_STYLE = [
  'finished high-end comic panel art',
  'magic cyberpunk hybrid world',
  'consistent protagonist: Nyx, androgynous hacker-mage, short black hair with cyan underglow, dark tech cloak, luminous rune tattoos, compact wrist deck',
  'consistent familiar: Hex, small angular drone with fox-like light ears and a blue flame core',
  'cinematic inked linework, saturated neon cyan and magenta accents, gold arcane sigils, black glass architecture',
  'clear panel composition, readable staging, print-ready detail, no speech bubbles, no captions, no readable text, no watermark, no UI chrome',
].join(', ');

const NEGATIVE_PROMPT = 'readable words, letters, captions, speech balloons, watermarks, logos, UI screenshots, blurry faces, extra fingers, malformed hands, muddy low-contrast color';

const REFERENCE_ASSET_SPECS = [
  {
    id: 'style-neon-arcana',
    category: 'style',
    label: 'Neon Arcana Style Bible',
    model: 'gemini-3-pro-image-preview',
    aspectRatio: '16:9',
    prompt: [
      'Create a polished visual style bible image for a magic/cyberpunk comic called Neon Grimoire.',
      'Show a contact sheet of unlabeled color, lighting, linework, material, and magical interface examples.',
      'Use cyan and magenta neon, gold abstract sigils, black glass, rain reflections, cinematic inked linework, and crisp print-ready rendering.',
      'No labels, no words, no numbers, no UI, no watermark.',
    ].join(' '),
  },
  {
    id: 'char-nyx',
    category: 'characters',
    label: 'Nyx Character Sheet',
    dependsOn: ['style-neon-arcana'],
    model: 'gemini-3-pro-image-preview',
    aspectRatio: '16:9',
    prompt: [
      'Create a finished character reference sheet for Nyx, an androgynous hacker-mage.',
      'Show front, side, and action pose views in the same outfit: short black hair with cyan underglow, dark tech cloak, luminous rune tattoos, compact wrist deck, focused expression.',
      'No labels, no words, no numbers, no speech bubbles, no watermark.',
    ].join(' '),
  },
  {
    id: 'char-hex',
    category: 'characters',
    label: 'Hex Familiar Drone Sheet',
    dependsOn: ['style-neon-arcana'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: [
      'Create a character/prop reference sheet for Hex, a small angular cyber-familiar drone with fox-like light ears and a blue flame core.',
      'Show hover pose, side view, blue flame transformation state, and small scale next to a hand silhouette.',
      'No labels, no words, no numbers, no UI text, no watermark.',
    ].join(' '),
  },
  {
    id: 'char-undercity-citizens',
    category: 'characters',
    label: 'Undercity Citizen Crowd Sheet',
    dependsOn: ['style-neon-arcana'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '16:9',
    prompt: [
      'Create an unlabeled crowd character reference sheet for undercity citizens in a magic/cyberpunk comic.',
      'Show varied people in practical streetwear reacting with awe to newly accessible magic, with consistent neon/cyberpunk styling.',
      'No labels, no words, no numbers, no speech bubbles, no watermark.',
    ].join(' '),
  },
  {
    id: 'env-alley-shrine',
    category: 'environments',
    label: 'Rain Alley Public Shrine Terminal',
    dependsOn: ['style-neon-arcana'],
    model: 'gemini-3-pro-image-preview',
    aspectRatio: '4:3',
    prompt: [
      'Create a rain-slick megacity alley shrine environment reference for a magic/cyberpunk comic.',
      'Include blank neon color panels, wet pavement, black glass, cables, abstract ward geometry, and a public terminal alcove.',
      'No labels, no words, no numbers, no signage text, no watermark.',
    ].join(' '),
  },
  {
    id: 'env-leyline-firewall',
    category: 'environments',
    label: 'Leyline Firewall Hologram Space',
    dependsOn: ['style-neon-arcana'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: 'Create an unlabeled reference image for a cyberpunk leyline firewall hologram space: cyan/magenta network lines, gold abstract ward geometry, floating transparent layers, no text, no symbols that form letters or numbers.',
  },
  {
    id: 'env-neon-spellgrid',
    category: 'environments',
    label: 'Interior Neon Spellgrid',
    dependsOn: ['style-neon-arcana'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled environment reference for the inside of a neon spellgrid: luminous branches, loops, abstract non-linguistic rune-like geometry, black glass depth, no readable text, no UI labels, no watermark.',
  },
  {
    id: 'env-obsidian-mainframe',
    category: 'environments',
    label: 'Obsidian Tower Mainframe Cathedral',
    dependsOn: ['style-neon-arcana'],
    model: 'gemini-3-pro-image-preview',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled environment reference for an Obsidian Tower mainframe cathedral: vast black glass architecture, luminous abstract geometry, guarded aisles, cyberpunk arcane lighting, no text, no signage, no watermark.',
  },
  {
    id: 'env-undercity',
    category: 'environments',
    label: 'Undercity Public Magic Street',
    dependsOn: ['style-neon-arcana', 'char-undercity-citizens'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled undercity street environment reference for a magic/cyberpunk comic: layered storefront shapes without text, cables, concrete, neon reflections, people using small public magic, no signage text, no watermark.',
  },
  {
    id: 'env-dawn-rooftop',
    category: 'environments',
    label: 'Dawn Rooftop Liberated Megacity',
    dependsOn: ['style-neon-arcana'],
    model: 'gemini-3-pro-image-preview',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled dawn rooftop environment reference overlooking a liberated cyberpunk megacity glowing with soft public magic, black glass towers, warm horizon, no text, no logos, no watermark.',
  },
  {
    id: 'obj-wrist-deck',
    category: 'objects',
    label: 'Nyx Wrist Deck',
    dependsOn: ['style-neon-arcana', 'char-nyx'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: 'Create an unlabeled prop reference image of a compact wrist-mounted hacker deck with cyan glow, tactile controls, blank abstract light patterns only, no letters, no numbers, no UI text.',
  },
  {
    id: 'obj-public-terminal',
    category: 'objects',
    label: 'Blank Public Shrine Terminal',
    dependsOn: ['style-neon-arcana', 'env-alley-shrine'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: 'Create an unlabeled prop reference image of an ornate public terminal embedded in a street shrine, screen showing abstract blank light geometry only, no readable glyphs, no letters, no numbers.',
  },
  {
    id: 'obj-corporate-ward',
    category: 'objects',
    label: 'Cracked Corporate Ward Sphere',
    dependsOn: ['style-neon-arcana', 'env-neon-spellgrid'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: 'Create an unlabeled prop/effect reference for a red corporate ward sphere: ornate arcane-cyber shell, visible cracks, alarm glow, abstract non-linguistic motifs only, no readable text.',
  },
  {
    id: 'obj-ice-golem',
    category: 'objects',
    label: 'ICE Golem Guardian',
    dependsOn: ['style-neon-arcana', 'env-obsidian-mainframe'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: 'Create an unlabeled creature/prop reference for a blocky ICE golem guardian made of black glass and cyan ward light, imposing patrol pose, no text, no labels.',
  },
  {
    id: 'obj-cracked-phone',
    category: 'objects',
    label: 'Cracked Public Magic Phone',
    dependsOn: ['style-neon-arcana', 'char-undercity-citizens'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: 'Create an unlabeled prop reference of a cracked smartphone glowing with simple abstract magical light shapes, no app UI, no letters, no numbers, no readable symbols.',
  },
  {
    id: 'obj-floating-talisman',
    category: 'objects',
    label: 'Floating Public Talisman',
    dependsOn: ['style-neon-arcana', 'char-undercity-citizens'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: 'Create an unlabeled prop reference of a small floating talisman made of gold light and cybernetic facets, abstract non-linguistic markings only, no text.',
  },
  {
    id: 'fx-zero-day',
    category: 'effects',
    label: 'Occult Zero-Day Glow',
    dependsOn: ['style-neon-arcana', 'obj-public-terminal'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: 'Create an unlabeled magic/cyberpunk effect reference for an occult zero-day vulnerability: subtle cracked light seam, cyan and gold abstract geometry, no text, no numbers.',
  },
  {
    id: 'fx-loop-branch',
    category: 'effects',
    label: 'Loop Branch Data Spell',
    dependsOn: ['style-neon-arcana', 'env-neon-spellgrid', 'obj-wrist-deck'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled effect reference of a programming loop expressed as abstract magic: repeated light arcs, validation nodes, branch split, energy spike, no code text, no letters, no numbers.',
  },
  {
    id: 'fx-route-triad',
    category: 'effects',
    label: 'Three Route Compiler Effect',
    dependsOn: ['style-neon-arcana', 'fx-loop-branch'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled effect reference showing three different abstract glowing pathways emerging from one source: fast stream, ornate hero conduit, corrective interwoven route, no labels or text.',
  },
  {
    id: 'fx-hex-blue-flame',
    category: 'effects',
    label: 'Hex Blue Flame Transformation',
    dependsOn: ['style-neon-arcana', 'char-hex'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '4:3',
    prompt: 'Create an unlabeled effect reference of Hex transforming into blue digital flame while keeping fox-ear drone silhouette cues, no text, no numbers, no watermark.',
  },
  {
    id: 'fx-glitch-spirits',
    category: 'effects',
    label: 'Glitch Spirit Failure Effect',
    dependsOn: ['style-neon-arcana', 'fx-loop-branch'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled effect reference of glitch spirits made of jagged shards, chromatic halos, noise, broken light, and distorted silhouettes, not letterforms, no text.',
  },
  {
    id: 'fx-daemon-pentacle',
    category: 'effects',
    label: 'Daemon Pentacle Public Light',
    dependsOn: ['style-neon-arcana', 'obj-corporate-ward', 'env-undercity'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled effect reference of a daemon pentacle unlocking a city spellgrid and transforming red hostile wards into warm public light, no letters, no numbers, no labels.',
  },
  {
    id: 'fx-public-magic',
    category: 'effects',
    label: 'Small Public Magic Effects',
    dependsOn: ['style-neon-arcana', 'char-undercity-citizens', 'obj-cracked-phone', 'obj-floating-talisman'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled effects reference for small public magic: tiny sparks, lifted pebbles, gentle talisman glow, phone aura, awe lighting, no text, no symbols that read as letters or numbers.',
  },
  {
    id: 'fx-liberated-grid',
    category: 'effects',
    label: 'Liberated Grid Dawn Glow',
    dependsOn: ['style-neon-arcana', 'env-dawn-rooftop', 'fx-daemon-pentacle'],
    model: 'gemini-2.5-flash-image',
    aspectRatio: '16:9',
    prompt: 'Create an unlabeled effect reference for a freed city spellgrid at dawn: soft network light, warm public glow, peaceful arcane-cyber atmosphere, no text, no labels, no watermark.',
  },
];

const PANEL_ASSET_MANIFESTS = {
  p01: {
    characters: ['char-nyx', 'char-hex'],
    environments: ['env-alley-shrine'],
    objects: ['obj-public-terminal', 'obj-wrist-deck'],
    effects: ['fx-zero-day'],
  },
  p02: {
    characters: ['char-nyx', 'char-hex'],
    environments: ['env-leyline-firewall'],
    objects: ['obj-wrist-deck'],
    effects: ['fx-loop-branch'],
  },
  p03: {
    characters: ['char-nyx', 'char-hex'],
    environments: ['env-neon-spellgrid'],
    objects: ['obj-wrist-deck'],
    effects: ['fx-loop-branch'],
  },
  p04: {
    characters: ['char-nyx'],
    environments: ['env-neon-spellgrid'],
    objects: [],
    effects: ['fx-route-triad'],
  },
  p05: {
    characters: ['char-nyx', 'char-hex'],
    environments: [],
    objects: ['obj-corporate-ward'],
    effects: ['fx-hex-blue-flame'],
  },
  p06: {
    characters: ['char-nyx'],
    environments: ['env-obsidian-mainframe'],
    objects: ['obj-ice-golem'],
    effects: ['fx-zero-day'],
  },
  p07: {
    characters: ['char-nyx', 'char-hex'],
    environments: ['env-neon-spellgrid'],
    objects: ['obj-wrist-deck'],
    effects: ['fx-glitch-spirits', 'fx-loop-branch'],
  },
  p08: {
    characters: ['char-nyx', 'char-hex'],
    environments: ['env-dawn-rooftop'],
    objects: ['obj-corporate-ward'],
    effects: ['fx-daemon-pentacle'],
  },
  p09: {
    characters: ['char-undercity-citizens'],
    environments: ['env-undercity'],
    objects: ['obj-cracked-phone', 'obj-floating-talisman'],
    effects: ['fx-public-magic'],
  },
  p10: {
    characters: ['char-nyx', 'char-hex'],
    environments: ['env-dawn-rooftop'],
    objects: ['obj-wrist-deck'],
    effects: ['fx-liberated-grid'],
  },
};

const PAPER_SFX_LABELS = {
  p01: 'FZZT',
  p03: 'LOOP',
  p05: 'KRAK',
  p07: 'GLITCH',
  p08: 'BLOOM',
  p09: 'SPARK',
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!VERTEX_PROJECT) {
    throw new Error('GOOGLE_CLOUD_PROJECT or CLOUDSDK_CORE_PROJECT is required for the real Vertex demo run.');
  }

  const outputDir = resolve(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const projectPath = resolve(options.projectPath ?? DEFAULT_PROJECT_PATH);
  const imageDir = join(outputDir, 'panels');
  const referenceDir = join(outputDir, 'references');
  await mkdir(imageDir, { recursive: true });
  await mkdir(referenceDir, { recursive: true });
  await mkdir(dirname(projectPath), { recursive: true });

  const token = await getGcloudAccessToken();
  const providerSecrets = loadSignalLoomProviderSecrets();
  const planPath = join(outputDir, 'panel-plan.json');
  const manifestPath = join(outputDir, 'generation-manifest.json');
  const projectCopyPath = join(outputDir, 'Neon-Grimoire-Signal-Loom-Demo.sloom');

  const panelPlan = options.force || !existsSync(planPath)
    ? await generatePanelPlan(token)
    : JSON.parse(await readFile(planPath, 'utf8'));
  validatePanelPlan(panelPlan);
  await writeFile(planPath, `${JSON.stringify(panelPlan, null, 2)}\n`);

  const references = [];
  for (const referenceSpec of resolveReferenceGenerationOrder(REFERENCE_ASSET_SPECS)) {
    references.push(await generateReferenceAsset({
      spec: referenceSpec,
      existingReferences: references,
      token,
      referenceDir,
      force: options.force || options.forceReferences,
    }));
  }

  const generatedPanels = [];
  for (const spec of MODEL_PLAN) {
    const panel = panelPlan.panels.find((candidate) => candidate.id === spec.id);
    if (!panel) throw new Error(`Panel plan missing ${spec.id}.`);
    generatedPanels.push(await generatePanel({
      spec,
      panel,
      token,
      providerSecrets,
      references,
      previousPanels: generatedPanels,
      imageDir,
      force: options.force || options.forcePanelIds?.has(spec.id),
    }));
  }

  const verifiedPanels = [];
  for (const panel of generatedPanels) {
    verifiedPanels.push({
      ...panel,
      verification: await verifyPanel({ panel, token, references }),
    });
  }
  const sequenceVerification = await verifySequence({
    panels: verifiedPanels,
    references,
    plan: panelPlan,
    token,
  });
  const failedPanels = verifiedPanels.filter((panel) => !panelClearedPreUpscaleVerification(panel));
  if (failedPanels.length > 0 || !sequenceVerification.pass) {
    await writeVerificationFailureManifest({
      manifestPath,
      panelPlan,
      references,
      verifiedPanels,
      sequenceVerification,
      stage: 'pre-upscale-verification',
    });
    throw new Error(`Pre-upscale verification failed for ${failedPanels.map((panel) => panel.id).join(', ') || 'sequence continuity'}. No panel upscaling was run.`);
  }

  const finalPanels = [];
  for (const panel of verifiedPanels) {
    finalPanels.push(await upscaleVerifiedPanel({
      panel,
      token,
      force: options.force || options.forcePanelIds?.has(panel.id),
    }));
  }

  const now = Date.now();
  const assetRegistry = await prepareProjectAssetRegistry({
    projectPaths: [projectPath, projectCopyPath],
    panels: finalPanels,
    references,
  });
  const project = buildProjectDocument({
    now,
    panels: finalPanels,
    references,
    plan: panelPlan,
    sequenceVerification,
    projectPath,
    assetRegistry,
  });

  await writeFile(projectCopyPath, `${JSON.stringify(project, null, 2)}\n`);
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  await writeFile(manifestPath, `${JSON.stringify({
    ok: true,
    generatedAt: new Date(now).toISOString(),
    vertexProject: VERTEX_PROJECT,
    vertexLocation: VERTEX_LOCATION,
    textModel: TEXT_MODEL,
    verifyModel: VERIFY_MODEL,
    upscaleModel: UPSCALE_MODEL,
    projectPath,
    projectCopyPath,
    planPath,
    references: references.map((reference) => ({
      id: reference.id,
      label: reference.label,
      model: reference.model,
      dependsOn: reference.dependsOn ?? [],
      usedReferenceIds: reference.usedReferenceIds ?? [],
      path: reference.path,
      size: reference.size,
    })),
    sequenceVerification,
    panels: finalPanels.map((panel) => ({
      id: panel.id,
      provider: panel.provider,
      model: panel.model,
      requestedModel: panel.requestedModel,
      route: panel.route,
      aspectRatio: panel.aspectRatio,
      originalPath: panel.originalPath,
      finalPath: panel.finalPath,
      originalSize: panel.originalSize,
      finalSize: panel.finalSize,
      verification: panel.verification,
    })),
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    projectPath,
    projectCopyPath,
    manifestPath,
    panelCount: finalPanels.length,
  }, null, 2));
}

async function generatePanelPlan(token) {
  const prompt = [
    'Create production-ready script data for a two-page, ten-panel comic demo in Signal Loom.',
    'Story: a hacker in a magic/cyberpunk hybrid world uses programming loops, branches, verification, fallback routing, and upscaling to free a corporate spellgrid.',
    'Return strict JSON only with this shape:',
    '{"title":string,"logline":string,"panels":[{"id":"p01","caption":string,"dialogue":string,"imagePrompt":string}...]}',
    'Use exactly ids p01 through p10 in order. The imagePrompt must describe finished comic panel art with no readable text in the image.',
    'Base beats:',
    ...BASE_BEATS.map((beat, index) => `${index + 1}. ${beat}`),
  ].join('\n');
  const payload = await callVertexGenerateContent({
    token,
    model: TEXT_MODEL,
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.65,
        responseMimeType: 'application/json',
      },
    },
  });
  const text = extractText(payload);
  return parseJsonFromText(text);
}

async function writeVerificationFailureManifest({
  manifestPath,
  panelPlan,
  references,
  verifiedPanels,
  sequenceVerification,
  stage,
}) {
  await writeFile(manifestPath, `${JSON.stringify({
    ok: false,
    stage,
    generatedAt: new Date().toISOString(),
    textModel: TEXT_MODEL,
    verifyModel: VERIFY_MODEL,
    panelPlanTitle: panelPlan.title,
    references: references.map((reference) => ({
      id: reference.id,
      label: reference.label,
      category: reference.category,
      model: reference.model,
      dependsOn: reference.dependsOn ?? [],
      usedReferenceIds: reference.usedReferenceIds ?? [],
      path: reference.path,
      size: reference.size,
    })),
    sequenceVerification,
    panels: verifiedPanels.map((panel) => ({
      id: panel.id,
      provider: panel.provider,
      model: panel.model,
      route: panel.route,
      originalPath: panel.originalPath,
      originalSize: panel.originalSize,
      assetManifest: panel.assetManifest,
      verification: panel.verification,
    })),
  }, null, 2)}\n`);
}

async function generatePanel({ spec, panel, token, providerSecrets, references, previousPanels, imageDir, force }) {
  const plannedProvider = spec.provider ?? 'vertex';
  const stem = `${spec.id}-${safeFilePart(plannedProvider)}-${safeFilePart(spec.model)}`;
  const originalPath = join(imageDir, `${stem}-original.png`);
  const finalPath = join(imageDir, `${stem}-x2.png`);
  const assetManifest = buildPanelAssetManifest(spec, references, previousPanels);
  let originalBuffer;
  let actualProvider = plannedProvider;
  let actualModel = spec.model;
  let actualRoute = spec.route;
  let providerNotes = [];

  if (!force && existsSync(originalPath)) {
    originalBuffer = await readFile(originalPath);
  } else {
    const prompt = buildPanelPrompt(panel, spec);
    const generated = await generateOriginalPanelImage({
      spec,
      prompt,
      token,
      providerSecrets,
      references: selectPanelReferenceDataUrls(assetManifest, references, previousPanels, plannedProvider),
    });
    actualProvider = generated.provider;
    actualModel = generated.model;
    actualRoute = generated.route;
    providerNotes = generated.notes;
    originalBuffer = generated.buffer;
    await writeFile(originalPath, originalBuffer);
  }

  const originalSize = readImageSize(originalBuffer);
  const originalMimeType = detectImageMimeType(originalBuffer);
  return {
    ...spec,
    provider: actualProvider,
    model: actualModel,
    requestedModel: spec.model,
    route: actualRoute,
    providerNotes,
    assetManifest,
    caption: panel.caption,
    dialogue: panel.dialogue,
    imagePrompt: buildPanelPrompt(panel, spec),
    originalPath,
    finalPath,
    originalSize,
    originalMimeType,
    originalDataUrl: `data:${originalMimeType};base64,${originalBuffer.toString('base64')}`,
  };
}

async function upscaleVerifiedPanel({ panel, token, force }) {
  let finalBuffer;
  if (!force && existsSync(panel.finalPath)) {
    const [originalStat, finalStat] = await Promise.all([
      stat(panel.originalPath),
      stat(panel.finalPath),
    ]);
    if (finalStat.mtimeMs >= originalStat.mtimeMs) {
      finalBuffer = await readFile(panel.finalPath);
    }
  }
  if (!finalBuffer) {
    const originalBuffer = await readFile(panel.originalPath);
    finalBuffer = await upscaleImage({ token, imageBuffer: originalBuffer });
    await writeFile(panel.finalPath, finalBuffer);
  }
  const finalSize = readImageSize(finalBuffer);
  return {
    ...panel,
    finalSize,
    dataUrl: `data:image/png;base64,${finalBuffer.toString('base64')}`,
  };
}

async function generateReferenceAsset({ spec, existingReferences, token, referenceDir, force }) {
  const stem = `${safeFilePart(spec.id)}-${safeFilePart(spec.model)}`;
  const imagePath = join(referenceDir, `${stem}.png`);
  const dependencyReferences = selectReferenceDependencies(spec, existingReferences);
  let buffer;
  if (!force && existsSync(imagePath)) {
    buffer = await readFile(imagePath);
  } else {
    const prompt = [
      spec.prompt,
      'This is a generated reference asset for downstream comic panel consistency. It is not final page art.',
      'Use clean isolated presentation with enough detail for later image generation and verification.',
    ].join('\n');
    const generated = await generateReferenceImageWithFallback({
      token,
      requestedModel: spec.model,
      prompt,
      aspectRatio: spec.aspectRatio,
      references: dependencyReferences,
    });
    buffer = generated.buffer;
    spec = { ...spec, model: generated.model };
    await writeFile(imagePath, buffer);
  }
  const mimeType = detectImageMimeType(buffer);
  const size = readImageSize(buffer);
  return {
    ...spec,
    usedReferenceIds: dependencyReferences.map((reference) => reference.id),
    sourceItemId: `neon-grimoire-reference-${spec.id}`,
    path: imagePath,
    mimeType,
    size,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
  };
}

async function generateReferenceImageWithFallback({ token, requestedModel, prompt, aspectRatio, references }) {
  if (references.length === 0 && requestedModel !== 'gemini-3-pro-image-preview') {
    throw new Error('Non-root reference generation requires at least one visual reference.');
  }
  const models = [...new Set([
    requestedModel,
    'gemini-3-pro-image-preview',
    'gemini-2.5-flash-image',
  ])];
  let lastError;
  for (const model of models) {
    try {
      return {
        model,
        buffer: await generateGeminiImage({
          token,
          model,
          prompt: references.length > 0
            ? `${prompt}\nUse the attached upstream reference images as visual anchors. Match their style, linework, palette, materials, and proportions.`
            : prompt,
          aspectRatio,
          references,
        }),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Reference image generation failed.');
}

function buildPanelAssetManifest(spec, references, previousPanels) {
  const configured = PANEL_ASSET_MANIFESTS[spec.id];
  if (!configured) throw new Error(`Missing panel asset manifest for ${spec.id}.`);
  const referenceById = new Map(references.map((reference) => [reference.id, reference]));
  const previousFrameIds = previousPanels.slice(-2).map((panel) => panel.id);
  const expand = (section) => (configured[section] ?? []).map((id) => {
    const reference = referenceById.get(id);
    if (!reference) throw new Error(`Panel ${spec.id} references missing asset ${id}.`);
    return {
      id,
      label: reference.label,
      category: reference.category,
      sourceItemId: reference.sourceItemId,
      sourceKey: `demo:neon-grimoire:reference:${id}`,
    };
  });
  const manifest = {
    panelId: spec.id,
    style: expandStyleReference(referenceById),
    characters: expand('characters'),
    environments: expand('environments'),
    objects: expand('objects'),
    effects: expand('effects'),
    previousFrames: previousFrameIds.map((panelId) => ({
      panelId,
      sourceItemId: `neon-grimoire-${panelId}-final`,
      sourceKey: `demo:neon-grimoire:${panelId}:final-x2`,
    })),
  };
  manifest.referenceAssetIds = [
    ...manifest.style,
    ...manifest.characters,
    ...manifest.environments,
    ...manifest.objects,
    ...manifest.effects,
  ].map((entry) => entry.sourceItemId);
  return manifest;
}

function expandStyleReference(referenceById) {
  const reference = referenceById.get('style-neon-arcana');
  if (!reference) throw new Error('Missing style-neon-arcana reference.');
  return [{
    id: reference.id,
    label: reference.label,
    category: reference.category,
    sourceItemId: reference.sourceItemId,
    sourceKey: `demo:neon-grimoire:reference:${reference.id}`,
  }];
}

function selectPanelReferenceDataUrls(assetManifest, references, previousPanels, provider) {
  const referenceBySourceItemId = new Map(references.map((reference) => [reference.sourceItemId, reference]));
  const selected = [];
  for (const sourceItemId of assetManifest.referenceAssetIds) {
    const reference = referenceBySourceItemId.get(sourceItemId);
    if (reference) selected.push(reference);
  }
  for (const previous of previousPanels.slice(-1)) {
    selected.push({
      id: `previous-${previous.id}`,
      label: `Previous frame ${previous.id.toUpperCase()}`,
      category: 'previousFrames',
      mimeType: previous.originalMimeType,
      dataUrl: previous.originalDataUrl,
    });
  }
  const limit = provider === 'bfl' ? 8 : provider === 'atlas' ? 6 : 12;
  return selected.slice(0, limit);
}

function buildReferenceGuidedPanelPrompt(prompt, references) {
  if (references.length === 0) {
    throw new Error('Panel generation requires generated visual references.');
  }
  const referenceList = references
    .map((reference, index) => `${index + 1}. ${reference.id} (${reference.category}) - ${reference.label}`)
    .join('\n');
  return [
    prompt,
    'Attached visual references are the mandatory source of visual truth for this panel.',
    referenceList,
    'Match the listed characters, props, environments, effects, palette, linework, proportions, materials, and previous-frame continuity from the attached images.',
    'Use only the listed story assets. Do not invent extra familiars, drones, creatures, foreground characters, tools, speech balloons, captions, readable UI, labels, watermarks, words, letters, or numbers.',
    'When a previous-frame reference is attached, preserve continuity of character state, object state, lighting direction, and scene progression without copying composition verbatim.',
  ].join('\n');
}

function resolveReferenceGenerationOrder(specs) {
  const pending = new Map(specs.map((spec) => [spec.id, spec]));
  const resolved = [];
  const resolvedIds = new Set();
  while (pending.size > 0) {
    let progressed = false;
    for (const [id, spec] of pending) {
      const dependencies = spec.dependsOn ?? [];
      if (dependencies.every((dependencyId) => resolvedIds.has(dependencyId))) {
        if (spec.id !== 'style-neon-arcana' && dependencies.length === 0) {
          throw new Error(`Reference asset ${spec.id} must declare visual dependencies.`);
        }
        resolved.push(spec);
        resolvedIds.add(id);
        pending.delete(id);
        progressed = true;
      }
    }
    if (!progressed) {
      throw new Error(`Reference asset dependency cycle or missing dependency: ${[...pending.keys()].join(', ')}`);
    }
  }
  return resolved;
}

function selectReferenceDependencies(spec, existingReferences) {
  const dependencyIds = spec.dependsOn ?? [];
  const byId = new Map(existingReferences.map((reference) => [reference.id, reference]));
  const dependencies = dependencyIds.map((dependencyId) => {
    const reference = byId.get(dependencyId);
    if (!reference) throw new Error(`Reference asset ${spec.id} depends on ${dependencyId}, which has not been generated.`);
    return reference;
  });
  if (spec.id !== 'style-neon-arcana' && dependencies.length === 0) {
    throw new Error(`Reference asset ${spec.id} must use at least one upstream visual reference.`);
  }
  return dependencies.slice(0, 12);
}

async function verifyPanel({ panel, token, references }) {
  const imageData = panel.originalDataUrl.replace(/^data:[^;]+;base64,/, '');
  const referenceParts = buildVerificationReferenceParts(panel.assetManifest, references);
  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          text: [
            'Verify this generated comic panel for the Signal Loom demo.',
            'Return JSON only: {"pass":boolean,"score":number,"notes":string,"assetCoverage":[{"id":string,"pass":boolean,"notes":string}],"continuityNotes":string}. Score must be between 0 and 1.',
            'Pass when the image looks like finished magic/cyberpunk comic panel art, substantially follows the requested beat, and has no readable natural-language text, panel IDs, captions, speech balloons, UI labels, signage text, or watermark.',
            'Also check style consistency, character consistency, environment consistency, object/prop consistency, effects consistency, and local continuity from listed previous frames.',
            'Do not fail for abstract non-linguistic runes, circuit marks, dots, bars, diagrams, or code-like decoration unless they form readable words, letters, numbers, labels, or speech/caption lettering.',
            'Reference image order after the generated panel:',
            ...referenceParts.map((part, index) => `${index + 1}. ${part.label} (${part.id}, ${part.category})`),
            `Panel asset manifest: ${JSON.stringify(panel.assetManifest)}`,
            `Requested beat: ${panel.imagePrompt}`,
          ].join('\n'),
        },
        { inlineData: { mimeType: panel.originalMimeType, data: imageData } },
        ...referenceParts.map((reference) => ({
          inlineData: {
            mimeType: reference.mimeType,
            data: reference.dataUrl.replace(/^data:[^;]+;base64,/, ''),
          },
        })),
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };
  const payload = await callVertexGenerateContent({ token, model: VERIFY_MODEL, body });
  const parsed = parseJsonFromText(extractText(payload));
  if (typeof parsed.pass !== 'boolean') throw new Error(`Verification for ${panel.id} did not return pass boolean.`);
  return {
    pass: parsed.pass,
    score: normalizeVerificationScore(parsed.score),
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    assetCoverage: Array.isArray(parsed.assetCoverage) ? parsed.assetCoverage : [],
    continuityNotes: typeof parsed.continuityNotes === 'string' ? parsed.continuityNotes : '',
  };
}

function panelClearedPreUpscaleVerification(panel) {
  if (!panel.verification?.pass) return false;
  const coverage = Array.isArray(panel.verification.assetCoverage)
    ? panel.verification.assetCoverage
    : [];
  return coverage.length > 0 && coverage.every((asset) => asset?.pass === true);
}

function buildVerificationReferenceParts(assetManifest, references) {
  const referenceBySourceItemId = new Map(references.map((reference) => [reference.sourceItemId, reference]));
  return assetManifest.referenceAssetIds
    .map((sourceItemId) => referenceBySourceItemId.get(sourceItemId))
    .filter(Boolean)
    .slice(0, 12);
}

async function verifySequence({ panels, references, plan, token }) {
  const panelImages = await Promise.all(panels.map(async (panel) => {
    const buffer = await readFile(panel.originalPath);
    return {
      id: panel.id,
      mimeType: detectImageMimeType(buffer),
      data: buffer.toString('base64'),
    };
  }));
  const body = {
    contents: [{
      role: 'user',
      parts: [
        {
          text: [
            'Verify this full two-page, ten-panel Signal Loom demo comic sequence.',
            'Return JSON only: {"pass":boolean,"score":number,"notes":string,"pageContinuity":[{"page":number,"pass":boolean,"notes":string}],"neighborContinuity":[{"from":string,"to":string,"pass":boolean,"notes":string}]}',
            'Check that the panels read left to right as a coherent story, each panel follows from its previous neighbor, character state and object state remain understandable, environments progress logically, and the ending resolves the setup.',
            'Also check that reference-guided style, character, prop, environment, and effects consistency is broadly maintained.',
            `Panel script JSON: ${JSON.stringify(plan)}`,
            `Panel asset manifests: ${JSON.stringify(panels.map((panel) => ({ id: panel.id, assetManifest: panel.assetManifest, caption: panel.caption })))}`,
            `Reference assets: ${JSON.stringify(references.map((reference) => ({ id: reference.id, label: reference.label, category: reference.category })))}`,
          ].join('\n'),
        },
        ...panelImages.map((panelImage) => ({
          inlineData: {
            mimeType: panelImage.mimeType,
            data: panelImage.data,
          },
        })),
      ],
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };
  const payload = await callVertexGenerateContent({ token, model: VERIFY_MODEL, body });
  const parsed = parseJsonFromText(extractText(payload));
  return {
    pass: typeof parsed.pass === 'boolean' ? parsed.pass : false,
    score: normalizeVerificationScore(parsed.score),
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    pageContinuity: Array.isArray(parsed.pageContinuity) ? parsed.pageContinuity : [],
    neighborContinuity: Array.isArray(parsed.neighborContinuity) ? parsed.neighborContinuity : [],
  };
}

async function generateImagen({ token, model, prompt, aspectRatio }) {
  const payload = await callVertexPredict({
    token,
    model,
    body: {
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio,
        outputOptions: { mimeType: 'image/png' },
      },
    },
  });
  return Buffer.from(extractPredictImage(payload), 'base64');
}

async function generateGeminiImage({ token, model, prompt, aspectRatio, references = [] }) {
  const payload = await callVertexGenerateContent({
    token,
    model,
    body: {
      contents: [{
        role: 'user',
        parts: [
          { text: references.length > 0 ? `${prompt}\nUse the attached reference images for character, object, environment, effects, style, and adjacent-frame continuity. Do not copy any unwanted lettering from references.` : prompt },
          ...references.map((reference) => ({
            inlineData: {
              mimeType: reference.mimeType,
              data: reference.dataUrl.replace(/^data:[^;]+;base64,/, ''),
            },
          })),
        ],
      }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio },
      },
    },
  });
  return Buffer.from(extractInlineImage(payload), 'base64');
}

async function generateOriginalPanelImage({ spec, prompt, token, providerSecrets, references = [] }) {
  const provider = spec.provider ?? 'vertex';
  const guidedPrompt = buildReferenceGuidedPanelPrompt(prompt, references);
  if (provider === 'vertex') {
    const buffer = spec.route === 'imagen'
      ? await generateImagen({ token, model: spec.model, prompt: guidedPrompt, aspectRatio: spec.aspectRatio })
      : await generateGeminiImage({ token, model: spec.model, prompt: guidedPrompt, aspectRatio: spec.aspectRatio, references });
    return {
      provider: 'vertex',
      model: spec.model,
      route: spec.route,
      buffer,
      notes: references.length > 0 ? [`Used ${references.length} generated reference image(s).`] : [],
    };
  }

  if (provider === 'bfl') {
    const apiKey = providerSecrets.bfl;
    if (!apiKey) {
      throw new Error('BFL FLUX key is not configured in Signal Loom settings or environment.');
    }
    return {
      provider: 'bfl',
      model: spec.model,
      route: spec.route,
      buffer: await generateBflImage({
        apiKey,
        model: spec.model,
        prompt: guidedPrompt,
        aspectRatio: spec.aspectRatio,
        references,
      }),
      notes: [`Generated through the configured Black Forest Labs FLUX provider using ${references.length} reference image(s).`],
    };
  }

  if (provider === 'atlas') {
    const apiKey = providerSecrets.atlas;
    if (!apiKey) {
      throw new Error('Atlas Cloud key is not configured in Signal Loom settings or environment.');
    }

    const models = [spec.model, ...(spec.fallbackModels ?? [])];
    let lastError;
    for (const model of models) {
      try {
        return {
          provider: 'atlas',
          model,
          route: model === spec.model ? spec.route : `atlas-fallback-${safeFilePart(model)}`,
          buffer: await generateAtlasImage({
            apiKey,
            baseUrl: providerSecrets.atlasBaseUrl,
            model,
            prompt: guidedPrompt,
            aspectRatio: spec.aspectRatio,
            references,
          }),
          notes: model === spec.model
            ? [`Generated through the configured Atlas Cloud provider using ${references.length} reference image(s).`]
            : [`Requested ${spec.model}; generated through Atlas fallback model ${model} using ${references.length} reference image(s).`],
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error(`Atlas generation failed for ${spec.id}.`);
  }

  throw new Error(`Unsupported panel provider: ${provider}`);
}

async function generateBflImage({ apiKey, model, prompt, aspectRatio, references = [] }) {
  const { width, height } = mapAspectRatioToImageDimensions(aspectRatio);
  const body = {
    prompt,
    width,
    height,
    output_format: 'png',
  };
  references.slice(0, 8).forEach((reference, index) => {
    body[`input_image${index === 0 ? '' : `_${index + 1}`}`] = reference.dataUrl;
  });
  const payload = await callBflCreate({
    apiKey,
    model,
    body,
  });
  const pollingUrl = payload.polling_url;
  if (typeof pollingUrl !== 'string' || !pollingUrl) {
    throw new Error('BFL did not return a polling URL.');
  }
  const resultUrl = await pollBflImageResult({ apiKey, pollingUrl });
  return downloadGeneratedImage(resultUrl);
}

async function callBflCreate({ apiKey, model, body }) {
  const response = await fetch(`https://api.bfl.ai/v1/${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'x-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    throw new Error(`BFL ${model} create failed (${response.status}): ${extractProviderErrorMessage(payload)}`);
  }
  if (payload?.error) {
    throw new Error(`BFL ${model} create failed: ${extractProviderErrorMessage(payload.error)}`);
  }
  return payload;
}

async function pollBflImageResult({ apiKey, pollingUrl }) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(2000);
    const response = await fetch(pollingUrl, { headers: { 'x-key': apiKey } });
    const payload = await response.json().catch(async () => ({ raw: await response.text() }));
    if (!response.ok) {
      throw new Error(`BFL polling failed (${response.status}): ${extractProviderErrorMessage(payload)}`);
    }
    const status = String(payload.status ?? '').toLowerCase();
    if (status === 'ready') {
      const resultUrl = firstStringFromUnknown(payload.result?.sample)
        ?? firstStringFromUnknown(payload.result?.url)
        ?? firstStringFromUnknown(payload.sample)
        ?? firstStringFromUnknown(payload.url);
      if (!resultUrl) throw new Error('BFL completed without an image URL.');
      return resultUrl;
    }
    if (['error', 'failed', 'failure', 'content moderated', 'request moderated'].includes(status)) {
      throw new Error(`BFL generation failed: ${extractProviderErrorMessage(payload.error ?? payload)}`);
    }
  }
  throw new Error('BFL image generation timed out after 240 seconds.');
}

async function generateAtlasImage({ apiKey, baseUrl, model, prompt, aspectRatio, references = [] }) {
  const normalizedBaseUrl = normalizeAtlasBaseUrl(baseUrl);
  const { width, height } = mapAspectRatioToImageDimensions(aspectRatio);
  const referenceImages = [];
  for (let index = 0; index < Math.min(references.length, 6); index += 1) {
    referenceImages.push(await uploadAtlasMedia({
      apiKey,
      baseUrl: normalizedBaseUrl,
      image: references[index],
      filename: `${references[index].id}.png`,
    }));
  }
  const response = await fetch(`${normalizedBaseUrl}/model/generateImage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      width,
      height,
      steps: model.includes('schnell') ? 4 : 12,
      output_format: 'png',
      enable_safety_checker: true,
      ...(referenceImages.length > 0 ? { reference_images: referenceImages } : {}),
    }),
  });
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    throw new Error(`Atlas ${model} create failed (${response.status}): ${extractProviderErrorMessage(payload)}`);
  }
  if (payload?.error || payload?.data?.error) {
    throw new Error(`Atlas ${model} create failed: ${extractProviderErrorMessage(payload.error ?? payload.data.error)}`);
  }
  const immediateOutput = extractAtlasOutputUrl(payload);
  const predictionId = extractAtlasPredictionId(payload);
  const resultUrl = immediateOutput ?? (predictionId
    ? await pollAtlasImageResult({ apiKey, baseUrl: normalizedBaseUrl, predictionId })
    : undefined);
  if (!resultUrl) {
    throw new Error(`Atlas ${model} did not return a prediction ID or image output.`);
  }
  return downloadGeneratedImage(resultUrl);
}

async function pollAtlasImageResult({ apiKey, baseUrl, predictionId }) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(2000);
    const response = await fetch(`${baseUrl}/model/prediction/${encodeURIComponent(predictionId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const payload = await response.json().catch(async () => ({ raw: await response.text() }));
    if (!response.ok) {
      throw new Error(`Atlas polling failed (${response.status}): ${extractProviderErrorMessage(payload)}`);
    }
    const outputUrl = extractAtlasOutputUrl(payload);
    const status = String(extractAtlasPredictionStatus(payload) ?? '').toLowerCase();
    if (status && ['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(status)) {
      throw new Error(`Atlas generation failed: ${extractProviderErrorMessage(payload.error ?? payload.data?.error ?? payload)}`);
    }
    if (outputUrl && (!status || ['succeeded', 'success', 'completed', 'complete', 'done', 'ready'].includes(status))) {
      return outputUrl;
    }
    if (status && ['succeeded', 'success', 'completed', 'complete', 'done', 'ready'].includes(status)) {
      throw new Error('Atlas completed the image job without an output URL.');
    }
  }
  throw new Error('Atlas image generation timed out after 240 seconds.');
}

async function uploadAtlasMedia({ apiKey, baseUrl, image, filename }) {
  if (/^https?:\/\//i.test(image.dataUrl)) {
    return image.dataUrl;
  }
  const match = image.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error(`Reference image ${image.id} is not a supported data URL.`);
  const formData = new FormData();
  const buffer = Buffer.from(match[2], 'base64');
  formData.append('file', new Blob([buffer], { type: match[1] }), filename);
  const response = await fetch(`${baseUrl}/model/uploadMedia`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  const payload = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    throw new Error(`Atlas media upload failed (${response.status}): ${extractProviderErrorMessage(payload)}`);
  }
  const uploadedUrl = firstStringFromUnknown(payload?.data?.download_url)
    ?? firstStringFromUnknown(payload?.data?.url)
    ?? firstStringFromUnknown(payload?.download_url)
    ?? firstStringFromUnknown(payload?.url);
  if (!uploadedUrl) throw new Error(`Atlas media upload for ${image.id} did not return a URL.`);
  return uploadedUrl;
}

async function downloadGeneratedImage(resultUrl) {
  if (/^data:image\/[^;]+;base64,/i.test(resultUrl)) {
    return Buffer.from(resultUrl.split(',')[1], 'base64');
  }
  if (!/^https?:\/\//i.test(resultUrl)) {
    return Buffer.from(resultUrl, 'base64');
  }
  const response = await fetch(resultUrl);
  if (!response.ok) {
    throw new Error(`Generated image download failed (${response.status}): ${await response.text()}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function upscaleImage({ token, imageBuffer }) {
  const payload = await callVertexPredict({
    token,
    model: UPSCALE_MODEL,
    body: {
      instances: [{
        prompt: 'Upscale the image for crisp comic print production.',
        image: { bytesBase64Encoded: imageBuffer.toString('base64') },
      }],
      parameters: {
        mode: 'upscale',
        outputOptions: { mimeType: 'image/png' },
        upscaleConfig: { upscaleFactor: 'x2' },
      },
    },
  });
  return Buffer.from(extractPredictImage(payload), 'base64');
}

async function callVertexPredict({ token, model, body }) {
  return callVertex({
    token,
    model,
    method: 'predict',
    body,
  });
}

async function callVertexGenerateContent({ token, model, body }) {
  return callVertex({
    token,
    model,
    method: 'generateContent',
    body,
  });
}

async function callVertex({ token, model, method, body }) {
  const url = `https://aiplatform.googleapis.com/v1/projects/${encodeURIComponent(VERTEX_PROJECT)}/locations/${encodeURIComponent(VERTEX_LOCATION)}/publishers/google/models/${encodeURIComponent(model)}:${method}`;
  let lastError;
  const retryDelaysMs = [5000, 30000, 75000];
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': VERTEX_PROJECT,
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(async () => ({ raw: await response.text() }));
      if (!response.ok) {
        const message = payload?.error?.message ?? response.statusText;
        const error = new Error(`Vertex ${model}:${method} failed (${response.status}): ${message}`);
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      lastError = error;
      const delay = retryDelaysMs[attempt];
      if (!delay || !isRetryableVertexError(error)) break;
      await sleep(delay);
    }
  }
  throw lastError;
}

function isRetryableVertexError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|quota|rate|temporarily|503|502|504/i.test(message);
}

function buildPanelPrompt(panel, spec) {
  return [
    `${GLOBAL_STYLE}.`,
    'Create only the interior artwork for one comic panel. Page number, panel number, slot, captions, and dialogue are invisible production metadata and must not appear in the image.',
    sanitizePanelImagePrompt(panel.imagePrompt),
    buildPanelSpecificFix(spec.id),
    'Critical text ban: zero readable words, zero alphabetic characters, zero numbers, zero panel labels, zero page labels, zero speech balloons, zero caption boxes, zero signage, zero screen UI text, zero watermarks. Signs, terminals, books, spell diagrams, code, and runes must be abstract non-linguistic geometry, blank light bars, dots, circuit traces, or decorative shapes only.',
    `Mood context only, do not render as lettering: ${panel.caption}`,
    `Avoid: ${NEGATIVE_PROMPT}.`,
  ].filter(Boolean).join('\n');
}

function sanitizePanelImagePrompt(value) {
  return String(value)
    .replace(/Neon signs reflect in puddles\./gi, 'Blank neon color panels reflect in puddles.')
    .replace(/Neon signs/gi, 'blank neon color panels')
    .replace(/glowing glyphs/gi, 'abstract non-linguistic glowing geometry')
    .replace(/runes and glyphs/gi, 'abstract non-linguistic rune-like geometry')
    .replace(/glowing runes/gi, 'non-linguistic geometric light motifs')
    .replace(/broken code/gi, 'fragmented digital noise')
    .replace(/glowing code/gi, 'glowing circuit-like light fragments')
    .replace(/abstract code constructs that look like glowing runes and glyphs/gi, 'abstract loops of geometric light, dots, and circuit traces');
}

function buildPanelSpecificFix(panelId) {
  switch (panelId) {
    case 'p01':
      return 'Nyx must be visible in the foreground examining a blank abstract terminal, with Hex hovering nearby. Background neon must be blank color shapes only.';
    case 'p02':
      return 'Nyx, the wrist deck, and Hex must all be visible. The holographic map must use geometry only, with no map labels, letters, numbers, or signage.';
    case 'p03':
      return 'Show Nyx enough to reveal the wrist deck and luminous rune tattoos, with Hex hovering as a small anchor. The loop and branches must be pure abstract geometry, not written code. The loop effect must read as an intentional loop structure: repeated ring or infinity-loop path, visible validation nodes, abstract fork or branch structures, and one energy spike, not only a swirling vortex.';
    case 'p04':
      return 'Show three distinct routes by color, shape, and density only. Nyx must be a tiny faint background silhouette only, not foreground or midground. Do not show Hex. Do not show Nyx holding anything. The three route pathways dominate the panel. No labels on the pathways. Do not include digits, Arabic numerals, numeric markings, pseudo-numbers, tiny UI readouts, or number-shaped symbols; use smooth blank glowing ribbons and unmarked nodes only.';
    case 'p05':
      return 'Hex must remain recognizable as a small angular fox-eared drone transforming around a blue flame core. The corporate ward is red, cracked, and alarmed, with no Latin words or readable sigils.';
    case 'p06':
      return 'Single full-bleed comic panel only, not a comic page or split-panel layout. No speech balloons, caption boxes, signatures, or corner text. Nyx enters the black-glass cathedral alone while ICE golems patrol. Hex is off-panel in this frame: do not show any familiar, animal, spirit, pet, drone, hovering companion, or second character. ICE golems must be solid dark blocky black-glass guardians matching the reference, not translucent robots. Wall motifs are abstract geometry only.';
    case 'p07':
      return 'Glitch spirits are shards, halos, and noisy light, not letterforms. Nyx actively reroutes streams while Hex helps maintain continuity.';
    case 'p08':
      return 'Single full-bleed comic panel only, with clean image edges and no signatures, logos, watermark-like corner marks, speech, captions, labels, letters, or numbers. Hex must be visible near Nyx in the blue-flame transformed state. The daemon pentacle should unlock the city grid while the corporate ward remains a cracked red-and-black glass sphere or spherical shard cluster, not a monster or creature. Red ward fragments must visibly crack, dissolve, and fade into warm gold/cyan public-access light; red hostile energy must be receding, not dominant.';
    case 'p09':
      return 'The cracked phone screen must be blank glow, abstract bars, dots, and non-linguistic light only. Background signage must be blank. No readable text, letters, numbers, captions, speech, or UI symbols anywhere.';
    case 'p10':
      return 'No panel number or visible terminal words. The device display is blank abstract light patterns only. Nyx and Hex stand together in a quiet dawn silhouette. Hex must be clearly visible beside Nyx with cyan/blue fox-like light ears and a blue flame core matching the reference.';
    default:
      return '';
  }
}

function buildProjectDocument({ now, panels, references, plan, sequenceVerification, projectPath, assetRegistry }) {
  const sourceItems = panels.map((panel, index) => ({
    id: `neon-grimoire-${panel.id}-final`,
    label: `${panel.id.toUpperCase()} ${shortTitle(panel.caption)} final x2`,
    kind: 'image',
    mimeType: 'image/png',
    ...getRegisteredAsset(assetRegistry, `neon-grimoire-${panel.id}-final`),
    sourceKey: `demo:neon-grimoire:${panel.id}:final-x2`,
    originNodeId: `image-${panel.id}`,
    envelopeId: 'demo-neon-grimoire-final-panels',
    envelopeLabel: 'Neon Grimoire final panels',
    envelopeIndex: index,
    pixelWidth: panel.finalSize.width,
    pixelHeight: panel.finalSize.height,
    prompt: panel.imagePrompt,
    provider: panel.provider,
    model: panel.model,
    createdAt: now,
  }));
  const referenceItems = references.map((reference, index) => ({
    id: reference.sourceItemId,
    label: reference.label,
    kind: 'image',
    mimeType: reference.mimeType,
    ...getRegisteredAsset(assetRegistry, reference.sourceItemId),
    sourceKey: `demo:neon-grimoire:reference:${reference.id}`,
    originNodeId: `reference-${reference.id}`,
    envelopeId: 'demo-neon-grimoire-reference-assets',
    envelopeLabel: 'Neon Grimoire generated reference assets',
    envelopeIndex: index,
    pixelWidth: reference.size.width,
    pixelHeight: reference.size.height,
    prompt: reference.prompt,
    provider: 'vertex',
    model: reference.model,
    dependsOn: reference.dependsOn ?? [],
    usedReferenceIds: reference.usedReferenceIds ?? [],
    createdAt: now,
  }));
  const planText = JSON.stringify(plan, null, 2);
  const verificationSummary = panels.map((panel) => ({
    id: panel.id,
    pass: panel.verification.pass,
    score: panel.verification.score,
    notes: panel.verification.notes,
    assetCoverage: panel.verification.assetCoverage,
    continuityNotes: panel.verification.continuityNotes,
  }));
  const nodes = buildFlowNodes({ panels, references, sourceItems, referenceItems, planText, verificationSummary, sequenceVerification, now });
  const edges = buildFlowEdges(panels);
  const paper = buildPaperSnapshot({ panels, sourceItems, now });

  return {
    schemaVersion: 1,
    id: 'neon-grimoire-signal-loom-demo',
    name: 'Neon Grimoire - Signal Loom Demo',
    savedAt: now,
    flow: { version: 3, nodes, edges },
    flowWorkspaces: [{
      id: 'main',
      name: 'Main Flow',
      createdAt: now,
      updatedAt: now,
      flow: { version: 3, nodes, edges },
    }],
    activeFlowWorkspaceId: 'main',
    editor: {
      workspaceView: 'flow',
      activeSourceBinId: 'default',
      sourceBinVisible: true,
      programMonitorVisible: true,
      inspectorVisible: true,
      sourceMonitorVisible: true,
      sourceBinWidth: 300,
      inspectorWidth: 320,
      monitorSectionHeight: 340,
    },
    sourceBin: {
      bins: [{
        id: 'default',
        name: 'Neon Grimoire Demo Assets',
        collapsed: false,
        createdAt: now,
        items: [
          ...sourceItems,
          ...referenceItems,
          {
            id: 'neon-grimoire-panel-plan-json',
            label: 'Actual Gemini panel plan JSON',
            kind: 'text',
            mimeType: 'application/json',
            text: planText,
            sourceKey: 'demo:neon-grimoire:panel-plan-json',
            originNodeId: 'text-panel-plan',
            createdAt: now,
          },
          {
            id: 'neon-grimoire-verification-json',
            label: 'Actual Gemini vision verification JSON',
            kind: 'text',
            mimeType: 'application/json',
            text: JSON.stringify(verificationSummary, null, 2),
            sourceKey: 'demo:neon-grimoire:verification-json',
            originNodeId: 'text-verify-summary',
            createdAt: now,
          },
        ],
      }],
      dismissedSourceKeys: [],
    },
    usageLedger: buildUsageLedger({ panels, now }),
    demoVerification: {
      panels: verificationSummary,
      sequence: sequenceVerification,
    },
    paper,
    imageEditor: { documents: [], activeDocId: null },
    fileSystem: {
      projectDirectoryName: dirname(projectPath),
      scratchDirectoryName: basename(deriveProjectScratchDirectoryPath(projectPath)),
      lastSavedToFolderAt: now,
      scratchAssetCount: sourceItems.length + referenceItems.length,
    },
  };
}

async function prepareProjectAssetRegistry({ projectPaths, panels, references }) {
  const assets = [
    ...panels.map((panel) => ({
      id: `neon-grimoire-${panel.id}-final`,
      sourcePath: panel.finalPath,
      scratchFileName: `${panel.id}-final-x2.png`,
    })),
    ...references.map((reference) => ({
      id: reference.sourceItemId,
      sourcePath: reference.path,
      scratchFileName: `reference-${reference.id}.${extensionForMimeType(reference.mimeType)}`,
    })),
  ];
  const registry = new Map();
  const scratchDirectories = [...new Set(projectPaths.map((projectPath) => deriveProjectScratchDirectoryPath(projectPath)))];
  for (const scratchDirectory of scratchDirectories) {
    await mkdir(scratchDirectory, { recursive: true });
  }
  for (const asset of assets) {
    const primaryScratchPath = join(scratchDirectories[0], asset.scratchFileName);
    for (const scratchDirectory of scratchDirectories) {
      const targetPath = join(scratchDirectory, asset.scratchFileName);
      if (resolve(asset.sourcePath) !== resolve(targetPath)) {
        await copyFile(asset.sourcePath, targetPath);
      }
    }
    registry.set(asset.id, {
      assetId: asset.id,
      assetUrl: buildNativeAssetUrl(asset.id),
      nativeFilePath: primaryScratchPath,
      scratchFileName: asset.scratchFileName,
    });
  }
  return registry;
}

function getRegisteredAsset(assetRegistry, id) {
  const asset = assetRegistry.get(id);
  if (!asset) throw new Error(`Missing registered project asset ${id}.`);
  return asset;
}

function deriveProjectScratchDirectoryPath(projectPath) {
  return `${projectPath.replace(/\.sloom$/i, '')}.signal-loom-scratch`;
}

function buildNativeAssetUrl(assetId) {
  return `signal-loom-asset://asset/${encodeURIComponent(assetId)}`;
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function buildFlowNodes({ panels, references, sourceItems, referenceItems, planText, verificationSummary, sequenceVerification, now }) {
  const nodes = [];
  const sourceItemById = new Map([...sourceItems, ...referenceItems].map((item) => [item.id, item]));
  const add = (id, type, x, y, data = {}, extra = {}) => {
    nodes.push({ id, type, position: { x, y }, data, ...extra });
  };

  const groupSpecs = [
    ['group-brief', '01 Brief and Style', 0, -3720, ['text-brief', 'color-style', 'text-negative']],
    ['group-plan', '02 Script, List, Loop', 650, -3720, ['text-panel-plan', 'envelope-panel-plan', 'loop-ten-panels', 'js-router']],
    ['group-references', '03 Generated Reference Assets', 1300, -3720, ['reference-asset-envelope', 'text-asset-manifest']],
    ['group-portals', '04 Named Portals', 1950, -3720, ['portal-render-entry', 'portal-render-exit', 'portal-paper-entry', 'portal-paper-exit']],
    ['group-render', '05 Real Multi-Provider Rendering', 2600, -3720, panels.map((panel) => `image-${panel.id}`)],
    ['group-verify', '06 Verify, Fallback, Package', 4550, -3720, ['vision-sample', 'text-verify-summary', 'text-sequence-verify', 'conditional-verified', 'fallback-final', 'source-bin-final']],
    ['group-paper', '07 Paper Layout Output', 5850, -3720, ['text-paper-layout', 'value-paper-pages', 'monitor-final-assets']],
  ];

  for (const [id, title, x, y, childIds] of groupSpecs) {
    add(id, 'groupNode', x, y, {
      customTitle: title,
      groupNode: {
        title,
        description: `${title} section for the two-page Neon Grimoire demo.`,
        childNodeIds: childIds,
        childEdgeIds: [],
        bounds: { x, y: y + 420, width: 620, height: 5200 },
        collapsed: false,
        color: '#22d3ee',
      },
    });
  }

  add('text-brief', 'textNode', 0, -3000, {
    customTitle: 'Bookmark: Project Brief',
    mode: 'prompt',
    provider: 'gemini',
    modelId: TEXT_MODEL,
    prompt: [
      'Neon Grimoire is a two-page Signal Loom demo comic.',
      'Goal: show a hacker-mage using real model generation, loops, branches, verification, fallback routing, upscaling, Source Library packaging, and Paper layout.',
      'Reading order: left to right like a book. Branches move up/down only where model choices diverge.',
    ].join('\n'),
  });
  add('color-style', 'colorSwatchNode', 0, -2600, {
    customTitle: 'Bookmark: Neon Arcana Palette',
    colorSwatchUsageMode: 'theme',
    colorSwatchColors: ['#00E5FF', '#FF2BD6', '#F7D046', '#10131B', '#F8FAFC'],
    colorSwatchDraftColor: '#00E5FF',
    colorSwatchSelectedIndex: 0,
  });
  add('text-negative', 'textNode', 0, -2080, {
    customTitle: 'Bookmark: Image Exclusions',
    mode: 'prompt',
    provider: 'gemini',
    modelId: TEXT_MODEL,
    prompt: NEGATIVE_PROMPT,
  });

  add('text-panel-plan', 'textNode', 520, -3000, {
    customTitle: 'Bookmark: Actual Gemini Panel Plan',
    mode: 'generate',
    provider: 'gemini',
    modelId: TEXT_MODEL,
    prompt: 'Generate the exact JSON script for the ten-panel magic/cyberpunk hacker comic.',
    result: planText,
    resultType: 'json',
    selectedResultId: 'panel-plan-result',
    resultHistory: [{
      id: 'panel-plan-result',
      result: planText,
      resultType: 'json',
      statusMessage: `Generated with Vertex ${TEXT_MODEL}`,
      createdAt: new Date(now).toISOString(),
      usage: {
        source: 'actual',
        confidence: 'measured',
        provider: 'vertex',
        modelId: TEXT_MODEL,
        notes: ['Actual Vertex Gemini response used to drive the demo project script.'],
      },
    }],
  });
  add('envelope-panel-plan', 'envelope', 880, -3000, {
    customTitle: 'Bookmark: Panel Plan Envelope',
    flowVariableName: 'panel_plan',
    envelopeItemKind: 'json',
    envelopeItems: panels.map((panel, index) => ({
      id: `plan-${panel.id}`,
      index,
      kind: 'json',
      label: `${panel.id.toUpperCase()} plan`,
      value: JSON.stringify({
        id: panel.id,
        page: panel.page,
        panel: panel.panel,
        caption: panel.caption,
        dialogue: panel.dialogue,
        provider: panel.provider,
        model: panel.model,
        route: panel.route,
        aspectRatio: panel.aspectRatio,
      }),
      mimeType: 'application/json',
      sourceNodeId: 'text-panel-plan',
    })),
  });
  add('loop-ten-panels', 'loopNode', 1240, -3000, {
    customTitle: 'Bookmark: Ten Panel Loop',
    count: 10,
    statusMessage: 'Loops the panel plan into ten render jobs.',
  });
  add('js-router', 'javascriptNode', 1600, -3000, {
    customTitle: 'Bookmark: Model Router JS',
    code: [
      'const panels = A;',
      'const modelRows = panels.map((panel) => ({',
      '  ...panel,',
      '  route: panel.provider === "bfl" ? "configured-external" :',
      '    panel.provider === "atlas" ? "configured-external" :',
      '    panel.route === "gemini-image" ? "gemini-image" : "vertex-imagen",',
      '  branch: panel.page === 1 ? "page-1" : "page-2"',
      '}));',
      'return modelRows;',
    ].join('\n'),
    result: JSON.stringify(panels.map((panel) => ({
      id: panel.id,
      provider: panel.provider,
      model: panel.model,
      route: resolveSwitchRoute(panel),
    })), null, 2),
    resultType: 'json',
    selectedResultId: 'router-result',
    resultHistory: [{
      id: 'router-result',
      result: JSON.stringify(panels.map((panel) => ({
        id: panel.id,
        provider: panel.provider,
        model: panel.model,
        route: resolveSwitchRoute(panel),
      })), null, 2),
      resultType: 'json',
      statusMessage: 'Router output recorded from the real generation plan.',
      createdAt: new Date(now).toISOString(),
      usage: { source: 'actual', confidence: 'measured', provider: 'local', modelId: 'javascript-router' },
    }],
  });

  add('reference-asset-envelope', 'envelope', 1960, -3000, {
    customTitle: 'Bookmark: Generated Reference Asset Package',
    flowVariableName: 'reference_assets',
    envelopeItemKind: 'image',
    envelopeItems: references.map((reference, index) => ({
      id: `reference-${reference.id}`,
      index,
      kind: 'image',
      label: reference.label,
      value: sourceItemById.get(reference.sourceItemId)?.assetUrl,
      mimeType: reference.mimeType,
      sourceNodeId: `reference-${reference.id}`,
      sourceBinItemId: reference.sourceItemId,
    })),
  });
  add('text-asset-manifest', 'textNode', 2320, -3000, {
    customTitle: 'Bookmark: Per Panel Asset Manifest',
    mode: 'prompt',
    provider: 'gemini',
    modelId: TEXT_MODEL,
    prompt: 'Each panel stores characters, environments, objects, effects, and previous-frame references in data.assetManifest.',
    result: JSON.stringify(panels.map((panel) => ({ id: panel.id, assetManifest: panel.assetManifest })), null, 2),
    resultType: 'json',
  });

  add('portal-render-entry', 'portal', 2680, -3000, {
    customTitle: 'Portal: Plan to Render Entrance',
    portalRole: 'entry',
    portalPairId: 'portal-plan-to-render',
    portalLabel: 'Plan to Render',
  });
  add('portal-render-exit', 'portal', 3040, -3000, {
    customTitle: 'Portal: Plan to Render Exit',
    portalRole: 'exit',
    portalPairId: 'portal-plan-to-render',
    portalLabel: 'Plan to Render',
  });
  add('switch-model-route', 'switchCaseNode', 3400, -3000, {
    customTitle: 'Bookmark: Model Route Switch',
    case1Val: 'vertex-imagen',
    case2Val: 'gemini-image',
    case3Val: 'configured-external',
  });

  const panelPositions = {
    p01: [2600, -1700],
    p02: [2960, -1700],
    p03: [3320, -1700],
    p04: [3680, -1700],
    p05: [4040, -1700],
    p06: [2600, 700],
    p07: [2960, 700],
    p08: [3320, 700],
    p09: [3680, 700],
    p10: [4040, 700],
  };
  for (const panel of panels) {
    const [x, y] = panelPositions[panel.id];
    const panelSourceItem = sourceItemById.get(`neon-grimoire-${panel.id}-final`);
    if (!panelSourceItem) throw new Error(`Missing final source item for ${panel.id}.`);
    add(`image-${panel.id}`, 'imageGen', x, y, {
      customTitle: `${panel.id.toUpperCase()} ${shortTitle(panel.caption)}`,
      mediaMode: 'generate',
      provider: toSignalLoomImageProvider(panel.provider),
      modelId: panel.model,
      assetManifest: panel.assetManifest,
      aspectRatio: panel.aspectRatio,
      imageOutputFormat: 'png',
      imageOperation: 'text-to-image',
      imageAutoUpscale: true,
      prompt: panel.imagePrompt,
      result: panelSourceItem.assetUrl,
      resultType: 'image',
      resultMimeType: 'image/png',
      resultFileName: `${panel.id}-${safeFilePart(panel.model)}-x2.png`,
      sourceBinItemId: panelSourceItem.id,
      sourceAssetId: panelSourceItem.assetId,
      sourceAssetUrl: panelSourceItem.assetUrl,
      sourceAssetName: panelSourceItem.label,
      sourceAssetMimeType: panelSourceItem.mimeType,
      resultOutputMetadata: {
        provider: panel.provider,
        requestedModel: panel.requestedModel,
        route: panel.route,
        providerNotes: panel.providerNotes,
        originalPath: panel.originalPath,
        finalPath: panel.finalPath,
        originalSize: panel.originalSize,
        finalSize: panel.finalSize,
        upscaleModel: UPSCALE_MODEL,
      },
      selectedResultId: `${panel.id}-final-result`,
      resultHistory: [{
        id: `${panel.id}-final-result`,
        result: panelSourceItem.assetUrl,
        resultType: 'image',
        statusMessage: `Generated with ${formatProviderLabel(panel.provider)} ${panel.model}; x2 upscaled with ${UPSCALE_MODEL}.`,
        createdAt: new Date(now).toISOString(),
        variableName: `${panel.id}_final`,
        usage: {
          source: 'actual',
          confidence: 'measured',
          provider: panel.provider,
          modelId: panel.model,
          imageCount: 1,
          notes: [
            ...panel.providerNotes,
            `Upscaled with ${UPSCALE_MODEL}; verification score ${panel.verification.score}.`,
          ],
        },
      }],
    });
  }

  add('envelope-final-panels', 'envelope', 4600, -1700, {
    customTitle: 'Bookmark: Final Panel Envelope',
    flowVariableName: 'final_panel_images',
    envelopeItemKind: 'image',
  });
  add('vision-sample', 'visionVerifyNode', 4960, -1700, {
    customTitle: 'Bookmark: Vision Verify Sample',
    modelId: VERIFY_MODEL,
    result: panels.every((panel) => panel.verification.pass) ? 'true' : 'false',
    resultType: 'boolean',
    usage: {
      source: 'actual',
      confidence: 'measured',
      provider: 'vertex',
      modelId: VERIFY_MODEL,
      notes: [`All-panel verification min score ${Math.min(...panels.map((panel) => panel.verification.score))}. ${panels[0]?.verification.notes ?? ''}`],
    },
  });
  add('text-verify-summary', 'textNode', 5320, -1700, {
    customTitle: 'Bookmark: Actual Vision Verification',
    mode: 'generate',
    provider: 'gemini',
    modelId: VERIFY_MODEL,
    prompt: 'Verify the final comic panels against the panel plan.',
    result: JSON.stringify(verificationSummary, null, 2),
    resultType: 'json',
    selectedResultId: 'verification-summary-result',
    resultHistory: [{
      id: 'verification-summary-result',
      result: JSON.stringify(verificationSummary, null, 2),
      resultType: 'json',
      statusMessage: `Verified with Vertex ${VERIFY_MODEL}`,
      createdAt: new Date(now).toISOString(),
      usage: {
        source: 'actual',
        confidence: 'measured',
        provider: 'vertex',
        modelId: VERIFY_MODEL,
        notes: ['One real vision verification call per final upscaled panel.'],
      },
    }],
  });
  add('text-sequence-verify', 'textNode', 5680, -1700, {
    customTitle: 'Bookmark: Whole Sequence Verification',
    mode: 'generate',
    provider: 'gemini',
    modelId: VERIFY_MODEL,
    prompt: 'Verify story sequence continuity, neighbor-to-neighbor logic, and reference consistency across the ten final panels.',
    result: JSON.stringify(sequenceVerification, null, 2),
    resultType: 'json',
    selectedResultId: 'sequence-verification-result',
    resultHistory: [{
      id: 'sequence-verification-result',
      result: JSON.stringify(sequenceVerification, null, 2),
      resultType: 'json',
      statusMessage: `Sequence verified with Vertex ${VERIFY_MODEL}`,
      createdAt: new Date(now).toISOString(),
      usage: {
        source: 'actual',
        confidence: 'measured',
        provider: 'vertex',
        modelId: VERIFY_MODEL,
        notes: ['One real whole-sequence vision verification call over the complete comic flow.'],
      },
    }],
  });
  add('value-verified-true', 'valueNode', 6040, -1700, {
    customTitle: 'Bookmark: Verified Gate Value',
    valueKind: 'boolean',
    value: panels.every((panel) => panel.verification.pass),
  });
  add('conditional-verified', 'conditionalNode', 6040, -1150, {
    customTitle: 'Bookmark: Verification Gate',
  });
  add('fallback-final', 'fallbackSelectorNode', 6040, -700, {
    customTitle: 'Bookmark: Fallback to Last Good Batch',
    statusMessage: 'Primary final envelope selected because verification passed.',
  });
  add('source-bin-final', 'sourceBin', 6040, -300, {
    customTitle: 'Bookmark: Source Library Package',
    targetBinId: 'default',
  });

  add('portal-paper-entry', 'portal', 6040, 600, {
    customTitle: 'Portal: Assets to Paper Entrance',
    portalRole: 'entry',
    portalPairId: 'portal-assets-to-paper',
    portalLabel: 'Assets to Paper',
  });
  add('portal-paper-exit', 'portal', 6400, 600, {
    customTitle: 'Portal: Assets to Paper Exit',
    portalRole: 'exit',
    portalPairId: 'portal-assets-to-paper',
    portalLabel: 'Assets to Paper',
  });
  add('text-paper-layout', 'textNode', 6400, -1700, {
    customTitle: 'Bookmark: Two Page Paper Layout',
    mode: 'prompt',
    provider: 'gemini',
    modelId: TEXT_MODEL,
    prompt: 'Paper workspace contains two comic-book pages, five panels per page, with measured gutters, captions, speech balloons, and linked Source Library images.',
  });
  add('value-paper-pages', 'valueNode', 6400, -1250, {
    customTitle: 'Bookmark: Paper Page Count',
    valueKind: 'number',
    value: 2,
  });
  add('monitor-final-assets', 'valueMonitorNode', 6400, -800, {
    customTitle: 'Bookmark: Final Asset Monitor',
  });

  return nodes;
}

function buildFlowEdges(panels) {
  const edges = [];
  const add = (source, target, targetHandle, sourceHandle) => {
    edges.push({
      id: `edge-${source}-${sourceHandle ?? 'out'}-${target}-${targetHandle ?? 'in'}`.replace(/[^a-zA-Z0-9_-]+/g, '-'),
      source,
      target,
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {}),
      selected: false,
    });
  };

  add('text-brief', 'text-panel-plan');
  add('color-style', 'js-router', 'B');
  add('text-negative', 'js-router', 'C');
  add('text-panel-plan', 'envelope-panel-plan');
  add('envelope-panel-plan', 'loop-ten-panels');
  add('text-panel-plan', 'text-asset-manifest');
  add('reference-asset-envelope', 'text-asset-manifest');
  add('loop-ten-panels', 'js-router', 'A');
  add('reference-asset-envelope', 'js-router');
  add('js-router', 'portal-render-entry');
  add('portal-render-exit', 'switch-model-route', 'key');
  for (const panel of panels) {
    const handle = resolveSwitchRoute(panel) === 'gemini-image'
      ? 'case2'
      : resolveSwitchRoute(panel) === 'configured-external'
        ? 'case3'
        : 'case1';
    add('switch-model-route', `image-${panel.id}`, undefined, handle);
    add(`image-${panel.id}`, 'envelope-final-panels');
  }
  add('image-p10', 'vision-sample', 'image');
  add('text-panel-plan', 'vision-sample', 'prompt');
  add('reference-asset-envelope', 'vision-sample', 'refImage');
  add('text-verify-summary', 'text-sequence-verify');
  add('value-verified-true', 'conditional-verified', 'condition');
  add('envelope-final-panels', 'conditional-verified', 'valueIfTrue');
  add('envelope-final-panels', 'fallback-final', 'primary');
  add('conditional-verified', 'fallback-final', 'fallback');
  add('fallback-final', 'source-bin-final');
  add('fallback-final', 'portal-paper-entry');
  add('portal-paper-exit', 'text-paper-layout');
  add('envelope-final-panels', 'monitor-final-assets');
  return edges;
}

function resolveSwitchRoute(panel) {
  if (panel.provider === 'bfl' || panel.provider === 'atlas') return 'configured-external';
  if (panel.route === 'gemini-image') return 'gemini-image';
  return 'vertex-imagen';
}

function toSignalLoomImageProvider(provider) {
  return provider === 'bfl' || provider === 'atlas' ? provider : 'gemini';
}

function formatProviderLabel(provider) {
  switch (provider) {
    case 'bfl':
      return 'BFL';
    case 'atlas':
      return 'Atlas Cloud';
    case 'vertex':
      return 'Vertex';
    default:
      return provider;
  }
}

function buildPaperSnapshot({ panels, sourceItems, now }) {
  const pageSpec = { preset: 'comic-book', widthMm: 170, heightMm: 260, bleedMm: 3.175, dpi: 300 };
  const slots = buildPageSlots(pageSpec);
  const pages = [1, 2].map((pageNumber) => {
    const pagePanels = panels.filter((panel) => panel.page === pageNumber);
    const frames = [];
    let z = 0;
    for (const panel of pagePanels) {
      const slot = slots[panel.slot];
      const item = sourceItems.find((candidate) => candidate.id === `neon-grimoire-${panel.id}-final`);
      frames.push(imageFrame(panel, item, slot, z++));
      frames.push(captionFrame(panel, slot, z++));
      if (panel.dialogue?.trim()) {
        frames.push(dialogueFrame(panel, slot, z++));
      }
      if (PAPER_SFX_LABELS[panel.id]) {
        frames.push(sfxFrame(panel, slot, PAPER_SFX_LABELS[panel.id], z++));
      }
    }
    return {
      id: `paper-page-${pageNumber}`,
      pageNumber,
      frames,
      guides: [
        { id: `guide-v-${pageNumber}`, orientation: 'vertical', positionMm: pageSpec.widthMm / 2, label: 'Center vertical' },
        { id: `guide-h-${pageNumber}`, orientation: 'horizontal', positionMm: pageSpec.heightMm / 2, label: 'Center horizontal' },
      ],
    };
  });
  return {
    document: {
      id: 'paper-neon-grimoire-demo',
      title: 'Neon Grimoire Demo Comic',
      page: pageSpec,
      layout: {
        marginsMm: { top: 7, right: 7, bottom: 7, left: 7 },
        columns: { count: 2, gutterMm: 3 },
        grid: { enabled: true, sizeMm: 5, subdivisions: 5 },
      },
      background: { type: 'solid', color: '#f8fafc', fromColor: '#f8fafc', toColor: '#f8fafc', angleDeg: 90, radialShape: 'ellipse' },
      printProduction: {
        pdfStandard: 'pdf-x-4',
        outputIntentProfileId: 'gracol-2013-coated',
        customOutputIntentName: '',
        inkLimitPercent: 300,
        blackPolicy: 'force-100k-text',
        spotColorPolicy: 'warn',
        includeBleed: true,
        includeCropMarks: true,
        includeRegistrationMarks: false,
        includeColorBars: false,
        includePageInfo: false,
        rasterizeEffects: true,
        flattenTransparency: false,
        packageFonts: false,
        packageLinkedAssets: true,
        metadataTitle: 'Neon Grimoire Demo Comic',
        metadataAuthor: 'Signal Loom',
        metadataSubject: 'Two-page AI workflow demo comic',
        metadataKeywords: 'Signal Loom, comic, Vertex, Gemini, Imagen, BFL, FLUX, Atlas Cloud',
      },
      view: {
        showRulers: true,
        showGrid: false,
        showGuides: true,
        showBleed: true,
        showSpreads: false,
        startOnRight: true,
        snapToGuides: false,
        snapToGrid: false,
      },
      parentPages: [{ id: 'parent-page-a', name: 'A-Parent', frames: [], guides: [] }],
      styles: {
        paragraph: [
          { id: 'para-caption', name: 'Demo Caption', typography: { fontFamily: 'Georgia, serif', fontSizePt: 7, leadingPt: 8.5, align: 'left', fontWeight: '700', hyphenate: true } },
          { id: 'para-dialogue', name: 'Demo Dialogue', typography: { fontFamily: 'Inter, system-ui, sans-serif', fontSizePt: 6.4, leadingPt: 7.2, align: 'center', fontWeight: '700', hyphenate: false } },
        ],
        character: [],
        object: [],
      },
      pages,
      createdAt: now,
      updatedAt: now,
    },
    selectedPageId: 'paper-page-1',
    selectedFrameId: undefined,
    selectedFrameIds: [],
    tool: 'select',
    zoom: 0.72,
  };
}

function buildPageSlots(pageSpec) {
  const margin = 7;
  const gutter = 3;
  const x = margin;
  const y = margin;
  const width = pageSpec.widthMm - margin * 2;
  const topHeight = 60;
  const middleHeight = 88;
  const bottomHeight = pageSpec.heightMm - margin * 2 - topHeight - middleHeight - gutter * 2;
  const halfWidth = (width - gutter) / 2;
  return {
    'top-left': { xMm: x, yMm: y, widthMm: halfWidth, heightMm: topHeight },
    'top-right': { xMm: x + halfWidth + gutter, yMm: y, widthMm: halfWidth, heightMm: topHeight },
    'middle-wide': { xMm: x, yMm: y + topHeight + gutter, widthMm: width, heightMm: middleHeight },
    'bottom-left': { xMm: x, yMm: y + topHeight + middleHeight + gutter * 2, widthMm: halfWidth, heightMm: bottomHeight },
    'bottom-right': { xMm: x + halfWidth + gutter, yMm: y + topHeight + middleHeight + gutter * 2, widthMm: halfWidth, heightMm: bottomHeight },
  };
}

function imageFrame(panel, item, slot, zIndex) {
  return baseFrame({
    id: `paper-${panel.id}-image`,
    kind: 'image',
    label: `${panel.id.toUpperCase()} final art`,
    ...slot,
    asset: {
      sourceBinItemId: item.id,
      label: item.label,
      kind: 'image',
      src: item.assetUrl,
      mimeType: item.mimeType,
      pixelWidth: item.pixelWidth,
      pixelHeight: item.pixelHeight,
    },
    fit: 'cover',
    strokeColor: '#0f172a',
    strokeWidthMm: 0.55,
    zIndex,
  });
}

function captionFrame(panel, slot, zIndex) {
  return baseFrame({
    id: `paper-${panel.id}-caption`,
    kind: 'caption',
    label: `${panel.id.toUpperCase()} caption`,
    xMm: slot.xMm + 2,
    yMm: slot.yMm + 2,
    widthMm: slot.widthMm - 4,
    heightMm: panel.slot === 'middle-wide' ? 10 : 12,
    text: panel.caption,
    fillColor: '#fff4bf',
    fillOpacity: 0.94,
    strokeColor: '#111827',
    strokeWidthMm: 0.25,
    cornerRadiusMm: 1.2,
    typography: {
      fontFamily: 'Georgia, serif',
      fontSizePt: panel.slot === 'middle-wide' ? 7.3 : 6.4,
      leadingPt: panel.slot === 'middle-wide' ? 8.8 : 7.6,
      align: 'left',
      hyphenate: true,
      color: '#111827',
      fontWeight: '700',
      fontStyle: 'normal',
    },
    zIndex,
  });
}

function dialogueFrame(panel, slot, zIndex) {
  const wide = slot.widthMm > 100;
  const widthMm = wide ? 54 : Math.min(46, slot.widthMm - 8);
  const heightMm = wide ? 16 : 18;
  const left = panel.panel % 2 === 0;
  return baseFrame({
    id: `paper-${panel.id}-dialogue`,
    kind: panel.id === 'p07' ? 'thoughtBubble' : 'speechBubble',
    label: `${panel.id.toUpperCase()} dialogue`,
    xMm: left ? slot.xMm + 4 : slot.xMm + slot.widthMm - widthMm - 4,
    yMm: slot.yMm + slot.heightMm - heightMm - 5,
    widthMm,
    heightMm,
    text: panel.dialogue,
    fillColor: '#ffffff',
    fillOpacity: 0.96,
    strokeColor: '#111827',
    strokeWidthMm: 0.35,
    cornerRadiusMm: 100,
    textBoxXPercent: 10,
    textBoxYPercent: 15,
    textBoxWidthPercent: 80,
    textBoxHeightPercent: 62,
    textVerticalAlign: 'middle',
    tailXPercent: left ? 24 : 76,
    tailYPercent: 93,
    typography: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePt: wide ? 6.8 : 6.1,
      leadingPt: wide ? 7.5 : 6.9,
      align: 'center',
      hyphenate: false,
      color: '#111827',
      fontWeight: '700',
      fontStyle: 'normal',
    },
    zIndex,
  });
}

function sfxFrame(panel, slot, text, zIndex) {
  const wide = slot.widthMm > 100;
  const widthMm = wide ? 34 : 26;
  const heightMm = wide ? 12 : 10;
  return baseFrame({
    id: `paper-${panel.id}-sfx`,
    kind: 'text',
    label: `${panel.id.toUpperCase()} SFX`,
    xMm: slot.xMm + slot.widthMm - widthMm - 5,
    yMm: slot.yMm + 5,
    widthMm,
    heightMm,
    text,
    fillColor: 'transparent',
    fillOpacity: 0,
    strokeColor: 'transparent',
    strokeWidthMm: 0,
    typography: {
      fontFamily: 'Impact, Inter, system-ui, sans-serif',
      fontSizePt: wide ? 14 : 10.5,
      leadingPt: wide ? 14 : 11,
      align: 'center',
      hyphenate: false,
      color: '#fef08a',
      fontWeight: '900',
      fontStyle: 'normal',
    },
    zIndex,
  });
}

function baseFrame(input) {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    xMm: roundMm(input.xMm),
    yMm: roundMm(input.yMm),
    widthMm: roundMm(input.widthMm),
    heightMm: roundMm(input.heightMm),
    rotationDeg: 0,
    locked: false,
    text: input.text,
    asset: input.asset,
    fit: input.fit ?? 'contain',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    imageFlipX: false,
    imageFlipY: false,
    columns: 1,
    typography: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePt: 8,
      leadingPt: 9.5,
      tracking: 0,
      align: 'left',
      hyphenate: true,
      color: '#111827',
      fontWeight: '400',
      fontStyle: 'normal',
      ...(input.typography ?? {}),
    },
    fillColor: input.fillColor ?? 'transparent',
    fillOpacity: input.fillOpacity ?? 1,
    strokeColor: input.strokeColor ?? '#111827',
    strokeOpacity: 1,
    strokeWidthMm: input.strokeWidthMm ?? 0.35,
    strokeStyle: 'solid',
    cornerRadiusMm: input.cornerRadiusMm ?? 0,
    opacity: 1,
    textBoxXPercent: input.textBoxXPercent ?? 0,
    textBoxYPercent: input.textBoxYPercent ?? 0,
    textBoxWidthPercent: input.textBoxWidthPercent ?? 100,
    textBoxHeightPercent: input.textBoxHeightPercent ?? 100,
    textRotationDeg: 0,
    textVerticalAlign: input.textVerticalAlign ?? 'top',
    bubbleShape: input.kind === 'thoughtBubble' ? 'cloud' : input.kind === 'speechBubble' ? 'organic' : undefined,
    bubbleWarp: input.kind === 'speechBubble' || input.kind === 'thoughtBubble' ? 0.18 : undefined,
    bubblePinchXPercent: input.kind === 'speechBubble' || input.kind === 'thoughtBubble' ? 58 : undefined,
    bubblePinchYPercent: input.kind === 'speechBubble' || input.kind === 'thoughtBubble' ? 75 : undefined,
    bubbleTailWidthPercent: input.kind === 'thoughtBubble' ? 12 : input.kind === 'speechBubble' ? 18 : undefined,
    bubbleTailCurvePercent: input.kind === 'speechBubble' || input.kind === 'thoughtBubble' ? 55 : undefined,
    tailXPercent: input.tailXPercent,
    tailYPercent: input.tailYPercent,
    zIndex: input.zIndex ?? 0,
    inherited: false,
  };
}

function buildUsageLedger({ panels, now }) {
  const entries = [
    {
      id: `usage-text-plan-${now}`,
      createdAt: now,
      workspace: 'flow',
      flowWorkspaceId: 'main',
      flowWorkspaceName: 'Main Flow',
      operation: 'text-generation',
      nodeId: 'text-panel-plan',
      nodeType: 'textNode',
      provider: 'vertex',
      modelId: TEXT_MODEL,
      source: 'actual',
      confidence: 'measured',
      notes: ['Actual Gemini panel planning call.'],
    },
  ];
  panels.forEach((panel, index) => {
    entries.push({
      id: `usage-image-${panel.id}-${now}`,
      createdAt: now + index + 1,
      workspace: 'flow',
      flowWorkspaceId: 'main',
      flowWorkspaceName: 'Main Flow',
      operation: 'image-generation',
      nodeId: `image-${panel.id}`,
      nodeType: 'imageGen',
      provider: panel.provider,
      modelId: panel.model,
      source: 'actual',
      confidence: 'measured',
      imageCount: 1,
      notes: [
        `Generated ${panel.id} with ${formatProviderLabel(panel.provider)}, then upscaled with ${UPSCALE_MODEL}.`,
        ...panel.providerNotes,
      ],
    });
    entries.push({
      id: `usage-upscale-${panel.id}-${now}`,
      createdAt: now + index + 100,
      workspace: 'flow',
      flowWorkspaceId: 'main',
      flowWorkspaceName: 'Main Flow',
      operation: 'upscale',
      nodeId: `image-${panel.id}`,
      nodeType: 'imageGen',
      provider: 'vertex',
      modelId: UPSCALE_MODEL,
      source: 'actual',
      confidence: 'measured',
      imageCount: 1,
      notes: [`Final size ${panel.finalSize.width} x ${panel.finalSize.height}.`],
    });
  });
  entries.push({
    id: `usage-vision-verify-${now}`,
    createdAt: now + 1000,
    workspace: 'flow',
    flowWorkspaceId: 'main',
    flowWorkspaceName: 'Main Flow',
    operation: 'vision-verify',
    nodeId: 'text-verify-summary',
    nodeType: 'textNode',
    provider: 'vertex',
    modelId: VERIFY_MODEL,
    source: 'actual',
    confidence: 'measured',
    notes: ['Actual Gemini vision verification calls for all final panels.'],
  });
  return { version: 1, entries };
}

function extractPredictImage(payload) {
  const predictions = Array.isArray(payload?.predictions) ? payload.predictions : [];
  for (const prediction of predictions) {
    const data = prediction?.bytesBase64Encoded
      || prediction?.bytes_base64_encoded
      || prediction?.image?.bytesBase64Encoded
      || prediction?.image?.bytes_base64_encoded;
    if (typeof data === 'string' && data) return data;
  }
  throw new Error('Vertex predict returned no image payload.');
}

function extractInlineImage(payload) {
  const parts = (payload?.candidates ?? []).flatMap((candidate) => candidate?.content?.parts ?? []);
  for (const part of parts) {
    const data = part?.inlineData?.data || part?.inline_data?.data;
    if (typeof data === 'string' && data) return data;
  }
  throw new Error('Vertex generateContent returned no inline image payload.');
}

function extractText(payload) {
  return (payload?.candidates ?? [])
    .flatMap((candidate) => candidate?.content?.parts ?? [])
    .map((part) => typeof part?.text === 'string' ? part.text : '')
    .join('\n')
    .trim();
}

function parseJsonFromText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!match) throw new Error(`Could not parse JSON response: ${text.slice(0, 500)}`);
    return JSON.parse(match[1]);
  }
}

function validatePanelPlan(plan) {
  if (!plan || typeof plan.title !== 'string' || !Array.isArray(plan.panels) || plan.panels.length !== 10) {
    throw new Error('Generated panel plan is not the required ten-panel JSON shape.');
  }
  for (const spec of MODEL_PLAN) {
    const panel = plan.panels.find((candidate) => candidate.id === spec.id);
    if (!panel || typeof panel.caption !== 'string' || typeof panel.imagePrompt !== 'string') {
      throw new Error(`Generated panel plan missing caption/imagePrompt for ${spec.id}.`);
    }
    if (typeof panel.dialogue !== 'string') panel.dialogue = '';
  }
}

async function getGcloudAccessToken() {
  const { stdout } = await execFileAsync('gcloud', ['auth', 'print-access-token'], { maxBuffer: 1024 * 1024 });
  const token = stdout.trim();
  if (!token) throw new Error('gcloud did not return an access token.');
  return token;
}

function loadSignalLoomProviderSecrets() {
  const settings = extractSignalLoomSettings();
  const apiKeys = settings?.state?.apiKeys ?? settings?.apiKeys ?? {};
  const providerSettings = settings?.state?.providerSettings ?? settings?.providerSettings ?? {};
  return {
    bfl: normalizeBflApiKey(
      process.env.BFL_API_KEY
        ?? process.env.BLACK_FOREST_LABS_API_KEY
        ?? process.env.BLACK_FORREST_LABS_API_KEY
        ?? process.env.BLACK_FOREST_LABS
        ?? process.env.BLACK_FORREST_LABS
        ?? apiKeys.bfl
        ?? extractSignalLoomStorageSecret('bfl'),
    ),
    atlas: normalizeSecret(
      process.env.ATLAS_API_KEY
        ?? process.env.ATLAS_CLOUD_API_KEY
        ?? apiKeys.atlas
        ?? extractSignalLoomStorageSecret('atlas'),
    ),
    atlasBaseUrl: normalizeAtlasBaseUrl(process.env.ATLAS_BASE_URL ?? providerSettings.atlasBaseUrl),
  };
}

function extractSignalLoomSettings() {
  const roots = [
    join(homedir(), '.config', 'Signal Loom'),
    join(homedir(), '.config', 'Signal Loom', 'Default'),
    join(homedir(), '.config', 'signal-loom'),
  ];
  const candidates = [];
  for (const root of roots) {
    for (const filePath of collectStorageFiles(root)) {
      let text = '';
      try {
        text = printableStorageText(readFileSync(filePath));
      } catch {
        continue;
      }
      const index = text.indexOf('flow-settings-storage');
      if (index < 0) continue;
      const objectStart = text.indexOf('{', index);
      if (objectStart < 0) continue;
      const parsed = parseBalancedJsonObject(text, objectStart);
      if (parsed) candidates.push(parsed);
    }
  }
  return candidates.at(-1);
}

function extractSignalLoomStorageSecret(provider) {
  const patterns = provider === 'bfl'
    ? [
      /"bfl"\s*:\s*"([^"]+)"/i,
      /bfl"\s*:\s*[_\s]*([A-Za-z0-9_-]{24,80})/i,
      /\bbfl_([A-Za-z0-9_-]{24,80})\b/i,
    ]
    : [
      new RegExp(`"${provider}"\\s*:\\s*"([^"]+)"`, 'i'),
      new RegExp(`${provider}"\\s*:\\s*[_\\s]*([A-Za-z0-9._-]{24,120})`, 'i'),
    ];

  for (const text of readSignalLoomStorageTexts()) {
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      const value = match[1] ?? match[0];
      const normalized = normalizeSecret(value);
      if (normalized && !/flow-settings-storage|defaultModels|providerSettings|localStorage/i.test(normalized)) {
        return normalized;
      }
    }
  }
  return undefined;
}

function readSignalLoomStorageTexts() {
  const roots = [
    join(homedir(), '.config', 'Signal Loom'),
    join(homedir(), '.config', 'Signal Loom', 'Default'),
    join(homedir(), '.config', 'signal-loom'),
  ];
  const texts = [];
  for (const root of roots) {
    for (const filePath of collectStorageFiles(root)) {
      try {
        texts.push(printableStorageText(readFileSync(filePath)));
      } catch {
        // Ignore unreadable Electron storage shards.
      }
    }
  }
  return texts;
}

function collectStorageFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (/\.(ldb|log|json)$/i.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function printableStorageText(buffer) {
  return String(buffer).replace(/[^\x20-\x7E]+/g, ' ');
}

function parseBalancedJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(startIndex, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function normalizeBflApiKey(value) {
  const normalized = normalizeSecret(value);
  if (!normalized) return undefined;
  return normalized.startsWith('bfl_') ? normalized : `bfl_${normalized}`;
}

function normalizeSecret(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/^"+|"+$/g, '');
  return trimmed || undefined;
}

function normalizeAtlasBaseUrl(baseUrl) {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  if (!trimmed) return ATLAS_DEFAULT_BASE_URL;
  if (trimmed === 'https://api.atlascloud.ai') return ATLAS_DEFAULT_BASE_URL;
  return trimmed;
}

function normalizeVerificationScore(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value > 1 && value <= 100) return Math.round((value / 100) * 1000) / 1000;
  return Math.max(0, Math.min(1, value));
}

function mapAspectRatioToImageDimensions(aspectRatio) {
  switch (aspectRatio) {
    case '16:9':
      return { width: 1344, height: 768 };
    case '4:5':
      return { width: 896, height: 1120 };
    case '3:4':
      return { width: 896, height: 1152 };
    case '1:1':
      return { width: 1024, height: 1024 };
    case '4:3':
    default:
      return { width: 1024, height: 768 };
  }
}

function extractAtlasPredictionId(payload) {
  return firstStringFromUnknown(payload?.data?.id)
    ?? firstStringFromUnknown(payload?.data?.prediction_id)
    ?? firstStringFromUnknown(payload?.id)
    ?? firstStringFromUnknown(payload?.prediction_id);
}

function extractAtlasPredictionStatus(payload) {
  return firstStringFromUnknown(payload?.data?.status) ?? firstStringFromUnknown(payload?.status);
}

function extractAtlasOutputUrl(payload) {
  return firstStringFromUnknown(payload?.data?.outputs)
    ?? firstStringFromUnknown(payload?.data?.output)
    ?? firstStringFromUnknown(payload?.data?.images)
    ?? firstStringFromUnknown(payload?.data?.image)
    ?? firstStringFromUnknown(payload?.data?.result)
    ?? firstStringFromUnknown(payload?.outputs)
    ?? firstStringFromUnknown(payload?.output)
    ?? firstStringFromUnknown(payload?.images)
    ?? firstStringFromUnknown(payload?.image)
    ?? firstStringFromUnknown(payload?.result);
}

function firstStringFromUnknown(value) {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstStringFromUnknown(item);
      if (nested) return nested;
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const nested = firstStringFromUnknown(item);
      if (nested) return nested;
    }
  }
  return undefined;
}

function extractProviderErrorMessage(value) {
  if (typeof value === 'string') return value.slice(0, 500);
  if (value && typeof value === 'object') {
    const message = value.message ?? value.detail ?? value.error ?? value.raw;
    if (typeof message === 'string') return message.slice(0, 500);
  }
  return JSON.stringify(value).slice(0, 500);
}

function readImageSize(buffer) {
  if (buffer.toString('ascii', 1, 4) === 'PNG') {
    return readPngSize(buffer);
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return readJpegSize(buffer);
  }
  throw new Error('Expected PNG or JPEG image data.');
}

function detectImageMimeType(buffer) {
  if (buffer.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Unsupported image MIME type.');
}

function readPngSize(buffer) {
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Expected PNG image data.');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (
      marker >= 0xc0
      && marker <= 0xcf
      && ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  throw new Error('Could not read JPEG dimensions.');
}

function parseArgs(args) {
  const options = { force: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      index += 1;
      if (index >= args.length) throw new Error(`Missing value for ${arg}`);
      return args[index];
    };
    switch (arg) {
      case '--output-dir':
        options.outputDir = next();
        break;
      case '--project':
      case '--project-path':
        options.projectPath = next();
        break;
      case '--force':
        options.force = true;
        break;
      case '--force-references':
        options.forceReferences = true;
        break;
      case '--force-panels':
        options.forcePanelIds = new Set(next().split(',').map((value) => value.trim()).filter(Boolean));
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function safeFilePart(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
}

function shortTitle(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9 ]+/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(' ') || 'Panel';
}

function roundMm(value) {
  return Math.round(value * 1000) / 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
