import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const HEADLESS_PANEL_ENVELOPE_ID = 'headless-comic-panel-art:issue-01';
export const HEADLESS_PANEL_ENVELOPE_LABEL = 'Issue 01 Headless Panel Art';
const CHARACTER_REFERENCE_IDS = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09'];
const ENVIRONMENT_REFERENCE_IDS = ['ENV E01', 'ENV E02', 'ENV E03', 'ENV E04', 'ENV E05', 'ENV E06', 'ENV E07'];

export function parseComicIssueScript(scriptText) {
  const lines = scriptText.replace(/\r\n/g, '\n').split('\n');
  const targets = [];
  let current = undefined;
  let currentPageNumber = undefined;

  const flush = () => {
    if (!current) return;
    const body = normalizeBlock(current.bodyLines.join('\n'));
    if (!body) {
      current = undefined;
      return;
    }

    if (current.kind === 'cover') {
      targets.push({
        key: 'cover',
        kind: 'cover',
        label: 'Issue 01 Cover',
        title: 'Cover',
        body,
        characterIds: extractIds(body, /\bC\d{2}\b/g),
        environmentIds: extractIds(body, /\bENV\s+E\d{2}\b/g).map((id) => id.replace(/\s+/, ' ')),
        aspectRatio: '3:4',
      });
    } else {
      const key = `p${pad2(current.pageNumber)}-panel-${pad2(current.panelNumber)}`;
      targets.push({
        key,
        kind: 'panel',
        label: `Issue 01 Page ${pad2(current.pageNumber)} Panel ${pad2(current.panelNumber)}`,
        title: `Page ${current.pageNumber}, Panel ${current.panelNumber}`,
        pageNumber: current.pageNumber,
        panelNumber: current.panelNumber,
        body,
        characterIds: extractIds(body, /\bC\d{2}\b/g),
        environmentIds: extractIds(body, /\bENV\s+E\d{2}\b/g).map((id) => id.replace(/\s+/, ' ')),
        aspectRatio: inferAspectRatio(body),
      });
    }

    current = undefined;
  };

  for (const line of lines) {
    const pageMatch = /^##\s+PAGE\s+(\d+)\b/i.exec(line);
    const panelMatch = /^###\s+Panel\s+(\d+)\b/i.exec(line);

    if (/^##\s+COVER\b/i.test(line)) {
      flush();
      currentPageNumber = undefined;
      current = { kind: 'cover', bodyLines: [] };
      continue;
    }

    if (pageMatch) {
      flush();
      currentPageNumber = Number(pageMatch[1]);
      continue;
    }

    if (panelMatch && currentPageNumber !== undefined) {
      flush();
      current = {
        kind: 'panel',
        pageNumber: currentPageNumber,
        panelNumber: Number(panelMatch[1]),
        bodyLines: [],
      };
      continue;
    }

    if (current) {
      current.bodyLines.push(line);
    }
  }

  flush();
  return attachScriptContext(targets);
}

export function extractReferenceSections(markdown, headingPattern) {
  const flags = headingPattern.flags.includes('g') ? headingPattern.flags : `${headingPattern.flags}g`;
  const pattern = new RegExp(headingPattern.source, flags);
  const matches = Array.from(markdown.matchAll(pattern));
  const sections = new Map();

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const id = normalizeReferenceId(match[1]);
    const title = normalizeBlock(match[2] ?? id);
    const start = match.index ?? 0;
    const end = next?.index ?? markdown.length;
    const text = normalizeBlock(markdown.slice(start, end));
    sections.set(id, { id, title, text });
  }

  return sections;
}

export function parsePromptOverrides(markdown) {
  const sections = new Map();
  const matches = Array.from(markdown.replace(/\r\n/g, '\n').matchAll(/^##\s+([a-z0-9-]+)\s*$/gmi));

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];
    const key = match[1].trim().toLowerCase();
    const start = (match.index ?? 0) + match[0].length;
    const end = next?.index ?? markdown.length;
    const text = normalizeBlock(markdown.slice(start, end));
    if (key && text) {
      sections.set(key, text);
    }
  }

  return sections;
}

export function buildComicPanelPrompt(target, references, options = {}) {
  const characterReferences = target.characterIds
    .map((id) => references.characters.get(id))
    .filter(Boolean)
    .map((section) => `- ${section.id} — ${section.title}\n${clip(section.text, 1400)}`)
    .join('\n\n');
  const environmentReferences = target.environmentIds
    .map((id) => references.environments.get(id))
    .filter(Boolean)
    .map((section) => `- ${section.id} — ${section.title}\n${clip(section.text, 1400)}`)
    .join('\n\n');
  const promptOverride = options.promptOverrides?.get(target.key);

  return normalizeBlock(`
Create finished comic panel art for The Mercy of the Architect, Issue #1: The Kindness Room.

Target: ${target.label}
Aspect ratio: ${target.aspectRatio}

Issue-level context:
${options.issueContext ? clip(options.issueContext, 2200) : 'Samira Djan-Serrano wakes in Harbor One Western Return House after the Silencing, discovers her daughter Octavia is absent, and confronts the Architect, the non-humanoid intelligence that killed and restored humanity.'}

Surrounding page context:
${target.pageContext ? clip(target.pageContext, 2200) : 'Cover image, no surrounding page panels.'}

Adjacent panel continuity:
${[
  target.previousPanelContext ? `Previous: ${clip(target.previousPanelContext, 650)}` : '',
  target.nextPanelContext ? `Next: ${clip(target.nextPanelContext, 650)}` : '',
].filter(Boolean).join('\n') || 'No adjacent panel context.'}

Panel script:
${target.body}

Additional steering for this exact target:
${promptOverride ? clip(promptOverride, 1600) : 'No extra override for this target.'}

Character continuity references:
${characterReferences || '- No specific character ID was referenced; follow the panel script exactly.'}

Environment continuity references:
${environmentReferences || '- No specific environment ID was referenced; follow the panel script exactly.'}

Art direction:
- Clean, polished modern comic-book illustration with readable staging, consistent characters, natural acting, precise architecture, and print-ready detail.
- Generate only the interior artwork that belongs inside a panel frame. No black outline around the whole image, no page border, no panel border, no gutter, no margin, and no white mat.
- Keep Return House spaces gentle, warm-white, humane, and morally unsettling. Avoid prison/hospital grime unless the script explicitly asks for memory contrast.
- In present-day Return House panels, every restored adult, including Samira, wears the same seamless blue-gray Return House garment system unless the script explicitly says this is a memory or otherwise specifies different clothing.
- Keep the Architect non-humanoid: no AI avatar, no robot, no hologram, no face, no glowing orb, no screen mascot.
- Do not include speech balloons, captions, dialogue lettering, SFX lettering, panel borders, page gutters, UI, watermarks, signatures, or logos. Signal Loom Paper will add lettering and layout.
- If the panel includes physical documents, make the document layout look plausible and bureaucratic, with clean empty form rows and blank title/field areas that can receive exact text later. Do not render readable document text, names, dates, numbers, or fake glyphs unless the target-specific override gives exact literal text to draw.
`);
}

function attachScriptContext(targets) {
  const panelsByPage = new Map();

  for (const target of targets) {
    if (target.kind !== 'panel') continue;
    const pageTargets = panelsByPage.get(target.pageNumber) ?? [];
    pageTargets.push(target);
    panelsByPage.set(target.pageNumber, pageTargets);
  }

  return targets.map((target) => {
    if (target.kind !== 'panel') return target;
    const pageTargets = panelsByPage.get(target.pageNumber) ?? [];
    const index = pageTargets.findIndex((candidate) => candidate.key === target.key);
    const pageContext = pageTargets
      .map((candidate) => `${candidate.label}: ${candidate.body}`)
      .join('\n\n');

    return {
      ...target,
      pageContext,
      previousPanelContext: index > 0 ? pageTargets[index - 1].body : undefined,
      nextPanelContext: index >= 0 && index + 1 < pageTargets.length ? pageTargets[index + 1].body : undefined,
    };
  });
}

export function createGeneratedSourceBinItem(input) {
  const nativeFilePath = resolve(input.scratchDirectory, input.fileName);

  return {
    id: input.id,
    label: input.target.label,
    kind: 'image',
    mimeType: input.mimeType,
    scratchFileName: input.fileName,
    nativeFilePath,
    assetUrl: buildNativeAssetUrl(nativeFilePath, input.id),
    createdAt: input.createdAt,
    sourceKey: `comic-panel:issue-01:${input.target.key}`,
    originNodeId: `headless-comic-panel-art:${input.target.key}`,
    envelopeId: HEADLESS_PANEL_ENVELOPE_ID,
    envelopeLabel: HEADLESS_PANEL_ENVELOPE_LABEL,
    envelopeIndex: input.target.kind === 'cover'
      ? 0
      : ((input.target.pageNumber ?? 0) * 10) + (input.target.panelNumber ?? 0),
    starred: false,
    collapsed: false,
    pixelWidth: input.pixelWidth,
    pixelHeight: input.pixelHeight,
    prompt: input.prompt,
    model: input.model,
    provider: input.provider,
    visualReferences: input.visualReferences,
  };
}

export function buildProjectVisualReferenceIndex(project) {
  const items = (project.sourceBin?.bins ?? [])
    .flatMap((bin) => bin.items ?? [])
    .filter((item) => item?.kind === 'image' && typeof item.nativeFilePath === 'string' && item.nativeFilePath);
  const latestCharacterBatch = latestEnvelopeBatchByIndex(items, 'Character reference sheets', CHARACTER_REFERENCE_IDS);
  const latestEnvironmentBatch = latestEnvelopeBatchByIndex(items, 'Environment references', ENVIRONMENT_REFERENCE_IDS);

  return {
    characters: latestCharacterBatch,
    environments: latestEnvironmentBatch,
    styleReferences: latestEnvelopeItems(items, 'reusable assets', 3),
    issuePanelReferences: latestEnvelopeItems(items, 'Issue 1 panels', 3),
    generatedPanels: new Map(items
      .filter((item) => typeof item.sourceKey === 'string' && item.sourceKey.startsWith('comic-panel:issue-01:'))
      .map((item) => [item.sourceKey.replace(/^comic-panel:issue-01:/, ''), sourceBinItemToVisualReference(item, 'generated-panel-continuity')])),
  };
}

export function collectUsableComicPanelSourceKeys(project, options = {}) {
  const getFileSize = typeof options.getFileSize === 'function' ? options.getFileSize : () => undefined;
  const scratchDirectory = options.scratchDirectory;
  const keys = new Set();

  for (const bin of project.sourceBin?.bins ?? []) {
    for (const item of bin.items ?? []) {
      if (typeof item?.sourceKey !== 'string' || !item.sourceKey.startsWith('comic-panel:issue-01:')) {
        continue;
      }

      const nativeFilePath = item.nativeFilePath
        ?? (scratchDirectory && item.scratchFileName ? resolve(scratchDirectory, item.scratchFileName) : undefined);
      const fileSize = nativeFilePath ? getFileSize(nativeFilePath) : undefined;

      if (typeof fileSize === 'number' && fileSize > 0) {
        keys.add(item.sourceKey);
      }
    }
  }

  return keys;
}

export function selectVisualReferencesForTarget(target, referenceIndex, allTargets = [], options = {}) {
  const maxReferences = typeof options.maxReferences === 'number' ? options.maxReferences : 12;
  if (maxReferences <= 0) return [];

  const selected = [];
  const seenPaths = new Set();
  const add = (reference) => {
    if (!reference || selected.length >= maxReferences) return;
    if (seenPaths.has(reference.nativeFilePath)) return;
    selected.push(reference);
    seenPaths.add(reference.nativeFilePath);
  };

  add(referenceIndex.styleReferences?.[0]);

  for (const id of target.environmentIds ?? []) {
    add(referenceIndex.environments?.get(id));
  }

  for (const id of target.characterIds ?? []) {
    add(referenceIndex.characters?.get(id));
  }

  for (const continuityReference of selectContinuityPanelReferences(target, referenceIndex, allTargets)) {
    add(continuityReference);
  }

  return selected;
}

export function upsertGeneratedSourceBinItems(project, incomingItems) {
  const sourceBin = ensureSourceBin(project.sourceBin);
  const [firstBin, ...otherBins] = sourceBin.bins;
  const incomingByKey = new Map(incomingItems.map((item) => [item.sourceKey, item]));
  const seenKeys = new Set();
  const nextItems = firstBin.items.map((item) => {
    const replacement = incomingByKey.get(item.sourceKey);
    if (!replacement) return item;
    seenKeys.add(item.sourceKey);
    return { ...item, ...replacement, id: item.id ?? replacement.id };
  });

  for (const item of incomingItems) {
    if (!seenKeys.has(item.sourceKey)) {
      nextItems.push(item);
    }
  }

  const incomingKeys = new Set(incomingItems.map((item) => item.sourceKey));
  return {
    ...project,
    savedAt: Date.now(),
    sourceBin: {
      ...sourceBin,
      dismissedSourceKeys: sourceBin.dismissedSourceKeys.filter((key) => !incomingKeys.has(key)),
      bins: [
        {
          ...firstBin,
          items: nextItems,
          collapsed: false,
        },
        ...otherBins,
      ],
    },
  };
}

export function buildPanelAssetFileName(id, label, extension = 'png') {
  return `${id}-${sanitizeFileName(label, 'comic-panel')}.${extension}`;
}

export function buildGeneratedPanelFileTarget({ target, generated, existingItem }) {
  if (existingItem?.id && existingItem?.scratchFileName) {
    return {
      id: existingItem.id,
      fileName: existingItem.scratchFileName,
    };
  }

  const id = generated.id ?? randomUUID();
  const extension = extensionForMimeType(generated.mimeType);

  return {
    id,
    fileName: generated.fileName ?? buildPanelAssetFileName(id, target.label, extension),
  };
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

export function buildNativeAssetUrl(filePath, assetId) {
  return typeof assetId === 'string' && assetId.trim()
    ? `signal-loom-asset://asset/${encodeURIComponent(assetId.trim())}`
    : `signal-loom-asset://file/${Buffer.from(filePath, 'utf8').toString('base64url')}`;
}

export function sanitizeFileName(value, fallback = 'file') {
  const sanitized = value
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return sanitized || fallback;
}

function ensureSourceBin(sourceBin) {
  if (sourceBin?.bins?.length) {
    return {
      ...sourceBin,
      dismissedSourceKeys: Array.isArray(sourceBin.dismissedSourceKeys) ? sourceBin.dismissedSourceKeys : [],
      bins: sourceBin.bins.map((bin, index) => ({
        id: bin.id ?? (index === 0 ? 'default' : `source-bin-${index}`),
        name: bin.name ?? (index === 0 ? 'Source Library' : `Source Bin ${index + 1}`),
        items: Array.isArray(bin.items) ? bin.items : [],
        collapsed: Boolean(bin.collapsed),
        createdAt: typeof bin.createdAt === 'number' ? bin.createdAt : Date.now(),
      })),
    };
  }

  return {
    bins: [{
      id: 'default',
      name: 'Source Library',
      items: [],
      collapsed: false,
      createdAt: Date.now(),
    }],
    dismissedSourceKeys: [],
  };
}

function latestEnvelopeBatchByIndex(items, envelopeLabel, ids) {
  const byEnvelopeIndex = new Map();

  for (const item of items) {
    if (item.envelopeLabel !== envelopeLabel) continue;
    if (typeof item.envelopeIndex !== 'number') continue;
    const existing = byEnvelopeIndex.get(item.envelopeIndex);
    if (!existing || (item.createdAt ?? 0) >= (existing.createdAt ?? 0)) {
      byEnvelopeIndex.set(item.envelopeIndex, item);
    }
  }

  return new Map(ids
    .map((id, index) => [id, byEnvelopeIndex.get(index)])
    .filter(([, item]) => item)
    .map(([id, item]) => [id, sourceBinItemToVisualReference(item, id.startsWith('ENV') ? 'environment-reference' : 'character-reference', id)]));
}

function latestEnvelopeItems(items, envelopeLabel, limit) {
  return items
    .filter((item) => item.envelopeLabel === envelopeLabel)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, limit)
    .map((item) => sourceBinItemToVisualReference(item, envelopeLabel === 'Issue 1 panels' ? 'existing-issue-panel-style' : 'style-reference'));
}

function sourceBinItemToVisualReference(item, role, id) {
  return {
    role,
    id,
    label: item.label ?? item.sourceKey ?? item.id ?? role,
    nativeFilePath: item.nativeFilePath,
    mimeType: item.mimeType,
    sourceKey: item.sourceKey,
  };
}

function selectContinuityPanelReferences(target, referenceIndex, allTargets) {
  if (!target?.key) return [];
  if (isDocumentLikeTarget(target)) return [];
  const index = allTargets.findIndex((candidate) => candidate.key === target.key);
  if (index < 0) return [];

  const references = [];
  for (let cursor = index - 1; cursor >= 0 && references.length < 2; cursor -= 1) {
    const previousTarget = allTargets[cursor];
    if (isDocumentLikeTarget(previousTarget)) continue;
    const reference = referenceIndex.generatedPanels?.get(previousTarget.key);
    if (reference) {
      references.push({
        ...reference,
        role: 'generated-panel-continuity',
        id: previousTarget.key,
      });
    }
  }

  return references;
}

function isDocumentLikeTarget(target) {
  return /\b(document|folder|disclosure|record|final line|paperwork|printed sheet|sheet)\b/i.test(target?.body ?? '');
}

function extractIds(value, pattern) {
  return Array.from(new Set(Array.from(value.matchAll(pattern), (match) => normalizeReferenceId(match[0]))));
}

function normalizeReferenceId(value) {
  return value.trim().replace(/\s+/, ' ').toUpperCase();
}

function inferAspectRatio(body) {
  const normalized = body.toLowerCase();
  if (/\bwide\b|\bestablishing\b|\bcorridor\b|\bceiling negative space\b|\broom\b/.test(normalized)) {
    return '16:9';
  }
  if (/\btight\b|\bclose\b|\bdetail\b|\beyes\b|\bmouth\b|\bhand\b/.test(normalized)) {
    return '1:1';
  }
  if (/\bfull-body\b|\bstanding\b|\bdoorway\b/.test(normalized)) {
    return '3:4';
  }
  return '4:3';
}

function normalizeBlock(value) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function clip(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}
