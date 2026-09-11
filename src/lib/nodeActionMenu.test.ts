import { describe, expect, it } from 'vitest';
import { getCompatibleNodeActions } from './nodeActionMenu';

describe('getCompatibleNodeActions', () => {
  it('offers mix-with-audio from video outputs', () => {
    const actions = getCompatibleNodeActions('videoGen');

    expect(actions.find((action) => action.id === 'extract-frame')).toMatchObject({
      label: 'Extract frame',
      targetType: 'imageGen',
    });

    expect(actions.map((action) => action.id)).toContain('mix-with-audio');
    expect(actions.find((action) => action.id === 'mix-with-audio')).toMatchObject({
      label: 'Mix with audio',
      targetType: 'composition',
      targetHandle: 'composition-video',
    });
  });

  it('offers animate-to-video from image outputs', () => {
    const actions = getCompatibleNodeActions('imageGen');

    expect(actions.find((action) => action.id === 'edit-image')).toMatchObject({
      label: 'Edit image',
      targetType: 'imageGen',
      targetHandle: 'image-edit-source',
    });

    expect(actions.find((action) => action.id === 'reference-image')).toMatchObject({
      label: 'Reference image',
      targetType: 'imageGen',
      targetHandle: 'image-reference-1',
    });

    expect(actions.find((action) => action.id === 'use-as-mask')).toMatchObject({
      label: 'Use as mask',
      targetType: 'imageGen',
      targetHandle: 'image-mask',
    });

    expect(actions.find((action) => action.id === 'animate-to-video')).toMatchObject({
      label: 'Animate to video',
      targetType: 'videoGen',
      targetHandle: 'video-start-frame',
    });

    expect(actions.find((action) => action.id === 'collect-in-bin')).toMatchObject({
      label: 'Collect in source bin',
      targetType: 'sourceBin',
    });

    expect(actions.find((action) => action.id === 'add-to-list')).toMatchObject({
      label: 'Add to list',
      targetType: 'list',
      targetHandle: 'list-item-0',
    });
  });

  it('offers composition from audio outputs', () => {
    const actions = getCompatibleNodeActions('audioGen');

    expect(actions.find((action) => action.id === 'mix-with-video')).toMatchObject({
      label: 'Mix with video',
      targetType: 'composition',
      targetHandle: 'composition-audio-1',
    });

    expect(actions.find((action) => action.id === 'collect-in-bin')).toMatchObject({
      label: 'Collect in source bin',
      targetType: 'sourceBin',
    });
  });

  it('offers source-bin collection from composition outputs', () => {
    const actions = getCompatibleNodeActions('composition');

    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'collect-in-bin',
        label: 'Collect in source bin',
        targetType: 'sourceBin',
      }),
      expect.objectContaining({
        id: 'add-to-list',
        label: 'Add to list',
        targetType: 'list',
      }),
    ]));
  });
});
