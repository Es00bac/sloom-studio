import type { PaperFrameKind, PaperTool } from '../../../types/paper';

export interface PaperToolDefinition {
  tool: PaperTool;
  label: string;
  shortcut?: string;
  frameKind: PaperFrameKind | null;
  add: boolean;
}

export const PAPER_TOOL_DEFINITIONS: PaperToolDefinition[] = [
  { tool: 'select', label: 'Select', shortcut: 'V', frameKind: null, add: false },
  { tool: 'hand', label: 'Hand', shortcut: 'H', frameKind: null, add: false },
  { tool: 'tiltmark', label: 'Tiltmark paint', shortcut: 'B', frameKind: null, add: false },
  { tool: 'text', label: 'Text frame', shortcut: 'T', frameKind: 'text', add: true },
  { tool: 'image', label: 'Image frame', shortcut: 'Shift+I', frameKind: 'image', add: true },
  { tool: 'panel', label: 'Comic panel', frameKind: 'panel', add: true },
  { tool: 'line', label: 'Line', frameKind: 'shape', add: true },
  { tool: 'ellipse', label: 'Ellipse / circle', frameKind: 'shape', add: true },
  { tool: 'triangle', label: 'Triangle', frameKind: 'shape', add: true },
  { tool: 'pentagon', label: 'Pentagon', frameKind: 'shape', add: true },
  { tool: 'hexagon', label: 'Hexagon', frameKind: 'shape', add: true },
  { tool: 'shape', label: 'Free polygon', frameKind: 'shape', add: true },
  { tool: 'speech', label: 'Speech bubble', frameKind: 'speechBubble', add: true },
  { tool: 'thought', label: 'Thought bubble', frameKind: 'thoughtBubble', add: true },
  { tool: 'caption', label: 'Caption', frameKind: 'caption', add: true },
  { tool: 'barcode', label: 'ISBN barcode', frameKind: 'barcode', add: true },
  { tool: 'eyedropper', label: 'Eyedropper', shortcut: 'I', frameKind: null, add: false },
  { tool: 'gutterKnife', label: 'Gutter knife', shortcut: 'K', frameKind: null, add: false },
];
