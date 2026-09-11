import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DecodedFrameScopesPanel } from './DecodedFrameScopesPanel';

describe('DecodedFrameScopesPanel', () => {
  it('is a mounted Program Monitor control with an explicit rendered-preview boundary', () => {
    const html = renderToStaticMarkup(
      <DecodedFrameScopesPanel
        hasPlayablePreview={false}
        isImageSequenceOutput={false}
        isRenderedPreview={false}
        videoRef={createRef<HTMLVideoElement>()}
      />,
    );
    expect(html).toContain('Decoded frame scopes');
    expect(html).toContain('data-video-decoded-scopes="unavailable"');
    expect(html).toContain('Switch the Program Monitor to Rendered Preview');
    expect(html).toContain('disabled=""');
  });

  it('enables only a playable rendered-preview measurement and states that it is explicit', () => {
    const html = renderToStaticMarkup(
      <DecodedFrameScopesPanel
        hasPlayablePreview
        isImageSequenceOutput={false}
        isRenderedPreview
        videoRef={createRef<HTMLVideoElement>()}
      />,
    );
    expect(html).toContain('data-video-decoded-scopes="idle"');
    expect(html).toContain('data-video-measure-decoded-scopes="true"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('runs only when you select Measure frame');
  });

  it('refuses an image-sequence archive because it has no decoded video monitor frame', () => {
    const html = renderToStaticMarkup(
      <DecodedFrameScopesPanel
        hasPlayablePreview
        isImageSequenceOutput
        isRenderedPreview
        videoRef={createRef<HTMLVideoElement>()}
      />,
    );
    expect(html).toContain('data-video-decoded-scopes="unavailable"');
    expect(html).toContain('image-sequence archive has no mounted decoded Program Monitor video');
  });
});
