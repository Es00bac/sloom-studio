import { describe, expect, it, vi } from 'vitest';
import type { NativeMenuCommand } from '../../lib/nativeApp';
import {
  matchesNativeMenuCommand,
  subscribeToNativeMenuCommands,
} from './useNativeMenuCommand';

describe('native menu command subscriptions', () => {
  it('matches explicit command lists and command prefixes', () => {
    expect(matchesNativeMenuCommand('image:tool-brush', {
      commands: ['image:tool-brush'],
    })).toBe(true);
    expect(matchesNativeMenuCommand('image:tool-move', {
      commands: ['image:tool-brush'],
    })).toBe(false);
    expect(matchesNativeMenuCommand('paper:export-pdf', {
      prefixes: ['paper:'],
    })).toBe(true);
    expect(matchesNativeMenuCommand('timeline:cut', {
      prefixes: ['paper:'],
    })).toBe(false);
  });

  it('supports predicate filters and disabled subscriptions', () => {
    const imageOnly = (command: NativeMenuCommand) => command.startsWith('image:');

    expect(matchesNativeMenuCommand('image:export-visible', {
      predicate: imageOnly,
    })).toBe(true);
    expect(matchesNativeMenuCommand('paper:add-page', {
      predicate: imageOnly,
    })).toBe(false);
    expect(matchesNativeMenuCommand('image:export-visible', {
      enabled: false,
      predicate: imageOnly,
    })).toBe(false);
  });

  it('subscribes once and forwards only matching commands', () => {
    let subscribedCallback: ((command: NativeMenuCommand) => void) | undefined;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((callback: (command: NativeMenuCommand) => void) => {
      subscribedCallback = callback;
      return unsubscribe;
    });
    const received: NativeMenuCommand[] = [];

    const remove = subscribeToNativeMenuCommands((command) => received.push(command), {
      prefixes: ['timeline:'],
      subscribe,
    });

    subscribedCallback?.('timeline:cut');
    subscribedCallback?.('paper:add-page');
    remove();

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(received).toEqual(['timeline:cut']);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('returns a noop unsubscribe when disabled', () => {
    const subscribe = vi.fn();
    const remove = subscribeToNativeMenuCommands(vi.fn(), {
      enabled: false,
      subscribe,
    });

    remove();

    expect(subscribe).not.toHaveBeenCalled();
  });
});
