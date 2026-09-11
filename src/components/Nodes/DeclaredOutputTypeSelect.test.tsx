import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DeclaredOutputTypeSelect } from './DeclaredOutputTypeSelect';

describe('DeclaredOutputTypeSelect', () => {
  it('warns that an undeclared flexible output cannot be connected as a typed value', () => {
    const html = renderToStaticMarkup(
      <DeclaredOutputTypeSelect
        allowedTypes={['text', 'number', 'json']}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Output type');
    expect(html).toContain('Unspecified — typed output blocked');
    expect(html).toContain('Choose the type this node promises to return');
    expect(html).toContain('<option value="json">JSON</option>');
    expect(html).not.toContain('<option value="image">Image</option>');
  });

  it('shows the declared selection without the blocking warning', () => {
    const html = renderToStaticMarkup(
      <DeclaredOutputTypeSelect
        allowedTypes={['text', 'json']}
        onChange={vi.fn()}
        value="json"
      />,
    );

    expect(html).toContain('<option value="json" selected="">JSON</option>');
    expect(html).not.toContain('Choose the type this node promises to return');
  });
});
