import { describe, expect, it } from 'vitest';
import { shouldShowSharedWorkspacePanels } from './sharedWorkspacePanelVisibility';

describe('shared workspace panel visibility', () => {
  it('keeps shared panels on desktop Paper and Image workspaces', () => {
    expect(shouldShowSharedWorkspacePanels({
      applicationChromeHidden: false,
      mobilePhoneInterfaceEnabled: false,
      workspaceView: 'paper',
    })).toBe(true);
    expect(shouldShowSharedWorkspacePanels({
      applicationChromeHidden: false,
      mobilePhoneInterfaceEnabled: false,
      workspaceView: 'image',
    })).toBe(true);
  });

  it('suppresses legacy shared panels on every dedicated phone workspace', () => {
    expect(shouldShowSharedWorkspacePanels({
      applicationChromeHidden: false,
      mobilePhoneInterfaceEnabled: true,
      workspaceView: 'paper',
    })).toBe(false);
    expect(shouldShowSharedWorkspacePanels({
      applicationChromeHidden: false,
      mobilePhoneInterfaceEnabled: true,
      workspaceView: 'image',
    })).toBe(false);
    expect(shouldShowSharedWorkspacePanels({
      applicationChromeHidden: false,
      mobilePhoneInterfaceEnabled: true,
      workspaceView: 'flow',
    })).toBe(false);
  });

  it('still suppresses panels while any workspace has hidden application chrome', () => {
    expect(shouldShowSharedWorkspacePanels({
      applicationChromeHidden: true,
      mobilePhoneInterfaceEnabled: true,
      workspaceView: 'flow',
    })).toBe(false);
  });
});
