// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageEditorToolbar } from './ImageEditorToolbar';
import { IMAGE_EDITOR_TOOL_DEFINITIONS } from './imageEditorTools';

describe('ImageEditorToolbar', () => {
  it('renders as a compact fixed-size two-column floating tool palette with no icon gaps', () => {
    const html = renderToStaticMarkup(<ImageEditorToolbar />);

    expect(html).toContain('class="w-[64px]');
    expect(html).toContain('data-image-editor-tools-panel="true"');
    expect(html).toContain('data-image-editor-toolbar-grouping-signature="navigation:hand|selection:marquee,lasso,magicWand|paint:brush,eraser,backgroundEraser,magicEraser,paintBucket,gradientTool|retouch:cloneStamp,spotHeal,blurBrush,sharpenBrush,smudgeBrush,dodgeBrush,burnBrush,spongeSaturateBrush,spongeDesaturateBrush|vector:pen,rectShape,ellipseShape|transform:move,crop|text:text|sample:eyedropper"');
    expect(html).toContain('data-image-editor-toolbar-flyout-signature="move:move|hand:hand|selection:marquee,lasso,magicWand|brush:brush|eraser:eraser,backgroundEraser,magicEraser|clone-heal:cloneStamp,spotHeal|focus-retouch:blurBrush,sharpenBrush,smudgeBrush|tone-retouch:dodgeBrush,burnBrush,spongeSaturateBrush,spongeDesaturateBrush|fill:paintBucket,gradientTool|vector:pen,rectShape,ellipseShape|crop:crop|text:text|eyedropper:eyedropper"');
    expect(html).toContain('data-image-editor-tools-grid="true"');
    expect(html).toContain('data-image-editor-color-well="true"');
    expect(html).toContain('data-image-editor-toolbar-customization="user-reorderable-flyout-groups"');
    expect(html).toContain('data-image-editor-toolbar-custom-order-signature="move|hand|selection|brush|eraser|clone-heal|focus-retouch|tone-retouch|fill|vector|crop|text|eyedropper"');
    expect(html).toContain('draggable="true"');
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('gap-0');
    expect(html).toContain('aria-label="Move tool"');
    expect(html).toContain('aria-label="Pen tool"');
    expect(html).toContain('aria-label="Background Eraser tool"');
    expect(html).toContain('aria-label="Magic Eraser tool"');
    expect(html).toContain('aria-label="Eyedropper tool"');
    expect(html).toContain('aria-label="Foreground color"');
    expect(html).toContain('aria-label="Background color"');
    expect(html).toContain('aria-label="Swap foreground and background colors"');
    expect(html).toContain('aria-label="Reset foreground and background colors"');
    expect(html).not.toContain('gap-1');
    expect(html).not.toContain('flex w-12 flex-col');
    expect(html).not.toContain('Dock</button>');
  });

  it('gives every tool a visually distinct icon (no two tools share a glyph)', () => {
    const html = renderToStaticMarkup(<ImageEditorToolbar />);
    const doc = document.createElement('div');
    doc.innerHTML = html;

    const iconByTool = new Map<string, string>();
    for (const definition of IMAGE_EDITOR_TOOL_DEFINITIONS) {
      const button = doc.querySelector(`button[aria-label="${definition.label} tool"]`);
      expect(button, `no toolbar button for ${definition.tool}`).not.toBeNull();
      const svg = button!.querySelector('svg');
      expect(svg, `no icon svg for ${definition.tool}`).not.toBeNull();
      // lucide stamps a `lucide-<name>` class (sometimes an alias + canonical pair); the full set
      // is a stable per-icon signature, so two different glyphs can never collide.
      const signature = Array.from(svg!.classList)
        .filter((cls) => cls.startsWith('lucide-'))
        .sort()
        .join(' ');
      expect(signature, `no lucide icon class for ${definition.tool}`).toBeTruthy();
      iconByTool.set(definition.tool, signature);
    }

    const distinct = new Set(iconByTool.values());
    expect(distinct.size, `shared icons across tools: ${JSON.stringify([...iconByTool])}`)
      .toBe(iconByTool.size);
  });

  it('makes related tool flyout groups discoverable without adding palette dock or resize chrome', () => {
    const html = renderToStaticMarkup(<ImageEditorToolbar />);
    const doc = document.createElement('div');
    doc.innerHTML = html;

    const panel = doc.querySelector('[data-image-editor-tools-panel="true"]');
    const toolGrid = doc.querySelector('[data-image-editor-tools-grid="true"]');
    const slots = Array.from(toolGrid?.children ?? []).filter((child) =>
      child.hasAttribute('data-image-editor-tool-slot'),
    );
    const directButtonSlots = Array.from(toolGrid?.children ?? []).filter((child) => child.tagName === 'BUTTON');
    const flyoutTriggers = toolGrid?.querySelectorAll('[data-image-editor-tool-flyout-trigger="true"]') ?? [];
    const flyoutMenus = toolGrid?.querySelectorAll('[data-image-editor-tool-flyout-group]') ?? [];

    expect(panel?.classList.contains('w-[64px]')).toBe(true);
    expect(toolGrid?.classList.contains('grid-cols-2')).toBe(true);
    expect(toolGrid?.classList.contains('gap-0')).toBe(true);
    expect(slots).toHaveLength(13);
    expect(slots.length).toBeLessThan(IMAGE_EDITOR_TOOL_DEFINITIONS.length);
    expect(directButtonSlots).toHaveLength(0);
    expect(flyoutTriggers).toHaveLength(7);
    expect(flyoutMenus).toHaveLength(7);

    const selectionFlyout = doc.querySelector('[data-image-editor-tool-flyout-group="selection"]');
    const eraserFlyout = doc.querySelector('[data-image-editor-tool-flyout-group="eraser"]');
    const vectorFlyout = doc.querySelector('[data-image-editor-tool-flyout-group="vector"]');

    expect(selectionFlyout?.getAttribute('aria-label')).toBe('Selection tools flyout');
    expect(selectionFlyout?.getAttribute('data-image-editor-tool-flyout-tools')).toBe('marquee,lasso,magicWand');
    expect(selectionFlyout?.querySelectorAll('button[role="menuitem"]')).toHaveLength(3);
    expect(eraserFlyout?.getAttribute('data-image-editor-tool-flyout-tools')).toBe('eraser,backgroundEraser,magicEraser');
    expect(vectorFlyout?.getAttribute('data-image-editor-tool-flyout-tools')).toBe('pen,rectShape,ellipseShape');

    for (const trigger of Array.from(flyoutTriggers)) {
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(trigger.getAttribute('aria-controls')).toMatch(/^image-tool-flyout-/);
    }

    for (const slot of slots) {
      expect(slot.getAttribute('draggable')).toBe('true');
      expect(slot.getAttribute('data-image-editor-tool-slot-reorderable')).toBe('true');
    }

    for (const menu of Array.from(flyoutMenus)) {
      expect(menu.classList.contains('absolute')).toBe(true);
      expect(menu.classList.contains('left-full')).toBe(true);
      expect(menu.getAttribute('data-image-editor-tool-flyout-footprint')).toBe('absolute-overlay');
    }

    expect(panel?.querySelector('[aria-label="Dock"]')).toBeNull();
    expect(panel?.querySelector('[aria-label*="Resize"]')).toBeNull();
    expect(panel?.querySelector('[data-image-editor-tools-dock-control]')).toBeNull();
    expect(panel?.querySelector('[data-image-editor-tools-resize-handle]')).toBeNull();
  });

  it('keeps the palette compact structure and integrates all tools and color wells', () => {
    const html = renderToStaticMarkup(<ImageEditorToolbar />);
    const doc = document.createElement('div');
    doc.innerHTML = html;

    const panel = doc.querySelector('[data-image-editor-tools-panel="true"]');
    const toolGrid = doc.querySelector('[data-image-editor-tools-grid="true"]');
    const colorWell = doc.querySelector('[data-image-editor-color-well="true"]');
    const editActions = doc.querySelector('[data-image-editor-edit-actions="true"]');

    expect(panel).not.toBeNull();
    expect(toolGrid).not.toBeNull();
    expect(colorWell).not.toBeNull();
    expect(editActions).not.toBeNull();

    // edit-actions row (Undo/Redo/Cut/Copy/Paste) + tool grid + colour well
    expect(panel?.children).toHaveLength(3);
    for (const label of ['Undo', 'Redo', 'Cut', 'Copy', 'Paste']) {
      expect(editActions?.querySelector(`button[aria-label="${label}"]`)).not.toBeNull();
    }

    const toolButtons = toolGrid?.querySelectorAll('button[aria-label$=" tool"]') ?? [];
    const slotButtons = toolGrid?.querySelectorAll('[data-image-editor-tool-slot-button="true"]') ?? [];
    expect(toolButtons).toHaveLength(IMAGE_EDITOR_TOOL_DEFINITIONS.length);
    expect(slotButtons).toHaveLength(13);

    for (const button of Array.from(slotButtons)) {
      expect(button.classList.contains('h-8')).toBe(true);
      expect(button.classList.contains('w-8')).toBe(true);
      expect(button.classList.contains('rounded-none')).toBe(true);
    }

    expect(toolGrid?.classList.contains('grid')).toBe(true);
    expect(toolGrid?.classList.contains('grid-cols-2')).toBe(true);
    expect(toolGrid?.classList.contains('gap-0')).toBe(true);
    expect(colorWell?.classList.contains('h-[60px]')).toBe(true);
    expect(colorWell?.classList.contains('w-16')).toBe(true);
    expect(colorWell?.querySelectorAll('button[aria-label="Foreground color"]').length).toBe(1);
    expect(colorWell?.querySelectorAll('button[aria-label="Background color"]').length).toBe(1);
    expect(colorWell?.querySelector('button[aria-label="Swap foreground and background colors"]')).not.toBeNull();
    expect(colorWell?.querySelector('button[aria-label="Reset foreground and background colors"]')).not.toBeNull();
    expect(panel?.querySelector('[aria-label="Dock"]')).toBeNull();
  });
});
