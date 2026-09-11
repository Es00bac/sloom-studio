// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { observePaperTopbarSlot, PAPER_TOPBAR_SLOT_ID } from './paperTopbarSlot';

describe('observePaperTopbarSlot', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('resolves the existing slot immediately', () => {
    const slot = document.createElement('div');
    slot.id = PAPER_TOPBAR_SLOT_ID;
    document.body.appendChild(slot);
    const seen = vi.fn();

    const stop = observePaperTopbarSlot(document, seen);

    expect(seen).toHaveBeenCalledWith(slot);
    stop();
  });

  it('waits for a slot that is mounted after the workspace effect runs', async () => {
    const seen = vi.fn();
    const stop = observePaperTopbarSlot(document, seen);

    expect(seen).toHaveBeenCalledWith(null);

    const slot = document.createElement('div');
    slot.id = PAPER_TOPBAR_SLOT_ID;
    document.body.appendChild(slot);
    await Promise.resolve();

    expect(seen).toHaveBeenLastCalledWith(slot);
    stop();
  });
});
