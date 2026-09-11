#!/usr/bin/env node
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseComicIssueScript } from './comic-panel-art-lib.mjs';

const DEFAULT_PROJECT_PATH = '/home/cabewse/Documents/Loom Workspace/Comic Book/Issue 1.sloom';
const DEFAULT_ISSUE_DIR = '/mnt/xtra/OpenCAS/workspace/novels/writing-project-20260518-004126/comic_adaptation/issue_01';
const AUTO_LAYOUT_SOURCE = 'headless-comic-panel-art:issue-01:paper-placement';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectPath = resolve(options.project ?? DEFAULT_PROJECT_PATH);
  const issueDir = resolve(options.issueDir ?? DEFAULT_ISSUE_DIR);
  const [projectText, scriptText] = await Promise.all([
    readFile(projectPath, 'utf8'),
    readFile(resolve(issueDir, 'script.md'), 'utf8'),
  ]);
  const project = JSON.parse(projectText);
  const targets = parseComicIssueScript(scriptText);
  const sourceItems = collectComicPanelSourceItems(project);
  const missing = targets.filter((target) => !sourceItems.has(target.key)).map((target) => target.key);

  if (missing.length) {
    throw new Error(`Cannot place Paper panels; missing generated source items: ${missing.join(', ')}`);
  }

  const backupPath = `${projectPath}.bak-${compactTimestamp()}-pre-paper-placement`;
  await copyFile(projectPath, backupPath);
  const nextProject = placePanelsInPaperProject(project, targets, sourceItems);
  await writeFile(projectPath, `${JSON.stringify(nextProject, null, 2)}\n`);
  console.log(`Backup written to ${backupPath}`);
  console.log(`Placed ${targets.length} generated panel frame(s) on ${targetsByPage(targets).length + 1} appended Paper page(s).`);
  console.log(`Updated ${projectPath}`);
}

function placePanelsInPaperProject(project, targets, sourceItems) {
  const paper = project.paper ?? {};
  const document = paper.document;
  if (!document?.page) throw new Error('Project has no Paper document/page setup.');
  const existingPages = (document.pages ?? []).filter((page) => page.autoLayoutSource !== AUTO_LAYOUT_SOURCE);
  const pageSpec = document.page;
  const appendedPages = [];
  const cover = targets.find((target) => target.kind === 'cover');

  if (cover) {
    appendedPages.push(createPlacedPaperPage({
      pageNumber: existingPages.length + appendedPages.length + 1,
      title: 'Issue 01 Generated Cover',
      targets: [cover],
      pageSpec,
      sourceItems,
      cover: true,
    }));
  }

  for (const pageTargets of targetsByPage(targets)) {
    appendedPages.push(createPlacedPaperPage({
      pageNumber: existingPages.length + appendedPages.length + 1,
      title: `Issue 01 Generated Page ${pad2(pageTargets[0].pageNumber)}`,
      targets: pageTargets,
      pageSpec,
      sourceItems,
      cover: false,
    }));
  }

  const pages = renumberPages([...existingPages, ...appendedPages]);
  const firstAppended = appendedPages[0]?.id;

  return {
    ...project,
    savedAt: Date.now(),
    paper: {
      ...paper,
      selectedPageId: firstAppended ?? paper.selectedPageId,
      selectedFrameId: undefined,
      selectedFrameIds: [],
      document: {
        ...document,
        pages,
        updatedAt: Date.now(),
      },
    },
  };
}

function createPlacedPaperPage({ pageNumber, title, targets, pageSpec, sourceItems, cover }) {
  const pageId = makeId(`page-${pageNumber}`);
  const slots = cover
    ? [coverSlot(pageSpec)]
    : layoutSlotsForCount(targets.length, pageSpec);
  const frames = targets.map((target, index) => {
    const item = sourceItems.get(target.key);
    return createImageFrame({
      target,
      item,
      slot: slots[index],
      zIndex: index,
    });
  });

  return {
    id: pageId,
    pageNumber,
    autoLayoutSource: AUTO_LAYOUT_SOURCE,
    autoLayoutTitle: title,
    frames,
    guides: defaultGuidesForPage(pageSpec),
  };
}

function createImageFrame({ target, item, slot, zIndex }) {
  return {
    id: makeId(`frame-${target.key}`),
    kind: 'image',
    label: target.label,
    xMm: roundMm(slot.xMm),
    yMm: roundMm(slot.yMm),
    widthMm: roundMm(slot.widthMm),
    heightMm: roundMm(slot.heightMm),
    rotationDeg: 0,
    locked: false,
    asset: {
      sourceBinItemId: item.id,
      label: item.label,
      kind: item.kind,
      src: item.assetUrl,
      mimeType: item.mimeType,
      pixelWidth: item.pixelWidth,
      pixelHeight: item.pixelHeight,
    },
    fit: 'cover',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    imageFlipX: false,
    imageFlipY: false,
    columns: 1,
    typography: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePt: 10,
      leadingPt: 13,
      tracking: 0,
      align: 'left',
      hyphenate: true,
      color: '#111827',
      fontWeight: '400',
      fontStyle: 'normal',
    },
    fillColor: 'transparent',
    fillOpacity: 1,
    strokeColor: '#111827',
    strokeOpacity: 1,
    strokeWidthMm: 0.45,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity: 1,
    textBoxXPercent: 0,
    textBoxYPercent: 0,
    textBoxWidthPercent: 100,
    textBoxHeightPercent: 100,
    textRotationDeg: 0,
    textVerticalAlign: 'top',
    zIndex,
    inherited: false,
    autoLayoutSource: AUTO_LAYOUT_SOURCE,
    sourceTargetKey: target.key,
  };
}

function coverSlot(pageSpec) {
  const bleed = pageSpec.bleedMm ?? 0;
  return {
    xMm: -bleed,
    yMm: -bleed,
    widthMm: pageSpec.widthMm + (bleed * 2),
    heightMm: pageSpec.heightMm + (bleed * 2),
  };
}

function layoutSlotsForCount(count, pageSpec) {
  const margin = 7;
  const gutter = 3;
  const x = margin;
  const y = margin;
  const width = pageSpec.widthMm - (margin * 2);
  const height = pageSpec.heightMm - (margin * 2);

  if (count <= 1) return [{ xMm: x, yMm: y, widthMm: width, heightMm: height }];
  if (count === 2) return rows(2, x, y, width, height, gutter);
  if (count === 3) {
    const topHeight = (height - gutter) * 0.48;
    return [
      { xMm: x, yMm: y, widthMm: width, heightMm: topHeight },
      ...columns(2, x, y + topHeight + gutter, width, height - topHeight - gutter, gutter),
    ];
  }
  if (count === 4) return grid(2, 2, x, y, width, height, gutter);
  if (count === 5) {
    const rowHeight = (height - (gutter * 2)) / 3;
    return [
      ...columns(2, x, y, width, rowHeight, gutter),
      { xMm: x, yMm: y + rowHeight + gutter, widthMm: width, heightMm: rowHeight },
      ...columns(2, x, y + ((rowHeight + gutter) * 2), width, rowHeight, gutter),
    ];
  }

  return grid(2, Math.ceil(count / 2), x, y, width, height, gutter).slice(0, count);
}

function rows(count, x, y, width, height, gutter) {
  const rowHeight = (height - (gutter * (count - 1))) / count;
  return Array.from({ length: count }, (_, index) => ({
    xMm: x,
    yMm: y + ((rowHeight + gutter) * index),
    widthMm: width,
    heightMm: rowHeight,
  }));
}

function columns(count, x, y, width, height, gutter) {
  const columnWidth = (width - (gutter * (count - 1))) / count;
  return Array.from({ length: count }, (_, index) => ({
    xMm: x + ((columnWidth + gutter) * index),
    yMm: y,
    widthMm: columnWidth,
    heightMm: height,
  }));
}

function grid(columnsCount, rowsCount, x, y, width, height, gutter) {
  const columnWidth = (width - (gutter * (columnsCount - 1))) / columnsCount;
  const rowHeight = (height - (gutter * (rowsCount - 1))) / rowsCount;
  const slots = [];
  for (let row = 0; row < rowsCount; row += 1) {
    for (let column = 0; column < columnsCount; column += 1) {
      slots.push({
        xMm: x + ((columnWidth + gutter) * column),
        yMm: y + ((rowHeight + gutter) * row),
        widthMm: columnWidth,
        heightMm: rowHeight,
      });
    }
  }
  return slots;
}

function defaultGuidesForPage(pageSpec) {
  return [
    { id: makeId('guide'), orientation: 'vertical', positionMm: pageSpec.widthMm / 2, label: 'Center vertical' },
    { id: makeId('guide'), orientation: 'horizontal', positionMm: pageSpec.heightMm / 2, label: 'Center horizontal' },
  ];
}

function collectComicPanelSourceItems(project) {
  return new Map((project.sourceBin?.bins ?? [])
    .flatMap((bin) => bin.items ?? [])
    .filter((item) => typeof item.sourceKey === 'string' && item.sourceKey.startsWith('comic-panel:issue-01:'))
    .map((item) => [item.sourceKey.replace(/^comic-panel:issue-01:/, ''), item]));
}

function targetsByPage(targets) {
  const pages = new Map();
  for (const target of targets) {
    if (target.kind !== 'panel') continue;
    const pageTargets = pages.get(target.pageNumber) ?? [];
    pageTargets.push(target);
    pages.set(target.pageNumber, pageTargets);
  }
  return Array.from(pages.entries())
    .sort(([a], [b]) => a - b)
    .map(([, pageTargets]) => pageTargets.sort((a, b) => a.panelNumber - b.panelNumber));
}

function renumberPages(pages) {
  return pages.map((page, index) => ({
    ...page,
    pageNumber: index + 1,
  }));
}

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      index += 1;
      if (index >= args.length) throw new Error(`Missing value for ${arg}`);
      return args[index];
    };

    switch (arg) {
      case '--project':
        options.project = next();
        break;
      case '--issue-dir':
        options.issueDir = next();
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function roundMm(value) {
  return Math.round(value * 1000) / 1000;
}

function makeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function compactTimestamp() {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14);
}

function printHelp() {
  console.log(`Usage: node scripts/place-comic-panels-in-paper.mjs [options]

Appends generated Issue #1 panel art to the Paper document as editable image frames.

Options:
  --project PATH      .sloom project path
  --issue-dir PATH    issue_01 script/reference directory
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
