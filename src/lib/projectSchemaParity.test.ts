import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FLOW_NODE_CATALOG_ENTRIES } from './nodeCatalog';
import { FLOW_NODE_TYPES } from './projectSchema';
import { FLOW_NODE_TYPES as FLOW_NODE_TYPE_VALUES } from '../types/flow';

const repoRoot = resolve(__dirname, '../..');

function readProjectFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function extractReactFlowNodeTypeMap(): string[] {
  const source = readProjectFile('src/App.tsx');
  const match = source.match(/const nodeTypes = \{([\s\S]*?)\n\}(?: satisfies [^;]+)?;/);
  expect(match, 'App nodeTypes map must be parsable for schema parity checks').not.toBeNull();

  return [...(match?.[1] ?? '').matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((entry) => entry[1]);
}

function extractFunctionSwitchCases(path: string, functionName: string): string[] {
  const source = readProjectFile(path);
  const start = source.indexOf(`function ${functionName}`);
  expect(start, `${functionName} must be parsable for schema parity checks`).toBeGreaterThanOrEqual(0);

  const tail = source.slice(start);
  const nextFunction = tail.slice(1).search(/\n(?:export\s+)?function\s+/);
  const functionSource = nextFunction === -1 ? tail : tail.slice(0, nextFunction + 1);

  return [...functionSource.matchAll(/case '([^']+)':/g)].map((entry) => entry[1]);
}

function readSchemaManifest(): { schemaVersion: number; flowNodeTypes: string[] } {
  return JSON.parse(readProjectFile('shared/project-schema.json')) as {
    schemaVersion: number;
    flowNodeTypes: string[];
  };
}

describe('Flow node schema parity', () => {
  it('uses one shared schema manifest for renderer and Electron Flow node validation', async () => {
    const manifest = readSchemaManifest();
    // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
    const electronSchema = await import('../../electron/project-schema.cjs') as {
      CURRENT_PROJECT_SCHEMA_VERSION: number;
      FLOW_NODE_TYPES: string[];
    };

    expect(manifest.schemaVersion).toBe(1);
    expect(FLOW_NODE_TYPES).toEqual(manifest.flowNodeTypes);
    expect(electronSchema.CURRENT_PROJECT_SCHEMA_VERSION).toBe(manifest.schemaVersion);
    expect(electronSchema.FLOW_NODE_TYPES).toEqual(manifest.flowNodeTypes);
  });

  it('keeps FlowNodeType, schema, catalog, and React Flow renderers in lockstep', () => {
    const manifest = readSchemaManifest();
    const flowNodeTypeValues = [...FLOW_NODE_TYPE_VALUES];
    const catalogNodeTypes = FLOW_NODE_CATALOG_ENTRIES.map((entry) => entry.type);
    const reactFlowNodeTypes = extractReactFlowNodeTypeMap();

    expect(new Set(manifest.flowNodeTypes).size).toBe(manifest.flowNodeTypes.length);
    expect(manifest.flowNodeTypes).toEqual(flowNodeTypeValues);
    expect(new Set(catalogNodeTypes)).toEqual(new Set(manifest.flowNodeTypes));
    expect(new Set(reactFlowNodeTypes)).toEqual(new Set(manifest.flowNodeTypes));
  });

  it('keeps helper node display labels aligned with every schema node type', () => {
    const manifest = readSchemaManifest();
    const expectedNodeTypes = new Set(manifest.flowNodeTypes);
    const helperSwitches = [
      {
        path: 'src/components/Nodes/VirtualNode.tsx',
        functionName: 'getDefaultNodeTitle',
      },
      {
        path: 'src/lib/nodeBookmarks.ts',
        functionName: 'getNodeTypeLabel',
      },
      {
        path: 'src/lib/sourceBin.ts',
        functionName: 'getEnvelopeSourceLabel',
      },
    ];

    for (const helperSwitch of helperSwitches) {
      const cases = extractFunctionSwitchCases(helperSwitch.path, helperSwitch.functionName);
      expect(new Set(cases).size, `${helperSwitch.functionName} must not contain duplicate labels`).toBe(cases.length);
      expect(new Set(cases), `${helperSwitch.functionName} must label every Flow node type`).toEqual(expectedNodeTypes);
    }
  });
});
