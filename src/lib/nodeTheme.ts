import type { FlowNodeType } from '../types/flow';

export interface NodeTheme {
  accentColor: string;
  hoverAccentColor: string;
  containerClassName: string;
  headerClassName: string;
  iconClassName: string;
}

const defaultTheme: NodeTheme = {
  accentColor: '#8b8f98',
  hoverAccentColor: '#a7acb6',
  containerClassName: 'bg-[#1e2027] border-gray-700/60 shadow-black/35',
  headerClassName: 'bg-[#252830]/80 border-gray-700/50',
  iconClassName: 'text-gray-400',
};

const nodeThemes: Record<FlowNodeType, NodeTheme> = {
  textNode: {
    accentColor: '#f59e0b',
    hoverAccentColor: '#fbbf24',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(245,158,11,0.15),#1e2027_34%,#15171d)] border-amber-400/35 shadow-amber-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(245,158,11,0.20),rgba(37,40,48,0.82))] border-amber-400/25',
    iconClassName: 'text-amber-200',
  },
  imageGen: {
    accentColor: '#22c55e',
    hoverAccentColor: '#4ade80',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(34,197,94,0.14),#1e2027_34%,#141a18)] border-emerald-400/35 shadow-emerald-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(34,197,94,0.20),rgba(37,40,48,0.82))] border-emerald-400/25',
    iconClassName: 'text-emerald-200',
  },
  cropImageNode: {
    accentColor: '#a3e635',
    hoverAccentColor: '#bef264',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(163,230,53,0.13),#1e2027_34%,#17200f)] border-lime-300/35 shadow-lime-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(163,230,53,0.18),rgba(37,40,48,0.82))] border-lime-300/25',
    iconClassName: 'text-lime-100',
  },
  videoGen: {
    accentColor: '#38bdf8',
    hoverAccentColor: '#7dd3fc',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(56,189,248,0.14),#1e2027_34%,#111923)] border-sky-400/35 shadow-sky-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(56,189,248,0.20),rgba(37,40,48,0.82))] border-sky-400/25',
    iconClassName: 'text-sky-200',
  },
  audioGen: {
    accentColor: '#06b6d4',
    hoverAccentColor: '#22d3ee',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(6,182,212,0.14),#1e2027_34%,#111b20)] border-cyan-400/35 shadow-cyan-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(6,182,212,0.20),rgba(37,40,48,0.82))] border-cyan-400/25',
    iconClassName: 'text-cyan-200',
  },
  transcriptionNode: {
    accentColor: '#22d3ee',
    hoverAccentColor: '#67e8f9',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(34,211,238,0.14),#1e2027_34%,#101c22)] border-cyan-300/35 shadow-cyan-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(34,211,238,0.20),rgba(37,40,48,0.82))] border-cyan-300/25',
    iconClassName: 'text-cyan-100',
  },
  audioProcessNode: {
    accentColor: '#2dd4bf',
    hoverAccentColor: '#5eead4',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(45,212,191,0.14),#1e2027_34%,#10201d)] border-teal-300/35 shadow-teal-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(45,212,191,0.20),rgba(37,40,48,0.82))] border-teal-300/25',
    iconClassName: 'text-teal-100',
  },
  settings: {
    accentColor: '#a78bfa',
    hoverAccentColor: '#c4b5fd',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(167,139,250,0.14),#1e2027_34%,#181622)] border-violet-400/35 shadow-violet-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(167,139,250,0.20),rgba(37,40,48,0.82))] border-violet-400/25',
    iconClassName: 'text-violet-200',
  },
  composition: {
    accentColor: '#fb7185',
    hoverAccentColor: '#fda4af',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(251,113,133,0.14),#1e2027_34%,#211419)] border-rose-400/35 shadow-rose-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(251,113,133,0.20),rgba(37,40,48,0.82))] border-rose-400/25',
    iconClassName: 'text-rose-200',
  },
  sourceBin: {
    accentColor: '#f97316',
    hoverAccentColor: '#fb923c',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(249,115,22,0.14),#1e2027_34%,#211812)] border-orange-400/35 shadow-orange-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(249,115,22,0.20),rgba(37,40,48,0.82))] border-orange-400/25',
    iconClassName: 'text-orange-200',
  },
  valueNode: {
    accentColor: '#2dd4bf',
    hoverAccentColor: '#5eead4',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(45,212,191,0.14),#1e2027_34%,#10201d)] border-teal-300/35 shadow-teal-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(45,212,191,0.20),rgba(37,40,48,0.82))] border-teal-300/25',
    iconClassName: 'text-teal-100',
  },
  colorSwatchNode: {
    accentColor: '#f472b6',
    hoverAccentColor: '#f9a8d4',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(244,114,182,0.14),#1e2027_34%,#24131e)] border-pink-400/35 shadow-pink-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(244,114,182,0.20),rgba(37,40,48,0.82))] border-pink-400/25',
    iconClassName: 'text-pink-200',
  },
  colorSwatchListNode: {
    accentColor: '#a78bfa',
    hoverAccentColor: '#c4b5fd',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(167,139,250,0.14),#1e2027_34%,#1b1830)] border-violet-400/35 shadow-violet-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(167,139,250,0.20),rgba(37,40,48,0.82))] border-violet-400/25',
    iconClassName: 'text-violet-200',
  },
  loraSpecNode: {
    accentColor: '#fbbf24',
    hoverAccentColor: '#fcd34d',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(251,191,36,0.14),#1e2027_34%,#2a2010)] border-amber-400/35 shadow-amber-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(251,191,36,0.20),rgba(37,40,48,0.82))] border-amber-400/25',
    iconClassName: 'text-amber-200',
  },
  slimgNode: {
    accentColor: '#38bdf8',
    hoverAccentColor: '#7dd3fc',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(56,189,248,0.14),#1e2027_34%,#0c2533)] border-sky-400/35 shadow-sky-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(56,189,248,0.20),rgba(37,40,48,0.82))] border-sky-400/25',
    iconClassName: 'text-sky-200',
  },
  doodleNode: {
    accentColor: '#5b8def',
    hoverAccentColor: '#93b9f7',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(91,141,239,0.14),#1e2027_34%,#131a26)] border-sky-400/35 shadow-sky-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(91,141,239,0.20),rgba(37,40,48,0.82))] border-sky-400/25',
    iconClassName: 'text-sky-200',
  },
  list: {
    accentColor: '#14b8a6',
    hoverAccentColor: '#2dd4bf',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(20,184,166,0.14),#1e2027_34%,#10201d)] border-teal-400/35 shadow-teal-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(20,184,166,0.20),rgba(37,40,48,0.82))] border-teal-400/25',
    iconClassName: 'text-teal-200',
  },
  expander: {
    accentColor: '#facc15',
    hoverAccentColor: '#fde047',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(250,204,21,0.13),#1e2027_34%,#201e11)] border-yellow-300/35 shadow-yellow-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(250,204,21,0.18),rgba(37,40,48,0.82))] border-yellow-300/25',
    iconClassName: 'text-yellow-100',
  },
  envelope: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#1d1424)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  virtual: {
    accentColor: '#e879f9',
    hoverAccentColor: '#f0abfc',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(232,121,249,0.14),#1e2027_34%,#211422)] border-fuchsia-400/35 shadow-fuchsia-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(232,121,249,0.20),rgba(37,40,48,0.82))] border-fuchsia-400/25',
    iconClassName: 'text-fuchsia-200',
  },
  portal: {
    accentColor: '#2dd4bf',
    hoverAccentColor: '#5eead4',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(45,212,191,0.16),#1e2027_34%,#11201e)] border-teal-300/40 shadow-teal-950/25',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(45,212,191,0.22),rgba(37,40,48,0.82))] border-teal-300/30',
    iconClassName: 'text-teal-100',
  },
  advancedImageEditor: {
    accentColor: '#84cc16',
    hoverAccentColor: '#a3e635',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(132,204,22,0.14),#1e2027_34%,#18210f)] border-lime-400/35 shadow-lime-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(132,204,22,0.20),rgba(37,40,48,0.82))] border-lime-400/25',
    iconClassName: 'text-lime-200',
  },
  switchNode: {
    accentColor: '#fb923c',
    hoverAccentColor: '#fdba74',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(251,146,60,0.14),#1e2027_34%,#271b12)] border-orange-400/35 shadow-orange-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(251,146,60,0.20),rgba(37,40,48,0.82))] border-orange-400/25',
    iconClassName: 'text-orange-200',
  },
  forkSwitchNode: {
    accentColor: '#f43f5e',
    hoverAccentColor: '#fb7185',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(244,63,94,0.14),#1e2027_34%,#271115)] border-rose-500/35 shadow-rose-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(244,63,94,0.20),rgba(37,40,48,0.82))] border-rose-500/25',
    iconClassName: 'text-rose-200',
  },
  runMeNode: {
    accentColor: '#10b981',
    hoverAccentColor: '#34d399',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(16,185,129,0.14),#1e2027_34%,#0e2418)] border-emerald-500/35 shadow-emerald-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(16,185,129,0.20),rgba(37,40,48,0.82))] border-emerald-500/25',
    iconClassName: 'text-emerald-200',
  },
  packageNode: {
    accentColor: '#a78bfa',
    hoverAccentColor: '#c084fc',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(167,139,250,0.14),#1e2027_34%,#1d1424)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(167,139,250,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  loopNode: {
    accentColor: '#f59e0b',
    hoverAccentColor: '#fbbf24',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(245,158,11,0.14),#1e2027_34%,#271e11)] border-amber-500/35 shadow-amber-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(245,158,11,0.20),rgba(37,40,48,0.82))] border-amber-500/25',
    iconClassName: 'text-amber-200',
  },
  visionVerifyNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  logicNode: {
    accentColor: '#818cf8',
    hoverAccentColor: '#93c5fd',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(129,140,248,0.14),#1e2027_34%,#13172a)] border-indigo-400/35 shadow-indigo-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(129,140,248,0.20),rgba(37,40,48,0.82))] border-indigo-400/25',
    iconClassName: 'text-indigo-200',
  },
  conditionalNode: {
    accentColor: '#a78bfa',
    hoverAccentColor: '#c084fc',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(167,139,250,0.14),#1e2027_34%,#181324)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(167,139,250,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  comparisonNode: {
    accentColor: '#e879f9',
    hoverAccentColor: '#f472b6',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(232,121,249,0.14),#1e2027_34%,#2a1329)] border-fuchsia-400/35 shadow-fuchsia-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(232,121,249,0.20),rgba(37,40,48,0.82))] border-fuchsia-400/25',
    iconClassName: 'text-fuchsia-200',
  },
  loopGateNode: {
    accentColor: '#38bdf8',
    hoverAccentColor: '#7dd3fc',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(56,189,248,0.14),#1e2027_34%,#0e1f2b)] border-sky-400/35 shadow-sky-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(56,189,248,0.20),rgba(37,40,48,0.82))] border-sky-400/25',
    iconClassName: 'text-sky-200',
  },
  loopBreakNode: {
    accentColor: '#fb7185',
    hoverAccentColor: '#fda4af',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(251,113,133,0.15),#1e2027_34%,#271115)] border-rose-400/40 shadow-rose-950/25',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(251,113,133,0.22),rgba(37,40,48,0.82))] border-rose-400/30',
    iconClassName: 'text-rose-100',
  },
  mathNode: {
    accentColor: '#14b8a6',
    hoverAccentColor: '#2dd4bf',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(20,184,166,0.14),#1e2027_34%,#0f221f)] border-teal-500/35 shadow-teal-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(20,184,166,0.20),rgba(37,40,48,0.82))] border-teal-500/25',
    iconClassName: 'text-teal-200',
  },
  listLengthNode: {
    accentColor: '#0ea5e9',
    hoverAccentColor: '#38bdf8',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(14,165,233,0.14),#1e2027_34%,#0b1e2a)] border-sky-500/35 shadow-sky-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(14,165,233,0.20),rgba(37,40,48,0.82))] border-sky-500/25',
    iconClassName: 'text-sky-200',
  },
  valueMonitorNode: {
    accentColor: '#06b6d4',
    hoverAccentColor: '#22d3ee',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(6,180,212,0.14),#1e2027_34%,#0b2126)] border-cyan-500/35 shadow-cyan-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(6,180,212,0.20),rgba(37,40,48,0.82))] border-cyan-500/25',
    iconClassName: 'text-cyan-200',
  },
  stringTemplateNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  regexReplaceNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  switchCaseNode: {
    accentColor: '#f43f5e',
    hoverAccentColor: '#fb7185',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(244,63,94,0.14),#1e2027_34%,#271115)] border-rose-500/35 shadow-rose-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(244,63,94,0.20),rgba(37,40,48,0.82))] border-rose-500/25',
    iconClassName: 'text-rose-200',
  },
  promptsJoinerNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  negativePromptNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  seedSequencerNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  promptMixerNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  storyStateNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  arrayFlatNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  textSentimentAnalysisNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  imageFeatureExtractorNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  fallbackSelectorNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  dialogueScriptSplitterNode: {
    accentColor: '#c084fc',
    hoverAccentColor: '#d8b4fe',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(192,132,252,0.14),#1e2027_34%,#22132a)] border-purple-400/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(192,132,252,0.20),rgba(37,40,48,0.82))] border-purple-400/25',
    iconClassName: 'text-purple-200',
  },
  numberNode: {
    accentColor: '#3b82f6',
    hoverAccentColor: '#60a5fa',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(59,130,246,0.14),#1e2027_34%,#0e1726)] border-blue-500/35 shadow-blue-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(59,130,246,0.20),rgba(37,40,48,0.82))] border-blue-500/25',
    iconClassName: 'text-blue-200',
  },
  groupNode: {
    accentColor: '#94a3b8',
    hoverAccentColor: '#cbd5e1',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(148,163,184,0.14),#1e2027_34%,#151923)] border-slate-400/35 shadow-slate-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(148,163,184,0.20),rgba(37,40,48,0.82))] border-slate-400/25',
    iconClassName: 'text-slate-200',
  },
  functionNode: {
    accentColor: '#22d3ee',
    hoverAccentColor: '#67e8f9',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(34,211,238,0.15),#1e2027_34%,#0b1c22)] border-cyan-300/40 shadow-cyan-950/25',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(34,211,238,0.22),rgba(37,40,48,0.82))] border-cyan-300/30',
    iconClassName: 'text-cyan-100',
  },
  functionInputNode: {
    accentColor: '#14b8a6',
    hoverAccentColor: '#2dd4bf',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(20,184,166,0.15),#1e2027_34%,#0a221f)] border-teal-500/35 shadow-teal-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(20,184,166,0.20),rgba(37,40,48,0.82))] border-teal-500/25',
    iconClassName: 'text-teal-200',
  },
  functionOutputNode: {
    accentColor: '#f43f5e',
    hoverAccentColor: '#fb7185',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(244,63,94,0.15),#1e2027_34%,#271115)] border-rose-500/35 shadow-rose-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(244,63,94,0.20),rgba(37,40,48,0.82))] border-rose-500/25',
    iconClassName: 'text-rose-200',
  },
  javascriptNode: {
    accentColor: '#f59e0b',
    hoverAccentColor: '#fbbf24',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(245,158,11,0.15),#1e2027_34%,#1d1912)] border-amber-500/35 shadow-amber-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(245,158,11,0.20),rgba(37,40,48,0.82))] border-amber-500/25',
    iconClassName: 'text-amber-200',
  },
  jsonQueryNode: {
    accentColor: '#8b5cf6',
    hoverAccentColor: '#a78bfa',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(139,92,246,0.15),#1e2027_34%,#16121f)] border-violet-500/35 shadow-violet-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(139,92,246,0.20),rgba(37,40,48,0.82))] border-violet-500/25',
    iconClassName: 'text-violet-200',
  },
  regexParseNode: {
    accentColor: '#f97316',
    hoverAccentColor: '#fb923c',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(249,115,22,0.15),#1e2027_34%,#1e140d)] border-orange-500/35 shadow-orange-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(249,115,22,0.20),rgba(37,40,48,0.82))] border-orange-500/25',
    iconClassName: 'text-orange-200',
  },
  pythonNode: {
    accentColor: '#06b6d4',
    hoverAccentColor: '#22d3ee',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(6,180,212,0.15),#1e2027_34%,#0b2126)] border-cyan-500/35 shadow-cyan-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(6,180,212,0.20),rgba(37,40,48,0.82))] border-cyan-500/25',
    iconClassName: 'text-cyan-200',
  },
  jsonBuilderNode: {
    accentColor: '#a855f7',
    hoverAccentColor: '#c084fc',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(168,85,247,0.15),#1e2027_34%,#1b1126)] border-purple-500/35 shadow-purple-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(168,85,247,0.20),rgba(37,40,48,0.82))] border-purple-500/25',
    iconClassName: 'text-purple-200',
  },
  htmlSandboxNode: {
    accentColor: '#f97316',
    hoverAccentColor: '#fb923c',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(249,115,22,0.15),#1e2027_34%,#1e140d)] border-orange-500/35 shadow-orange-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(249,115,22,0.20),rgba(37,40,48,0.82))] border-orange-500/25',
    iconClassName: 'text-orange-200',
  },
  apiFetchNode: {
    accentColor: '#10b981',
    hoverAccentColor: '#34d399',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(16,184,129,0.15),#1e2027_34%,#0c2118)] border-emerald-500/35 shadow-emerald-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(16,184,129,0.20),rgba(37,40,48,0.82))] border-emerald-500/25',
    iconClassName: 'text-emerald-200',
  },
  sqlQueryNode: {
    accentColor: '#6366f1',
    hoverAccentColor: '#818cf8',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(99,102,241,0.15),#1e2027_34%,#121426)] border-indigo-500/35 shadow-indigo-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(99,102,241,0.20),rgba(37,40,48,0.82))] border-indigo-500/25',
    iconClassName: 'text-indigo-200',
  },
  csvParserNode: {
    accentColor: '#10b981',
    hoverAccentColor: '#34d399',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(16,184,129,0.15),#1e2027_34%,#0c2118)] border-emerald-500/35 shadow-emerald-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(16,184,129,0.20),rgba(37,40,48,0.82))] border-emerald-500/25',
    iconClassName: 'text-emerald-200',
  },
  mathExpressionNode: {
    accentColor: '#3b82f6',
    hoverAccentColor: '#60a5fa',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(59,130,246,0.15),#1e2027_34%,#0e1726)] border-blue-500/35 shadow-blue-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(59,130,246,0.20),rgba(37,40,48,0.82))] border-blue-500/25',
    iconClassName: 'text-blue-200',
  },
  xmlYamlNode: {
    accentColor: '#14b8a6',
    hoverAccentColor: '#2dd4bf',
    containerClassName: 'bg-[linear-gradient(155deg,rgba(20,184,166,0.15),#1e2027_34%,#0a221f)] border-teal-500/35 shadow-teal-950/20',
    headerClassName: 'bg-[linear-gradient(90deg,rgba(20,184,166,0.20),rgba(37,40,48,0.82))] border-teal-500/25',
    iconClassName: 'text-teal-200',
  },
};

export function getNodeTheme(nodeType?: FlowNodeType, nodeData?: Record<string, unknown>): NodeTheme {
  if (nodeType === 'switchNode' && nodeData) {
    const state = nodeData.state ?? 'on';
    return state === 'on' ? nodeThemes['runMeNode'] : nodeThemes['forkSwitchNode'];
  }

  if (nodeType === 'forkSwitchNode' && nodeData) {
    const selectedOutput = nodeData.selectedOutput ?? 'A';
    return selectedOutput === 'A' ? nodeThemes['forkSwitchNode'] : nodeThemes['runMeNode'];
  }

  if ((nodeType === 'logicNode' || nodeType === 'comparisonNode' || nodeType === 'visionVerifyNode') && nodeData) {
    const result = nodeData.result;
    return result === true || result === 'true' ? nodeThemes['runMeNode'] : nodeThemes['forkSwitchNode'];
  }

  return nodeType ? nodeThemes[nodeType] : defaultTheme;
}
