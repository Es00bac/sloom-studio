import { describe, expect, it } from 'vitest';
import {
  buildFlowNodePatchForRestoredSourceBinItem,
  buildFlowNodePatchForSourceBinItem,
  getFlowNodeTypeForSourceBinItem,
} from './sourceBinFlowBridge';

describe('sourceBinFlowBridge', () => {
  it('maps source-bin media kinds to the existing imported node types', () => {
    expect(getFlowNodeTypeForSourceBinItem({ kind: 'image' })).toBe('imageGen');
    expect(getFlowNodeTypeForSourceBinItem({ kind: 'video' })).toBe('videoGen');
    expect(getFlowNodeTypeForSourceBinItem({ kind: 'composition' })).toBe('videoGen');
    expect(getFlowNodeTypeForSourceBinItem({ kind: 'audio' })).toBe('audioGen');
    expect(getFlowNodeTypeForSourceBinItem({ kind: 'text' })).toBe('textNode');
    expect(getFlowNodeTypeForSourceBinItem({ kind: 'document' })).toBe('textNode');
    expect(getFlowNodeTypeForSourceBinItem({ kind: 'subtitle' })).toBe('textNode');
    expect(getFlowNodeTypeForSourceBinItem({ kind: 'package' })).toBe('textNode');
  });

  it('creates the same imported media node patch used by source-bin drag/drop', () => {
    expect(buildFlowNodePatchForSourceBinItem({
      id: 'item-1',
      label: 'Edited still.png',
      kind: 'image',
      assetId: 'asset-1',
      assetUrl: 'blob:edited',
      mimeType: 'image/png',
    })).toEqual({
      mediaMode: 'import',
      sourceBinItemId: 'item-1',
      sourceAssetId: 'asset-1',
      sourceAssetUrl: 'blob:edited',
      sourceAssetName: 'Edited still.png',
      sourceAssetMimeType: 'image/png',
    });
  });

  it('creates prompt node patches for source-bin text items', () => {
    expect(buildFlowNodePatchForSourceBinItem({
      id: 'text-1',
      label: 'Fallback label',
      kind: 'text',
      text: 'Prompt from source bin',
    })).toEqual({
      mode: 'prompt',
      prompt: 'Prompt from source bin',
    });
  });

  it('keeps supported document source-bin assets routable through Gemini-capable text nodes', () => {
    expect(buildFlowNodePatchForSourceBinItem({
      id: 'doc-1',
      label: 'shot-list.pdf',
      kind: 'document',
      assetUrl: 'blob:doc',
      mimeType: 'application/pdf',
    })).toEqual({
      mode: 'generate',
      prompt: 'Analyze this document.',
      sourceBinItemId: 'doc-1',
      textVisionSourceItemId: 'doc-1',
      sourceAssetId: undefined,
      sourceAssetUrl: 'blob:doc',
      sourceAssetName: 'shot-list.pdf',
      sourceAssetMimeType: 'application/pdf',
    });
  });

  it('keeps unsupported document packages as prompt labels instead of pretending Gemini can inspect them', () => {
    expect(buildFlowNodePatchForSourceBinItem({
      id: 'doc-2',
      label: 'layout.idml',
      kind: 'document',
      assetUrl: 'blob:doc',
      mimeType: 'application/vnd.adobe.indesign-idml-package',
    })).toEqual({
      mode: 'prompt',
      prompt: 'layout.idml',
    });
  });

  it('routes package source-bin items through prompt nodes instead of video nodes', () => {
    const item = {
      id: 'zip-1',
      label: 'png-image-sequence.zip',
      kind: 'package' as const,
      assetUrl: 'blob:image-sequence-zip',
      mimeType: 'application/zip',
    };

    expect(getFlowNodeTypeForSourceBinItem(item)).toBe('textNode');
    expect(buildFlowNodePatchForSourceBinItem(item)).toEqual({
      mode: 'prompt',
      prompt: 'png-image-sequence.zip',
    });
  });

  it('repairs reopened media node assets from the durable source-bin item id', () => {
    expect(buildFlowNodePatchForRestoredSourceBinItem({
      mediaMode: 'import',
      sourceBinItemId: 'item-1',
      sourceAssetUrl: 'blob:dead-from-previous-session',
      sourceAssetName: 'Old still.png',
    }, [
      {
        id: 'item-1',
        label: 'Restored still.png',
        kind: 'image',
        assetId: 'asset-2',
        assetUrl: 'data:image/png;base64,RESTORED',
        mimeType: 'image/png',
      },
    ])).toEqual({
      sourceBinItemId: 'item-1',
      sourceAssetId: 'asset-2',
      sourceAssetUrl: 'data:image/png;base64,RESTORED',
      sourceAssetName: 'Restored still.png',
      sourceAssetMimeType: 'image/png',
    });
  });

  it('can relink older reopened media nodes by matching saved asset metadata', () => {
    expect(buildFlowNodePatchForRestoredSourceBinItem({
      mediaMode: 'import',
      sourceAssetId: 'asset-1',
      sourceAssetUrl: 'blob:dead-from-previous-session',
      sourceAssetName: 'Old still.png',
      sourceAssetMimeType: 'image/png',
    }, [
      {
        id: 'item-1',
        label: 'Restored still.png',
        kind: 'image',
        assetId: 'asset-1',
        assetUrl: 'data:image/png;base64,RESTORED',
        mimeType: 'image/png',
      },
    ])).toEqual({
      sourceBinItemId: 'item-1',
      sourceAssetId: 'asset-1',
      sourceAssetUrl: 'data:image/png;base64,RESTORED',
      sourceAssetName: 'Restored still.png',
      sourceAssetMimeType: 'image/png',
    });
  });
});
