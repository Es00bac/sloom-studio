// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { VideoParamKeyframeTrack } from '../../../lib/videoParamKeyframes';
import type { TranscriptEditProposal, TranscriptSearchMatch } from '../../../lib/videoTranscriptEditing';
import { createVideoVoiceoverParagraph } from '../../../lib/videoVoiceoverAuthoring';
import {
  ParameterKeyframeEditor,
  TranscriptEditingPanel,
  VoiceoverSfxDialog,
  type VoiceoverSfxDialogProps,
} from './ProfessionalFinishingAuthoringControls';

const noop = () => undefined;

vi.hoisted(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

describe('professional finishing authoring controls', () => {
  it('renders an accessible parameter keyframe editor with typed automation controls', () => {
    const tracks: VideoParamKeyframeTrack[] = [{
      version: 1,
      id: 'opacity-track',
      parameterId: 'opacity',
      label: 'Opacity',
      unit: '%',
      defaultValue: 100,
      minValue: 0,
      maxValue: 100,
      keyframes: [
        { id: 'start', timeMs: 0, value: 0, interpolation: 'cubic-bezier', bezier: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
        { id: 'end', timeMs: 1_000, value: 100, interpolation: 'linear' },
      ],
    }];
    const markup = renderToStaticMarkup(
      <ParameterKeyframeEditor
        currentTimeMs={500}
        durationMs={1_000}
        onAddKeyframe={noop}
        onChangeKeyframe={noop}
        onRemoveKeyframe={noop}
        onSelectTrack={noop}
        selectedTrackId="opacity-track"
        tracks={tracks}
      />,
    );
    expect(markup).toContain('aria-label="Parameter keyframe editor"');
    expect(markup).toContain('aria-label="Automated parameter"');
    expect(markup).toContain('aria-label="Opacity keyframes"');
    expect(markup).toContain('aria-label="Keyframe 1 interpolation"');
    expect(markup).toContain('aria-label="Keyframe 1 cubic Bezier controls"');
    expect(markup).toContain('Add at playhead');
  });

  it('renders transcript search, navigable matches, and an explicitly atomic apply action', () => {
    const match: TranscriptSearchMatch = {
      wordStartIndex: 4,
      wordEndIndex: 5,
      startMs: 2_000,
      endMs: 3_000,
      text: 'remove this',
    };
    const proposal: TranscriptEditProposal = {
      title: 'Remove selection',
      ranges: [{ startMs: 2_000, endMs: 3_000, reason: 'transcript-selection' }],
      commands: [{ kind: 'ripple-delete', startMs: 2_000, endMs: 3_000, durationMs: 1_000, source: 'transcript' }],
      removedRangesAfter: [{ startMs: 2_000, endMs: 3_000, reason: 'transcript-selection' }],
    };
    const markup = renderToStaticMarkup(
      <TranscriptEditingPanel
        matches={[match]}
        onApplyProposal={noop}
        onClearSelection={noop}
        onPreviewProposal={noop}
        onQueryChange={noop}
        onSearch={noop}
        onSelectMatch={noop}
        pendingProposal={proposal}
        query="remove this"
        selectedRangeLabel="Words 5–6"
        wordCount={80_000}
      />,
    );
    expect(markup).toContain('aria-label="Transcript editing"');
    expect(markup).toContain('role="search"');
    expect(markup).toContain('aria-label="Transcript search results"');
    expect(markup).toContain('Preview timeline patch');
    expect(markup).toContain('Apply as one edit');
  });

  it('bounds the search input, and surfaces search errors and timeline preview results accessibly', () => {
    const markup = renderToStaticMarkup(
      <TranscriptEditingPanel
        matches={[]}
        onApplyProposal={noop}
        onClearSelection={noop}
        onPreviewProposal={noop}
        onQueryChange={noop}
        onSearch={noop}
        onSelectMatch={noop}
        pendingProposal={undefined}
        previewSummary="Transcript patch preview: 2 clips affected · 2 splits · removes 2.00 s"
        query="x"
        searchError="Transcript search queries are limited to 200 characters."
        wordCount={4}
      />,
    );
    expect(markup).toContain('maxLength="200"');
    const alerts = markup.match(/<p role="alert"[^>]*>([^<]+)<\/p>/gu) ?? [];
    expect(alerts.some((alert) => alert.includes('limited to 200 characters'))).toBe(true);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Transcript patch preview: 2 clips affected · 2 splits · removes 2.00 s');
  });

  it('enables preview from a selected range, then gates apply on the generated proposal', async () => {
    const match: TranscriptSearchMatch = {
      wordStartIndex: 0,
      wordEndIndex: 1,
      startMs: 1_000,
      endMs: 2_000,
      text: 'remove this',
    };
    const proposal: TranscriptEditProposal = {
      title: 'Remove selection',
      ranges: [{ startMs: 1_000, endMs: 2_000, reason: 'transcript-selection' }],
      commands: [{ kind: 'ripple-delete', startMs: 1_000, endMs: 2_000, durationMs: 1_000, source: 'transcript' }],
      removedRangesAfter: [{ startMs: 1_000, endMs: 2_000, reason: 'transcript-selection' }],
    };
    const onPreview = vi.fn();
    const onApply = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;
    const button = (label: string) => Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(label)) as HTMLButtonElement;

    function Harness() {
      const [selectedMatch, setSelectedMatch] = useState<TranscriptSearchMatch>();
      const [pendingProposal, setPendingProposal] = useState<TranscriptEditProposal>();
      return (
        <TranscriptEditingPanel
          matches={[match]}
          onApplyProposal={onApply}
          onClearSelection={() => { setSelectedMatch(undefined); setPendingProposal(undefined); }}
          onPreviewProposal={() => { onPreview(); setPendingProposal(proposal); }}
          onQueryChange={() => undefined}
          onSearch={() => undefined}
          onSelectMatch={(nextMatch) => { setSelectedMatch(nextMatch); setPendingProposal(undefined); }}
          pendingProposal={pendingProposal}
          query="remove this"
          selectedRangeLabel={selectedMatch ? 'Words 1–2' : undefined}
          wordCount={2}
        />
      );
    }

    try {
      root = createRoot(container);
      await act(async () => root?.render(<Harness />));
      expect(button('Preview timeline patch').disabled).toBe(true);
      expect(button('Apply as one edit').disabled).toBe(true);

      await act(async () => button('remove this')?.click());
      expect(button('Preview timeline patch').disabled).toBe(false);
      expect(button('Apply as one edit').disabled).toBe(true);

      await act(async () => button('Preview timeline patch')?.click());
      expect(onPreview).toHaveBeenCalledTimes(1);
      expect(button('Apply as one edit').disabled).toBe(false);

      await act(async () => button('Apply as one edit')?.click());
      expect(onApply).toHaveBeenCalledTimes(1);

      await act(async () => button('Clear selection')?.click());
      expect(button('Preview timeline patch').disabled).toBe(true);
      expect(button('Apply as one edit').disabled).toBe(true);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  it('requires rights and billing confirmation in the accessible generated-audio dialog', () => {
    const paragraph = createVideoVoiceoverParagraph({
      id: 'paragraph-1', text: 'Read this line.', languageCode: 'en', voiceId: 'voice-1',
    });
    const baseProps: VoiceoverSfxDialogProps = {
      open: true,
      mode: 'voiceover',
      providers: [{ providerId: 'optional-provider', modelId: 'voice-v1', label: 'Optional provider' }],
      selectedProviderId: 'optional-provider',
      draft: {
        paragraphText: paragraph.text,
        languageCode: paragraph.languageCode,
        voiceId: paragraph.voiceId,
        sfxPrompt: '',
        rangeStartMs: 0,
        rangeEndMs: 1_000,
      },
      paragraphs: [paragraph],
      rightsConfirmed: false,
      billingConfirmed: false,
      onClose: noop,
      onModeChange: noop,
      onProviderChange: noop,
      onDraftChange: noop,
      onRightsConfirmedChange: noop,
      onBillingConfirmedChange: noop,
      onGenerateVoiceover: noop,
      onGenerateRangeSfx: noop,
      onRegenerateParagraph: noop,
    };
    const blocked = renderToStaticMarkup(<VoiceoverSfxDialog {...baseProps} />);
    expect(blocked).toContain('role="dialog"');
    expect(blocked).toContain('aria-modal="true"');
    expect(blocked).toContain('Imported originals are never replaced.');
    expect(blocked).toContain('potentially billable provider request');
    expect(blocked).toMatch(/<button[^>]*disabled=""[^>]*>Generate voiceover with timestamps<\/button>/u);

    const approved = renderToStaticMarkup(<VoiceoverSfxDialog {...baseProps} billingConfirmed rightsConfirmed />);
    const approvedButton = approved.match(/<button[^>]*>Generate voiceover with timestamps<\/button>/u)?.[0];
    expect(approvedButton).toBeTruthy();
    expect(approvedButton).not.toContain(' disabled=""');
  });
});
