import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FunctionLibraryDrawer } from './FunctionLibraryDrawer';
import { SEQUENTIAL_ART_LIBRARY_FUNCTIONS } from '../../lib/standardLibrary';

describe('FunctionLibraryDrawer', () => {
  it('renders searchable built-in function descriptions and custom functions', () => {
    const html = renderToStaticMarkup(
      <FunctionLibraryDrawer
        builtInFunctions={SEQUENTIAL_ART_LIBRARY_FUNCTIONS}
        customFunctions={[
          {
            id: 'custom-1',
            name: 'My Custom Function',
            description: 'A reusable project function.',
            usage: 'Connect inputs, then run the collapsed node.',
            tags: ['custom'],
            source: 'custom',
            inputPorts: [],
            outputPorts: [],
            nodes: [],
            edges: [],
          },
        ]}
        onClose={() => undefined}
        onInsertBuiltIn={() => undefined}
        onInsertCustom={() => undefined}
        open
      />,
    );

    expect(html).toContain('Function Library');
    expect(html).toContain('Search functions');
    expect(html).toContain('Expression Batch Prompter');
    expect(html).toContain('My Custom Function');
  });
});
