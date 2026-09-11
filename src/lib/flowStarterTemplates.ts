import type { Edge } from '@xyflow/react';
import type { AppNode, FlowNodeType, NodeData } from '../types/flow';
import type { AppLocale } from './i18n';
import { validateFlowConnection } from './flowConnectionContracts';
import { getNodeCatalogEntry, type FlowNodeCatalogCategoryId } from './nodeCatalog';
import { DEFAULT_MODELS } from './providerCatalog';

/**
 * Built-in Flow starter templates (MH-094).
 *
 * A starter template is a small curated graph that teaches one Flow capability.
 * Every template is authored against the real node catalog and the typed
 * connection contracts: `validateFlowStarterTemplate` proves each edge resolves
 * through `validateFlowConnection` at definition time, and the store-level tests
 * prove the same templates survive real instantiation and save/reopen.
 */

export interface FlowStarterTemplateNode {
  /** Stable key unique within the template; remapped to a real node id at insertion. */
  key: string;
  type: FlowNodeType;
  /** Position relative to the insertion anchor. */
  position: { x: number; y: number };
  data?: Partial<NodeData>;
}

export interface FlowStarterTemplateEdge {
  from: string;
  fromHandle?: string | null;
  to: string;
  toHandle?: string | null;
}

export interface FlowStarterTemplate {
  id: string;
  title: string;
  titleJa?: string;
  description: string;
  descriptionJa?: string;
  tags: string[];
  nodes: FlowStarterTemplateNode[];
  edges: FlowStarterTemplateEdge[];
}

export interface FlowStarterTemplateInsertPayload {
  nodes: Partial<AppNode>[];
  edges: Partial<Edge>[];
}

const NODE_GAP_X = 60;

/** Minimum edge-to-edge clearance required between node boxes inside one
 * template under the `STARTER_TEMPLATE_NODE_BOX` placement estimate. */
export const STARTER_TEMPLATE_MIN_INTERNAL_CLEARANCE = 40;

export const FLOW_STARTER_TEMPLATES: readonly FlowStarterTemplate[] = [
  {
    id: 'text-to-image',
    title: 'Text to image',
    titleJa: 'テキストから画像へ',
    description: 'The simplest chain: write a prompt, generate the image. Connect a Text Prompt to an Image node and run.',
    descriptionJa: '最もシンプルな構成です。テキストプロンプトを書き、Image ノードに接続して実行します。',
    tags: ['image', 'prompt', 'basics', 'beginner'],
    nodes: [
      {
        key: 'prompt',
        type: 'textNode',
        position: { x: 0, y: 0 },
        data: { mode: 'prompt', prompt: 'A lighthouse on a cliff at dawn, cinematic lighting' },
      },
      { key: 'image', type: 'imageGen', position: { x: 440, y: -20 } },
    ],
    edges: [
      { from: 'prompt', fromHandle: null, to: 'image', toHandle: null },
    ],
  },
  {
    id: 'prompt-builder',
    title: 'Prompt builder',
    titleJa: 'プロンプトビルダー',
    description: 'Keep subject and style separate, then join them into one prompt. Edit the style once and every render follows.',
    descriptionJa: '被写体とスタイルを分けて保持し、1 つのプロンプトに結合します。スタイルを 1 箇所だけ編集すれば全出力に反映されます。',
    tags: ['prompt', 'text', 'join', 'image'],
    nodes: [
      {
        key: 'subject',
        type: 'textNode',
        position: { x: 0, y: -160 },
        data: { mode: 'prompt', prompt: 'A cozy reading nook with a sleeping cat' },
      },
      {
        key: 'style',
        type: 'textNode',
        position: { x: 0, y: 160 },
        data: { mode: 'prompt', prompt: 'warm watercolor illustration, soft edges' },
      },
      { key: 'joiner', type: 'promptsJoinerNode', position: { x: 440, y: 0 }, data: { delimiter: ', ' } },
      { key: 'image', type: 'imageGen', position: { x: 880, y: -20 } },
    ],
    edges: [
      { from: 'subject', fromHandle: null, to: 'joiner', toHandle: 'A' },
      { from: 'style', fromHandle: null, to: 'joiner', toHandle: 'B' },
      { from: 'joiner', fromHandle: null, to: 'image', toHandle: null },
    ],
  },
  {
    id: 'palette-consistency',
    title: 'Color palette consistency',
    titleJa: 'カラーパレットの一貫性',
    description: 'Lock a master palette, label the colors a scene actually uses, and feed both into the Image node so panels stay consistent.',
    descriptionJa: 'マスターパレットを固定し、シーンで使う色に名前を付けて、両方を Image ノードに渡します。これでコマごとの色の一貫性が保たれます。',
    tags: ['color', 'palette', 'consistency', 'image', 'comic'],
    nodes: [
      {
        key: 'palette',
        type: 'colorSwatchNode',
        position: { x: 0, y: -40 },
        data: { colorSwatchColors: ['#243b53', '#7ab6ff', '#ffd57a'] },
      },
      { key: 'swatch', type: 'colorSwatchListNode', position: { x: 440, y: -40 }, data: { colorSwatchLabel: 'Night harbor scene' } },
      {
        key: 'scene',
        type: 'textNode',
        position: { x: 0, y: 280 },
        data: { mode: 'prompt', prompt: 'A night harbor with fishing boats, quiet mood' },
      },
      { key: 'image', type: 'imageGen', position: { x: 880, y: 40 } },
    ],
    edges: [
      { from: 'palette', fromHandle: 'palette-color-0', to: 'swatch', toHandle: null },
      { from: 'swatch', fromHandle: null, to: 'image', toHandle: null },
      { from: 'scene', fromHandle: null, to: 'image', toHandle: null },
    ],
  },
  {
    id: 'batch-variations',
    title: 'Batch prompt variations',
    titleJa: 'プロンプトのバッチ生成',
    description: 'Collect two prompt variations in a typed envelope. The Image node renders each item, and the Source Bin keeps every result in the project.',
    descriptionJa: '2 つのプロンプトのバリエーションを型付きエンベロープに集めます。Image ノードが各アイテムを描画し、ソースビンが結果をプロジェクトに保存します。',
    tags: ['batch', 'envelope', 'variations', 'source bin'],
    nodes: [
      {
        key: 'variation-a',
        type: 'textNode',
        position: { x: 0, y: -160 },
        data: { mode: 'prompt', prompt: 'the hero standing in the rain, low angle' },
      },
      {
        key: 'variation-b',
        type: 'textNode',
        position: { x: 0, y: 160 },
        data: { mode: 'prompt', prompt: 'the hero standing in the rain, wide shot' },
      },
      { key: 'envelope', type: 'envelope', position: { x: 440, y: -40 }, data: { envelopeItemKind: 'text' } },
      { key: 'image', type: 'imageGen', position: { x: 880, y: -60 } },
      { key: 'bin', type: 'sourceBin', position: { x: 1320, y: -40 } },
    ],
    edges: [
      { from: 'variation-a', fromHandle: null, to: 'envelope', toHandle: null },
      { from: 'variation-b', fromHandle: null, to: 'envelope', toHandle: null },
      { from: 'envelope', fromHandle: null, to: 'image', toHandle: null },
      { from: 'image', fromHandle: null, to: 'bin', toHandle: null },
    ],
  },
  {
    id: 'sketch-to-render',
    title: 'Sketch to render',
    titleJa: 'ラフから描画へ',
    description: 'Draw a blue-pencil doodle on the Doodle node, describe it, and use it as reference guidance for the generated image.',
    descriptionJa: 'ラフスケッチノードに青鉛筆で下書きし、説明を添えると、生成画像の参照ガイドとして使えます。',
    tags: ['doodle', 'sketch', 'reference', 'image'],
    nodes: [
      {
        key: 'doodle',
        type: 'doodleNode',
        position: { x: 0, y: -60 },
        data: { doodleDescription: 'A small robot watering a plant', aspectRatio: '1:1' },
      },
      {
        key: 'prompt',
        type: 'textNode',
        position: { x: 0, y: 260 },
        data: { mode: 'prompt', prompt: 'clean children\u2019s book illustration of the sketch' },
      },
      { key: 'image', type: 'imageGen', position: { x: 520, y: 40 } },
    ],
    edges: [
      { from: 'doodle', fromHandle: null, to: 'image', toHandle: 'image-reference-1' },
      { from: 'prompt', fromHandle: null, to: 'image', toHandle: null },
    ],
  },
  {
    id: 'image-to-video',
    title: 'Image to video',
    titleJa: '画像から動画へ',
    description: 'Generate a still frame first, then extend it into a video clip. The image lands on the video start-frame input.',
    descriptionJa: 'まず静止フレームを生成し、それを動画クリップへ拡張します。画像は動画の開始フレーム入力に接続されます。',
    tags: ['video', 'image', 'animation'],
    nodes: [
      {
        key: 'scene',
        type: 'textNode',
        position: { x: 0, y: 0 },
        data: { mode: 'prompt', prompt: 'a paper boat drifting down a rainy gutter' },
      },
      { key: 'image', type: 'imageGen', position: { x: 440, y: -20 } },
      {
        key: 'motion',
        type: 'textNode',
        position: { x: 440, y: 300 },
        data: { mode: 'prompt', prompt: 'slow push-in, gentle ripples, 5 seconds' },
      },
      { key: 'video', type: 'videoGen', position: { x: 920, y: 60 } },
    ],
    edges: [
      { from: 'scene', fromHandle: null, to: 'image', toHandle: null },
      { from: 'image', fromHandle: null, to: 'video', toHandle: 'video-start-frame' },
      { from: 'motion', fromHandle: null, to: 'video', toHandle: 'video-prompt' },
    ],
  },
  {
    id: 'dialogue-to-panels',
    title: 'Dialogue to panels',
    titleJa: 'セリフからコマへ',
    description: 'A comic starter: split one character\u2019s lines out of a script and render the dialogue list as panel prompts.',
    descriptionJa: '漫画向けの構成です。脚本から特定キャラクターのセリフを抽出し、そのリストをコマのプロンプトとして描画します。',
    tags: ['comic', 'story', 'dialogue', 'script'],
    nodes: [
      {
        key: 'script',
        type: 'textNode',
        position: { x: 0, y: 0 },
        data: { mode: 'prompt', prompt: 'MARA: We move at dawn.\nMARA: Quietly, and keep to the shadows.\nGUARD: Who goes there?' },
      },
      { key: 'splitter', type: 'dialogueScriptSplitterNode', position: { x: 480, y: -20 }, data: { prefix: 'MARA:' } },
      { key: 'image', type: 'imageGen', position: { x: 940, y: -20 } },
    ],
    edges: [
      { from: 'script', fromHandle: null, to: 'splitter', toHandle: null },
      { from: 'splitter', fromHandle: null, to: 'image', toHandle: null },
    ],
  },
  {
    id: 'local-calculator',
    title: 'Local value calculator',
    titleJa: 'ローカル値電卓',
    description: 'Runs entirely on your machine with no provider keys: two typed numbers, one Math node, and a Value Monitor to inspect the result.',
    descriptionJa: 'プロバイダーキー不要で完全にローカルで動きます。型付き数値 2 つ、Math ノード 1 つ、結果を確認する値モニターで構成されます。',
    tags: ['math', 'local', 'values', 'monitor', 'beginner'],
    nodes: [
      { key: 'a', type: 'valueNode', position: { x: 0, y: -160 }, data: { valueKind: 'number', value: 24 } },
      { key: 'b', type: 'valueNode', position: { x: 0, y: 160 }, data: { valueKind: 'number', value: 18 } },
      { key: 'math', type: 'mathNode', position: { x: 400, y: 0 }, data: { operation: '-' } },
      { key: 'monitor', type: 'valueMonitorNode', position: { x: 800, y: 0 } },
    ],
    edges: [
      { from: 'a', fromHandle: null, to: 'math', toHandle: 'A' },
      { from: 'b', fromHandle: null, to: 'math', toHandle: 'B' },
      { from: 'math', fromHandle: null, to: 'monitor', toHandle: null },
    ],
  },
  {
    id: 'text-extract-count',
    title: 'Extract and count text',
    titleJa: 'テキストの抽出と計数',
    description: 'A local data recipe: parse matched text out of a paragraph with a regular expression, count the matches, and inspect the list. No provider keys needed.',
    descriptionJa: 'ローカルで動くデータレシピです。正規表現で段落から一致するテキストを取り出し、件数を数えてリストを確認します。プロバイダーキーは不要です。',
    tags: ['regex', 'text', 'data', 'local', 'list'],
    nodes: [
      {
        key: 'source',
        type: 'textNode',
        position: { x: 0, y: 0 },
        data: {
          mode: 'prompt',
          prompt: 'order-17 shipped, order-42 pending, order-63 shipped, order-9 cancelled',
        },
      },
      {
        key: 'parse',
        type: 'regexParseNode',
        position: { x: 480, y: -20 },
        data: { regex: 'order-\\d+', flags: 'g' },
      },
      { key: 'count', type: 'listLengthNode', position: { x: 940, y: -20 } },
      { key: 'monitor', type: 'valueMonitorNode', position: { x: 1360, y: 0 } },
    ],
    edges: [
      { from: 'source', fromHandle: null, to: 'parse', toHandle: 'text' },
      { from: 'parse', fromHandle: null, to: 'count', toHandle: null },
      { from: 'count', fromHandle: null, to: 'monitor', toHandle: null },
    ],
  },
];

export function getFlowStarterTemplate(id: string): FlowStarterTemplate | undefined {
  return FLOW_STARTER_TEMPLATES.find((template) => template.id === id);
}

export function findFlowStarterTemplates(query: string): FlowStarterTemplate[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...FLOW_STARTER_TEMPLATES];
  }
  return FLOW_STARTER_TEMPLATES.filter((template) => [
    template.title,
    template.titleJa ?? '',
    template.description,
    template.descriptionJa ?? '',
    ...template.tags,
  ].some((value) => value.toLowerCase().includes(normalized)));
}

export function starterTemplateLabel(template: FlowStarterTemplate, locale: AppLocale = 'en'): string {
  return locale === 'ja' ? template.titleJa ?? template.title : template.title;
}

export function starterTemplateDescription(template: FlowStarterTemplate, locale: AppLocale = 'en'): string {
  return locale === 'ja' ? template.descriptionJa ?? template.description : template.description;
}

/** Node types whose execution calls a configured AI provider with an API key. */
const PROVIDER_EXECUTING_NODE_TYPES: ReadonlySet<FlowNodeType> = new Set<FlowNodeType>([
  'imageGen',
  'videoGen',
  'audioGen',
  'transcriptionNode',
  'audioProcessNode',
]);

export type StarterTemplateRunRequirement = 'provider' | 'local';

/**
 * What the user must have configured before the recipe can actually run:
 * `provider` recipes contain generator nodes that call a configured provider,
 * `local` recipes execute entirely on the user's machine. The gallery shows
 * this distinction on every card so nobody expects a key-dependent recipe to
 * run before a provider and API key are configured.
 */
export function starterTemplateRunRequirement(template: FlowStarterTemplate): StarterTemplateRunRequirement {
  return template.nodes.some((node) => PROVIDER_EXECUTING_NODE_TYPES.has(node.type)) ? 'provider' : 'local';
}

/** Build the payload shape the flowStore `insertTemplate` action consumes. */
export function buildStarterTemplateInsertPayload(template: FlowStarterTemplate): FlowStarterTemplateInsertPayload {
  return {
    nodes: template.nodes.map((node) => ({
      id: node.key,
      type: node.type,
      position: { ...node.position },
      data: node.data ? { ...node.data } : undefined,
    })),
    edges: template.edges.map((edge, index) => ({
      id: `${template.id}-edge-${index}`,
      source: edge.from,
      target: edge.to,
      sourceHandle: edge.fromHandle ?? undefined,
      targetHandle: edge.toHandle ?? undefined,
    })),
  };
}

export interface FlowStarterTemplateValidation {
  valid: boolean;
  issues: string[];
}

/**
 * Validate a template at definition time against the real node catalog and
 * typed connection contracts. Builds contract-resolution nodes the same way
 * the runtime resolves ports (id/type/position/data) and checks every edge
 * with `validateFlowConnection`, including connection limits as edges are
 * added one by one.
 */
export function validateFlowStarterTemplate(template: FlowStarterTemplate): FlowStarterTemplateValidation {
  const issues: string[] = [];
  const keys = new Set<string>();

  for (const node of template.nodes) {
    if (!node.key) {
      issues.push('A node is missing its key.');
      continue;
    }
    if (keys.has(node.key)) {
      issues.push(`Duplicate node key ${node.key}.`);
    }
    keys.add(node.key);
    if (!getNodeCatalogEntry(node.type)) {
      issues.push(`Node ${node.key} has unknown type ${String(node.type)}.`);
    }
    if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) {
      issues.push(`Node ${node.key} has a non-finite position.`);
    }
  }

  for (let a = 0; a < template.nodes.length; a += 1) {
    for (let b = a + 1; b < template.nodes.length; b += 1) {
      const first = template.nodes[a];
      const second = template.nodes[b];
      if (!Number.isFinite(first.position?.x) || !Number.isFinite(first.position?.y)
        || !Number.isFinite(second.position?.x) || !Number.isFinite(second.position?.y)) {
        continue;
      }
      if (templateNodesOverlap(first, second)) {
        issues.push(
          `Nodes ${first.key} and ${second.key} overlap under the ${STARTER_TEMPLATE_NODE_BOX.width}x${STARTER_TEMPLATE_NODE_BOX.height}`
            + ` placement estimate; keep at least ${STARTER_TEMPLATE_MIN_INTERNAL_CLEARANCE}px between node boxes inside a template.`,
        );
      }
    }
  }

  if (template.edges.length === 0) {
    issues.push('Template has no edges; a starter recipe must demonstrate at least one connection.');
  }

  const builtNodes: AppNode[] = template.nodes
    .filter((node) => node.key && !issues.some((issue) => issue.includes(`Node ${node.key} has unknown type`)))
    .map((node) => ({
      id: node.key,
      type: node.type,
      position: { ...node.position },
      data: buildContractValidationData(node.type, node.data),
    }));
  const builtEdges: Edge[] = [];

  template.edges.forEach((edge, index) => {
    if (!keys.has(edge.from)) {
      issues.push(`Edge ${index} source ${String(edge.from)} does not exist.`);
      return;
    }
    if (!keys.has(edge.to)) {
      issues.push(`Edge ${index} target ${String(edge.to)} does not exist.`);
      return;
    }
    if (edge.from === edge.to) {
      issues.push(`Edge ${index} connects node ${edge.from} to itself.`);
      return;
    }
    if (builtNodes.length === template.nodes.length) {
      const candidate: Edge = {
        id: `${template.id}-candidate-${index}`,
        source: edge.from,
        target: edge.to,
        sourceHandle: edge.fromHandle ?? null,
        targetHandle: edge.toHandle ?? null,
      };
      const validation = validateFlowConnection(candidate, { nodes: builtNodes, edges: builtEdges });
      if (!validation.valid) {
        issues.push(`Edge ${index} (${edge.from} -> ${edge.to}) violates the connection contract: ${validation.reason ?? 'invalid'}`);
        return;
      }
      builtEdges.push(candidate);
    }
  });

  return { valid: issues.length === 0, issues };
}

/**
 * Contract resolution reads provider/modelId with different fallbacks per node
 * (text resolves the catalog default; media generators expect an explicit
 * modelId like the store's initial data). Seed the same defaults the store
 * instantiation seeds so static validation matches what lands on the canvas.
 * Exported for the node-pack importer, which validates shared graphs the same
 * way before installing them.
 */
export function buildContractValidationData(type: FlowNodeType, data: Partial<NodeData> | undefined): AppNode['data'] {
  const merged: Record<string, unknown> = { ...(data ?? {}) };
  if (type === 'textNode' && typeof merged.provider !== 'string') {
    merged.provider = 'gemini';
  }
  if (type === 'imageGen' && typeof merged.modelId !== 'string') {
    merged.provider = typeof merged.provider === 'string' ? merged.provider : 'gemini';
    const provider = (merged.provider as keyof typeof DEFAULT_MODELS.image) in DEFAULT_MODELS.image
      ? merged.provider as keyof typeof DEFAULT_MODELS.image
      : 'gemini';
    merged.modelId = DEFAULT_MODELS.image[provider];
  }
  if (type === 'videoGen' && typeof merged.modelId !== 'string') {
    merged.provider = typeof merged.provider === 'string' ? merged.provider : 'gemini';
    const provider = (merged.provider as keyof typeof DEFAULT_MODELS.video) in DEFAULT_MODELS.video
      ? merged.provider as keyof typeof DEFAULT_MODELS.video
      : 'gemini';
    merged.modelId = DEFAULT_MODELS.video[provider];
  }
  return merged as AppNode['data'];
}

/** Validate every built-in template; used by tests as a shipping gate. */
export function validateAllFlowStarterTemplates(): FlowStarterTemplateValidation {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const template of FLOW_STARTER_TEMPLATES) {
    if (ids.has(template.id)) {
      issues.push(`Duplicate template id ${template.id}.`);
    }
    ids.add(template.id);
    for (const issue of validateFlowStarterTemplate(template).issues) {
      issues.push(`[${template.id}] ${issue}`);
    }
  }
  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Collision-free placement
// ---------------------------------------------------------------------------

/** Conservative on-canvas size estimate used for collision math on both the
 * template being placed and the nodes already on the canvas. */
export const STARTER_TEMPLATE_NODE_BOX = { width: 340, height: 280 } as const;
const COLLISION_STEP_X = STARTER_TEMPLATE_NODE_BOX.width + NODE_GAP_X;
const COLLISION_STEP_Y = STARTER_TEMPLATE_NODE_BOX.height + 120;
const COLLISION_COLUMNS = 8;

export interface TemplatePlacementNode {
  position: { x: number; y: number };
}

export interface TemplateBounds {
  width: number;
  height: number;
}

/** Bounding box of the template's nodes (with per-node size estimate). */
export function getStarterTemplateBounds(template: FlowStarterTemplate): TemplateBounds {
  const minX = Math.min(...template.nodes.map((node) => node.position.x));
  const maxX = Math.max(...template.nodes.map((node) => node.position.x + STARTER_TEMPLATE_NODE_BOX.width));
  const minY = Math.min(...template.nodes.map((node) => node.position.y));
  const maxY = Math.max(...template.nodes.map((node) => node.position.y + STARTER_TEMPLATE_NODE_BOX.height));
  return { width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function boxesIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width
    && b.x < a.x + a.width
    && a.y < b.y + b.height
    && b.y < a.y + a.height;
}

/** True when two authored template nodes sit closer than the required
 * internal clearance under the estimated node box (either axis). */
function templateNodesOverlap(
  first: FlowStarterTemplateNode,
  second: FlowStarterTemplateNode,
): boolean {
  const clearance = STARTER_TEMPLATE_MIN_INTERNAL_CLEARANCE;
  const separatedHorizontally = first.position.x + STARTER_TEMPLATE_NODE_BOX.width + clearance <= second.position.x
    || second.position.x + STARTER_TEMPLATE_NODE_BOX.width + clearance <= first.position.x;
  const separatedVertically = first.position.y + STARTER_TEMPLATE_NODE_BOX.height + clearance <= second.position.y
    || second.position.y + STARTER_TEMPLATE_NODE_BOX.height + clearance <= first.position.y;
  return !separatedHorizontally && !separatedVertically;
}

/**
 * Resolve a collision-free insertion anchor for a template near the requested
 * position. Deterministically scans right, then wraps to the next row, so
 * inserting the same template twice at the same requested point yields
 * side-by-side copies that never overlap existing nodes.
 *
 * The scan never returns an overlapping candidate: it keeps advancing rows on
 * the infinite, pannable canvas until a free cell is found. Termination is
 * guaranteed because `existingNodes` is finite — once a row starts at or below
 * the bottom edge of every existing node box, its first cell cannot intersect
 * anything, so the scan always returns.
 */
export function resolveCollisionFreeTemplatePosition(
  template: FlowStarterTemplate,
  existingNodes: readonly TemplatePlacementNode[],
  requested: { x: number; y: number },
): { x: number; y: number } {
  const bounds = getStarterTemplateBounds(template);
  const existing = existingNodes
    .filter((node) => Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y))
    .map((node) => ({
      x: node.position.x,
      y: node.position.y,
      width: STARTER_TEMPLATE_NODE_BOX.width,
      height: STARTER_TEMPLATE_NODE_BOX.height,
    }));

  let candidate = { x: requested.x, y: requested.y };
  for (;;) {
    for (let column = 0; column < COLLISION_COLUMNS; column += 1) {
      const box = { ...candidate, width: bounds.width, height: bounds.height };
      if (!existing.some((other) => boxesIntersect(box, other))) {
        return candidate;
      }
      candidate = { x: candidate.x + COLLISION_STEP_X, y: candidate.y };
    }
    candidate = { x: requested.x, y: candidate.y + COLLISION_STEP_Y };
  }
}

// ---------------------------------------------------------------------------
// Preview model
// ---------------------------------------------------------------------------

export interface StarterTemplatePreviewNode {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface StarterTemplatePreviewEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface StarterTemplatePreviewModel {
  width: number;
  height: number;
  nodes: StarterTemplatePreviewNode[];
  edges: StarterTemplatePreviewEdge[];
}

const PREVIEW_CATEGORY_COLORS: Record<FlowNodeCatalogCategoryId, string> = {
  generate: '#22d3ee',
  'inputs-data': '#a3e635',
  'lists-envelopes': '#fbbf24',
  'flow-control': '#f472b6',
  'logic-math': '#818cf8',
  'text-tools': '#34d399',
  'story-tools': '#fb923c',
  'reuse-layout': '#c084fc',
  'monitor-debug': '#38bdf8',
  settings: '#94a3b8',
};

const PREVIEW_WIDTH = 216;
const PREVIEW_HEIGHT = 104;
const PREVIEW_NODE_WIDTH = 44;
const PREVIEW_NODE_HEIGHT = 24;
const PREVIEW_PADDING = 8;

/** Deterministic miniature graph preview (pure data; rendered as SVG by the UI). */
export function getStarterTemplatePreviewModel(template: FlowStarterTemplate): StarterTemplatePreviewModel {
  if (template.nodes.length === 0) {
    return { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, nodes: [], edges: [] };
  }

  const minX = Math.min(...template.nodes.map((node) => node.position.x));
  const maxX = Math.max(...template.nodes.map((node) => node.position.x));
  const minY = Math.min(...template.nodes.map((node) => node.position.y));
  const maxY = Math.max(...template.nodes.map((node) => node.position.y));
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);

  const innerWidth = PREVIEW_WIDTH - PREVIEW_PADDING * 2 - PREVIEW_NODE_WIDTH;
  const innerHeight = PREVIEW_HEIGHT - PREVIEW_PADDING * 2 - PREVIEW_NODE_HEIGHT;
  const scale = Math.min(innerWidth / spanX, innerHeight / spanY, 1);

  const boxes = new Map<string, StarterTemplatePreviewNode>();
  for (const node of template.nodes) {
    const entry = getNodeCatalogEntry(node.type);
    const color = entry ? PREVIEW_CATEGORY_COLORS[entry.categoryId] : '#64748b';
    boxes.set(node.key, {
      x: PREVIEW_PADDING + (node.position.x - minX) * scale,
      y: PREVIEW_PADDING + (node.position.y - minY) * scale,
      width: PREVIEW_NODE_WIDTH,
      height: PREVIEW_NODE_HEIGHT,
      color,
    });
  }

  const edges: StarterTemplatePreviewEdge[] = [];
  for (const edge of template.edges) {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) {
      continue;
    }
    const forward = to.x >= from.x;
    edges.push({
      x1: forward ? from.x + from.width : from.x,
      y1: from.y + from.height / 2,
      x2: forward ? to.x : to.x + to.width,
      y2: to.y + to.height / 2,
    });
  }

  return { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, nodes: [...boxes.values()], edges };
}

/** Node count helper for gallery badges. */
export function starterTemplateNodeCount(template: FlowStarterTemplate): number {
  return template.nodes.length;
}
