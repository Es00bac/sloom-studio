import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NodeContractHelp } from './NodeContractHelp';

describe('NodeContractHelp', () => {
  it('shows purpose, typed ports, failure guidance, and an example use case', () => {
    const html = renderToStaticMarkup(<NodeContractHelp nodeType="cropImageNode" />);

    expect(html).toContain('Crop one connected image locally');
    expect(html).toContain('Input');
    expect(html).toContain('Image · image/package/envelope&lt;image&gt;/envelope&lt;package&gt;/envelope&lt;mixed&gt; · required');
    expect(html).toContain('Output');
    expect(html).toContain('Cropped image · image');
    expect(html).toContain('Execution is blocked when required inputs are missing');
    expect(html).toContain('Crop Image example');
  });

  it('explains model-disabled ports instead of hiding them', () => {
    const html = renderToStaticMarkup(
      <NodeContractHelp
        initialData={{ provider: 'stability', modelId: 'stable-image-core' }}
        nodeType="imageGen"
      />,
    );

    expect(html).toContain('Reference 1 · image/package/envelope&lt;image&gt;/envelope&lt;package&gt;/envelope&lt;mixed&gt;/text/json · unavailable');
    expect(html).toContain('does not support reference images');
  });
});
