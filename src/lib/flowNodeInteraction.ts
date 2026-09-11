const FLOW_NODE_SUPPRESSION_CLASSES = ['nodrag', 'nopan', 'nowheel'] as const;

export const FLOW_NODE_INTERACTIVE_CLASS_NAME = FLOW_NODE_SUPPRESSION_CLASSES.join(' ');

export function withFlowNodeInteractionClasses(className = ''): string {
  const classNames = new Set<string>(FLOW_NODE_SUPPRESSION_CLASSES);

  for (const token of className.split(/\s+/)) {
    if (token) {
      classNames.add(token);
    }
  }

  return Array.from(classNames).join(' ');
}

export function shouldOpenNodeTitleContextMenu(input: {
  nodeSelected: boolean;
  target: EventTarget | null;
}): boolean {
  if (input.nodeSelected) {
    return false;
  }

  return !isNativeNodeContextMenuTarget(input.target);
}

export function isNativeNodeContextMenuTarget(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"], .react-flow__handle'));
}
