// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

// zustand's persist middleware resolves `localStorage` once at store creation (module import),
// and Node's experimental localStorage getter yields undefined without --localstorage-file.
// Install a Map-backed stand-in before any store module loads.
const localStorageBacking = vi.hoisted(() => {
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, String(value));
      },
      removeItem: (key: string) => {
        backing.delete(key);
      },
      clear: () => backing.clear(),
      key: () => null,
      length: 0,
    },
  });
  return backing;
});

const servedLan = vi.hoisted(() => ({ value: false }));
const saveCalls = vi.hoisted(() => ({ documents: [] as Array<Record<string, unknown>> }));
const saveControl = vi.hoisted(() => ({ rejectWith: undefined as Error | undefined }));

vi.mock('../DockablePanel', () => ({
  DockableDialog: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../lib/projectLibrary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/projectLibrary')>();
  return {
    ...actual,
    isRemoteLanClient: () => servedLan.value,
    saveProjectDocument: async (document: unknown) => {
      saveCalls.documents.push(document as Record<string, unknown>);
      if (saveControl.rejectWith) throw saveControl.rejectWith;
      return document as never;
    },
  };
});

import { ProjectHistoryModal } from './ProjectHistoryModal';
import type { ProjectRevisionRecord } from '../../lib/projectHistory';
import { useProjectHistoryStore } from '../../store/projectHistoryStore';
import { useConfirmationStore } from '../../store/confirmationStore';

function buildRecord(id: string, name: string, createdAt: number): ProjectRevisionRecord {
  return {
    id,
    kind: 'save',
    name,
    createdAt,
    summary: { version: 1, initial: true, sections: [] },
    payload: '{}',
    payloadChars: 2,
  };
}

function seedRecords(records: ProjectRevisionRecord[]) {
  useProjectHistoryStore.getState().applySection({ version: 1, revisions: records });
}

describe('ProjectHistoryModal served-LAN read-only boundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorageBacking.clear();
    window.indexedDB = new IDBFactory() as unknown as typeof window.indexedDB;
    servedLan.value = false;
    saveCalls.documents.length = 0;
    saveControl.rejectWith = undefined;
    useProjectHistoryStore.getState().hydrateFromSection(undefined);

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container?.remove();
    useProjectHistoryStore.getState().hydrateFromSection(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderModal() {
    act(() => {
      root.render(<ProjectHistoryModal isOpen onClose={() => undefined} />);
    });
  }

  async function flushAsync(ms = 10) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  async function waitForStatus(fragment: string) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (container.textContent?.includes(fragment)) return;
      await flushAsync(10);
    }
    throw new Error(`Timed out waiting for status containing "${fragment}". Modal text: ${container.textContent}`);
  }

  function clickButton(label: string) {
    const button = [...container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.includes(label));
    expect(button, `button "${label}" should be rendered`).toBeDefined();
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (!nativeSetter) throw new Error('HTMLInputElement value setter is unavailable.');
    act(() => {
      nativeSetter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function findRenameInput(recordName: string): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="Rename ${recordName}"]`);
    expect(input, `rename input for "${recordName}" should be rendered`).toBeDefined();
    return input!;
  }

  function submitRenameForm() {
    const form = container.querySelector('form');
    expect(form, 'rename form should be rendered').toBeDefined();
    act(() => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  function currentRecordIds() {
    return useProjectHistoryStore.getState().records.map((record) => record.id);
  }

  it('refuses a new snapshot before any local mutation, save attempt, or false success', async () => {
    servedLan.value = true;
    seedRecords([buildRecord('rev-1', 'First save', 1_000)]);
    renderModal();
    await flushAsync();

    expect(container.textContent).toContain('served read-only collaboration session');

    clickButton('New Snapshot');
    await waitForStatus('cannot record a new snapshot');

    expect(useProjectHistoryStore.getState().records).toHaveLength(1);
    expect(currentRecordIds()).toEqual(['rev-1']);
    expect(saveCalls.documents).toHaveLength(0);
    expect(container.textContent).not.toContain('saved to the local project library');
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain('read-only');
  });

  it('refuses rename before opening the rename editor', async () => {
    servedLan.value = true;
    seedRecords([buildRecord('rev-1', 'First save', 1_000)]);
    renderModal();
    await flushAsync();

    clickButton('Rename');
    await waitForStatus('cannot rename revisions');

    expect(container.querySelector('input[aria-label="Rename First save"]')).toBeNull();
    expect(currentRecordIds()).toEqual(['rev-1']);
    expect(useProjectHistoryStore.getState().records[0]?.name).toBe('First save');
    expect(saveCalls.documents).toHaveLength(0);
  });

  it('refuses rename at commit time when the session becomes served while the form is open', async () => {
    seedRecords([buildRecord('rev-1', 'First save', 1_000)]);
    renderModal();
    await flushAsync();

    clickButton('Rename');
    const input = findRenameInput('First save');
    setInputValue(input, 'Stolen Rename');

    servedLan.value = true;
    submitRenameForm();
    await waitForStatus('cannot rename revisions');

    expect(useProjectHistoryStore.getState().records[0]?.name).toBe('First save');
    expect(useProjectHistoryStore.getState().records[0]?.renamedAt).toBeUndefined();
    expect(saveCalls.documents).toHaveLength(0);
  });

  it('refuses delete before destructive confirmation and keeps every record', async () => {
    servedLan.value = true;
    seedRecords([
      buildRecord('rev-1', 'First save', 1_000),
      buildRecord('rev-2', 'Second save', 2_000),
    ]);
    const requestConfirmation = vi.spyOn(useConfirmationStore.getState(), 'requestConfirmation');
    renderModal();
    await flushAsync();

    clickButton('Delete');
    await waitForStatus('cannot delete revisions');

    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(currentRecordIds()).toEqual(['rev-1', 'rev-2']);
    expect(saveCalls.documents).toHaveLength(0);
  });

  it('refuses delete when the session becomes served while confirmation is open', async () => {
    seedRecords([buildRecord('rev-1', 'First save', 1_000)]);
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const requestConfirmation = vi.spyOn(useConfirmationStore.getState(), 'requestConfirmation')
      .mockImplementation(() => new Promise<boolean>((resolve) => {
        resolveConfirmation = resolve;
      }));
    renderModal();
    await flushAsync();

    clickButton('Delete');
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    servedLan.value = true;
    await act(async () => {
      resolveConfirmation?.(true);
      await Promise.resolve();
    });
    await waitForStatus('cannot delete revisions');

    expect(currentRecordIds()).toEqual(['rev-1']);
    expect(saveCalls.documents).toHaveLength(0);
    expect(container.textContent).not.toContain('Deleted revision');
  });

  it('still records and persists a named snapshot outside served sessions', async () => {
    seedRecords([buildRecord('rev-1', 'First save', 1_000)]);
    renderModal();
    await flushAsync();

    expect(container.textContent).not.toContain('served read-only collaboration session');

    const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="New snapshot name"]');
    expect(nameInput).toBeDefined();
    setInputValue(nameInput!, 'Milestone');
    clickButton('New Snapshot');
    await waitForStatus('saved to the local project library');

    const records = useProjectHistoryStore.getState().records;
    expect(records).toHaveLength(2);
    expect(records[1]?.kind).toBe('manual');
    expect(records[1]?.name).toBe('Milestone');
    expect(saveCalls.documents).toHaveLength(1);
  });

  it('does not publish a named snapshot when browser persistence fails', async () => {
    seedRecords([buildRecord('rev-1', 'First save', 1_000)]);
    saveControl.rejectWith = new Error('The local project database is blocked.');
    renderModal();
    await flushAsync();

    const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="New snapshot name"]');
    expect(nameInput).toBeDefined();
    setInputValue(nameInput!, 'Doomed Snapshot');
    clickButton('New Snapshot');
    await waitForStatus('local project database is blocked');

    expect(currentRecordIds()).toEqual(['rev-1']);
    expect(useProjectHistoryStore.getState().records[0]?.name).toBe('First save');
    expect(saveCalls.documents).toHaveLength(1);
    expect(container.textContent).not.toContain('Doomed Snapshot');
    expect(container.textContent).not.toContain('saved to the local project library');
  });

  it('still renames and deletes revisions outside served sessions', async () => {
    seedRecords([buildRecord('rev-1', 'First save', 1_000)]);
    const requestConfirmation = vi.spyOn(useConfirmationStore.getState(), 'requestConfirmation');
    renderModal();
    await flushAsync();

    clickButton('Rename');
    const input = findRenameInput('First save');
    setInputValue(input, 'Renamed Milestone');
    submitRenameForm();
    await waitForStatus('Revision renamed');

    expect(useProjectHistoryStore.getState().records[0]?.name).toBe('Renamed Milestone');
    expect(useProjectHistoryStore.getState().records[0]?.renamedAt).toBeDefined();
    expect(saveCalls.documents).toHaveLength(0);

    clickButton('Delete');
    await waitForStatus('Deleted revision');
    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(useProjectHistoryStore.getState().records).toHaveLength(0);
  });
});
