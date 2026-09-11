import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAbortError } from './abortSignals';

const mocks = vi.hoisted(() => ({
  showAlertDialog: vi.fn(),
}));

vi.mock('../store/alertDialogStore', () => ({
  showAlertDialog: mocks.showAlertDialog,
}));

import { runFileOperation } from './fileOperationBoundary';

describe('runFileOperation', () => {
  beforeEach(() => {
    mocks.showAlertDialog.mockReset();
    mocks.showAlertDialog.mockResolvedValue(undefined);
  });

  it('runs the operation and shows no dialog on success', async () => {
    const operation = vi.fn(async () => undefined);

    await runFileOperation('Save Project Failed', operation);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
  });

  it('shows a danger dialog with the thrown error message when the operation rejects', async () => {
    const operation = vi.fn(async () => {
      throw new Error('The disk is full.');
    });

    await runFileOperation('Save Project Failed', operation);

    expect(mocks.showAlertDialog).toHaveBeenCalledWith({
      title: 'Save Project Failed',
      message: 'The disk is full.',
      tone: 'danger',
    });
  });

  it('falls back to the supplied message when the thrown value is not an Error', async () => {
    const operation = vi.fn(async () => {
      throw 'nope';
    });

    await runFileOperation('Save Project Failed', operation, 'The project could not be saved.');

    expect(mocks.showAlertDialog).toHaveBeenCalledWith({
      title: 'Save Project Failed',
      message: 'The project could not be saved.',
      tone: 'danger',
    });
  });

  it('uses a generic fallback message when none is supplied and the thrown value is not an Error', async () => {
    const operation = vi.fn(async () => {
      throw { code: 'EACCES' };
    });

    await runFileOperation('Export Assets Failed', operation);

    expect(mocks.showAlertDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Export Assets Failed',
      tone: 'danger',
    }));
    const call = mocks.showAlertDialog.mock.calls[0][0] as { message: string };
    expect(call.message.length).toBeGreaterThan(0);
  });

  it('silently swallows a user-cancellation (AbortError) without showing a dialog', async () => {
    const operation = vi.fn(async () => {
      throw createAbortError('The picker was cancelled.');
    });

    await runFileOperation('Set Scratch Folder Failed', operation);

    expect(mocks.showAlertDialog).not.toHaveBeenCalled();
  });

  it('never lets the operation rejection escape the returned promise', async () => {
    const operation = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(runFileOperation('Import Media Failed', operation)).resolves.toBeUndefined();
  });
});
