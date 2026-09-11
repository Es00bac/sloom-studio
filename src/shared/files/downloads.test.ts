import { describe, expect, it, vi } from 'vitest';
import {
  buildDownloadFilename,
  buildWorkspaceDownloadFilename,
  downloadBlob,
  downloadBlobWithOutcome,
  downloadJsonFile,
  downloadUrlAsFile,
} from './downloads';

describe('shared browser downloads', () => {
  it('reports a failed browser outcome when object URL creation fails', async () => {
    const outcome = await downloadBlobWithOutcome(new Blob(['x']), 'broken.txt', {
      document: { createElement: vi.fn() } as unknown as Document,
      url: { createObjectURL: vi.fn(() => { throw new Error('blocked'); }), revokeObjectURL: vi.fn() },
      setTimeout: vi.fn(),
    });
    expect(outcome).toEqual({ status: 'failed', platform: 'browser', error: 'blocked' });
  });

  it('sanitizes filenames through the media registry', () => {
    expect(buildDownloadFilename('Scene 01/final!', 'image/jpeg', 'png')).toBe('Scene-01-final.jpg');
  });

  it('keeps Sloom Studio container extensions literal (no MIME inference)', () => {
    expect(buildWorkspaceDownloadFilename('Untitled-1', 'slimg')).toBe('Untitled-1.slimg');
    expect(buildWorkspaceDownloadFilename('My Zine!', '.SLPPR')).toBe('My-Zine.slppr');
    expect(buildWorkspaceDownloadFilename('', 'slimg')).toBe('signal-loom.slimg');
    expect(buildWorkspaceDownloadFilename(undefined, 'slppr')).toBe('signal-loom.slppr');
  });

  it('downloads blob payloads through one DOM anchor path and revokes object URLs', () => {
    const clicks: string[] = [];
    const anchor = { href: '', download: '', click: () => clicks.push('clicked'), remove: vi.fn() };
    const documentLike = {
      createElement: () => anchor,
      body: { append: vi.fn(), appendChild: vi.fn() },
    } as unknown as Document;
    const urlLike = {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL;
    const timeout = vi.fn((callback: () => void) => {
      callback();
      return 1 as unknown as number;
    });

    downloadBlob(new Blob(['x'], { type: 'text/plain' }), 'note.txt', {
      document: documentLike,
      url: urlLike,
      setTimeout: timeout,
    });

    expect(anchor.href).toBe('blob:test');
    expect(anchor.download).toBe('note.txt');
    expect(clicks).toEqual(['clicked']);
    expect(urlLike.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('serializes JSON downloads without each caller rebuilding the blob path', async () => {
    const created: Blob[] = [];
    const urlLike = {
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob);
        return 'blob:json';
      }),
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL;
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const documentLike = {
      createElement: () => anchor,
      body: { append: vi.fn(), appendChild: vi.fn() },
    } as unknown as Document;

    downloadJsonFile('project.sloom', { name: 'Project' }, {
      document: documentLike,
      url: urlLike,
      setTimeout: (callback) => {
        callback();
        return 1 as unknown as number;
      },
    });

    expect(created[0].type).toBe('application/json');
    expect(await created[0].text()).toContain('"name": "Project"');
    expect(anchor.download).toBe('project.sloom');
  });

  it('falls back to opening the original URL when fetch-based download fails', async () => {
    const anchor = { href: '', download: '', target: '', rel: '', click: vi.fn(), remove: vi.fn() };
    const documentLike = {
      createElement: () => anchor,
      body: { append: vi.fn(), appendChild: vi.fn() },
    } as unknown as Document;

    await downloadUrlAsFile('https://example.invalid/file.png', 'file.png', {
      document: documentLike,
      fetch: vi.fn(async () => ({ ok: false, status: 404 }) as Response),
      url: URL,
    });

    expect(anchor.href).toBe('https://example.invalid/file.png');
    expect(anchor.download).toBe('file.png');
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noreferrer');
    expect(anchor.click).toHaveBeenCalledOnce();
  });
});
