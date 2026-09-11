import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  getAcceptStringForAllImportableFormats,
  getAcceptStringForKinds,
  getElectronDialogFilterGroups,
  getFileExtension,
  inferDownloadExtension,
  inferMimeTypeFromFile,
  inferSourceKindFromFile,
  isGifAssetReference,
  isGifMimeType,
  MEDIA_FORMAT_REGISTRY,
  type MediaFormatDefinition,
} from './mediaFormatRegistry';

const require = createRequire(import.meta.url);
const electronRegistry = require('../../electron/media-format-registry.cjs') as {
  MEDIA_FORMAT_REGISTRY: Array<Pick<MediaFormatDefinition, 'kind' | 'label' | 'extensions' | 'mimeTypes' | 'preferredMimeTypes'>>;
  getElectronDialogFilterGroups: (kinds?: string[]) => ReturnType<typeof getElectronDialogFilterGroups>;
};

describe('mediaFormatRegistry', () => {
  it('infers source kinds from broad extension and MIME aliases', () => {
    expect(inferSourceKindFromFile('cover.exr', '')).toBe('image');
    expect(inferSourceKindFromFile('paint.psb', '')).toBe('image');
    expect(inferSourceKindFromFile('workfile.xcf', '')).toBe('image');
    expect(inferSourceKindFromFile('cut.h265', '')).toBe('video');
    expect(inferSourceKindFromFile('mix.aiff', '')).toBe('audio');
    expect(inferSourceKindFromFile('layout.idml', '')).toBe('document');
    expect(inferSourceKindFromFile('captions.srt', '')).toBe('subtitle');
    expect(inferSourceKindFromFile('book.cbz', '')).toBe('document');
    expect(inferSourceKindFromFile('project.sloom', '')).toBe('package');
    expect(inferSourceKindFromFile('export.sloom-paper-package.json', '')).toBe('package');
    expect(inferSourceKindFromFile('export.sloom-paper.package.json', '')).toBe('package');
    expect(inferSourceKindFromFile('export.sloom-paper-package.zip', '')).toBe('package');
    expect(inferSourceKindFromFile('layout.sloom-idml.json', '')).toBe('document');
    expect(inferSourceKindFromFile('unknown.bin', 'audio/ogg')).toBe('audio');
  });

  it('infers exact special multi-part project and interchange extensions', () => {
    expect(getFileExtension('Project.sloom-paper.json')).toBe('sloom-paper.json');
    expect(getFileExtension('Project.sloom-paper-package.json')).toBe('sloom-paper-package.json');
    expect(getFileExtension('Project.sloom-paper.package.json')).toBe('sloom-paper.package.json');
    expect(getFileExtension('Project.sloom-paper-package.zip')).toBe('sloom-paper-package.zip');
    expect(getFileExtension('Layout.sloom-idml.json')).toBe('sloom-idml.json');
    expect(inferMimeTypeFromFile('Project.sloom-paper-package.json')).toBe('application/vnd.signal-loom.paper-package+json');
    expect(inferDownloadExtension('application/vnd.signal-loom.paper-package+json', 'bin')).toBe('sloom-paper-package.json');
  });

  it('builds exact browser accept strings for special import classes', () => {
    expect(getAcceptStringForKinds(['document'])).toBe(
      'text/plain,text/markdown,text/rtf,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,application/vnd.adobe.indesign-idml-package,application/vnd.signal-loom.paper-idml+json,text/html,application/xhtml+xml,application/epub+zip,application/vnd.comicbook+zip,.txt,.md,.rtf,.docx,.pdf,.idml,.sloom-idml.json,.html,.htm,.epub,.cbz',
    );
    expect(getAcceptStringForKinds(['package'])).toBe(
      'application/vnd.signal-loom.project+json,application/vnd.signal-loom.paper+json,application/vnd.signal-loom.paper-package+json,application/zip,application/x-zip-compressed,.sloom,.sloom-paper.json,.sloom-paper-package.json,.sloom-paper.package.json,.sloom-paper-package.zip,.zip',
    );
    expect(getAcceptStringForKinds(['package'])).not.toContain('.sloom.paper.package.json');
    expect(getAcceptStringForKinds(['subtitle'])).toContain('text/vtt');
    expect(getAcceptStringForAllImportableFormats()).toContain('.hevc');
    expect(getAcceptStringForAllImportableFormats()).toContain('.sloom-idml.json');
    expect(getAcceptStringForAllImportableFormats()).toContain('.sloom-paper-package.json');
    expect(getAcceptStringForKinds(['image'])).toContain('.tiff');
    expect(getAcceptStringForKinds(['image'])).toContain('.psb');
    expect(getAcceptStringForKinds(['image'])).toContain('.xcf');
  });

  it('infers MIME types and download filename extensions from the registry', () => {
    expect(inferMimeTypeFromFile('page.svg')).toBe('image/svg+xml');
    expect(inferMimeTypeFromFile('scan.tif')).toBe('image/tiff');
    expect(inferMimeTypeFromFile('workfile.xcf')).toBe('image/x-xcf');
    expect(inferMimeTypeFromFile('show.vtt')).toBe('text/vtt');
    expect(inferDownloadExtension('application/pdf', 'bin')).toBe('pdf');
    expect(inferDownloadExtension('audio/x-aiff', 'bin')).toBe('aiff');
  });

  it('creates Electron filter groups from registry definitions', () => {
    const filters = getElectronDialogFilterGroups();
    expect(filters.find((filter) => filter.name === 'Images')?.extensions).toContain('psb');
    expect(filters.find((filter) => filter.name === 'Images')?.extensions).toContain('xcf');
    expect(filters.find((filter) => filter.name === 'Video')?.extensions).toContain('hevc');
    expect(filters.find((filter) => filter.name === 'Audio')?.extensions).toContain('opus');
    expect(filters.find((filter) => filter.name === 'Documents')?.extensions).toContain('epub');
    expect(filters.find((filter) => filter.name === 'Documents')?.extensions).toContain('sloom-idml.json');
    expect(filters.find((filter) => filter.name === 'Subtitles')?.extensions).toContain('ass');
    expect(filters.find((filter) => filter.name === 'Projects & Packages')?.extensions).toContain('sloom');
    expect(filters.find((filter) => filter.name === 'Projects & Packages')?.extensions).toContain('sloom-paper-package.json');
    expect(filters.find((filter) => filter.name === 'Projects & Packages')?.extensions).toContain('sloom-paper-package.zip');
    expect(filters.at(-1)).toEqual({ name: 'All Files', extensions: ['*'] });
  });

  it('detects GIF mime types case-insensitively and ignores charset suffixes', () => {
    expect(isGifMimeType('image/gif')).toBe(true);
    expect(isGifMimeType('IMAGE/GIF')).toBe(true);
    expect(isGifMimeType('image/gif; charset=binary')).toBe(true);
    expect(isGifMimeType('image/png')).toBe(false);
    expect(isGifMimeType(undefined)).toBe(false);
  });

  it('trusts an explicit mimeType over the asset URL when detecting a GIF asset reference', () => {
    expect(isGifAssetReference('blob:http://localhost/abc-123', 'image/gif')).toBe(true);
    expect(isGifAssetReference('blob:http://localhost/abc-123.png', 'image/png')).toBe(false);
    expect(isGifAssetReference('data:image/gif;base64,AAA', undefined)).toBe(true);
    expect(isGifAssetReference('data:image/png;base64,AAA', undefined)).toBe(false);
    expect(isGifAssetReference('https://example.com/anim.gif', undefined)).toBe(true);
    expect(isGifAssetReference('https://example.com/anim.gif?v=2', undefined)).toBe(true);
    expect(isGifAssetReference('blob:http://localhost/no-extension-no-mime', undefined)).toBe(false);
    expect(isGifAssetReference(undefined, undefined)).toBe(false);
  });

  it('keeps the Electron CJS mirror aligned with the renderer registry', () => {
    const rendererCoverage = MEDIA_FORMAT_REGISTRY.map(({ kind, label, extensions, mimeTypes, preferredMimeTypes }) => ({ kind, label, extensions, mimeTypes, preferredMimeTypes }));
    expect(electronRegistry.MEDIA_FORMAT_REGISTRY).toEqual(JSON.parse(JSON.stringify(rendererCoverage)));
    expect(electronRegistry.getElectronDialogFilterGroups()).toEqual(getElectronDialogFilterGroups());
  });

  it('lets the native Video picker restrict the dialog to linked footage kinds', () => {
    const filters = electronRegistry.getElectronDialogFilterGroups(['video', 'audio']);
    expect(filters.find((filter) => filter.name === 'Video')).toBeDefined();
    expect(filters.find((filter) => filter.name === 'Audio')).toBeDefined();
    expect(filters.find((filter) => filter.name === 'Images')).toBeUndefined();
    expect(filters.find((filter) => filter.name === 'Documents')).toBeUndefined();
  });
});
