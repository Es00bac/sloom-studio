import type { AspectRatio, VideoResolution } from '../types/flow';

export interface VideoCanvasDimensions {
  width: number;
  height: number;
}

export function getAspectRatioValue(aspectRatio: AspectRatio): number {
  const [width, height] = aspectRatio.split(':').map((part) => Number(part));
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

export function getVideoCanvasDimensions(
  aspectRatio: AspectRatio,
  resolution: VideoResolution,
): VideoCanvasDimensions {
  switch (aspectRatio) {
    case '1:1':
      return {
        width: getSquareSizeForResolution(resolution),
        height: getSquareSizeForResolution(resolution),
      };
    case '9:16':
      return {
        width: getPortraitWidthForResolution(resolution),
        height: getPortraitHeightForResolution(resolution),
      };
    default:
      return {
        width: getLandscapeWidthForResolution(resolution),
        height: getLandscapeHeightForResolution(resolution),
      };
  }
}

function getLandscapeWidthForResolution(resolution: VideoResolution): number {
  switch (resolution) {
    case '4k':
      return 3840;
    case '1080p':
      return 1920;
    default:
      return 1280;
  }
}

function getLandscapeHeightForResolution(resolution: VideoResolution): number {
  switch (resolution) {
    case '4k':
      return 2160;
    case '1080p':
      return 1080;
    default:
      return 720;
  }
}

function getPortraitWidthForResolution(resolution: VideoResolution): number {
  switch (resolution) {
    case '4k':
      return 2160;
    case '1080p':
      return 1080;
    default:
      return 720;
  }
}

function getPortraitHeightForResolution(resolution: VideoResolution): number {
  switch (resolution) {
    case '4k':
      return 3840;
    case '1080p':
      return 1920;
    default:
      return 1280;
  }
}

function getSquareSizeForResolution(resolution: VideoResolution): number {
  switch (resolution) {
    case '4k':
      return 2160;
    case '1080p':
      return 1080;
    default:
      return 720;
  }
}
