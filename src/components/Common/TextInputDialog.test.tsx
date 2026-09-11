import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTextInputDialogStore } from '../../store/textInputDialogStore';
import { TextInputDialog, TextInputDialogView } from './TextInputDialog';

describe('TextInputDialog', () => {
  beforeEach(() => {
    useTextInputDialogStore.setState({ activeRequest: null });
  });

  it('renders a themed text-entry dialog when a request is active', () => {
    const html = renderToStaticMarkup(
      <TextInputDialogView
        request={{
        id: 'request-1',
        title: 'Rename Source Bin',
        message: 'Rename "Source Library".',
        label: 'Bin name',
        initialValue: 'Source Library',
        confirmLabel: 'Rename',
        resolve: () => undefined,
        }}
        respond={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Rename Source Bin"');
    expect(html).toContain('Rename &quot;Source Library&quot;.');
    expect(html).toContain('Bin name');
    expect(html).toContain('Rename');
    expect(html).toContain('Cancel');
  });

  it('does not render while closed', () => {
    const html = renderToStaticMarkup(<TextInputDialog />);

    expect(html).toBe('');
  });
});
