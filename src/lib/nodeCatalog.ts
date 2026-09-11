import type { FlowNodeType, NodeData } from '../types/flow';
import type { AppLocale } from './i18n';
import { FLOW_NODE_CONTRACTS } from './flowNodeContracts';

export type FlowNodeCatalogCategoryId =
  | 'generate'
  | 'inputs-data'
  | 'lists-envelopes'
  | 'flow-control'
  | 'logic-math'
  | 'text-tools'
  | 'story-tools'
  | 'reuse-layout'
  | 'monitor-debug'
  | 'settings';

export interface FlowNodeCatalogCategory {
  id: FlowNodeCatalogCategoryId;
  label: string;
  description: string;
}

export interface FlowNodeCatalogEntry {
  type: FlowNodeType;
  label: string;
  description: string;
  categoryId: FlowNodeCatalogCategoryId;
  tags: string[];
  initialData?: Partial<NodeData>;
}

export const FLOW_NODE_CATALOG_CATEGORIES: FlowNodeCatalogCategory[] = [
  { id: 'generate', label: 'Generate', description: 'AI media generators and final outputs.' },
  { id: 'inputs-data', label: 'Inputs & Data', description: 'Prompts, primitive values, source-bin assets, and packages.' },
  { id: 'lists-envelopes', label: 'Lists & Envelopes', description: 'Batch inputs, typed lists, envelopes, and item expansion.' },
  { id: 'flow-control', label: 'Flow Control', description: 'Run triggers, loops, gates, and explicit loop stopping.' },
  { id: 'logic-math', label: 'Logic & Math', description: 'Boolean logic, comparisons, math, and routing.' },
  { id: 'text-tools', label: 'Text Tools', description: 'Templates, prompt joining, replacements, and prompt utilities.' },
  { id: 'story-tools', label: 'Story Tools', description: 'Sequential-art helpers for scenes, dialogue, state, and analysis.' },
  { id: 'reuse-layout', label: 'Reuse & Layout', description: 'Functions, groups, portals, aliases, and workspace organization.' },
  { id: 'monitor-debug', label: 'Monitor & Debug', description: 'Inspect values and verify connected media.' },
  { id: 'settings', label: 'Settings', description: 'Provider and execution configuration.' },
];

export const FLOW_NODE_CATALOG_ENTRIES: FlowNodeCatalogEntry[] = [
  entry('imageGen', 'Image', 'Generate or edit images with the selected image provider.', 'generate', ['image', 'ai', 'media']),
  entry('videoGen', 'Video', 'Generate video from prompts, frames, references, or source clips.', 'generate', ['video', 'ai', 'media']),
  entry('audioGen', 'Audio', 'Generate speech, sound effects, or voice-changed audio.', 'generate', ['audio', 'speech', 'ai']),
  entry('transcriptionNode', 'Transcription', 'Transcribe connected audio or video into text, timed JSON, VTT, and SRT captions.', 'generate', ['audio', 'video', 'speech to text', 'scribe', 'captions', 'subtitles']),
  entry('audioProcessNode', 'Audio Process', 'Isolate dialogue from connected audio or video without replacing the source.', 'generate', ['audio', 'video', 'dialogue', 'voice isolation', 'cleanup', 'denoise']),
  entry('composition', 'Composition', 'Combine video, audio, and timeline assets into a rendered sequence.', 'generate', ['video', 'timeline', 'output']),

  entry('textNode', 'Text Prompt', 'Write a prompt or generate text for downstream nodes.', 'inputs-data', ['text', 'prompt', 'primitive']),
  entry('valueNode', 'Value', 'Create a typed primitive value: text, number, boolean, or JSON.', 'inputs-data', ['primitive', 'boolean', 'json', 'number']),
  entry('colorSwatchNode', 'Color Palette', 'Build a master palette of colors that guides image and video color consistency; drag colors into a Color Swatch to label them per scene.', 'inputs-data', ['color', 'palette', 'swatch', 'theme', 'consistency']),
  entry('colorSwatchListNode', 'Color Swatch', 'A labeled subset of a Color Palette: drag palette colors in and name each one (hair, skin, shirt) for a scene or panel.', 'inputs-data', ['color', 'swatch', 'palette', 'label', 'scene', 'panel']),
  entry('loraSpecNode', 'LoRA Spec', 'Build the JSON LoRA weights (path + scale, up to 3) that FLUX LoRA models accept; connect it to a FLUX LoRA image node for consistency.', 'inputs-data', ['lora', 'flux', 'kontext', 'weights', 'consistency', 'json']),
  entry('doodleNode', 'Doodle', 'Sketch a blue-pencil reference image plus a description, packaged for an Image node.', 'inputs-data', ['sketch', 'doodle', 'draw', 'reference', 'blue pencil'], { aspectRatio: '1:1', doodleDescription: '' }),
  entry('cropImageNode', 'Crop Image', 'Crop one connected image locally and output the cropped image downstream.', 'inputs-data', ['crop', 'image', 'asset', 'reference', 'storyboard']),
  entry('slimgNode', '.slimg', 'Save the connected image as a new editable .slimg and open it in Image; outputs the flattened result live (re-flattens as you edit it).', 'inputs-data', ['slimg', 'image', 'save', 'edit', 'flatten', 'bridge']),
  entry('numberNode', 'Number', 'Legacy numeric value node for math and list workflows.', 'inputs-data', ['number', 'primitive']),
  entry('sourceBin', 'Source Bin', 'Expose project source-bin assets to the Flow canvas.', 'inputs-data', ['asset', 'source']),
  entry('packageNode', 'Asset Package', 'Bundle an image/media asset with descriptive text.', 'inputs-data', ['package', 'asset']),

  entry('list', 'Typed List', 'Collect connected items into a typed batch list.', 'lists-envelopes', ['list', 'batch']),
  entry('envelope', 'Envelope', 'Build or collect a typed list of output items.', 'lists-envelopes', ['envelope', 'typed list', 'batch']),
  entry('expander', 'Expander', 'Select one item from a list or envelope for downstream use.', 'lists-envelopes', ['list', 'select']),
  entry('arrayFlatNode', 'List Flattener', 'Flatten nested lists into one list.', 'lists-envelopes', ['list', 'nested']),
  entry('listLengthNode', 'List Length', 'Count items in a list or envelope.', 'lists-envelopes', ['list', 'count']),

  entry('runMeNode', 'RUN ME', 'Add an explicit run trigger waypoint.', 'flow-control', ['run', 'trigger']),
  entry('loopNode', 'Simple Loop', 'Repeat a connected item a fixed number of times.', 'flow-control', ['loop', 'batch']),
  entry('loopGateNode', 'While Gate', 'Gate or repeat while a condition remains true.', 'flow-control', ['loop', 'condition']),
  entry('loopBreakNode', 'Stop When', 'Stop a batch/list/envelope loop when a connected condition becomes true.', 'flow-control', ['break', 'stop', 'loop', 'condition']),
  entry('switchNode', 'On/Off Switch', 'Pass or block a connected signal.', 'flow-control', ['switch', 'gate']),
  entry('forkSwitchNode', 'Fork Switch', 'Choose one of two branch outputs.', 'flow-control', ['switch', 'branch']),

  entry('logicNode', 'Boolean Logic', 'Combine boolean-like values with AND, OR, XOR, or NOT.', 'logic-math', ['boolean', 'logic']),
  entry('conditionalNode', 'If / Else', 'Choose between two values from a boolean-like condition.', 'logic-math', ['if', 'conditional']),
  entry('comparisonNode', 'Compare', 'Compare text or numbers and output a boolean.', 'logic-math', ['compare', 'boolean']),
  entry('switchCaseNode', 'Switch Case', 'Route values by matching a case.', 'logic-math', ['case', 'route']),
  entry('mathNode', 'Math', 'Perform arithmetic on numeric values.', 'logic-math', ['math', 'number']),
  entry('fallbackSelectorNode', 'Fallback Selector', 'Select the first usable value from candidates.', 'logic-math', ['fallback', 'route']),
  entry('javascriptNode', 'JavaScript Script', 'Execute custom JavaScript code with inputs A, B, and C.', 'logic-math', ['javascript', 'js', 'script', 'code', 'function', 'custom']),
  entry('jsonQueryNode', 'JSON Query', 'Extract data from a JSON object using JavaScript expression paths.', 'logic-math', ['json', 'query', 'path', 'extract', 'object', 'jsonata']),
  entry('regexParseNode', 'Regex Parse', 'Parse text and extract match groups using a regular expression pattern.', 'logic-math', ['regex', 'parse', 'match', 'pattern', 'extract', 'groups']),
  entry('pythonNode', 'Python Script', 'Execute Python-like script/expression logic with inputs A, B, and C.', 'logic-math', ['python', 'py', 'script', 'code', 'function', 'custom']),
  entry('jsonBuilderNode', 'JSON Builder', 'Construct a JSON object dynamically from inputs A, B, C, D, and E.', 'logic-math', ['json', 'build', 'create', 'object', 'template']),
  entry('htmlSandboxNode', 'HTML Sandbox', 'Render dynamic HTML, CSS, and JS inside an interactive sandbox iframe.', 'logic-math', ['html', 'css', 'js', 'sandbox', 'preview', 'iframe', 'visual']),
  entry('apiFetchNode', 'API Requester', 'Perform a GET or POST web request to any URL with custom headers and body.', 'logic-math', ['fetch', 'api', 'request', 'http', 'get', 'post', 'url', 'web']),
  entry('sqlQueryNode', 'SQL Query', 'Execute SELECT queries and JOIN operations on arrays A and B.', 'logic-math', ['sql', 'query', 'join', 'select', 'where', 'list', 'filter']),
  entry('csvParserNode', 'CSV Interop', 'Parse CSV to JSON lists or format JSON lists into CSV files.', 'logic-math', ['csv', 'parse', 'format', 'interop', 'list', 'excel']),
  entry('mathExpressionNode', 'Math Expression', 'Evaluate multi-variable algebraic formulas and math functions.', 'logic-math', ['math', 'expression', 'formula', 'algebra', 'equation']),
  entry('xmlYamlNode', 'XML/YAML Interop', 'Convert data seamlessly between JSON, XML, and YAML structures.', 'logic-math', ['xml', 'yaml', 'json', 'interop', 'parse', 'convert']),

  entry('stringTemplateNode', 'String Template', 'Render text from placeholders like {A}, {B}, and {C}.', 'text-tools', ['template', 'prompt']),
  entry('regexReplaceNode', 'Regex Replace', 'Replace text using a regular expression.', 'text-tools', ['regex', 'text']),
  entry('promptsJoinerNode', 'Prompt Joiner', 'Join prompt fragments with a delimiter.', 'text-tools', ['join', 'prompt']),
  entry('negativePromptNode', 'Negative Prompt', 'Combine exclusions and negative prompt fragments.', 'text-tools', ['negative', 'prompt']),
  entry('promptMixerNode', 'Prompt Mixer', 'Mix prompt variations for story and art generation.', 'text-tools', ['prompt', 'variation']),

  entry('storyStateNode', 'Story State', 'Store or reuse a named story variable.', 'story-tools', ['story', 'state']),
  entry('seedSequencerNode', 'Seed Sequencer', 'Generate repeatable seed sequences.', 'story-tools', ['seed', 'sequence']),
  entry('textSentimentAnalysisNode', 'Sentiment Analyzer', 'Score text polarity with a deterministic local keyword heuristic.', 'story-tools', ['text', 'analysis', 'polarity']),
  entry('imageFeatureExtractorNode', 'Image Feature Extractor', 'Extract dimensions, orientation, aspect ratio, and average color locally.', 'story-tools', ['image', 'analysis', 'dimensions', 'color']),
  entry('dialogueScriptSplitterNode', 'Dialogue Splitter', 'Split dialogue/script text into usable story chunks.', 'story-tools', ['dialogue', 'script']),

  entry('functionNode', 'Function', 'Use or configure a reusable collapsed graph function.', 'reuse-layout', ['function', 'reuse']),
  entry('groupNode', 'Group', 'Group related nodes visually on the canvas.', 'reuse-layout', ['group', 'layout']),
  entry('functionInputNode', 'Function Input Marker', 'Define a custom function entry point / input handle.', 'reuse-layout', ['function', 'input', 'marker', 'handle', 'entry']),
  entry('functionOutputNode', 'Function Output Marker', 'Define a custom function exit point / output handle.', 'reuse-layout', ['function', 'output', 'marker', 'handle', 'exit']),
  entry('virtual', 'Virtual Alias', 'Reuse an upstream output elsewhere without moving the original node.', 'reuse-layout', ['alias', 'reuse']),
  entry('portal', 'Portal Pair', 'Create paired waypoints for long-distance wiring.', 'reuse-layout', ['portal', 'layout']),
  entry('advancedImageEditor', 'Image Editor', 'Open an image-editing workspace node.', 'reuse-layout', ['image', 'editor']),

  entry('valueMonitorNode', 'Value Monitor', 'Inspect a connected signal, list, envelope, or media value.', 'monitor-debug', ['monitor', 'debug']),
  entry('visionVerifyNode', 'Vision Verify', 'Ask a vision model to verify an image against a prompt.', 'monitor-debug', ['vision', 'verify']),

  entry('settings', 'Config', 'Configure execution defaults for connected nodes.', 'settings', ['settings', 'config']),
];

interface LocalizedCatalogText {
  label: string;
  description: string;
}

const NODE_CATEGORY_JA: Record<FlowNodeCatalogCategoryId, LocalizedCatalogText> = {
  generate: { label: '生成', description: 'AI メディア生成と最終出力。' },
  'inputs-data': { label: '入力・データ', description: 'プロンプト、プリミティブ値、ソースビンのアセット、パッケージ。' },
  'lists-envelopes': { label: 'リスト・エンベロープ', description: 'バッチ入力、型付きリスト、エンベロープ、アイテム展開。' },
  'flow-control': { label: 'フロー制御', description: '実行トリガー、ループ、ゲート、明示的なループ停止。' },
  'logic-math': { label: 'ロジック・計算', description: 'ブール論理、比較、計算、ルーティング。' },
  'text-tools': { label: 'テキストツール', description: 'テンプレート、プロンプト結合、置換、プロンプトユーティリティ。' },
  'story-tools': { label: 'ストーリーツール', description: 'シーン・セリフ・状態・分析のための連続漫画ヘルパー。' },
  'reuse-layout': { label: '再利用・レイアウト', description: '関数、グループ、ポータル、エイリアス、ワークスペースの整理。' },
  'monitor-debug': { label: 'モニター・デバッグ', description: '値の確認と接続メディアの検証。' },
  settings: { label: '設定', description: 'プロバイダーと実行の設定。' },
};

const NODE_ENTRY_JA: Partial<Record<FlowNodeType, LocalizedCatalogText>> = {
  imageGen: { label: '画像', description: '選択した画像プロバイダーで画像を生成・編集します。' },
  videoGen: { label: '動画', description: 'プロンプト・フレーム・参照・ソースクリップから動画を生成します。' },
  audioGen: { label: '音声', description: '音声・効果音・ボイスチェンジ音声を生成します。' },
  transcriptionNode: { label: '文字起こし', description: '接続した音声または動画をテキスト、タイム付き JSON、VTT、SRT 字幕に変換します。' },
  audioProcessNode: { label: '音声処理', description: '元の素材を置き換えずに、接続した音声または動画から会話音声を分離します。' },
  composition: { label: 'コンポジション', description: '動画・音声・タイムラインアセットをレンダリングして 1 本にまとめます。' },
  textNode: { label: 'テキストプロンプト', description: 'プロンプトを書く、または下流ノード用にテキストを生成します。' },
  valueNode: { label: '値', description: '型付きプリミティブ値（テキスト・数値・真偽・JSON）を作成します。' },
  colorSwatchNode: { label: 'カラーパレット', description: '画像・動画の色の一貫性を導くマスターパレットを作成。色をカラースウォッチにドラッグしてシーンごとに名前を付けられます。' },
  colorSwatchListNode: { label: 'カラースウォッチ', description: 'カラーパレットの一部に名前を付けたもの。パレットの色をドラッグし、シーンやコマごとに（髪・肌・シャツなど）名前を付けます。' },
  loraSpecNode: { label: 'LoRA スペック', description: 'FLUX LoRA モデルが受け取る JSON の LoRA ウェイト（パス＋スケール、最大 3 つ）を作成し、FLUX LoRA 画像ノードに接続します。' },
  doodleNode: { label: 'ラフスケッチ', description: '青鉛筆の参照画像と説明をスケッチし、Image ノード用にまとめます。' },
  cropImageNode: { label: '画像トリミング', description: '接続した画像 1 枚をローカルでトリミングし、下流に出力します。' },
  slimgNode: { label: '.slimg', description: '接続した画像を新しい編集可能な .slimg として保存し Image で開きます。フラット化した結果をライブ出力します（編集に応じて再フラット化）。' },
  numberNode: { label: '数値', description: '計算やリスト処理向けの従来の数値ノード。' },
  sourceBin: { label: 'ソースビン', description: 'プロジェクトのソースビンのアセットを Flow キャンバスに公開します。' },
  packageNode: { label: 'アセットパッケージ', description: '画像／メディアアセットを説明テキストと束ねます。' },
  list: { label: '型付きリスト', description: '接続したアイテムを型付きのバッチリストにまとめます。' },
  envelope: { label: 'エンベロープ', description: '出力アイテムの型付きリストを作成・収集します。' },
  expander: { label: 'エキスパンダー', description: 'リストやエンベロープから 1 つのアイテムを選んで下流に渡します。' },
  arrayFlatNode: { label: 'リスト平坦化', description: 'ネストしたリストを 1 つのリストに平坦化します。' },
  listLengthNode: { label: 'リスト長', description: 'リストやエンベロープのアイテム数を数えます。' },
  runMeNode: { label: 'RUN ME', description: '明示的な実行トリガーの中継点を追加します。' },
  loopNode: { label: 'シンプルループ', description: '接続したアイテムを固定回数だけ繰り返します。' },
  loopGateNode: { label: 'While ゲート', description: '条件が真である間、ゲートまたは繰り返しを行います。' },
  loopBreakNode: { label: '停止条件', description: '接続した条件が真になったらバッチ／リスト／エンベロープのループを停止します。' },
  switchNode: { label: 'オン/オフスイッチ', description: '接続した信号を通すか遮断します。' },
  forkSwitchNode: { label: 'フォークスイッチ', description: '2 つの分岐出力のどちらかを選びます。' },
  logicNode: { label: 'ブール論理', description: 'AND・OR・XOR・NOT でブール値を組み合わせます。' },
  conditionalNode: { label: 'If / Else', description: '真偽条件で 2 つの値のどちらかを選びます。' },
  comparisonNode: { label: '比較', description: 'テキストや数値を比較し、真偽値を出力します。' },
  switchCaseNode: { label: 'スイッチケース', description: 'ケースの一致で値をルーティングします。' },
  mathNode: { label: '計算', description: '数値に算術演算を行います。' },
  fallbackSelectorNode: { label: 'フォールバック選択', description: '候補から最初に使える値を選びます。' },
  javascriptNode: { label: 'JavaScript スクリプト', description: '入力 A・B・C を使ってカスタム JavaScript コードを実行します。' },
  jsonQueryNode: { label: 'JSON クエリ', description: 'JavaScript 式のパスで JSON オブジェクトからデータを抽出します。' },
  regexParseNode: { label: '正規表現パース', description: '正規表現パターンでテキストを解析し、マッチグループを抽出します。' },
  pythonNode: { label: 'Python スクリプト', description: '入力 A・B・C を使って Python 風のスクリプト／式ロジックを実行します。' },
  jsonBuilderNode: { label: 'JSON ビルダー', description: '入力 A・B・C・D・E から JSON オブジェクトを動的に構築します。' },
  htmlSandboxNode: { label: 'HTML サンドボックス', description: 'インタラクティブなサンドボックス iframe 内で動的な HTML・CSS・JS を描画します。' },
  apiFetchNode: { label: 'API リクエスター', description: '任意の URL に対してカスタムヘッダーとボディで GET／POST リクエストを送ります。' },
  sqlQueryNode: { label: 'SQL クエリ', description: '配列 A・B に対して SELECT クエリと JOIN を実行します。' },
  csvParserNode: { label: 'CSV 相互変換', description: 'CSV を JSON リストに解析、または JSON リストを CSV に整形します。' },
  mathExpressionNode: { label: '数式', description: '多変数の代数式と数学関数を評価します。' },
  xmlYamlNode: { label: 'XML/YAML 相互変換', description: 'JSON・XML・YAML の構造をシームレスに変換します。' },
  stringTemplateNode: { label: '文字列テンプレート', description: '{A}・{B}・{C} などのプレースホルダーからテキストを生成します。' },
  regexReplaceNode: { label: '正規表現置換', description: '正規表現でテキストを置換します。' },
  promptsJoinerNode: { label: 'プロンプト結合', description: 'プロンプトの断片を区切り文字で結合します。' },
  negativePromptNode: { label: 'ネガティブプロンプト', description: '除外語やネガティブプロンプトの断片をまとめます。' },
  promptMixerNode: { label: 'プロンプトミキサー', description: 'ストーリーやアート生成向けにプロンプトのバリエーションを混ぜます。' },
  storyStateNode: { label: 'ストーリー状態', description: '名前付きのストーリー変数を保存・再利用します。' },
  seedSequencerNode: { label: 'シードシーケンサー', description: '再現可能なシード列を生成します。' },
  textSentimentAnalysisNode: { label: '感情分析', description: 'ルーティングやシーンロジック向けにテキストの感情を分析します。' },
  imageFeatureExtractorNode: { label: '画像特徴抽出', description: '一貫性チェック向けに画像の特徴を抽出します。' },
  dialogueScriptSplitterNode: { label: 'セリフ分割', description: 'セリフ／脚本テキストを使いやすいストーリー単位に分割します。' },
  functionNode: { label: '関数', description: '再利用可能な折りたたみグラフ関数を使用・設定します。' },
  groupNode: { label: 'グループ', description: '関連するノードをキャンバス上で視覚的にグループ化します。' },
  functionInputNode: { label: '関数入力マーカー', description: 'カスタム関数の入口／入力ハンドルを定義します。' },
  functionOutputNode: { label: '関数出力マーカー', description: 'カスタム関数の出口／出力ハンドルを定義します。' },
  virtual: { label: '仮想エイリアス', description: '元のノードを動かさずに、上流の出力を別の場所で再利用します。' },
  portal: { label: 'ポータルペア', description: '長距離配線用のペア中継点を作成します。' },
  advancedImageEditor: { label: '画像エディター', description: '画像編集ワークスペースノードを開きます。' },
  valueMonitorNode: { label: '値モニター', description: '接続した信号・リスト・エンベロープ・メディア値を確認します。' },
  visionVerifyNode: { label: 'ビジョン検証', description: 'ビジョンモデルに画像をプロンプトと照合させます。' },
  settings: { label: '設定', description: '接続ノードの実行デフォルトを設定します。' },
};

export function nodeCategoryLabel(category: FlowNodeCatalogCategory, locale: AppLocale = 'en'): string {
  return locale === 'ja' ? NODE_CATEGORY_JA[category.id]?.label ?? category.label : category.label;
}

export function nodeCategoryDescription(category: FlowNodeCatalogCategory, locale: AppLocale = 'en'): string {
  return locale === 'ja' ? NODE_CATEGORY_JA[category.id]?.description ?? category.description : category.description;
}

export function nodeCatalogEntryLabel(entry: FlowNodeCatalogEntry, locale: AppLocale = 'en'): string {
  return locale === 'ja' ? NODE_ENTRY_JA[entry.type]?.label ?? entry.label : entry.label;
}

export function nodeCatalogEntryDescription(entry: FlowNodeCatalogEntry, locale: AppLocale = 'en'): string {
  return locale === 'ja' ? NODE_ENTRY_JA[entry.type]?.description ?? entry.description : entry.description;
}

export function getNodeCatalogEntry(type: FlowNodeType): FlowNodeCatalogEntry | undefined {
  return FLOW_NODE_CATALOG_ENTRIES.find((entry) => entry.type === type);
}

export function getNodeCatalogEntriesForCategory(categoryId: FlowNodeCatalogCategoryId): FlowNodeCatalogEntry[] {
  return FLOW_NODE_CATALOG_ENTRIES.filter((entry) => entry.categoryId === categoryId);
}

export function findNodeCatalogEntries(query: string): FlowNodeCatalogEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return FLOW_NODE_CATALOG_ENTRIES;
  }

  return FLOW_NODE_CATALOG_ENTRIES.filter((entry) => [
    entry.label,
    entry.description,
    entry.categoryId,
    NODE_ENTRY_JA[entry.type]?.label ?? '',
    NODE_ENTRY_JA[entry.type]?.description ?? '',
    ...entry.tags,
  ].some((value) => value.toLowerCase().includes(normalized)));
}

function entry(
  type: FlowNodeType,
  label: string,
  _legacyDescription: string,
  categoryId: FlowNodeCatalogCategoryId,
  tags: string[],
  initialData?: Partial<NodeData>,
): FlowNodeCatalogEntry {
  return { type, label, description: FLOW_NODE_CONTRACTS[type].purpose, categoryId, tags, initialData };
}
