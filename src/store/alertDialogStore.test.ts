import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAlertDialogStore } from './alertDialogStore';

describe('alert dialog store', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    useAlertDialogStore.setState({ activeRequest: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens a request and resolves when acknowledged', async () => {
    const request = useAlertDialogStore.getState().requestAlert({
      title: 'Open Project Failed',
      message: 'The selected project file could not be opened.',
      tone: 'danger',
    });

    expect(useAlertDialogStore.getState().activeRequest).toMatchObject({
      title: 'Open Project Failed',
      message: 'The selected project file could not be opened.',
      tone: 'danger',
    });

    useAlertDialogStore.getState().respond();

    await expect(request).resolves.toBeUndefined();
    expect(useAlertDialogStore.getState().activeRequest).toBeNull();
  });

  it('resolves a replaced request before opening the next one', async () => {
    const first = useAlertDialogStore.getState().requestAlert('First alert');
    const second = useAlertDialogStore.getState().requestAlert({
      title: 'Second',
      message: 'Second alert',
      tone: 'warning',
    });

    await expect(first).resolves.toBeUndefined();
    expect(useAlertDialogStore.getState().activeRequest).toMatchObject({
      title: 'Second',
      message: 'Second alert',
    });

    useAlertDialogStore.getState().respond();
    await expect(second).resolves.toBeUndefined();
  });

  it('does not open a dialog when automation bypass is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    await expect(useAlertDialogStore.getState().requestAlert('Automation alert')).resolves.toBeUndefined();
    expect(useAlertDialogStore.getState().activeRequest).toBeNull();
  });
});
