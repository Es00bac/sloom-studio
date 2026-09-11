import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capturePaperWorkspaceAuthorization, usePaperStore } from '../store/paperStore';
import { useSourceBinStore } from '../store/sourceBinStore';
import { useFlowStore } from '../store/flowStore';
import { useFlowWorkspaceStore } from '../store/flowWorkspaceStore';
import { useProjectUsageStore } from '../store/projectUsageStore';
import { useImageEditorStore } from '../store/imageEditorStore';
import {
  buildCurrentProjectDocument,
  prepareProjectDocumentTransaction,
  restoreProjectDocument,
} from './projectDocumentActions';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import {
  materializePaperDocumentAssetUrls,
  paperAssetRepository,
} from '../features/paper/assets/PaperAssetRuntime';
import {
  PAPER_PORTABLE_ASSETS_SCHEMA,
  PAPER_PORTABLE_ASSETS_VERSION,
  validatePaperPortableAssetsSectionShape,
} from '../features/paper/assets/PaperPortableAssets';
import {
  createBinaryAssetRecord,
  verifyBinaryAssetRecord,
  type BinaryAssetRef,
} from '../shared/assets/contentAddressedAsset';
import { resolveExactPaperOutputProfile } from './paperManagedIccProfiles';
import { collectPaperLinkedAssets } from './paperPreflight';
import { classifyPaperFontPackaging } from './paperManagedFonts';
import { installTestBundledPaperFontFace } from '../features/paper/assets/testBundledPaperFontFixture';
import type {
  PaperDocument,
  PaperManagedFontFace,
  PaperManagedIccProfile,
} from '../types/paper';

/**
 * AUD-004 clean-profile portability gate: a portable `.sloom` must carry every managed Paper byte
 * (images, exact font faces, license texts, ICC profiles) for every tab, reopen on a fresh
 * profile without the source IndexedDB, and fail closed — never silently — on policy or
 * corruption problems.
 */

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const imageABytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
const imageBBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
const fontBytes = Uint8Array.from([0x00, 0x01, 0x00, 0x00, 40, 41, 42, 43, 44, 45, 46, 47]);
const restrictedFontBytes = Uint8Array.from([0x00, 0x01, 0x00, 0x00, 90, 91, 92, 93, 94]);
const licenseBytes = new TextEncoder().encode('SIL OPEN FONT LICENSE Version 1.1 — test fixture');

interface PortableSectionEntryShape {
  ref: BinaryAssetRef;
  dataBase64: string;
}

interface PortableSectionShape {
  schema: string;
  version: number;
  assets: PortableSectionEntryShape[];
  excludedFonts?: Array<{ assetId: string; reason: string; detail: string; familyName?: string }>;
  missingAssets?: Array<{ id: string }>;
}

type ProjectDocumentWithPaperAssets = Awaited<ReturnType<typeof buildCurrentProjectDocument>> & {
  paperAssets?: PortableSectionShape;
};

async function seedRecord(bytes: Uint8Array, mimeType: string, fileName?: string): Promise<BinaryAssetRef> {
  const record = await createBinaryAssetRecord(bytes, { mimeType, ...(fileName ? { fileName } : {}) });
  return paperAssetRepository.put(record);
}

function managedFace(
  fontAsset: BinaryAssetRef,
  overrides: Partial<PaperManagedFontFace> = {},
): PaperManagedFontFace {
  return {
    id: `face-${fontAsset.sha256.slice(0, 8)}`,
    familyId: 'portable test family',
    familyName: 'Portable Test Family',
    postscriptName: 'PortableTestFamily-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x41, end: 0x5a }],
    format: 'truetype',
    fontAsset,
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
    ...overrides,
  };
}

function managedIccProfile(asset: BinaryAssetRef): PaperManagedIccProfile {
  return {
    id: asset.id,
    asset,
    description: 'Coated FOGRA39 (ISO 12647-2:2004)',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'FOGRA39',
    source: { kind: 'user-import' },
  };
}

function paperTabDocument(options: {
  title: string;
  imageRefs: Array<{ ref: BinaryAssetRef; label: string }>;
  fonts?: PaperManagedFontFace[];
  iccProfiles?: PaperManagedIccProfile[];
}): PaperDocument {
  let document = createDefaultPaperDocument({ title: options.title });
  for (const image of options.imageRefs) {
    document = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 60,
      heightMm: 40,
      asset: {
        label: image.label,
        kind: 'image',
        mimeType: image.ref.mimeType,
        locator: { kind: 'managed', ref: image.ref },
      },
    } as never).document;
  }
  return {
    ...document,
    ...(options.fonts ? { importedFonts: options.fonts } : {}),
    ...(options.iccProfiles ? { managedIccProfiles: options.iccProfiles } : {}),
  };
}

function seedPaperTabs(tabs: Array<{ id: string; document: PaperDocument }>): void {
  usePaperStore.getState().restoreSnapshot({
    document: tabs[0].document,
    documents: tabs.map((tab) => ({ id: tab.id, document: tab.document, tool: 'select', zoom: 1 })),
    activeDocumentId: tabs[0].id,
    tool: 'select',
    zoom: 1,
  });
}

async function wipePaperAssetRepository(): Promise<void> {
  for (const ref of await paperAssetRepository.listRefs()) {
    await paperAssetRepository.delete(ref.id);
  }
}

async function resetAllStores(): Promise<void> {
  useFlowStore.getState().replaceFlowSnapshot({ nodes: [], edges: [] });
  useFlowWorkspaceStore.getState().reset();
  useProjectUsageStore.getState().restoreSnapshot(undefined);
  useImageEditorStore.getState().restoreProjectSnapshot(undefined);
  usePaperStore.getState().restoreSnapshot(undefined);
  await useSourceBinStore.getState().restoreProjectSnapshot(undefined).catch(() => undefined);
}

async function buildSavedPortableProject(options: {
  strict?: boolean;
} = {}): Promise<ProjectDocumentWithPaperAssets> {
  const saved = await buildCurrentProjectDocument({
    id: 'aud-004-project',
    name: 'AUD-004 Portable Round Trip',
    includeAssetData: true,
    ...(options.strict ? { strictPaperAssets: true } : {}),
  } as never);
  return JSON.parse(JSON.stringify(saved)) as ProjectDocumentWithPaperAssets;
}

async function seedTwoTabProject(): Promise<{
  refs: { imageA: BinaryAssetRef; imageB: BinaryAssetRef; font: BinaryAssetRef; license: BinaryAssetRef; icc: BinaryAssetRef };
}> {
  const imageA = await seedRecord(imageABytes, 'image/png', 'panel-a.png');
  const imageB = await seedRecord(imageBBytes, 'image/png', 'panel-b.png');
  const font = await seedRecord(fontBytes, 'font/ttf', 'portable-test.ttf');
  const license = await seedRecord(licenseBytes, 'text/plain', 'OFL.txt');
  const icc = await seedRecord(fogra39, 'application/vnd.iccprofile', 'FOGRA39L_coated.icc');

  const tabA = paperTabDocument({
    title: 'Tab A Layout',
    imageRefs: [{ ref: imageA, label: 'Panel A' }],
    fonts: [managedFace(font, { license: { id: 'user-license', textAsset: license } })],
    iccProfiles: [managedIccProfile(icc)],
  });
  const tabB = paperTabDocument({
    title: 'Tab B Layout',
    // imageA appears in BOTH tabs: the section must deduplicate it by digest.
    imageRefs: [{ ref: imageB, label: 'Panel B' }, { ref: imageA, label: 'Panel A Reuse' }],
  });
  seedPaperTabs([
    { id: 'tab-a', document: tabA },
    { id: 'tab-b', document: tabB },
  ]);
  return { refs: { imageA, imageB, font, license, icc } };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await resetAllStores();
  await wipePaperAssetRepository();
});

describe('portable .sloom Paper asset section (AUD-004)', () => {
  it('preserves a bundled catalog face and its packaging decision across portable project reopen', async () => {
    const face = await installTestBundledPaperFontFace(paperAssetRepository);
    const source = face.source;
    const licenseEvidence = face.license;
    seedPaperTabs([{
      id: 'tab-bundled-font',
      document: paperTabDocument({ title: 'Bundled Font Tab', imageRefs: [], fonts: [face] }),
    }]);
    const saved = await buildSavedPortableProject({ strict: true });

    await resetAllStores();
    await wipePaperAssetRepository();
    await restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    });

    const restored = usePaperStore.getState().document.importedFonts?.[0];
    expect(restored).toEqual(face);
    expect(restored && classifyPaperFontPackaging(restored)).toEqual(classifyPaperFontPackaging(face));
    expect(restored?.source).not.toBe(source);
    expect(restored?.license).not.toBe(licenseEvidence);
    expect(await paperAssetRepository.get(face.fontAsset.id)).toBeDefined();
    expect(await paperAssetRepository.get(face.license.textAsset!.id)).toBeDefined();
  });

  it('reopens mixed portable faces with bundled trust only on the installed catalog bytes', async () => {
    const installed = await installTestBundledPaperFontFace(paperAssetRepository);
    const arbitrary = await seedRecord(new Uint8Array([7, 7, 7, 7]), 'font/ttf', 'arbitrary-user-font.ttf');
    seedPaperTabs([{
      id: 'tab-mixed-font-provenance',
      document: paperTabDocument({
        title: 'Mixed Font Provenance',
        imageRefs: [],
        fonts: [installed, {
          ...installed,
          id: 'forged-bundled-face',
          familyId: 'forged bundled face',
          familyName: 'Forged Bundled Face',
          postscriptName: 'ForgedBundledFace-Regular',
          fontAsset: arbitrary,
          embeddability: 'unknown',
        }],
      }),
    }]);
    const saved = await buildSavedPortableProject({ strict: true });

    await resetAllStores();
    await wipePaperAssetRepository();
    await restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    });

    expect(usePaperStore.getState().document.importedFonts?.map((face) => face.source.kind))
      .toEqual(['bundled', 'user-import']);
  });

  it('rejects portable save when an installed bundled face has lost its license record', async () => {
    const face = await installTestBundledPaperFontFace(paperAssetRepository);
    await paperAssetRepository.delete(face.license.textAsset!.id);
    seedPaperTabs([{
      id: 'tab-missing-bundled-license',
      document: paperTabDocument({ title: 'Missing Bundled License', imageRefs: [], fonts: [face] }),
    }]);

    await expect(buildSavedPortableProject({ strict: true })).rejects.toThrow(/license|missing/i);
  });

  it('embeds every reachable managed record from all Paper tabs and reopens on a clean profile with identical digests', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();

    const section = saved.paperAssets;
    expect(section, 'portable project must carry a Paper asset section').toBeDefined();
    expect(section?.schema).toBe('signal-loom/paper-portable-assets');
    expect(section?.version).toBe(1);
    const ids = (section?.assets ?? []).map((entry) => entry.ref.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set([refs.imageA.id, refs.imageB.id, refs.font.id, refs.license.id, refs.icc.id]));
    for (const entry of section?.assets ?? []) {
      expect(entry.dataBase64.length).toBeGreaterThan(0);
      expect(entry.dataBase64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    }
    // The Paper document JSON itself must keep content-addressed references only.
    expect(JSON.stringify(saved.paper)).not.toMatch(/data:|blob:/i);

    // Clean profile: no stores, no repository records.
    await resetAllStores();
    await wipePaperAssetRepository();
    expect(await paperAssetRepository.listRefs()).toHaveLength(0);

    await restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    });

    const paperState = usePaperStore.getState();
    expect(paperState.documents.map((tab) => tab.id)).toEqual(['tab-a', 'tab-b']);
    expect(paperState.document.title).toBe('Tab A Layout');

    for (const [name, ref] of Object.entries(refs)) {
      const record = await paperAssetRepository.get(ref.id);
      expect(record, `record ${name} must be staged into the repository`).toBeDefined();
      expect(await verifyBinaryAssetRecord(record!)).toBe(true);
      expect(record!.ref).toEqual(ref);
    }

    // Render/export gate: every tab materializes concrete URLs from the restored records.
    const reopenedTabA = paperState.documents.find((tab) => tab.id === 'tab-a')!.document;
    const reopenedTabB = paperState.documents.find((tab) => tab.id === 'tab-b')!.document;
    const materializedA = await materializePaperDocumentAssetUrls(reopenedTabA);
    const materializedB = await materializePaperDocumentAssetUrls(reopenedTabB);
    for (const materialized of [materializedA, materializedB]) {
      for (const frame of materialized.pages[0].frames) {
        if (frame.kind !== 'image') continue;
        expect(frame.asset?.locator?.kind).toBe('external');
        expect(frame.asset?.locator && 'url' in frame.asset.locator ? frame.asset.locator.url : '').toMatch(/^data:image\/png;base64,/);
      }
    }
    expect(collectPaperLinkedAssets(reopenedTabA).map((asset) => asset.status)).toEqual(['embedded']);

    // The exact managed ICC profile resolves ready for strict output.
    const resolution = await resolveExactPaperOutputProfile({
      profiles: reopenedTabA.managedIccProfiles ?? [],
      getAsset: (id) => paperAssetRepository.get(id),
    }, refs.icc.id);
    expect(resolution.status).toBe('ready');
    if (resolution.status === 'ready') {
      expect(resolution.bytes).toEqual(fogra39);
    }
  });

  it('reopens a portable project served over insecure LAN HTTP without SubtleCrypto', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    await resetAllStores();
    await wipePaperAssetRepository();
    vi.stubGlobal('crypto', {});

    await restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    });

    expect(usePaperStore.getState().document.title).toBe('Tab A Layout');
    for (const ref of Object.values(refs)) {
      const record = await paperAssetRepository.get(ref.id);
      expect(record).toBeDefined();
      await expect(verifyBinaryAssetRecord(record!)).resolves.toBe(true);
    }
  });

  it('fails closed when a .sloom has managed Paper references but omits the required portable section', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    delete saved.paperAssets;

    await resetAllStores();
    await wipePaperAssetRepository();

    await expect(restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    })).rejects.toThrow(/paperAssets|required/i);
    const paperState = usePaperStore.getState();
    expect(paperState.document.title).not.toBe('Tab A');
    expect(await paperAssetRepository.get(refs.imageA.id)).toBeUndefined();
    expect(refs.imageA.id).toMatch(/^sha256:/);
  });

  it('migrates a legacy .sloom without a portable section when every exact local record is available', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    delete saved.paperAssets;

    // Simulate reopening on the originating profile: reset the workspace while retaining its
    // content-addressed Paper repository.
    await resetAllStores();
    await restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    });

    expect(usePaperStore.getState().documents.map((tab) => tab.document.title)).toEqual([
      'Tab A Layout',
      'Tab B Layout',
    ]);
    const resaved = await buildCurrentProjectDocument({ includeAssetData: true } as never);
    expect(new Set((resaved.paperAssets?.assets ?? []).map((entry) => entry.ref.id))).toEqual(
      new Set([refs.imageA.id, refs.imageB.id, refs.font.id, refs.license.id, refs.icc.id]),
    );
  });

  it('rejects a current portable section before staging when required license text is absent', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    const paperDocuments = [saved.paper?.document, ...(saved.paper?.documents ?? []).map((tab) => tab.document)]
      .filter((document): document is PaperDocument => Boolean(document));
    for (const paperDocument of paperDocuments) {
      for (const face of paperDocument.importedFonts ?? []) face.license = { id: face.license.id };
    }
    await resetAllStores();
    await wipePaperAssetRepository();

    await expect(restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    })).rejects.toThrow(/required license text|partial restore/i);
    expect(await paperAssetRepository.get(refs.font.id)).toBeUndefined();
  });

  it('rejects a current portable section that declares required license bytes missing', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    saved.paperAssets!.missingAssets = [{ id: refs.license.id, context: 'required font license text' }];
    await resetAllStores();
    await wipePaperAssetRepository();

    await expect(restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    })).rejects.toThrow(/required license text.*missing/i);
    expect(await paperAssetRepository.get(refs.font.id)).toBeUndefined();
  });

  it('rejects a corrupted asset payload before mutating any store or repository state', async () => {
    await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    const entry = saved.paperAssets!.assets[0];
    // Length-preserving corruption in the payload body: same decoded size, different digest.
    const index = 10;
    const flipped = entry.dataBase64[index] === 'A' ? 'B' : 'A';
    entry.dataBase64 = `${entry.dataBase64.slice(0, index)}${flipped}${entry.dataBase64.slice(index + 1)}`;

    await resetAllStores();
    await wipePaperAssetRepository();
    const previousTitle = usePaperStore.getState().document.title;

    await expect(restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    })).rejects.toThrow(/hash|digest|corrupt|verif/i);
    expect(usePaperStore.getState().document.title).toBe(previousTitle);
    expect(await paperAssetRepository.listRefs()).toHaveLength(0);
  });

  it('rejects a truncated asset payload whose bytes do not match the declared length', async () => {
    await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    const entry = saved.paperAssets!.assets[0];
    entry.dataBase64 = entry.dataBase64.slice(0, Math.max(4, entry.dataBase64.length - 8));

    await resetAllStores();
    await wipePaperAssetRepository();

    await expect(restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    })).rejects.toThrow(/length|truncat|hash|verif/i);
    expect(await paperAssetRepository.listRefs()).toHaveLength(0);
  });

  it('rejects duplicate asset identities in the section', async () => {
    await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    saved.paperAssets!.assets.push({ ...saved.paperAssets!.assets[0] });

    await resetAllStores();
    await wipePaperAssetRepository();

    await expect(restoreProjectDocument(saved)).rejects.toThrow(/duplicate/i);
    expect(await paperAssetRepository.listRefs()).toHaveLength(0);
  });

  it('rejects a section whose declared sizes exceed the per-asset limit before decoding bytes', async () => {
    await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    const entry = saved.paperAssets!.assets[0];
    entry.ref = { ...entry.ref, byteLength: 512 * 1024 * 1024 };

    await resetAllStores();
    await wipePaperAssetRepository();

    await expect(restoreProjectDocument(saved)).rejects.toThrow(/limit|exceed/i);
    expect(await paperAssetRepository.listRefs()).toHaveLength(0);
  });

  it('rejects an encoded payload larger than its declared byte length permits before decoding', () => {
    const sha256 = 'a'.repeat(64);
    expect(() => validatePaperPortableAssetsSectionShape({
      schema: PAPER_PORTABLE_ASSETS_SCHEMA,
      version: PAPER_PORTABLE_ASSETS_VERSION,
      assets: [{
        ref: {
          id: `sha256:${sha256}`,
          sha256,
          mimeType: 'image/png',
          byteLength: 1,
        },
        // Canonical base64, but dishonest: 3 KiB of decoded data is declared as one byte.
        dataBase64: 'AAAA'.repeat(1_024),
      }],
    }, {
      maxAssetBytes: 1,
      maxTotalBytes: 1,
    })).toThrow(/encoded payload.*declared byte length/i);
  });

  it('rejects a section with more entries than the aggregate limit', async () => {
    await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    const template = saved.paperAssets!.assets[0];
    const synthetic = Array.from({ length: 4097 }, (_ignored, index) => {
      const sha = index.toString(16).padStart(64, '0');
      return {
        ref: { id: `sha256:${sha}`, sha256: sha, mimeType: 'image/png', byteLength: 1 },
        dataBase64: template.dataBase64.slice(0, 4) || 'AAAA',
      };
    });
    saved.paperAssets!.assets = synthetic as never;

    await resetAllStores();
    await wipePaperAssetRepository();

    await expect(restoreProjectDocument(saved)).rejects.toThrow(/entries|limit/i);
    expect(await paperAssetRepository.listRefs()).toHaveLength(0);
  });

  it('rejects traversal file names in asset metadata', async () => {
    await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    const entry = saved.paperAssets!.assets[0];
    entry.ref = { ...entry.ref, fileName: '../../evil.ttf' };

    await resetAllStores();
    await wipePaperAssetRepository();

    await expect(restoreProjectDocument(saved)).rejects.toThrow(/file name|unsafe|traversal/i);
    expect(await paperAssetRepository.listRefs()).toHaveLength(0);
  });

  it('rejects a digest-correct payload whose MIME or file metadata conflicts with the document reference', async () => {
    await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    const entry = saved.paperAssets!.assets[0];
    entry.ref = { ...entry.ref, mimeType: 'text/plain', fileName: '../wrong.bin' };

    await resetAllStores();
    await wipePaperAssetRepository();

    await expect(restoreProjectDocument(saved)).rejects.toThrow(/file name|unsafe|metadata|reference/i);
    expect(await paperAssetRepository.listRefs()).toHaveLength(0);
  });

  it('excludes a license-restricted font face explicitly on save and reports it on clean reopen', async () => {
    const imageA = await seedRecord(imageABytes, 'image/png', 'panel-a.png');
    const restrictedFont = await seedRecord(restrictedFontBytes, 'font/ttf', 'restricted.ttf');
    const tab = paperTabDocument({
      title: 'Restricted Font Tab',
      imageRefs: [{ ref: imageA, label: 'Panel A' }],
      fonts: [managedFace(restrictedFont, {
        id: 'face-restricted',
        familyId: 'restricted family',
        familyName: 'Restricted Family',
        postscriptName: 'RestrictedFamily-Regular',
        embeddability: 'restricted',
      })],
    });
    seedPaperTabs([{ id: 'tab-restricted', document: tab }]);

    const saved = await buildSavedPortableProject();
    const section = saved.paperAssets;
    expect(section).toBeDefined();
    const ids = (section?.assets ?? []).map((entry) => entry.ref.id);
    expect(ids).toContain(imageA.id);
    expect(ids).not.toContain(restrictedFont.id);
    expect(section?.excludedFonts?.length).toBe(1);
    expect(section?.excludedFonts?.[0]).toMatchObject({
      assetId: restrictedFont.id,
      reason: 'restricted',
    });
    expect(section?.excludedFonts?.[0]?.detail).toMatch(/Restricted Family|RestrictedFamily-Regular/);

    await resetAllStores();
    await wipePaperAssetRepository();
    await restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    });

    const repairs = usePaperStore.getState().recovery?.repairs ?? [];
    expect(repairs.join('\n')).toMatch(/Restricted Family/);
    expect(repairs.join('\n')).toMatch(/restricted/i);
    expect(await paperAssetRepository.get(imageA.id)).toBeDefined();
    expect(await paperAssetRepository.get(restrictedFont.id)).toBeUndefined();
  });

  it('fails closed with an actionable diagnostic when a strict portable export contains a disallowed font', async () => {
    const restrictedFont = await seedRecord(restrictedFontBytes, 'font/ttf', 'restricted.ttf');
    const tab = paperTabDocument({
      title: 'Strict Export Tab',
      imageRefs: [],
      fonts: [managedFace(restrictedFont, {
        id: 'face-restricted-strict',
        familyId: 'restricted family',
        familyName: 'Restricted Family',
        postscriptName: 'RestrictedFamily-Regular',
        embeddability: 'restricted',
      })],
    });
    seedPaperTabs([{ id: 'tab-strict', document: tab }]);

    await expect(buildSavedPortableProject({ strict: true })).rejects.toThrow(/Restricted Family/);
    await expect(buildSavedPortableProject({ strict: true })).rejects.toThrow(/restrict/i);
  });

  it('fails closed when a current portable section declares a packageable font record missing', async () => {
    const portableFont = await seedRecord(fontBytes, 'font/ttf', 'portable.ttf');
    seedPaperTabs([{
      id: 'tab-required-font',
      document: paperTabDocument({ title: 'Required Portable Font', imageRefs: [], fonts: [managedFace(portableFont)] }),
    }]);
    const saved = await buildSavedPortableProject();
    const section = saved.paperAssets!;
    section.assets = section.assets.filter((entry) => entry.ref.id !== portableFont.id);
    section.missingAssets = [{ id: portableFont.id, context: 'font: PortableTestFamily-Regular' }];

    await resetAllStores();
    await wipePaperAssetRepository();
    await expect(restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    })).rejects.toThrow(/missing required managed font|declares required managed font missing/i);
  });

  it('packages an unknown-rights face only with a byte-bound packaging attestation', async () => {
    const attestedFont = await seedRecord(fontBytes, 'font/ttf', 'attested.ttf');
    const tab = paperTabDocument({
      title: 'Attested Tab',
      imageRefs: [],
      fonts: [managedFace(attestedFont, {
        id: 'face-attested',
        embeddability: 'unknown',
        attestation: {
          acceptedAt: 1,
          assetSha256: attestedFont.sha256,
          mayEmbedOutput: true,
          mayPackageEditableProject: true,
          statementVersion: 1,
        },
      })],
    });
    seedPaperTabs([{ id: 'tab-attested', document: tab }]);

    const saved = await buildSavedPortableProject({ strict: true });
    expect(saved.paperAssets?.assets.map((entry) => entry.ref.id)).toContain(attestedFont.id);
    expect(saved.paperAssets?.excludedFonts ?? []).toHaveLength(0);
  });

  it('repairs a same-ID repository record whose stored bytes no longer match their digest', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();

    await resetAllStores();
    await wipePaperAssetRepository();
    // Simulate a corrupted profile: the id claims imageA's digest but holds different bytes.
    await paperAssetRepository.put({ ref: { ...refs.imageA }, bytes: Uint8Array.from([9, 9, 9]) });

    await restoreProjectDocument(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    });

    const repaired = await paperAssetRepository.get(refs.imageA.id);
    expect(repaired).toBeDefined();
    expect(await verifyBinaryAssetRecord(repaired!)).toBe(true);
    expect(repaired!.bytes).toEqual(imageABytes);
  });

  it('rolls back newly staged repository records when a later restore step fails', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();

    await resetAllStores();
    await wipePaperAssetRepository();

    const originalPrepare = useSourceBinStore.getState().prepareProjectSnapshot;
    useSourceBinStore.setState({
      prepareProjectSnapshot: async () => {
        throw new Error('source bin failed');
      },
    });
    try {
      await expect(restoreProjectDocument(saved, {
        paperAuthorization: capturePaperWorkspaceAuthorization(),
      })).rejects.toThrow(/source bin failed/);
      expect(await paperAssetRepository.get(refs.imageA.id)).toBeUndefined();
      expect(await paperAssetRepository.listRefs()).toHaveLength(0);
    } finally {
      useSourceBinStore.setState({ prepareProjectSnapshot: originalPrepare });
    }
  });

  it('awaits memoized Paper asset rollback after a commit-phase failure before returning', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();
    await resetAllStores();
    await wipePaperAssetRepository();
    const originalRestorePaperSnapshot = usePaperStore.getState().restoreSnapshot;
    usePaperStore.setState({
      restoreSnapshot: (snapshot, options) => {
        if (snapshot?.document?.title === 'Tab A Layout') {
          throw new Error('commit phase failed');
        }
        originalRestorePaperSnapshot(snapshot, options);
      },
    });
    const originalDelete = paperAssetRepository.delete.bind(paperAssetRepository);
    let rollbackDeleteStarted!: () => void;
    let releaseRollbackDelete!: () => void;
    const deleteStarted = new Promise<void>((resolve) => { rollbackDeleteStarted = resolve; });
    const deleteBlocked = new Promise<void>((resolve) => { releaseRollbackDelete = resolve; });
    const deleteSpy = vi.spyOn(paperAssetRepository, 'delete').mockImplementation(async (id) => {
      rollbackDeleteStarted();
      await deleteBlocked;
      await originalDelete(id);
    });
    let operationSettled = false;
    try {
      const operation = restoreProjectDocument(saved, {
        paperAuthorization: capturePaperWorkspaceAuthorization(),
      }).finally(() => { operationSettled = true; });
      await deleteStarted;

      expect(operationSettled).toBe(false);
      expect(await paperAssetRepository.get(refs.imageA.id)).toBeDefined();
      releaseRollbackDelete();

      await expect(operation).rejects.toThrow(/commit phase failed/);
      expect(operationSettled).toBe(true);
      expect(await paperAssetRepository.get(refs.imageA.id)).toBeUndefined();
      expect(await paperAssetRepository.listRefs()).toHaveLength(0);
    } finally {
      releaseRollbackDelete?.();
      deleteSpy.mockRestore();
      usePaperStore.setState({ restoreSnapshot: originalRestorePaperSnapshot });
    }
  });

  it('rolls back staged repository records when a prepared project switch is canceled', async () => {
    const { refs } = await seedTwoTabProject();
    const saved = await buildSavedPortableProject();

    await resetAllStores();
    await wipePaperAssetRepository();

    const transaction = await prepareProjectDocumentTransaction(saved, {
      paperAuthorization: capturePaperWorkspaceAuthorization(),
    });
    expect(await paperAssetRepository.get(refs.imageA.id)).toBeDefined();

    await transaction.rollback();

    expect(await paperAssetRepository.get(refs.imageA.id)).toBeUndefined();
    expect(await paperAssetRepository.listRefs()).toHaveLength(0);
  });
});
