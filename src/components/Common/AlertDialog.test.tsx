import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAlertDialogStore } from '../../store/alertDialogStore';
import { AlertDialog, AlertDialogView } from './AlertDialog';

describe('AlertDialog', () => {
  beforeEach(() => {
    useAlertDialogStore.setState({ activeRequest: null });
  });

  it('renders a themed alert dialog when a request is active', () => {
    const html = renderToStaticMarkup(
      <AlertDialogView
        request={{
          id: 'alert-1',
          title: 'Open Project Failed',
          message: 'The selected project file could not be opened.',
          confirmLabel: 'Dismiss',
          tone: 'danger',
          resolve: () => undefined,
        }}
        respond={() => undefined}
      />,
    );

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-label="Open Project Failed"');
    expect(html).toContain('The selected project file could not be opened.');
    expect(html).toContain('Dismiss');
  });

  it('does not render while closed', () => {
    const html = renderToStaticMarkup(<AlertDialog />);

    expect(html).toBe('');
  });
});
