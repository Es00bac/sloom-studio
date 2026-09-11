import { describe, expect, it } from 'vitest';
import {
  IMAGE_EDITOR_TOOL_DEFINITIONS,
  buildImageEditorToolReadinessDescriptor,
  getImageEditorToolbarFlyoutSignature,
  getImageEditorToolRegistryReadiness,
  sanitizeImageEditorToolbarFlyoutOrder,
} from './imageEditorTools';
import { DEFAULT_KEYBOARD_SHORTCUTS } from '../../lib/keyboardShortcuts';

describe('imageEditorTools', () => {
  it('registers a dedicated hand tool for viewport panning', () => {
    const ids = IMAGE_EDITOR_TOOL_DEFINITIONS.map((definition) => definition.tool);
    expect(ids).toContain('hand');
    expect(ids).toContain('backgroundEraser');
    expect(ids).toContain('magicEraser');
    expect(new Set(ids).size).toBe(ids.length);
    expect(IMAGE_EDITOR_TOOL_DEFINITIONS.find((definition) => definition.tool === 'hand')).toMatchObject({
      label: 'Hand',
      shortcut: 'H',
    });
    expect(IMAGE_EDITOR_TOOL_DEFINITIONS.find((definition) => definition.tool === 'magicEraser')).toMatchObject({
      label: 'Magic Eraser',
      shortcut: 'Shift+E',
    });
    expect(IMAGE_EDITOR_TOOL_DEFINITIONS.find((definition) => definition.tool === 'backgroundEraser')).toMatchObject({
      label: 'Background Eraser',
      shortcut: 'Alt+E',
    });
    expect(ids.indexOf('backgroundEraser')).toBe(ids.indexOf('eraser') + 1);
    expect(ids.indexOf('magicEraser')).toBe(ids.indexOf('backgroundEraser') + 1);
  });

  it('describes compact flyout readiness with user-reorderable toolbar customization', () => {
    const readiness = getImageEditorToolRegistryReadiness(DEFAULT_KEYBOARD_SHORTCUTS);

    expect(readiness.registeredToolCount).toBe(IMAGE_EDITOR_TOOL_DEFINITIONS.length);
    expect(readiness.missingShortcutTools).toEqual([]);
    expect(readiness.nestedFlyoutUnsupportedTools).toEqual(
      ['move', 'hand', 'brush', 'crop', 'text', 'eyedropper'],
    );
    expect(readiness.toolbarCustomization).toMatchObject({
      status: 'customizable-toolbar',
      supported: true,
      userReorderable: true,
      evidenceSignature: 'customization:user-reorderable-flyout-groups:no-dock:no-resize',
    });
    expect(readiness.workspaceCommandRouting).toEqual({
      workspace: 'image',
      supported: true,
      caveat: 'Image tool commands route through image:* native menu commands only while the Image workspace is active.',
    });
    expect(readiness.tools.find((tool) => tool.tool === 'brush')).toMatchObject({
      command: 'image:tool-brush',
      actionSuitability: 'preset-friendly',
      batchSuitability: 'not-batch-safe',
    });
    expect(readiness.tools.find((tool) => tool.tool === 'eraser')).toMatchObject({
      nestedFlyoutSupported: true,
      nestedFlyoutCaveat:
        'Compact flyout group "Eraser" exposes Eraser, Background Eraser, and Magic Eraser without adding toolbar rows.',
    });
    expect(readiness.tools.find((tool) => tool.tool === 'pen')).toMatchObject({
      command: 'image:tool-pen',
      nestedFlyoutSupported: true,
      actionSuitability: 'descriptor-only',
      batchSuitability: 'not-batch-safe',
    });
    expect(buildImageEditorToolReadinessDescriptor(DEFAULT_KEYBOARD_SHORTCUTS)
      .tools.find((tool) => tool.tool === 'lasso')?.optionSummary?.caveat)
      .toContain('Magnetic lasso samples the document composite');
  });

  it('sanitizes custom toolbar flyout order without changing palette size or dropping groups', () => {
    const customOrder = sanitizeImageEditorToolbarFlyoutOrder([
      'text',
      'eraser',
      'bogus',
      'selection',
      'text',
    ]);

    expect(customOrder.slice(0, 3)).toEqual(['text', 'eraser', 'selection']);
    expect(new Set(customOrder).size).toBe(customOrder.length);
    expect(customOrder).toHaveLength(13);
    expect(getImageEditorToolbarFlyoutSignature(customOrder).startsWith('text:text|eraser:eraser,backgroundEraser,magicEraser|selection:marquee,lasso,magicWand')).toBe(true);
  });

  it('reports missing shortcut coverage for registered image tools', () => {
    const readiness = getImageEditorToolRegistryReadiness({
      'image:tool-brush': 'B',
    });

    expect(readiness.missingShortcutTools).toContain('pen');
    expect(readiness.missingShortcutCommands).toContain('image:tool-pen');
    expect(readiness.shortcutCollisions).toEqual([]);
  });

  it('builds stable grouping and shortcut signatures for dashboard checklist consumers', () => {
    const descriptor = buildImageEditorToolReadinessDescriptor(DEFAULT_KEYBOARD_SHORTCUTS);

    expect(descriptor.descriptorId).toBe('image-tool-registry-shortcuts:v1');
    expect(descriptor.toolbarGroupingSignature).toBe(
      'navigation:hand|selection:marquee,lasso,magicWand|paint:brush,eraser,backgroundEraser,magicEraser,paintBucket,gradientTool|retouch:cloneStamp,spotHeal,blurBrush,sharpenBrush,smudgeBrush,dodgeBrush,burnBrush,spongeSaturateBrush,spongeDesaturateBrush|vector:pen,rectShape,ellipseShape|transform:move,crop|text:text|sample:eyedropper',
    );
    expect(descriptor).toMatchObject({
      toolbarFlyoutSignature:
        'move:move|hand:hand|selection:marquee,lasso,magicWand|brush:brush|eraser:eraser,backgroundEraser,magicEraser|clone-heal:cloneStamp,spotHeal|focus-retouch:blurBrush,sharpenBrush,smudgeBrush|tone-retouch:dodgeBrush,burnBrush,spongeSaturateBrush,spongeDesaturateBrush|fill:paintBucket,gradientTool|vector:pen,rectShape,ellipseShape|crop:crop|text:text|eyedropper:eyedropper',
      toolbarFlyoutFootprint: 'absolute-overlay',
      toolbarCustomization: {
        status: 'customizable-toolbar',
        supported: true,
        userReorderable: true,
      },
    });
    expect(descriptor.shortcutMapSignature).toContain('image:tool-brush=B');
    expect(descriptor.shortcutMapSignature).toContain('image:tool-magic-eraser=Shift+E');
    expect(descriptor.toolbarGroups.find((group) => group.group === 'paint')).toMatchObject({
      signature: 'paint:brush,eraser,backgroundEraser,magicEraser,paintBucket,gradientTool',
      toolCount: 6,
    });
    expect(descriptor.unsupported.map((item) => item.kind)).not.toContain('nested-tool-flyouts');
    expect(descriptor.unsupported.map((item) => item.kind)).not.toContain('toolbar-customization');
    expect(descriptor.shortcutConflicts).toEqual([]);
  });

  it('reports conflicts, option availability, inactive command states, and missing device routes explicitly', () => {
    const descriptor = buildImageEditorToolReadinessDescriptor({
      ...DEFAULT_KEYBOARD_SHORTCUTS,
      'image:tool-brush': 'B',
      'image:tool-pen': 'B',
      'image:tool-crop': '',
    });

    expect(descriptor.shortcutConflicts).toContainEqual({
      shortcut: 'B',
      commands: ['image:tool-brush', 'image:tool-pen'],
    });
    expect(descriptor.tools.find((tool) => tool.tool === 'brush')?.optionSummary).toMatchObject({
      configurable: true,
      propertiesPanel: true,
      presetSupport: true,
    });
    expect(descriptor.tools.find((tool) => tool.tool === 'pen')?.optionSummary).toMatchObject({
      configurable: false,
      status: 'descriptor-only',
    });
    expect(descriptor.commandStates).toContainEqual({
      command: 'image:tool-crop',
      tool: 'crop',
      state: 'unavailable',
      reason: 'No normalized keyboard shortcut is assigned.',
    });
    expect(descriptor.deviceRoutes).toEqual(
      expect.arrayContaining([
        {
          device: 'desktop-keyboard',
          supported: true,
          caveat: 'Image tool shortcuts are desktop keyboard routes scoped to the Image workspace.',
        },
        {
          device: 'android',
          supported: false,
          caveat: 'Android hardware/software shortcut routing for Image tool commands is not implemented.',
        },
        {
          device: 'gamepad',
          supported: false,
          caveat: 'Gamepad bindings open settings but do not route Image tool selection commands.',
        },
      ]),
    );
  });
});
