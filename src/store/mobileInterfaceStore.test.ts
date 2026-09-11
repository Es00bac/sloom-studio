import { describe, expect, it } from 'vitest';
import {
  resolveMobileEdgeDrawerToggle,
  resolveNextMobileChromeModeForApplicationTab,
  sanitizeMobileChromeMode,
  sanitizeMobileEdgeDrawerId,
  useMobileInterfaceStore,
} from './mobileInterfaceStore';

describe('mobileInterfaceStore', () => {
  it('accepts only supported phone chrome modes', () => {
    expect(sanitizeMobileChromeMode('collapsed')).toBe('collapsed');
    expect(sanitizeMobileChromeMode('expanded')).toBe('expanded');
    expect(sanitizeMobileChromeMode('hidden')).toBe('hidden');
    expect(sanitizeMobileChromeMode('large-screen')).toBe('collapsed');
    expect(sanitizeMobileChromeMode(undefined)).toBe('collapsed');
  });

  it('accepts only supported phone edge drawers', () => {
    expect(sanitizeMobileEdgeDrawerId('top')).toBe('top');
    expect(sanitizeMobileEdgeDrawerId('source')).toBe('source');
    expect(sanitizeMobileEdgeDrawerId('panels')).toBe('panels');
    expect(sanitizeMobileEdgeDrawerId('assets')).toBe('assets');
    expect(sanitizeMobileEdgeDrawerId('layers')).toBeNull();
    expect(sanitizeMobileEdgeDrawerId(undefined)).toBeNull();
  });

  it('keeps one active mobile edge drawer at a time', () => {
    expect(resolveMobileEdgeDrawerToggle(null, 'source')).toBe('source');
    expect(resolveMobileEdgeDrawerToggle('source', 'panels')).toBe('panels');
    expect(resolveMobileEdgeDrawerToggle('panels', 'panels')).toBeNull();
  });

  it('maps application Tab to hide and restore instead of browser focus traversal', () => {
    expect(resolveNextMobileChromeModeForApplicationTab('collapsed')).toBe('hidden');
    expect(resolveNextMobileChromeModeForApplicationTab('expanded')).toBe('hidden');
    expect(resolveNextMobileChromeModeForApplicationTab('hidden')).toBe('collapsed');
  });

  it('clears active drawers when hiding and restores a collapsed shell', () => {
    const store = useMobileInterfaceStore;
    store.setState({
      activeEdgeDrawer: null,
      chromeMode: 'collapsed',
    });

    store.getState().toggleEdgeDrawer('source');
    expect(store.getState()).toMatchObject({
      activeEdgeDrawer: 'source',
      chromeMode: 'collapsed',
    });

    store.getState().toggleEdgeDrawer('panels');
    expect(store.getState()).toMatchObject({
      activeEdgeDrawer: 'panels',
      chromeMode: 'collapsed',
    });

    store.getState().toggleEdgeDrawer('top');
    expect(store.getState()).toMatchObject({
      activeEdgeDrawer: 'top',
      chromeMode: 'expanded',
    });

    store.getState().hideInterface();
    expect(store.getState()).toMatchObject({
      activeEdgeDrawer: null,
      chromeMode: 'hidden',
    });

    store.getState().restoreInterface();
    expect(store.getState()).toMatchObject({
      activeEdgeDrawer: null,
      chromeMode: 'collapsed',
    });
  });

  it('keeps side drawers independent from hidden top chrome', () => {
    const store = useMobileInterfaceStore;
    store.setState({
      activeEdgeDrawer: null,
      chromeMode: 'hidden',
    });

    store.getState().toggleEdgeDrawer('source');
    expect(store.getState()).toMatchObject({
      activeEdgeDrawer: 'source',
      chromeMode: 'hidden',
    });

    store.getState().toggleEdgeDrawer('source');
    expect(store.getState()).toMatchObject({
      activeEdgeDrawer: null,
      chromeMode: 'hidden',
    });

    store.getState().toggleEdgeDrawer('panels');
    expect(store.getState()).toMatchObject({
      activeEdgeDrawer: 'panels',
      chromeMode: 'hidden',
    });

    store.getState().toggleEdgeDrawer('top');
    expect(store.getState()).toMatchObject({
      activeEdgeDrawer: 'top',
      chromeMode: 'expanded',
    });
  });
});
