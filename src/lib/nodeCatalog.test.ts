import { describe, expect, it } from 'vitest';
import {
  FLOW_NODE_CATALOG_ENTRIES,
  FLOW_NODE_CATALOG_CATEGORIES,
  findNodeCatalogEntries,
  getNodeCatalogEntry,
} from './nodeCatalog';
import { FLOW_NODE_TYPES } from './projectSchema';
import { FLOW_NODE_CONTRACTS } from './flowNodeContracts';

describe('node catalog', () => {
  it('groups core flow nodes by what they do', () => {
    expect(FLOW_NODE_CATALOG_CATEGORIES.map((category) => category.id)).toEqual([
      'generate',
      'inputs-data',
      'lists-envelopes',
      'flow-control',
      'logic-math',
      'text-tools',
      'story-tools',
      'reuse-layout',
      'monitor-debug',
      'settings',
    ]);
    expect(getNodeCatalogEntry('loopBreakNode')).toMatchObject({
      categoryId: 'flow-control',
      label: 'Stop When',
    });
    expect(getNodeCatalogEntry('valueNode')).toMatchObject({
      categoryId: 'inputs-data',
      label: 'Value',
    });
    expect(getNodeCatalogEntry('colorSwatchNode')).toMatchObject({
      categoryId: 'inputs-data',
      label: 'Color Palette',
    });
    expect(getNodeCatalogEntry('cropImageNode')).toMatchObject({
      categoryId: 'inputs-data',
      label: 'Crop Image',
    });
  });

  it('has one catalog entry for every durable Flow node type', () => {
    const catalogNodeTypes = FLOW_NODE_CATALOG_ENTRIES.map((entry) => entry.type);

    expect(new Set(catalogNodeTypes).size).toBe(catalogNodeTypes.length);
    expect(new Set(catalogNodeTypes)).toEqual(new Set(FLOW_NODE_TYPES));
  });

  it('searches node labels, descriptions, and tags', () => {
    expect(findNodeCatalogEntries('break').map((entry) => entry.type)).toContain('loopBreakNode');
    expect(findNodeCatalogEntries('primitive').map((entry) => entry.type)).toContain('valueNode');
    expect(findNodeCatalogEntries('template').map((entry) => entry.type)).toContain('stringTemplateNode');
    expect(findNodeCatalogEntries('palette').map((entry) => entry.type)).toContain('colorSwatchNode');
    expect(findNodeCatalogEntries('crop').map((entry) => entry.type)).toContain('cropImageNode');
  });

  it('uses the audited node contract purpose as the English catalog description', () => {
    for (const entry of FLOW_NODE_CATALOG_ENTRIES) {
      expect(entry.description).toBe(FLOW_NODE_CONTRACTS[entry.type].purpose);
    }
  });
});
