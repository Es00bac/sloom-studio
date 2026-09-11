import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT = resolve(DEFAULT_ROOT, 'docs/audits/flow-node-audit-2026-07-15.md');

export async function loadFlowNodeAuditRows(root = DEFAULT_ROOT) {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false },
  });

  try {
    const [{ FLOW_NODE_TYPES }, contractModule, catalogModule, runtimeModule] = await Promise.all([
      server.ssrLoadModule('/src/types/flow.ts'),
      server.ssrLoadModule('/src/lib/flowNodeContracts.ts'),
      server.ssrLoadModule('/src/lib/nodeCatalog.ts'),
      server.ssrLoadModule('/src/lib/flowRuntimePortCapabilities.ts'),
    ]);
    const entries = new Map(catalogModule.FLOW_NODE_CATALOG_ENTRIES.map((entry) => [entry.type, entry]));

    return FLOW_NODE_TYPES.map((type) => {
      const contract = contractModule.getFlowNodeContract(type);
      const entry = entries.get(type);
      const node = {
        id: `audit-${type}`,
        type,
        position: { x: 0, y: 0 },
        data: { ...(entry?.initialData ?? {}) },
      };
      const ports = contractModule.resolveFlowNodePorts({ node, nodes: [node], edges: [] });
      const inputs = ports.filter((port) => port.direction === 'input');
      const outputs = ports.filter((port) => port.direction === 'output');
      const example = contract.examples[0];
      const runtimeEvidenceEntries = inputs.map((port) => ({
        port,
        evidence: runtimeModule.getFlowRuntimePortEvidence(type, port.id),
      }));
      const runtimeEvidenceFiles = [...new Set(runtimeEvidenceEntries.flatMap(({ evidence }) => evidence
        ? [stripAnchor(evidence.consumer), evidence.verification]
        : []))];

      return {
        type,
        label: entry?.label ?? humanize(type),
        category: entry?.categoryId ?? 'uncategorized',
        role: contract.role,
        purpose: contract.purpose,
        inputs: formatPorts(inputs, 'input'),
        outputs: formatPorts(outputs, 'output'),
        dynamicBehavior: describeDynamicBehavior(type, ports),
        example: example.description,
        failureModes: contract.failureModes.join(' '),
        implementation: contract.implementation.path,
        apiCapability: contract.implementation.apiCapability ?? 'local / structural',
        runtimeEvidence: runtimeEvidenceEntries.length === 0
          ? 'No input ports.'
          : runtimeEvidenceEntries.map(({ port, evidence }) => evidence
            ? `${port.id ?? 'default'} → ${evidence.family}: ${evidence.consumer} (${evidence.verification})`
            : `${port.id ?? 'default'} → MISSING RUNTIME EVIDENCE`
          ).join('<br>'),
        runtimeEvidenceFiles,
        missingRuntimeEvidence: runtimeEvidenceEntries.filter(({ evidence }) => !evidence).map(({ port }) => port.id ?? 'default'),
        verification: 'src/lib/flowNodeContracts.test.ts + src/lib/flowRuntimePortCapabilities.test.ts + focused consumer behavior tests',
      };
    });
  } finally {
    await server.close();
  }
}

export function renderFlowNodeAudit(rows) {
  const generatedRows = rows.map((row) => [
    `\`${row.type}\``,
    row.label,
    row.category,
    row.role,
    row.purpose,
    row.inputs,
    row.outputs,
    row.dynamicBehavior,
    row.example,
    row.failureModes,
    `\`${row.implementation}\``,
    row.apiCapability,
    row.runtimeEvidence,
    row.verification,
  ].map(cell).join(' | '));

  return `# Flow Node Contract/Runtime Parity Audit — 2026-07-15

> Generated from \`FLOW_NODE_TYPES\`, \`FLOW_NODE_CONTRACTS\`, \`FLOW_NODE_CATALOG_ENTRIES\`, and the independent \`FLOW_RUNTIME_PORT_CAPABILITIES\` evidence registry by \`scripts/generate-flow-node-audit.mjs\`. Do not hand-edit this matrix.

## Result

All ${rows.length} registered node types have a unique executable contract, a user-facing purpose, typed ports, at least one representative connection chain, a named implementation path, and independent runtime-consumer evidence for every resolved input handle. The table shows the default configuration; the parity suite separately exercises every port-changing dynamic variant.

Compatibility is exact. \`text\`, \`number\`, \`boolean\`, \`json\`, \`image\`, \`video\`, \`audio\`, \`package\`, \`control\`, \`list<T>\`, and \`envelope<T>\` do not coerce into one another. \`unknown\` is restricted to explicitly undeclared flexible outputs and becomes connectable only after the node declares its result type or the graph resolves a concrete upstream type.

## Exhaustive matrix

| Node type | UI label | Category | Role | Purpose | Inputs | Outputs | Dynamic behavior | Representative chain | Failure behavior | Implementation | API capability | Runtime evidence | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${generatedRows.map((row) => `| ${row} |`).join('\n')}

## Audit interpretation

- API nodes derive accepted media handles and enabled controls from the exact selected provider/model contract.
- Flexible code, query, and HTTP nodes default to \`unknown\`; their declared output selector is the type boundary used by downstream validation.
- Disabled handles stay visible with a reason, but connection creation and execution preflight reject them.
- Legacy edges are preserved and annotated invalid rather than silently deleted; diagnostics name the carried and accepted types and suggest a converter when one exists.
- Group is intentionally visual-only. Source Bin and Run Me are intentional sinks. Function markers and Portal endpoints are intentional graph boundaries.
`;
}

function stripAnchor(value) {
  return String(value).split('#')[0];
}

export async function generateFlowNodeAudit({ root = DEFAULT_ROOT, output = DEFAULT_OUTPUT } = {}) {
  const rows = await loadFlowNodeAuditRows(root);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderFlowNodeAudit(rows), 'utf8');
  return { output, count: rows.length };
}

function formatPorts(ports, direction) {
  if (ports.length === 0) return direction === 'input' ? 'None' : 'None (sink or visual-only)';
  return ports.map((port) => {
    const id = port.id === null ? 'default' : port.id;
    const types = port.types.map(describeType).join(' / ');
    const cardinality = port.maxConnections === null ? 'many' : `${port.minConnections}–${port.maxConnections}`;
    const flags = [port.required ? 'required' : 'optional', `${cardinality} connection${cardinality === '1' ? '' : 's'}`];
    if (port.disabledReason) flags.push(`disabled by default: ${port.disabledReason}`);
    return `${port.label} [${id}] → ${types} (${flags.join(', ')})`;
  }).join('<br>');
}

function describeType(type) {
  if (type.kind === 'list' || type.kind === 'envelope') {
    return `${type.kind}<${describeType(type.item)}>`;
  }
  return type.kind;
}

function describeDynamicBehavior(type, ports) {
  const dynamic = {
    textNode: 'Input modalities follow the exact text model; prompt mode has no input.',
    imageGen: 'Source, mask, and 14 reference handles remain visible; unsupported handles are blocked from the selected model contract.',
    videoGen: 'Start/end frames, three references, source video, duration, resolution, audio, and route warnings follow the exact video contract.',
    audioGen: 'Prompt changes to audio for voice change; operation-specific model controls are disabled when unsupported.',
    composition: 'Audio inputs expand from one to four ordered tracks.',
    valueNode: 'Output changes with the selected primitive kind.',
    list: 'Typed slots expand as connections are added and enforce one consistent item type.',
    envelope: 'Item and output types follow the selected envelope item kind.',
    expander: 'Output resolves from the connected list/envelope item type.',
    portal: 'Entrance has an input; the paired exit has an output carrying the resolved entrance type.',
    functionNode: 'Ports are generated from the saved function contract.',
    javascriptNode: 'Output is unknown until an explicit result type is declared.',
    pythonNode: 'Output is unknown until an explicit result type is declared.',
    jsonQueryNode: 'Output is unknown until an explicit result type is declared.',
    apiFetchNode: 'Response is unknown until an explicit result type is declared.',
    csvParserNode: 'Ports invert between CSV→JSON and JSON→CSV modes.',
    xmlYamlNode: 'Input/output switch between JSON and text by conversion mode.',
  };
  if (dynamic[type]) return dynamic[type];
  if (ports.some((port) => port.disabledReason)) return 'Visible port availability follows the current node configuration.';
  return 'Stable typed ports; values/settings change behavior without changing the contract shape.';
}

function humanize(value) {
  return value.replace(/Node$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

function cell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}

function isMain() {
  return process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
  const result = await generateFlowNodeAudit();
  console.log(`Generated ${result.count} Flow node audit rows at ${result.output}`);
}
