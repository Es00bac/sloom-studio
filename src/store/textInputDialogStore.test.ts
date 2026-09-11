import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTextInputDialogStore } from './textInputDialogStore';

describe('text input dialog store', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    useTextInputDialogStore.setState({ activeRequest: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('opens a request and resolves with submitted text', async () => {
    const promise = useTextInputDialogStore.getState().requestTextInput({
      title: 'Rename Source Bin',
      label: 'Bin name',
      initialValue: 'Source Library',
    });

    expect(useTextInputDialogStore.getState().activeRequest).toMatchObject({
      title: 'Rename Source Bin',
      label: 'Bin name',
      initialValue: 'Source Library',
    });

    useTextInputDialogStore.getState().respond('References');

    await expect(promise).resolves.toBe('References');
    expect(useTextInputDialogStore.getState().activeRequest).toBeNull();
  });

  it('resolves a replaced request as cancelled', async () => {
    const first = useTextInputDialogStore.getState().requestTextInput({
      title: 'First',
      label: 'Name',
    });
    const second = useTextInputDialogStore.getState().requestTextInput({
      title: 'Second',
      label: 'Name',
    });

    await expect(first).resolves.toBeNull();
    useTextInputDialogStore.getState().respond('Second value');
    await expect(second).resolves.toBe('Second value');
  });

  it('resolves cancel responses as null', async () => {
    const request = useTextInputDialogStore.getState().requestTextInput({
      title: 'New Source Bin',
      label: 'Bin name',
    });

    useTextInputDialogStore.getState().respond(null);

    await expect(request).resolves.toBeNull();
    expect(useTextInputDialogStore.getState().activeRequest).toBeNull();
  });

  it('returns the initial value when automation bypass is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const request = useTextInputDialogStore.getState().requestTextInput({
      title: 'New Source Bin',
      label: 'Bin name',
      initialValue: 'New Bin',
    });

    await expect(request).resolves.toBe('New Bin');
    expect(useTextInputDialogStore.getState().activeRequest).toBeNull();
  });
});
