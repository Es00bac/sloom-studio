import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AttemptHistory } from './AttemptHistory';

describe('AttemptHistory variable assignment', () => {
  it('renders a variable-name input for the selected generated attempt', () => {
    const html = renderToStaticMarkup(
      <AttemptHistory
        attempts={[{
          id: 'attempt-1',
          result: 'Generated prompt',
          resultType: 'text',
          statusMessage: 'Generated',
          createdAt: '2026-06-03T12:00:00.000Z',
          variableName: 'hero_prompt',
        }]}
        onAssignVariable={() => undefined}
        selectedAttemptId="attempt-1"
      />,
    );

    expect(html).toContain('value="hero_prompt"');
    expect(html).toContain('placeholder="variable_name"');
  });

  it.each([true, false])('never renders Boolean %s as an image or video URL', (decision) => {
    const html = renderToStaticMarkup(
      <AttemptHistory
        attempts={[{
          id: 'invalid-media', result: decision, resultType: 'image', statusMessage: 'Invalid', createdAt: '2026-07-16T00:00:00.000Z',
        }, {
          id: 'other-media', result: 'data:image/png;base64,AA==', resultType: 'image', statusMessage: 'Other', createdAt: '2026-07-16T00:01:00.000Z',
        }]}
        onSelectAttempt={() => undefined}
        selectedAttemptId="invalid-media"
      />,
    );

    expect(html).not.toContain(`src="${decision}"`);
    expect(html).toContain('>R1<');
  });
});
