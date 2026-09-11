import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { createDefaultPaperDocument } from './paperDocument';
import { addPaperPage } from './paperDocument';
import type { PaperDocument, PaperFrame } from '../types/paper';
import { resolveSwatchCssColor } from './paperSwatches';
import { buildPaperIdmlPackage, buildPaperIdmlParts, IDML_DOM_VERSION } from './paperIdmlExport';

function withFrames(base: PaperDocument, frames: Partial<PaperFrame>[]): PaperDocument {
  const templateFrame = base.pages[0].frames[0];
  const built: PaperFrame[] = frames.map((patch, i) => ({
    ...(templateFrame ?? ({} as PaperFrame)),
    id: `frame-${i}`,
    kind: 'text',
    label: `Frame ${i}`,
    xMm: 10, yMm: 10, widthMm: 50, heightMm: 30, rotationDeg: 0, locked: false,
    fit: 'contain', imageScale: 1, imageOffsetXPercent: 0, imageOffsetYPercent: 0, imageRotationDeg: 0,
    columns: 1, fillColor: 'transparent', fillOpacity: 1, strokeColor: 'transparent', strokeOpacity: 1,
    strokeWidthMm: 0, strokeStyle: 'solid', cornerRadiusMm: 0, opacity: 1,
    typography: templateFrame?.typography ?? ({} as PaperFrame['typography']),
    ...patch,
  } as PaperFrame));
  return { ...base, pages: base.pages.map((p, idx) => (idx === 0 ? { ...p, frames: built } : p)) };
}

function sampleDoc(): PaperDocument {
  let doc = createDefaultPaperDocument({ title: 'IDML test', preset: 'us-letter' });
  doc = withFrames(doc, [
    { kind: 'text', text: 'Hello & <world>\nSecond line', xMm: 12, yMm: 20, widthMm: 80, heightMm: 40 },
    { kind: 'image', fillColor: '#ff8800', xMm: 100, yMm: 120, widthMm: 60, heightMm: 60 },
  ]);
  return doc;
}

describe('paperIdmlExport', () => {
  it('emits the required package parts, mimetype included', () => {
    const parts = buildPaperIdmlParts(sampleDoc());
    for (const required of [
      'mimetype',
      'META-INF/container.xml',
      'designmap.xml',
      'Resources/Graphic.xml',
      'Resources/Fonts.xml',
      'Resources/Styles.xml',
      'Resources/Preferences.xml',
      'XML/BackingStory.xml',
      'XML/Tags.xml',
      'XML/Mapping.xml',
    ]) {
      expect(parts[required], required).toBeDefined();
    }
    expect(parts.mimetype).toBe('application/vnd.adobe.indesign-idml-package');
    // One spread per page, one story per text frame.
    expect(Object.keys(parts).filter((p) => p.startsWith('Spreads/'))).toHaveLength(1);
    expect(Object.keys(parts).filter((p) => p.startsWith('Stories/'))).toHaveLength(1);
  });

  it('carries bleed, slug, job metadata, and mark intent into the editable IDML package', () => {
    const base = sampleDoc();
    const document: PaperDocument = {
      ...base,
      page: { ...base.page, bleedMm: 3 },
      printProduction: {
        ...base.printProduction,
        marks: {
          ...base.printProduction.marks,
          cropMarks: true,
          registrationMarks: true,
          colorBars: true,
          slugAreaMm: 12,
        },
        jobInfo: {
          jobName: 'Catalog <proof>',
          jobNumber: 'CAT-42',
          client: 'Example & Co.',
          author: 'A. Operator',
          notes: 'Coated stock',
        },
      },
    };
    const parts = buildPaperIdmlParts(document);

    expect(parts['Resources/Preferences.xml']).toContain('DocumentBleedTopOffset="8.5039"');
    expect(parts['Resources/Preferences.xml']).toContain('SlugBottomOffset="34.0157"');
    expect(parts['META-INF/metadata.xml']).toContain('<sloom:JobName>Catalog &lt;proof&gt;</sloom:JobName>');
    expect(parts['META-INF/metadata.xml']).toContain('<sloom:Client>Example &amp; Co.</sloom:Client>');
    expect(parts['META-INF/metadata.xml']).toContain('<sloom:RegistrationMarks>true</sloom:RegistrationMarks>');
    expect(parts['META-INF/metadata.xml']).toContain('<sloom:ColorBars>true</sloom:ColorBars>');
  });

  it('wraps every non-designmap part in idPkg and declares the DOMVersion', () => {
    const parts = buildPaperIdmlParts(sampleDoc());
    for (const [path, xml] of Object.entries(parts)) {
      if (path === 'mimetype' || path.startsWith('META-INF/')) continue;
      expect(xml.startsWith('<?xml'), path).toBe(true);
      if (path === 'designmap.xml') {
        expect(xml).toContain('<Document ');
        expect(xml).toContain('<?aid ');
      } else {
        expect(xml, path).toContain('xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"');
      }
      expect(xml, path).toContain(`DOMVersion="${IDML_DOM_VERSION}"`);
    }
  });

  it('links text frames to stories and lists them in StoryList', () => {
    const parts = buildPaperIdmlParts(sampleDoc());
    const designmap = parts['designmap.xml'];
    const storyPath = Object.keys(parts).find((p) => p.startsWith('Stories/'))!;
    const storySelf = storyPath.replace('Stories/Story_', '').replace('.xml', '');
    expect(designmap).toContain(`StoryList="${storySelf}"`);
    const spreadPath = Object.keys(parts).find((p) => p.startsWith('Spreads/'))!;
    expect(parts[spreadPath]).toContain(`ParentStory="${storySelf}"`);
    // Text content escaped, second paragraph split out.
    expect(parts[storyPath]).toContain('Hello &amp; &lt;world&gt;');
    expect(parts[storyPath]).toContain('Second line');
    // The image frame became a graphic Rectangle with the fill colour.
    expect(parts[spreadPath]).toContain('<Rectangle ');
    expect(parts[spreadPath]).toContain('ContentType="GraphicType"');
  });

  it('centres the single page on the binding spine in BOTH axes (Scribus-verified geometry)', () => {
    const parts = buildPaperIdmlParts(sampleDoc());
    const spreadPath = Object.keys(parts).find((p) => p.startsWith('Spreads/'))!;
    // US Letter 612×792pt → page centred on the spine: ItemTransform tx=-W/2=-306, ty=-H/2=-396.
    // (Using tx=0 shifted every frame +half-a-page right and dropped right-side frames off-page —
    // caught by importing into Scribus 1.6; this locks the fix.)
    expect(parts[spreadPath]).toContain('ItemTransform="1 0 0 1 -306 -396"');
    expect(parts[spreadPath]).toContain('GeometricBounds="0 0 792 612"');
    // A frame authored at x=12mm,y=20mm,80x40mm has centre (-W/2 + x + w/2) = -306 + 34.0157 + 113.386.
    // Its ItemTransform tx must be negative-of-half-width-relative, proving frames share the page origin.
    expect(parts[spreadPath]).toMatch(/ItemTransform="1 0 0 1 -158\.5984 /);
  });

  it('builds a valid ZIP with mimetype first and round-trips', () => {
    const bytes = buildPaperIdmlPackage(sampleDoc());
    const unzipped = unzipSync(bytes);
    expect(Object.keys(unzipped)[0]).toBe('mimetype');
    expect(strFromU8(unzipped.mimetype)).toBe('application/vnd.adobe.indesign-idml-package');
    expect(unzipped['designmap.xml']).toBeDefined();

    const out = process.env.SLOOM_IDML_OUT;
    if (out) writeFileSync(`${out}/sloom-sample.idml`, bytes);
  });

  it('preserves swatch CMYK ink values as Space="CMYK" (not RGB)', () => {
    let doc = sampleDoc();
    const cmyk = { c: 80, m: 0, y: 40, k: 0 };
    const swatch = { id: 'sw1', name: 'Teal', type: 'process' as const, model: 'cmyk' as const, rgb: { r: 40, g: 160, b: 170 }, cmyk };
    const css = resolveSwatchCssColor(swatch);
    doc = { ...doc, swatches: [swatch] };
    doc = { ...doc, pages: doc.pages.map((p, i) => (i === 0 ? { ...p, frames: p.frames.map((f, fi) => (fi === 1 ? { ...f, fillColor: css } : f)) } : p)) };
    const parts = buildPaperIdmlParts(doc);
    expect(parts['Resources/Graphic.xml']).toContain('Space="CMYK" ColorValue="80 0 40 0"');
  });

  it('handles a two-page document (two spreads)', () => {
    let doc = sampleDoc();
    doc = addPaperPage(doc);
    const parts = buildPaperIdmlParts(doc);
    expect(Object.keys(parts).filter((p) => p.startsWith('Spreads/'))).toHaveLength(2);
  });

  it('preserves reordered layer catalog flags and maps every frame to its IDML layer', () => {
    let doc = sampleDoc();
    doc = {
      ...doc,
      // Paper's durable layer catalog is back-to-front. Keep this deliberately different from both the
      // default order and the frame array order so the assertion catches positional/index-based mapping.
      layers: [
        { id: 'notes', name: 'Notes & markup', visible: false, printable: true, locked: true },
        { id: 'art', name: 'Artwork', visible: true, printable: true, locked: false },
        { id: 'copy', name: 'Final copy', visible: true, printable: false, locked: false },
      ],
      pages: doc.pages.map((page, pageIndex) => pageIndex === 0 ? {
        ...page,
        frames: [
          { ...page.frames[0], id: 'copy-frame', layerId: 'copy' },
          { ...page.frames[1], id: 'notes-frame', layerId: 'notes' },
          { ...page.frames[1], id: 'art-frame', layerId: 'art', xMm: 40 },
        ],
      } : page),
    };

    const parts = buildPaperIdmlParts(doc);
    const designmap = parts['designmap.xml'];
    const notesLayer = '<Layer Self="layer1" Name="Notes &amp; markup" Visible="false" Locked="true" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"/>';
    const artLayer = '<Layer Self="layer2" Name="Artwork" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="true"/>';
    const copyLayer = '<Layer Self="layer3" Name="Final copy" Visible="true" Locked="false" IgnoreWrap="false" ShowGuides="true" LockGuides="false" UI="true" Expendable="true" Printable="false"/>';
    expect(designmap).toContain(notesLayer);
    expect(designmap).toContain(artLayer);
    expect(designmap).toContain(copyLayer);
    expect(designmap.indexOf(notesLayer)).toBeLessThan(designmap.indexOf(artLayer));
    expect(designmap.indexOf(artLayer)).toBeLessThan(designmap.indexOf(copyLayer));
    expect(designmap).toContain('ActiveLayer="layer1"');

    const spreadPath = Object.keys(parts).find((path) => path.startsWith('Spreads/'))!;
    const itemLayers = [...parts[spreadPath].matchAll(/<(?:TextFrame|Rectangle)\b[^>]*\bItemLayer="([^"]+)"/g)]
      .map((match) => match[1]);
    expect(itemLayers).toEqual(['layer3', 'layer1', 'layer2']);
  });

  it('keeps legacy frames with a missing or unknown layer on the normalized default layer', () => {
    let doc = sampleDoc();
    doc = {
      ...doc,
      layers: [
        { id: 'base', name: 'Base', visible: true, printable: true, locked: false },
        { id: 'top', name: 'Top', visible: true, printable: true, locked: false },
      ],
      pages: doc.pages.map((page, pageIndex) => pageIndex === 0 ? {
        ...page,
        frames: [
          { ...page.frames[0], layerId: undefined },
          { ...page.frames[1], layerId: 'removed-layer' },
        ],
      } : page),
    };

    const parts = buildPaperIdmlParts(doc);
    const spreadPath = Object.keys(parts).find((path) => path.startsWith('Spreads/'))!;
    expect(parts[spreadPath].match(/ItemLayer="layer1"/g)).toHaveLength(2);
  });
});
