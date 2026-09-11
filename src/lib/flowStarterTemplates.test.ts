// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  FLOW_STARTER_TEMPLATES,
  STARTER_TEMPLATE_MIN_INTERNAL_CLEARANCE,
  STARTER_TEMPLATE_NODE_BOX,
  buildStarterTemplateInsertPayload,
  findFlowStarterTemplates,
  getFlowStarterTemplate,
  getStarterTemplateBounds,
  getStarterTemplatePreviewModel,
  resolveCollisionFreeTemplatePosition,
  starterTemplateDescription,
  starterTemplateLabel,
  starterTemplateNodeCount,
  starterTemplateRunRequirement,
  validateAllFlowStarterTemplates,
  validateFlowStarterTemplate,
  type FlowStarterTemplate,
} from './flowStarterTemplates';

const NODE_BOX = STARTER_TEMPLATE_NODE_BOX;
const boxAt = (anchor: { x: number; y: number }, position: { x: number; y: number }) => ({
  x: anchor.x + position.x,
  y: anchor.y + position.y,
  width: NODE_BOX.width,
  height: NODE_BOX.height,
});
const boxesOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + b.height;

describe('flow starter template catalog', () => {
  it('ships a non-trivial set of starter templates with complete metadata', () => {
    expect(FLOW_STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const template of FLOW_STARTER_TEMPLATES) {
      expect(template.id).toMatch(/^[a-z0-9-]+$/);
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(20);
      expect(template.titleJa?.length ?? 0).toBeGreaterThan(0);
      expect(template.descriptionJa?.length ?? 0).toBeGreaterThan(0);
      expect(template.tags.length).toBeGreaterThan(0);
      expect(template.nodes.length).toBeGreaterThanOrEqual(2);
      expect(template.edges.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('validates every template graph against the real node catalog and connection contracts', () => {
    const result = validateAllFlowStarterTemplates();
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('validates each individual template and reports useful issues for a broken one', () => {
    for (const template of FLOW_STARTER_TEMPLATES) {
      expect(validateFlowStarterTemplate(template).valid).toBe(true);
    }

    const broken: FlowStarterTemplate = {
      id: 'broken',
      title: 'Broken',
      description: 'A broken template used only by this test.',
      tags: ['test'],
      nodes: [
        { key: 'a', type: 'textNode', position: { x: 0, y: 0 } },
        { key: 'b', type: 'mathNode', position: { x: 400, y: 0 } },
      ],
      edges: [
        { from: 'a', to: 'b', toHandle: 'A' },
      ],
    };
    const result = validateFlowStarterTemplate(broken);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes('connection contract'))).toBe(true);
  });

  it('finds templates by English and Japanese text and tags', () => {
    expect(findFlowStarterTemplates('video').map((t) => t.id)).toContain('image-to-video');
    expect(findFlowStarterTemplates('パレット').map((t) => t.id)).toContain('palette-consistency');
    expect(findFlowStarterTemplates('lighthouse-not-a-tag')).toEqual([]);
    expect(findFlowStarterTemplates('')).toHaveLength(FLOW_STARTER_TEMPLATES.length);
  });

  it('localizes labels and descriptions', () => {
    const template = getFlowStarterTemplate('text-to-image');
    expect(template).toBeDefined();
    expect(starterTemplateLabel(template!, 'en')).toBe('Text to image');
    expect(starterTemplateLabel(template!, 'ja')).toBe('テキストから画像へ');
    expect(starterTemplateDescription(template!, 'ja')).not.toBe(starterTemplateDescription(template!, 'en'));
  });

  it('builds an insert payload keyed for the store insertTemplate action', () => {
    const template = getFlowStarterTemplate('prompt-builder')!;
    const payload = buildStarterTemplateInsertPayload(template);
    expect(payload.nodes.map((node) => node.id)).toEqual(template.nodes.map((node) => node.key));
    const nodeIds = new Set(payload.nodes.map((node) => node.id));
    for (const edge of payload.edges) {
      expect(nodeIds.has(edge.source as string)).toBe(true);
      expect(nodeIds.has(edge.target as string)).toBe(true);
    }
    expect(payload.edges.some((edge) => edge.targetHandle === 'A')).toBe(true);
    for (const node of payload.nodes) {
      expect(Number.isFinite(node.position?.x)).toBe(true);
      expect(Number.isFinite(node.position?.y)).toBe(true);
    }
  });
});

describe('collision-free template placement', () => {
  const template = getFlowStarterTemplate('text-to-image')!;
  const bounds = getStarterTemplateBounds(template);
  expect(bounds.width).toBeGreaterThan(0);

  it('returns the requested position when the canvas area is free', () => {
    const resolved = resolveCollisionFreeTemplatePosition(template, [], { x: 100, y: 50 });
    expect(resolved).toEqual({ x: 100, y: 50 });
  });

  it('shifts the template right until its box clears every existing node box', () => {
    const existing = [
      { position: { x: 0, y: 0 } },
      { position: { x: 380, y: 120 } },
    ];
    const resolved = resolveCollisionFreeTemplatePosition(template, existing, { x: 40, y: 20 });
    const placed = { ...resolved, width: bounds.width, height: bounds.height };
    for (const node of existing) {
      const box = { ...node.position, width: 340, height: 280 };
      const overlaps = placed.x < box.x + box.width
        && box.x < placed.x + placed.width
        && placed.y < box.y + box.height
        && box.y < placed.y + placed.height;
      expect(overlaps).toBe(false);
    }
  });

  it('places two consecutive inserts of the same template without any node boxes overlapping', () => {
    const nodeBoxAt = (anchor: { x: number; y: number }, index: number) => {
      const node = template.nodes[index];
      return {
        x: anchor.x + node.position.x,
        y: anchor.y + node.position.y,
        width: 340,
        height: 280,
      };
    };
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

    const first = resolveCollisionFreeTemplatePosition(template, [], { x: 200, y: 200 });
    // The first insert's nodes are on the canvas as individual node boxes.
    const firstNodeBoxes = template.nodes.map((_, index) => nodeBoxAt(first, index));
    const firstInsertAsCanvasNodes = firstNodeBoxes.map((box) => ({ position: { x: box.x, y: box.y } }));
    const second = resolveCollisionFreeTemplatePosition(template, firstInsertAsCanvasNodes, { x: 200, y: 200 });
    const secondNodeBoxes = template.nodes.map((_, index) => nodeBoxAt(second, index));
    for (const firstBox of firstNodeBoxes) {
      for (const secondBox of secondNodeBoxes) {
        expect(overlaps(firstBox, secondBox)).toBe(false);
      }
    }
  });

  it('stays deterministic on a densely occupied canvas and never returns an overlapping position', () => {
    const dense = Array.from({ length: 80 }, (_, index) => ({
      position: { x: (index % 10) * 400, y: Math.floor(index / 10) * 400 },
    }));
    const first = resolveCollisionFreeTemplatePosition(template, dense, { x: 0, y: 0 });
    const second = resolveCollisionFreeTemplatePosition(template, dense, { x: 0, y: 0 });
    expect(first).toEqual(second);
    expect(Number.isFinite(first.x)).toBe(true);
    expect(Number.isFinite(first.y)).toBe(true);
    // The June Park verdict requires the dense result to be collision-free,
    // not merely finite: every template node box must clear every existing box.
    const placed = { ...first, width: bounds.width, height: bounds.height };
    for (const node of dense) {
      expect(boxesOverlap(placed, { ...node.position, width: NODE_BOX.width, height: NODE_BOX.height })).toBe(false);
    }
  });

  it('keeps scanning past the old 8x5 window when every scanned cell is blocked', () => {
    // Forty blockers on the exact 8-column x 5-row scan lattice block every
    // cell the old resolver visited, and one more blocker sits on the exact
    // candidate the old resolver fell back to (requested.x, requested.y + 5
    // rows). The repaired search must continue down the canvas and return a
    // position that clears every existing box.
    const blockers: { position: { x: number; y: number } }[] = [];
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        blockers.push({ position: { x: column * 400, y: row * 400 } });
      }
    }
    blockers.push({ position: { x: 0, y: 2000 } });
    const resolved = resolveCollisionFreeTemplatePosition(template, blockers, { x: 0, y: 0 });
    const placed = { ...resolved, width: bounds.width, height: bounds.height };
    for (const node of blockers) {
      expect(boxesOverlap(placed, { ...node.position, width: NODE_BOX.width, height: NODE_BOX.height })).toBe(false);
    }
    // Deterministic for identical inputs.
    expect(resolveCollisionFreeTemplatePosition(template, blockers, { x: 0, y: 0 })).toEqual(resolved);
  });

  it('ignores non-finite existing positions instead of failing the search', () => {
    const resolved = resolveCollisionFreeTemplatePosition(
      template,
      [{ position: { x: Number.NaN, y: Number.NaN } }],
      { x: 10, y: 10 },
    );
    expect(resolved).toEqual({ x: 10, y: 10 });
  });
});

describe('starter template internal geometry', () => {
  it('keeps every pair of node boxes in every recipe clear of each other under the placement estimate', () => {
    for (const template of FLOW_STARTER_TEMPLATES) {
      for (let a = 0; a < template.nodes.length; a += 1) {
        for (let b = a + 1; b < template.nodes.length; b += 1) {
          const first = template.nodes[a];
          const second = template.nodes[b];
          const firstBox = boxAt({ x: 0, y: 0 }, first.position);
          const secondBox = boxAt({ x: 0, y: 0 }, second.position);
          expect(boxesOverlap(firstBox, secondBox)).toBe(false);
          const gapX = first.position.x <= second.position.x
            ? secondBox.x - (firstBox.x + firstBox.width)
            : firstBox.x - (secondBox.x + secondBox.width);
          const gapY = first.position.y <= second.position.y
            ? secondBox.y - (firstBox.y + firstBox.height)
            : firstBox.y - (secondBox.y + secondBox.height);
          expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(STARTER_TEMPLATE_MIN_INTERNAL_CLEARANCE);
        }
      }
    }
  });

  it('fails template validation when two authored nodes overlap their estimated boxes', () => {
    const overlapping: FlowStarterTemplate = {
      id: 'overlapping',
      title: 'Overlapping',
      description: 'Two stacked nodes placed closer than one node box.',
      tags: ['test'],
      nodes: [
        { key: 'a', type: 'valueNode', position: { x: 0, y: 0 }, data: { valueKind: 'number', value: 1 } },
        { key: 'b', type: 'valueNode', position: { x: 0, y: 120 }, data: { valueKind: 'number', value: 2 } },
        { key: 'sum', type: 'mathNode', position: { x: 400, y: 0 }, data: { operation: '+' } },
      ],
      edges: [
        { from: 'a', to: 'sum', toHandle: 'A' },
        { from: 'b', to: 'sum', toHandle: 'B' },
      ],
    };
    const result = validateFlowStarterTemplate(overlapping);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes('Nodes a and b overlap'))).toBe(true);
  });
});

describe('starter template run requirements', () => {
  it('marks recipes containing generator nodes as provider-dependent and the rest as local', () => {
    for (const template of FLOW_STARTER_TEMPLATES) {
      const requirement = starterTemplateRunRequirement(template);
      const hasGenerator = template.nodes.some((node) =>
        node.type === 'imageGen' || node.type === 'videoGen' || node.type === 'audioGen');
      expect(requirement).toBe(hasGenerator ? 'provider' : 'local');
    }
    // The two documented no-key recipes stay local.
    expect(starterTemplateRunRequirement(getFlowStarterTemplate('local-calculator')!)).toBe('local');
    expect(starterTemplateRunRequirement(getFlowStarterTemplate('text-extract-count')!)).toBe('local');
    // Every provider-dependent recipe actually contains a generator node.
    for (const template of FLOW_STARTER_TEMPLATES) {
      if (starterTemplateRunRequirement(template) === 'provider') {
        expect(template.nodes.some((node) => node.type === 'imageGen' || node.type === 'videoGen')).toBe(true);
      }
    }
  });
});

describe('starter template preview model', () => {
  it('produces an in-bounds miniature graph for every template', () => {
    for (const template of FLOW_STARTER_TEMPLATES) {
      const model = getStarterTemplatePreviewModel(template);
      expect(model.width).toBeGreaterThan(0);
      expect(model.height).toBeGreaterThan(0);
      expect(model.nodes).toHaveLength(template.nodes.length);
      for (const node of model.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.x + node.width).toBeLessThanOrEqual(model.width);
        expect(node.y + node.height).toBeLessThanOrEqual(model.height);
        expect(node.color).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(model.edges).toHaveLength(template.edges.length);
      for (const edge of model.edges) {
        expect(edge.x1).toBeGreaterThanOrEqual(0);
        expect(edge.x2).toBeLessThanOrEqual(model.width);
        expect(edge.y1).toBeGreaterThanOrEqual(0);
        expect(edge.y2).toBeLessThanOrEqual(model.height);
      }
      expect(starterTemplateNodeCount(template)).toBe(template.nodes.length);
    }
  });
});
