// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the phone detector so the test exercises the sheet branch directly rather than
// fighting jsdom's navigator/screen. The detector itself is covered by mobilePhoneInterface.test.ts.
const mobileState = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../lib/mobilePhoneInterface', () => ({
  useMobilePhoneInterfaceDescriptor: () => ({
    enabled: mobileState.enabled,
    orientation: 'portrait' as const,
    surface: 'phone' as const,
    topbarHeightPx: 48,
    expandedDrawerMaxHeightCss: 'min(72vh, 34rem)',
    collapsedTopPaddingClassName: 'pt-12' as const,
    hiddenTopPaddingClassName: 'pt-0' as const,
    reason: 'test-phone',
  }),
}));

import { DockableDialog } from './DockableDialog';
import { useDockablePanelStore } from '../../store/dockablePanelStore';

describe('DockableDialog mobile full-screen sheet', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let originalSetPointerCapture: typeof HTMLElement.prototype.setPointerCapture | undefined;
  let originalReleasePointerCapture: typeof HTMLElement.prototype.releasePointerCapture | undefined;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    useDockablePanelStore.setState({ defaults: {}, layouts: {} });
    mobileState.enabled = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    originalSetPointerCapture = HTMLElement.prototype.setPointerCapture;
    originalReleasePointerCapture = HTMLElement.prototype.releasePointerCapture;
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalSetPointerCapture) {
      HTMLElement.prototype.setPointerCapture = originalSetPointerCapture;
    }
    if (originalReleasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = originalReleasePointerCapture;
    }
  });

  const renderDialog = (open: boolean, onClose: () => void) => {
    act(() => {
      root!.render(
        <DockableDialog
          dialogId="settings"
          onClose={onClose}
          open={open}
          title="Provider Configuration"
          workspaceId="app-dialogs"
        >
          <div data-testid="dialog-body">body content</div>
        </DockableDialog>,
      );
    });
  };

  it('renders a full-screen sheet with title and children on a phone', () => {
    renderDialog(true, vi.fn());
    const sheet = document.querySelector('[data-mobile-dialog-sheet="true"]');
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute('role')).toBe('dialog');
    expect(sheet?.textContent).toContain('Provider Configuration');
    expect(document.querySelector('[data-testid="dialog-body"]')).not.toBeNull();
  });

  it('calls onClose when the sheet close button is pressed', () => {
    const onClose = vi.fn();
    renderDialog(true, onClose);
    const closeButton = document.querySelector(
      '[aria-label="Close Provider Configuration"]',
    ) as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();
    act(() => {
      closeButton!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render the mobile sheet on desktop', () => {
    mobileState.enabled = false;
    renderDialog(true, vi.fn());
    expect(document.querySelector('[data-mobile-dialog-sheet="true"]')).toBeNull();
  });

  it('renders nothing when closed', () => {
    renderDialog(false, vi.fn());
    expect(document.querySelector('[data-mobile-dialog-sheet="true"]')).toBeNull();
    expect(document.querySelector('[data-testid="dialog-body"]')).toBeNull();
  });
});
