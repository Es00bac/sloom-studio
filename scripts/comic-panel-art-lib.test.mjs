import { describe, expect, it } from 'vitest';
import {
  buildComicPanelPrompt,
  buildGeneratedPanelFileTarget,
  buildProjectVisualReferenceIndex,
  collectUsableComicPanelSourceKeys,
  createGeneratedSourceBinItem,
  extractReferenceSections,
  parsePromptOverrides,
  parseComicIssueScript,
  selectVisualReferencesForTarget,
  upsertGeneratedSourceBinItems,
} from './comic-panel-art-lib.mjs';

describe('comic panel art headless helpers', () => {
  it('parses the cover and page panels into stable generation targets', () => {
    const targets = parseComicIssueScript(`# Test Issue

## COVER

**Cover Image:**
Samira stands in the doorway.

**Cover text:**
THE MERCY OF THE ARCHITECT

## PAGE 1 — 2 PANELS

### Panel 1
**Memory insert. C02 / ENV E02.**
Tavi watches from bed.

**TAVI:**
If you get lost, knock there first.

### Panel 2
**Hard cut. C01 / ENV E01.**
Samira wakes.
`);

    expect(targets).toHaveLength(3);
    expect(targets.map((target) => target.key)).toEqual(['cover', 'p01-panel-01', 'p01-panel-02']);
    expect(targets[1]).toMatchObject({
      label: 'Issue 01 Page 01 Panel 01',
      pageNumber: 1,
      panelNumber: 1,
      characterIds: ['C02'],
      environmentIds: ['ENV E02'],
    });
    expect(targets[1].pageContext).toContain('Issue 01 Page 01 Panel 02');
    expect(targets[2].previousPanelContext).toContain('Tavi watches from bed.');
  });

  it('builds panel prompts from referenced character and environment sections without asking the model to letter the page', () => {
    const characters = extractReferenceSections(`## C01 — SAMIRA DJAN-SERRANO
Samira reference prompt: standalone full-body character design, blue-gray recovery clothes.

## C02 — OCTAVIA
Tavi reference prompt: child in moon pajamas.
`, /^##\s+(C\d+)\s+—\s+(.+)$/gm);
    const environments = extractReferenceSections(`## ENV E01 — KINDNESS ROOM
Reference prompt: empty seamless warm-white resurrection recovery room.
`, /^##\s+(ENV E\d+)\s+—\s+(.+)$/gm);
    const [target] = parseComicIssueScript(`## PAGE 1 — 1 PANEL

### Panel 1
**C01 / ENV E01.**
Samira wakes on a low bed.

**SAMIRA:**
Tavi?
`);

    const overrides = parsePromptOverrides(`## p01-panel-01
Show the bed height clearly and keep Samira's hands visible.
`);
    const prompt = buildComicPanelPrompt(target, { characters, environments }, {
      issueContext: 'Pilot issue context: Samira wakes after the Silencing and the room is kind but morally repulsive.',
      promptOverrides: overrides,
    });

    expect(prompt).toContain('Issue 01 Page 01 Panel 01');
    expect(prompt).toContain('Pilot issue context');
    expect(prompt).toContain('Surrounding page context');
    expect(prompt).toContain('Show the bed height clearly');
    expect(prompt).toContain('C01 — SAMIRA DJAN-SERRANO');
    expect(prompt).toContain('ENV E01 — KINDNESS ROOM');
    expect(prompt).toContain('Samira wakes on a low bed.');
    expect(prompt).toContain('Do not include speech balloons');
    expect(prompt).toContain('no AI avatar, no robot, no hologram');
  });

  it('creates stable source-bin image records with opaque asset URLs and upserts reruns', () => {
    const [target] = parseComicIssueScript(`## PAGE 2 — 1 PANEL

### Panel 1
**C01 / ENV E01.**
Samira listens.
`);
    const item = createGeneratedSourceBinItem({
      target,
      projectDirectory: '/tmp/Comic Book',
      scratchDirectory: '/tmp/Comic Book/Issue 1.signal-loom-scratch',
      fileName: 'generated-panel.png',
      mimeType: 'image/png',
      pixelWidth: 1536,
      pixelHeight: 864,
      createdAt: 123,
      id: 'asset-1',
    });
    const project = {
      sourceBin: {
        bins: [{
          id: 'default',
          name: 'Source Library',
          items: [{ ...item, label: 'old label' }],
          collapsed: false,
          createdAt: 1,
        }],
        dismissedSourceKeys: [],
      },
    };

    const updated = upsertGeneratedSourceBinItems(project, [{ ...item, id: 'replacement-id', label: 'new label' }]);
    const items = updated.sourceBin.bins[0].items;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'asset-1',
      label: 'new label',
      sourceKey: 'comic-panel:issue-01:p02-panel-01',
      envelopeId: 'headless-comic-panel-art:issue-01',
      pixelWidth: 1536,
      pixelHeight: 864,
    });
    expect(items[0].assetUrl).toBe('signal-loom-asset://asset/asset-1');
    expect(items[0].assetUrl).not.toContain(Buffer.from(item.nativeFilePath, 'utf8').toString('base64url'));
  });

  it('reuses an existing registered panel file when regenerating a broken batch asset', () => {
    const [target] = parseComicIssueScript(`## PAGE 3 — 1 PANEL

### Panel 1
**ENV E01.**
Silent ceiling hold.
`);

    expect(buildGeneratedPanelFileTarget({
      target,
      generated: {
        mimeType: 'image/jpeg',
      },
      existingItem: {
        id: 'paper-linked-item',
        scratchFileName: 'paper-linked-item-issue-01-page-03-panel-01.jpg',
      },
    })).toEqual({
      id: 'paper-linked-item',
      fileName: 'paper-linked-item-issue-01-page-03-panel-01.jpg',
    });
  });

  it('does not treat zero-byte registered comic panels as existing generation outputs', () => {
    const project = {
      sourceBin: {
        bins: [{
          items: [
            {
              sourceKey: 'comic-panel:issue-01:p01-panel-01',
              scratchFileName: 'panel-01.jpg',
            },
            {
              sourceKey: 'comic-panel:issue-01:p01-panel-02',
              scratchFileName: 'panel-02.jpg',
            },
          ],
        }],
      },
    };

    expect(collectUsableComicPanelSourceKeys(project, {
      scratchDirectory: '/tmp/scratch',
      getFileSize: (filePath) => filePath.endsWith('panel-02.jpg') ? 123 : 0,
    })).toEqual(new Set(['comic-panel:issue-01:p01-panel-02']));
  });

  it('selects existing project visual references for target continuity', () => {
    const targets = parseComicIssueScript(`## PAGE 1 — 2 PANELS

### Panel 1
**C01 / ENV E01.**
Samira wakes.

### Panel 2
**C01, C02 / ENV E02.**
Samira remembers Tavi.
`);
    const project = {
      sourceBin: {
        bins: [{
          items: [
            projectImage('style-new', 'Style', 'reusable assets', undefined, 20, '/tmp/style.png'),
            projectImage('c01-old', 'Image 1', 'Character reference sheets', 0, 10, '/tmp/c01-old.png'),
            projectImage('c01-new', 'Image 1', 'Character reference sheets', 0, 30, '/tmp/c01-new.png'),
            projectImage('c02-new', 'Image 2', 'Character reference sheets', 1, 31, '/tmp/c02-new.png'),
            projectImage('env01', 'Image 1', 'Environment references', 0, 30, '/tmp/env01.png'),
            projectImage('env02', 'Image 2', 'Environment references', 1, 31, '/tmp/env02.png'),
            projectImage('panel-1', 'Issue 01 Page 01 Panel 01', 'Issue 01 Headless Panel Art', 11, 40, '/tmp/panel-1.png', 'comic-panel:issue-01:p01-panel-01'),
          ],
        }],
      },
    };

    const index = buildProjectVisualReferenceIndex(project);
    const references = selectVisualReferencesForTarget(targets[1], index, targets, { maxReferences: 8 });

    expect(references.map((reference) => reference.nativeFilePath)).toContain('/tmp/style.png');
    expect(references.map((reference) => reference.nativeFilePath)).toContain('/tmp/c01-new.png');
    expect(references.map((reference) => reference.nativeFilePath)).toContain('/tmp/c02-new.png');
    expect(references.map((reference) => reference.nativeFilePath)).toContain('/tmp/env02.png');
    expect(references.map((reference) => reference.nativeFilePath)).toContain('/tmp/panel-1.png');
    expect(references.map((reference) => reference.nativeFilePath)).not.toContain('/tmp/c01-old.png');
  });
});

function projectImage(id, label, envelopeLabel, envelopeIndex, createdAt, nativeFilePath, sourceKey) {
  return {
    id,
    label,
    kind: 'image',
    mimeType: 'image/png',
    envelopeLabel,
    envelopeIndex,
    createdAt,
    nativeFilePath,
    sourceKey,
  };
}
