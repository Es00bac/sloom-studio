import { useEffect } from 'react';
import {
  onNativeRendererCommand,
  type NativeMenuCommand,
} from '../../lib/nativeApp';

export type NativeMenuCommandHandler = (command: NativeMenuCommand) => void;
export type NativeMenuCommandPredicate = (command: NativeMenuCommand) => boolean;
export type NativeMenuCommandSubscriber = (handler: NativeMenuCommandHandler) => () => void;

export interface NativeMenuCommandMatchOptions {
  enabled?: boolean;
  commands?: readonly NativeMenuCommand[];
  prefixes?: readonly string[];
  predicate?: NativeMenuCommandPredicate;
}

export interface NativeMenuCommandSubscriptionOptions extends NativeMenuCommandMatchOptions {
  subscribe?: NativeMenuCommandSubscriber;
}

export function matchesNativeMenuCommand(
  command: NativeMenuCommand,
  {
    enabled = true,
    commands,
    prefixes,
    predicate,
  }: NativeMenuCommandMatchOptions = {},
): boolean {
  if (!enabled) {
    return false;
  }

  const hasCommandFilter = Boolean(commands?.length);
  const hasPrefixFilter = Boolean(prefixes?.length);
  const hasPredicateFilter = Boolean(predicate);

  if (!hasCommandFilter && !hasPrefixFilter && !hasPredicateFilter) {
    return true;
  }

  if (commands?.includes(command)) {
    return true;
  }

  if (prefixes?.some((prefix) => command.startsWith(prefix))) {
    return true;
  }

  return predicate?.(command) ?? false;
}

export function subscribeToNativeMenuCommands(
  handler: NativeMenuCommandHandler,
  options: NativeMenuCommandSubscriptionOptions = {},
): () => void {
  if (options.enabled === false) {
    return () => undefined;
  }

  const subscribe = options.subscribe ?? onNativeRendererCommand;

  return subscribe((command) => {
    if (matchesNativeMenuCommand(command, options)) {
      handler(command);
    }
  });
}

export function useNativeMenuCommand(
  handler: NativeMenuCommandHandler,
  {
    commands,
    enabled,
    prefixes,
    predicate,
    subscribe,
  }: NativeMenuCommandSubscriptionOptions = {},
): void {
  useEffect(() => subscribeToNativeMenuCommands(handler, {
    commands,
    enabled,
    prefixes,
    predicate,
    subscribe,
  }), [
    commands,
    enabled,
    handler,
    prefixes,
    predicate,
    subscribe,
  ]);
}
