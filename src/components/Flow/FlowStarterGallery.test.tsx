// @vitest-environment jsdom

import { flushSync } from 'react-dom';
import { createRoot as createClientRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowStarterGallery } from './FlowStarterGallery';
import { FLOW_STARTER_TEMPLATES, starterTemplateRunRequirement } from '../../lib/flowStarterTemplates';
import { useSettingsStore } from '../../store/settingsStore';

function setSearchValue(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('[data-starter-template-search="true"]')!;
  // React's value tracker swallows plain value writes; set through the native
  // prototype setter so the bubbling input event re-renders the gallery.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync(() => undefined);
}

describe('FlowStarterGallery', () => {
  const originalLocale = useSettingsStore.getState().locale;
  let tracked: Array<{ container: HTMLElement; unmount: () => void }>;

  beforeEach(() => {
    tracked = [];
    useSettingsStore.getState().setLocale('en');
  });

  afterEach(() => {
    useSettingsStore.getState().setLocale(originalLocale);
    for (const entry of tracked) {
      entry.unmount();
      entry.container.remove();
    }
  });

  const mountGallery = (onInsert: (id: string) => void, variant: 'panel' | 'menu' = 'panel') => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createClientRoot(container);
    tracked.push({ container, unmount: () => root.unmount() });
    flushSync(() => root.render(<FlowStarterGallery onInsert={onInsert} variant={variant} />));
    return container;
  };

  it('renders every starter template with an accessible add action, preview, description, and node count', () => {
    const onInsert = vi.fn();
    const container = mountGallery(onInsert);

    const cards = container.querySelectorAll('[data-starter-template-card]');
    expect(cards).toHaveLength(FLOW_STARTER_TEMPLATES.length);
    for (const template of FLOW_STARTER_TEMPLATES) {
      const card = container.querySelector(`[data-starter-template-card="${template.id}"]`)!;
      expect(card.getAttribute('aria-label')).toBe(`Add ${template.title} template`);
      // The miniature graph preview exists and is hidden from assistive tech...
      const preview = container.querySelector(`[data-starter-template-preview="${template.id}"]`)!;
      expect(preview.getAttribute('aria-hidden')).toBe('true');
      expect(preview.querySelectorAll('rect')).toHaveLength(template.nodes.length);
      // ...while the textual description carries the meaning.
      expect(card.textContent).toContain(template.description);
      expect(card.textContent).toContain(`${template.nodes.length} nodes`);
    }
    expect(container.querySelector('[data-starter-template-search="true"]')?.getAttribute('aria-label'))
      .toBe('Search starter templates');
  });

  it('filters templates by search text and shows an explicit empty state', () => {
    const onInsert = vi.fn();
    const container = mountGallery(onInsert);

    setSearchValue(container, 'palette');
    expect(container.querySelectorAll('[data-starter-template-card]')).toHaveLength(1);
    expect(container.querySelector('[data-starter-template-card="palette-consistency"]')).not.toBeNull();

    setSearchValue(container, 'zzz-no-such-template');
    expect(container.querySelectorAll('[data-starter-template-card]')).toHaveLength(0);
    expect(container.querySelector('[data-starter-template-empty]')?.textContent)
      .toBe('No matching templates.');
  });

  it('inserts the exact template id from the clicked card', () => {
    const onInsert = vi.fn();
    const container = mountGallery(onInsert);
    const card = container.querySelector<HTMLButtonElement>('[data-starter-template-card="text-to-image"]');
    (card as HTMLButtonElement).click();
    flushSync(() => undefined);
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith('text-to-image');
  });

  it('localizes the gallery chrome and template titles into Japanese', () => {
    useSettingsStore.getState().setLocale('ja');
    const onInsert = vi.fn();
    const container = mountGallery(onInsert);

    expect(container.textContent).toContain('Flow をはじめる');
    expect(container.textContent).toContain('テキストから画像へ');
    expect(container.querySelector('[data-starter-template-card="text-to-image"]')?.getAttribute('aria-label'))
      .toBe('テキストから画像へテンプレートを追加');

    setSearchValue(container, '電卓');
    expect(container.querySelectorAll('[data-starter-template-card]')).toHaveLength(1);
  });

  it('renders the compact menu variant with the same insert behavior', () => {
    const onInsert = vi.fn();
    const container = mountGallery(onInsert, 'menu');

    expect(container.querySelector('[data-starter-template-menu-panel="true"]')).not.toBeNull();
    expect(container.querySelector('section')).toBeNull();
    const card = container.querySelector<HTMLButtonElement>('[data-starter-template-card="local-calculator"]');
    card!.click();
    flushSync(() => undefined);
    expect(onInsert).toHaveBeenCalledWith('local-calculator');
  });

  it('states the provider/API-key prerequisite on every provider-dependent card and not on local cards', () => {
    const onInsert = vi.fn();
    const container = mountGallery(onInsert);

    for (const template of FLOW_STARTER_TEMPLATES) {
      const requirement = starterTemplateRunRequirement(template);
      const card = container.querySelector(`[data-starter-template-card="${template.id}"]`)!;
      const line = card.querySelector(`[data-starter-template-requirement="${requirement}"]`);
      expect(line).not.toBeNull();
      expect(card.querySelectorAll('[data-starter-template-requirement]')).toHaveLength(1);
      if (requirement === 'provider') {
        expect(line!.textContent).toContain('Needs AI providers');
        expect(line!.textContent).toContain('Provider settings');
        expect(line!.textContent).toContain('API key');
        expect(card.textContent).not.toContain('Runs locally');
      } else {
        expect(line!.textContent).toContain('Runs locally');
        expect(line!.textContent).toContain('no provider or API key needed');
        expect(card.textContent).not.toContain('Needs AI providers');
      }
    }
    // The distinction is real: both kinds exist in the shipped set.
    expect(FLOW_STARTER_TEMPLATES.some((t) => starterTemplateRunRequirement(t) === 'provider')).toBe(true);
    expect(FLOW_STARTER_TEMPLATES.some((t) => starterTemplateRunRequirement(t) === 'local')).toBe(true);
  });

  it('localizes the provider prerequisite line into Japanese', () => {
    useSettingsStore.getState().setLocale('ja');
    const container = mountGallery(vi.fn());

    const providerCard = container.querySelector('[data-starter-template-card="text-to-image"]')!;
    expect(providerCard.querySelector('[data-starter-template-requirement="provider"]')?.textContent)
      .toContain('プロバイダー設定');
    const localCard = container.querySelector('[data-starter-template-card="local-calculator"]')!;
    expect(localCard.querySelector('[data-starter-template-requirement="local"]')?.textContent)
      .toContain('ローカルで動作します');
  });

  it('stacks the preview above a full-width text column instead of a fixed-width row (Faye Rowan P1: crushed titles)', () => {
    const container = mountGallery(vi.fn());
    const card = container.querySelector<HTMLButtonElement>('[data-starter-template-card="text-to-image"]')!;

    // The old row layout (`items-stretch` + a `shrink-0` fixed-pixel preview) squeezed the
    // text column to ~54px and the title to 0px at real card widths. Stacking the preview
    // above a full-width text column, with a `w-full` responsive preview instead of a fixed
    // pixel box, is what keeps the title readable at both the 304px gallery card width and
    // the narrower 172px Start-menu popover card width.
    expect(card.className).toContain('flex-col');
    expect(card.className).not.toContain('items-stretch');

    const preview = card.querySelector('[data-starter-template-preview="text-to-image"]')!;
    expect(preview.getAttribute('class')).toContain('w-full');
    expect(preview.getAttribute('class')).not.toContain('shrink-0');
    expect(preview.hasAttribute('width')).toBe(false);
    expect(preview.hasAttribute('height')).toBe(false);

    const title = card.querySelector('.truncate');
    expect(title?.className).toContain('min-w-0');
  });

  it('marks the panel and menu surfaces as a keyboard-focus scope so Tab traverses instead of hiding the interface', () => {
    const panelContainer = mountGallery(vi.fn(), 'panel');
    expect(panelContainer.querySelector('[data-starter-template-panel]')?.getAttribute('data-keyboard-focus-scope'))
      .toBe('true');

    const menuContainer = mountGallery(vi.fn(), 'menu');
    expect(menuContainer.querySelector('[data-starter-template-menu-panel]')?.getAttribute('data-keyboard-focus-scope'))
      .toBe('true');
  });

  it('lets the empty-canvas panel shrink its list instead of clipping the whole card off-screen', () => {
    // Faye Rowan's P1: at 1024x640 and 800x600 only the list scrolled, so the panel itself
    // overflowed the viewport. The card must cap its own height and let the list (not the
    // card) absorb the overflow.
    const container = mountGallery(vi.fn(), 'panel');
    const card = container.querySelector('[data-starter-template-panel] > div')!;
    expect(card.className).toContain('max-h-full');
    expect(card.className).toContain('flex-col');
    const list = container.querySelector('[data-starter-template-list]')!;
    expect(list.className).toContain('flex-1');
    expect(list.className).toContain('min-h-0');
  });
});
