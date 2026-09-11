import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { buildAppMenuGroups } from './appMenuModel';
import { executeNodeRequest } from './flowExecution';
import { createDefaultFunctionNodeConfig } from './functionNodes';
import {
  buildWorkspaceWindowUrl,
  getWorkspaceWindowTitle,
  parseWorkspaceWindowSearch,
  WORKSPACE_WINDOW_VIEWS,
} from './workspaceWindows';
import {
  mergeSourceBinItemsIntoBins,
  removeSourceBinItemFromBins,
  renameSourceBinItemInBins,
} from './workspaceWindowCommands';
import { DEFAULT_MODELS, DEFAULT_PROVIDER_SETTINGS } from './providerCatalog';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import type { SourceBin } from '../store/sourceBinStore';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('application smoke tests', () => {
  it('keeps node default model settings populated for every generation capability', () => {
    expect(DEFAULT_MODELS.text.gemini).toBeTruthy();
    expect(DEFAULT_MODELS.image.gemini).toBeTruthy();
    expect(DEFAULT_MODELS.video.gemini).toBeTruthy();
    expect(DEFAULT_MODELS.audio.elevenlabs).toBeTruthy();
  });

  it('keeps proxy settings persistable as primitive values', () => {
    expect(DEFAULT_PROVIDER_SETTINGS.backendProxyEnabled).toBe(false);
    expect(DEFAULT_PROVIDER_SETTINGS.backendProxyBaseUrl).toBe('');
  });

  it('keeps all workspace window routes and open/focus menu commands reachable', () => {
    // Cross-app window launchers live in the per-workspace Window menu.
    const windowMenu = buildAppMenuGroups('flow').find((group) => group.id === 'window');

    expect(windowMenu?.items.slice(0, 4).map((item) => item.command)).toEqual([
      'view:flow',
      'view:editor',
      'view:image',
      'view:paper',
    ]);

    for (const workspace of WORKSPACE_WINDOW_VIEWS) {
      const url = buildWorkspaceWindowUrl('https://signal-loom.local/app?existing=1', workspace);

      expect(parseWorkspaceWindowSearch(new URL(url).search)).toBe(workspace);
      expect(getWorkspaceWindowTitle(workspace)).toMatch(/^Sloom Studio - /);
    }
  });

  it('keeps source-library add, rename, and remove commands mergeable across workspaces', () => {
    const bins: SourceBin[] = [{
      id: 'library',
      name: 'Source Library',
      items: [],
      collapsed: false,
      createdAt: 1,
    }];
    const item = {
      id: 'asset-1',
      label: 'Panel Art',
      kind: 'image',
      assetUrl: 'blob:panel-art',
      createdAt: 2,
      sourceKey: 'media/panel-art.png',
    } as const;

    const withItem = mergeSourceBinItemsIntoBins(bins, [item], 'library');
    expect(withItem[0].items).toHaveLength(1);
    expect(mergeSourceBinItemsIntoBins(withItem, [item], 'library')).toBe(withItem);

    const renamed = renameSourceBinItemInBins(withItem, 'asset-1', 'Opening Panel');
    expect(renamed[0].items[0].label).toBe('Opening Panel');
    expect(renameSourceBinItemInBins(renamed, 'missing', 'Ignored')).toBe(renamed);

    const removed = removeSourceBinItemFromBins(renamed, 'asset-1');
    expect(removed[0].items).toHaveLength(0);
    expect(removeSourceBinItemFromBins(removed, 'asset-1')).toBe(removed);
  });

  it('keeps native startup bootstrap isolated from menu-command callback churn', () => {
    const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const handleAppMenuCommandRef = useRef(handleAppMenuCommand);');
    expect(source).toContain("handleAppMenuCommandRef.current = handleAppMenuCommand;");
    expect(source).toContain("void handleAppMenuCommandRef.current(command, 'native-menu');");
    expect(source).not.toContain(
      "}, [handleAppMenuCommand, setNativeScratchDirectoryPath, setWorkspaceView, windowWorkspaceView]);",
    );
    expect(source).toContain('applyNativeStartupProjectReplacement({');
    expect(source).not.toContain("localStorage.getItem('signal-loom-paper-workspace')");
  });

  it('can build the non-provider Paper frames required by the workspace smoke path', () => {
    let document = createDefaultPaperDocument({ title: 'Smoke Paper' });
    const pageId = document.pages[0].id;

    for (const frame of [
      { id: 'smoke-text', kind: 'text' as const, text: 'Caption', xMm: 12, yMm: 12, widthMm: 50, heightMm: 24 },
      { id: 'smoke-image', kind: 'image' as const, xMm: 18, yMm: 42, widthMm: 80, heightMm: 50 },
      { id: 'smoke-speech', kind: 'speechBubble' as const, text: 'Hello', xMm: 32, yMm: 28, widthMm: 58, heightMm: 34 },
    ]) {
      document = addFrameToPaperPage(document, pageId, frame).document;
    }

    expect(document.pages[0].frames.map((frame) => frame.kind)).toEqual([
      'text',
      'image',
      'speechBubble',
    ]);
  });

  it('can execute a tiny proxied text graph request and surface telemetry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        result: 'proxied result',
        resultType: 'text',
        statusMessage: 'Generated through smoke proxy',
        usage: {
          source: 'actual',
          confidence: 'measured',
          provider: 'proxy',
          totalTokens: 2,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const node = {
      id: 'text-1',
      type: 'textNode',
      position: { x: 0, y: 0 },
      data: {
        mode: 'generate',
        provider: 'gemini',
      },
    } as AppNode;
    const settings: RuntimeSettingsSnapshot = {
      apiKeys: { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
      defaultModels: DEFAULT_MODELS,
      providerSettings: {
        ...DEFAULT_PROVIDER_SETTINGS,
        backendProxyEnabled: true,
        backendProxyBaseUrl: 'https://proxy.local',
      },
    };

    const result = await executeNodeRequest(
      node,
      {
        prompt: 'hello',
        config: {
          aspectRatio: '1:1',
          steps: 30,
          durationSeconds: 4,
          videoResolution: '720p',
          videoFrameRate: 30,
          imageOutputFormat: 'png',
          audioOutputFormat: 'mp3_44100_128',
        },
      },
      settings,
    );

    expect(result.result).toBe('proxied result');
    expect(result.usage?.totalTokens).toBe(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('passes named function input values into reusable function expressions', async () => {
    const config = createDefaultFunctionNodeConfig('Image passthrough');
    config.contract.inputPorts = [{
      id: 'input-character-sheet',
      key: 'character_sheet',
      label: 'Character Sheet',
      resultType: 'image',
      required: true,
      order: 0,
    }];
    config.contract.outputPorts = [{
      id: 'output-result',
      key: 'result',
      label: 'Result',
      resultType: 'text',
      required: true,
      order: 0,
    }];
    config.outputBindings = [{
      id: 'output-binding-result',
      targetOutputPortId: 'output-result',
      sourceNodeId: '',
      expression: '{{flow.input.character_sheet}}',
      transforms: [],
      resultType: 'text',
      missing: { strategy: 'default', value: '' },
    }];

    const node = {
      id: 'function-1',
      type: 'functionNode',
      position: { x: 0, y: 0 },
      data: { functionNode: config },
    } as AppNode;
    const settings: RuntimeSettingsSnapshot = {
      apiKeys: { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
      defaultModels: DEFAULT_MODELS,
      providerSettings: DEFAULT_PROVIDER_SETTINGS,
    };

    const result = await executeNodeRequest(
      node,
      {
        prompt: '',
        functionInputs: {
          'input-character-sheet': 'data:image/png;base64,abc',
        },
        config: {
          aspectRatio: '1:1',
          steps: 30,
          durationSeconds: 4,
          videoResolution: '720p',
          videoFrameRate: 30,
          imageOutputFormat: 'png',
          audioOutputFormat: 'mp3_44100_128',
        },
      },
      settings,
    );

    expect(result.result).toBe('data:image/png;base64,abc');
    expect(result.statusMessage).toContain('Image passthrough');
  });
});
