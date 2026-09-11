import { getAutomationValueAtLocalTime } from './clipAutomation';
import { audioKeyframesToVolumeAutomation } from './editorKeyframes';
import { isAudioTrackAudible } from './editorAudioMix';
import type { AudioTimelineBlock } from './manualEditorTimeline';
import { evaluateProfessionalVideoParameter } from './videoParamKeyframes';
import type { ProfessionalAudioBus } from '../types/videoProfessional';
import {
  createVideoAudioMixerRoutingModel,
  resolveVideoAudioMixerRoutes,
} from './videoAudioMixer';

export const PROGRAM_MEDIA_DRIFT_TOLERANCE_SECONDS = 0.18;

export interface ProgramAudioPlaybackItem {
  id: string;
  src: string;
  sourceTimeSeconds: number;
  /** HTML media-element fallback level, clipped to the platform's [0, 1] range. */
  volume: number;
  /** Web Audio gain retains the persisted bus gain range for supported browsers. */
  gain: number;
  /** Shared bounded selected-clip plus bus stereo position. */
  pan: number;
}

export interface ProgramAudioPlaybackPlan {
  items: ProgramAudioPlaybackItem[];
  mixerError?: string;
}

export interface ProgramAudioPlaybackInput {
  audioBlocks: AudioTimelineBlock[];
  playheadSeconds: number;
  trackVolumes: number[];
  mutedTracks: number[];
  soloTracks: number[];
  audioMixerBuses?: ProfessionalAudioBus[];
}

export function buildProgramAudioPlaybackItems(input: ProgramAudioPlaybackInput): ProgramAudioPlaybackItem[] {
  return buildProgramAudioPlaybackPlan(input).items;
}

/** Resolves the same persisted bus route used by export before constructing active monitor items. */
export function buildProgramAudioPlaybackPlan({
  audioBlocks,
  playheadSeconds,
  trackVolumes,
  mutedTracks,
  soloTracks,
  audioMixerBuses,
}: ProgramAudioPlaybackInput): ProgramAudioPlaybackPlan {
  const routing = audioMixerBuses === undefined
    ? undefined
    : resolveVideoAudioMixerRoutes(createVideoAudioMixerRoutingModel({
        buses: audioMixerBuses,
        tracks: audioBlocks.map((block) => ({
          id: block.clip.id,
          pan: block.clip.professional?.pan,
          busId: block.clip.professional?.busId,
        })),
      }));
  if (routing && !routing.ok) {
    return { items: [], mixerError: routing.reason };
  }
  const routeByClipId = new Map(routing?.routes.map((route) => [route.id, route]));
  const items = audioBlocks.flatMap((block) => {
    const { clip, item } = block;

    if (
      !item?.assetUrl
      || !clip.enabled
      || !isAudioTrackAudible(clip.trackIndex, mutedTracks, soloTracks)
      || playheadSeconds < block.startSeconds
      || playheadSeconds >= block.endSeconds
    ) {
      return [];
    }

    const localTimeSeconds = Math.max(0, playheadSeconds - block.startSeconds);
    const sourceTimeSeconds = Math.max(0, (clip.sourceInMs ?? 0) / 1_000 + localTimeSeconds);
    const automationPoints = clip.volumeKeyframes?.length
      ? audioKeyframesToVolumeAutomation(clip)
      : clip.volumeAutomationPoints;
    const automationPercent = clip.professional?.parameterKeyframes?.some((track) => track.parameter === 'volume')
      ? evaluateProfessionalVideoParameter(
          clip.professional.parameterKeyframes,
          'volume',
          localTimeSeconds * 1_000,
          { defaultValue: clip.volumePercent, minValue: 0 },
        )
      : getAutomationValueAtLocalTime(
          automationPoints,
          localTimeSeconds,
          block.durationSeconds,
          clip.volumePercent,
        );
    const fadeFactor = resolveProgramAudioFadeFactor(
      localTimeSeconds,
      block.durationSeconds,
      clip.fadeInSeconds,
      clip.fadeOutSeconds,
    );
    const levelMatchFactor = 10 ** ((clip.measuredMatchGainDb ?? 0) / 20);
    const trackFactor = Math.max(0, trackVolumes[clip.trackIndex] ?? 100) / 100;
    const baseGain = clamp01((automationPercent / 100) * trackFactor * fadeFactor * levelMatchFactor);
    const route = routeByClipId.get(clip.id);
    if (routing && (!route || !route.audible)) return [];
    const gain = Math.max(0, Math.min(16, baseGain * (route ? 10 ** (route.gainDb / 20) : 1)));

    return [{
      id: clip.id,
      src: item.assetUrl,
      sourceTimeSeconds,
      volume: clamp01(gain),
      gain,
      pan: route?.pan ?? 0,
    }];
  }).slice(0, 64);
  return { items };
}

export function resolveProgramAudioFadeFactor(
  localTimeSeconds: number,
  durationSeconds: number,
  fadeInSeconds?: number,
  fadeOutSeconds?: number,
): number {
  const safeDuration = Math.max(0, durationSeconds);
  const local = Math.max(0, Math.min(safeDuration, localTimeSeconds));
  const fadeIn = Math.max(0, Math.min(safeDuration / 2, fadeInSeconds ?? 0));
  const fadeOut = Math.max(0, Math.min(safeDuration / 2, fadeOutSeconds ?? 0));
  const fadeInFactor = fadeIn > 0 ? Math.min(1, local / fadeIn) : 1;
  const fadeOutFactor = fadeOut > 0 ? Math.min(1, (safeDuration - local) / fadeOut) : 1;
  return clamp01(Math.min(fadeInFactor, fadeOutFactor));
}

export function shouldCorrectProgramMediaTime(
  currentTimeSeconds: number,
  targetTimeSeconds: number,
  playing: boolean,
): boolean {
  if (!Number.isFinite(currentTimeSeconds) || !Number.isFinite(targetTimeSeconds)) {
    return false;
  }

  const tolerance = playing ? PROGRAM_MEDIA_DRIFT_TOLERANCE_SECONDS : 0.01;
  return Math.abs(currentTimeSeconds - targetTimeSeconds) > tolerance;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
