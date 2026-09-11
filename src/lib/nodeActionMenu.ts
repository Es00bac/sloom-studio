import type {
  CompositionTargetHandle,
  FlowNodeType,
  ImageTargetHandle,
  ListTargetHandle,
  VideoTargetHandle,
} from '../types/flow';

export interface NodeActionTemplate {
  id: string;
  label: string;
  targetType?: FlowNodeType;
  targetHandle?: VideoTargetHandle | CompositionTargetHandle | ImageTargetHandle | ListTargetHandle | string;
  disabled?: boolean;
}

export function getCompatibleNodeActions(nodeType: FlowNodeType): NodeActionTemplate[] {
  switch (nodeType) {
    case 'cropImageNode':
    case 'imageGen':
      return [
        {
          id: 'edit-image',
          label: 'Edit image',
          targetType: 'imageGen',
          targetHandle: 'image-edit-source',
        },
        {
          id: 'reference-image',
          label: 'Reference image',
          targetType: 'imageGen',
          targetHandle: 'image-reference-1',
        },
        {
          id: 'use-as-mask',
          label: 'Use as mask',
          targetType: 'imageGen',
          targetHandle: 'image-mask',
        },
        {
          id: 'describe-image',
          label: 'Describe with text',
          targetType: 'textNode',
        },
        {
          id: 'animate-to-video',
          label: 'Animate to video',
          targetType: 'videoGen',
          targetHandle: 'video-start-frame',
        },
        {
          id: 'guide-video-style',
          label: 'Guide video',
          targetType: 'videoGen',
          targetHandle: 'video-reference-1',
        },
        {
          id: 'mix-with-audio',
          label: 'Mix with audio',
          targetType: 'composition',
          targetHandle: 'composition-video',
        },
        {
          id: 'collect-in-bin',
          label: 'Collect in source bin',
          targetType: 'sourceBin',
        },
        {
          id: 'add-to-list',
          label: 'Add to list',
          targetType: 'list',
          targetHandle: 'list-item-0',
        },
        {
          id: 'feed-function',
          label: 'Feed function',
          targetType: 'functionNode',
          targetHandle: 'input-flow',
        },
      ];
    case 'videoGen':
      return [
        { id: 'upscale', label: 'Upscale', disabled: true },
        { id: 'edit-video', label: 'Edit video', disabled: true },
        {
          id: 'extract-frame',
          label: 'Extract frame',
          targetType: 'imageGen',
        },
        {
          id: 'mix-with-audio',
          label: 'Mix with audio',
          targetType: 'composition',
          targetHandle: 'composition-video',
        },
        {
          id: 'extend-video',
          label: 'Extend video',
          targetType: 'videoGen',
          targetHandle: 'video-source-video',
        },
        {
          id: 'collect-in-bin',
          label: 'Collect in source bin',
          targetType: 'sourceBin',
        },
        {
          id: 'add-to-list',
          label: 'Add to list',
          targetType: 'list',
          targetHandle: 'list-item-0',
        },
        {
          id: 'feed-function',
          label: 'Feed function',
          targetType: 'functionNode',
          targetHandle: 'input-flow',
        },
        { id: 'lipsync-generation', label: 'Lipsync generation', disabled: true },
      ];
    case 'audioGen':
      return [
        {
          id: 'mix-with-video',
          label: 'Mix with video',
          targetType: 'composition',
          targetHandle: 'composition-audio-1',
        },
        {
          id: 'collect-in-bin',
          label: 'Collect in source bin',
          targetType: 'sourceBin',
        },
        {
          id: 'add-to-list',
          label: 'Add to list',
          targetType: 'list',
          targetHandle: 'list-item-0',
        },
        {
          id: 'feed-function',
          label: 'Feed function',
          targetType: 'functionNode',
          targetHandle: 'input-flow',
        },
        { id: 'lipsync-generation', label: 'Lipsync generation', disabled: true },
      ];
    case 'textNode':
      return [
        {
          id: 'generate-image',
          label: 'Generate image',
          targetType: 'imageGen',
        },
        {
          id: 'generate-video',
          label: 'Generate video',
          targetType: 'videoGen',
          targetHandle: 'video-prompt',
        },
        {
          id: 'generate-audio',
          label: 'Generate audio',
          targetType: 'audioGen',
        },
        {
          id: 'collect-in-bin',
          label: 'Collect in source bin',
          targetType: 'sourceBin',
        },
        {
          id: 'add-to-list',
          label: 'Add to list',
          targetType: 'list',
          targetHandle: 'list-item-0',
        },
        {
          id: 'feed-function',
          label: 'Feed function',
          targetType: 'functionNode',
          targetHandle: 'input-flow',
        },
      ];
    case 'composition':
      return [
        {
          id: 'collect-in-bin',
          label: 'Collect in source bin',
          targetType: 'sourceBin',
        },
        {
          id: 'add-to-list',
          label: 'Add to list',
          targetType: 'list',
          targetHandle: 'list-item-0',
        },
        {
          id: 'feed-function',
          label: 'Feed function',
          targetType: 'functionNode',
          targetHandle: 'input-flow',
        },
      ];
    case 'list':
      return [
        {
          id: 'expand-list',
          label: 'Expand item',
          targetType: 'expander',
        },
        {
          id: 'send-to-envelope',
          label: 'Send to envelope',
          targetType: 'envelope',
        },
        {
          id: 'collect-in-bin',
          label: 'Collect in source bin',
          targetType: 'sourceBin',
        },
      ];
    case 'envelope':
      return [
        {
          id: 'expand-envelope',
          label: 'Expand item',
          targetType: 'expander',
        },
        {
          id: 'collect-in-bin',
          label: 'Collect in source bin',
          targetType: 'sourceBin',
        },
      ];
    case 'expander':
      return [
        {
          id: 'add-to-list',
          label: 'Add to list',
          targetType: 'list',
          targetHandle: 'list-item-0',
        },
      ];
    default:
      return [];
  }
}
