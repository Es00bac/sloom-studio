import type {
  AppNode,
  FunctionNodeConfig,
  FunctionPortKind,
  FunctionValueKind,
  NodeData,
} from '../types/flow';
import type { Edge } from '@xyflow/react';
import { createDefaultFunctionNodeConfig } from './functionNodes';

export interface StandardLibraryPort {
  key: string;
  label: string;
  resultType: FunctionValueKind;
  description?: string;
  required?: boolean;
}

export interface StandardLibraryFunction {
  id: string;
  name: string;
  description: string;
  usage?: string;
  nodes: Partial<AppNode>[];
  edges: Partial<Edge>[];
  tags: string[];
  inputPorts?: StandardLibraryPort[];
  outputPorts?: StandardLibraryPort[];
  source?: 'built-in' | 'custom';
  functionNodeConfig?: FunctionNodeConfig;
}

export const STANDARD_LIBRARY_FUNCTIONS: StandardLibraryFunction[] = [
  {
    "id": "iterative-refinement",
    "name": "Iterative Refinement",
    "description": "Image Gen -> Vision Verify -> Conditional (Loop Back vs. Continue)",
    "tags": [
      "image",
      "vision",
      "loop"
    ],
    "nodes": [
      {
        "id": "img-gen",
        "type": "imageGen",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "id": "vision-verify",
        "type": "visionVerifyNode",
        "position": {
          "x": 400,
          "y": 0
        }
      },
      {
        "id": "conditional",
        "type": "conditionalNode",
        "position": {
          "x": 800,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "img-gen",
        "target": "vision-verify",
        "targetHandle": "image"
      },
      {
        "id": "e2",
        "source": "vision-verify",
        "target": "conditional",
        "targetHandle": "condition"
      }
    ]
  },
  {
    "id": "text-image-video",
    "name": "Text to Image to Video",
    "description": "Prompt Input -> Image Gen -> Video Gen (Basic pipeline)",
    "tags": [
      "text",
      "image",
      "video",
      "pipeline"
    ],
    "nodes": [
      {
        "id": "prompt",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "A cinematic shot of a cyberpunk city at night"
        }
      },
      {
        "id": "img-gen",
        "type": "imageGen",
        "position": {
          "x": 400,
          "y": 0
        }
      },
      {
        "id": "vid-gen",
        "type": "videoGen",
        "position": {
          "x": 800,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "prompt",
        "target": "img-gen"
      },
      {
        "id": "e2",
        "source": "img-gen",
        "target": "vid-gen",
        "targetHandle": "video-start-frame"
      }
    ]
  },
  {
    "id": "prompt-enhancer",
    "name": "Prompt Enhancer",
    "description": "Base Prompt + Style Array (List) -> Prompts Joiner -> Image Gen",
    "tags": [
      "prompt",
      "text",
      "image"
    ],
    "nodes": [
      {
        "id": "base-prompt",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "A portrait of a knight"
        }
      },
      {
        "id": "style-list",
        "type": "list",
        "position": {
          "x": 0,
          "y": 400
        }
      },
      {
        "id": "joiner",
        "type": "promptsJoinerNode",
        "position": {
          "x": 400,
          "y": 150
        }
      },
      {
        "id": "img-gen",
        "type": "imageGen",
        "position": {
          "x": 800,
          "y": 150
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "base-prompt",
        "target": "joiner",
        "targetHandle": "A"
      },
      {
        "id": "e2",
        "source": "style-list",
        "target": "joiner",
        "targetHandle": "B"
      },
      {
        "id": "e3",
        "source": "joiner",
        "target": "img-gen"
      }
    ]
  },
  {
    "id": "sentiment-analyzer",
    "name": "Sentiment Analyzer",
    "description": "Prompt Input -> Text Sentiment Analysis -> Switch Case",
    "tags": [
      "text",
      "logic",
      "routing"
    ],
    "nodes": [
      {
        "id": "input",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "This is absolutely amazing!"
        }
      },
      {
        "id": "sentiment",
        "type": "textSentimentAnalysisNode",
        "position": {
          "x": 400,
          "y": 0
        }
      },
      {
        "id": "switch",
        "type": "switchCaseNode",
        "position": {
          "x": 800,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "input",
        "target": "sentiment"
      },
      {
        "id": "e2",
        "source": "sentiment",
        "target": "switch"
      }
    ]
  },
  {
    "id": "character-consistency",
    "name": "Character Consistency",
    "description": "2x Image Gen -> Image Feature Extractor -> Comparison (Similarity) -> Value Monitor",
    "tags": [
      "image",
      "analysis",
      "comparison"
    ],
    "nodes": [
      {
        "id": "img1",
        "type": "imageGen",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "id": "img2",
        "type": "imageGen",
        "position": {
          "x": 0,
          "y": 800
        }
      },
      {
        "id": "extract1",
        "type": "imageFeatureExtractorNode",
        "position": {
          "x": 400,
          "y": 0
        }
      },
      {
        "id": "extract2",
        "type": "imageFeatureExtractorNode",
        "position": {
          "x": 400,
          "y": 800
        }
      },
      {
        "id": "compare",
        "type": "comparisonNode",
        "position": {
          "x": 800,
          "y": 400
        }
      },
      {
        "id": "monitor",
        "type": "valueMonitorNode",
        "position": {
          "x": 1200,
          "y": 400
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "img1",
        "target": "extract1"
      },
      {
        "id": "e2",
        "source": "img2",
        "target": "extract2"
      },
      {
        "id": "e3",
        "source": "extract1",
        "target": "compare",
        "targetHandle": "a"
      },
      {
        "id": "e4",
        "source": "extract2",
        "target": "compare",
        "targetHandle": "b"
      },
      {
        "id": "e5",
        "source": "compare",
        "target": "monitor"
      }
    ]
  },
  {
    "id": "dialogue-audio",
    "name": "Dialogue Splitter & Audio",
    "description": "Script Input -> Dialogue Script Splitter -> Array Flat -> Audio Gen",
    "tags": [
      "text",
      "audio",
      "script"
    ],
    "nodes": [
      {
        "id": "script",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "JOHN: Hello there.\nMARY: Hi!"
        }
      },
      {
        "id": "splitter",
        "type": "dialogueScriptSplitterNode",
        "position": {
          "x": 400,
          "y": 0
        }
      },
      {
        "id": "flat",
        "type": "arrayFlatNode",
        "position": {
          "x": 800,
          "y": 0
        }
      },
      {
        "id": "audio",
        "type": "audioGen",
        "position": {
          "x": 1200,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "script",
        "target": "splitter"
      },
      {
        "id": "e2",
        "source": "splitter",
        "target": "flat"
      },
      {
        "id": "e3",
        "source": "flat",
        "target": "audio"
      }
    ]
  },
  {
    "id": "negative-prompt-combiner",
    "name": "Negative Prompt Combiner",
    "description": "Positive Input, Multiple Negative Inputs -> Negative Prompt Node -> Image Gen",
    "tags": [
      "prompt",
      "image",
      "utilities"
    ],
    "nodes": [
      {
        "id": "pos",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "A beautiful landscape"
        }
      },
      {
        "id": "neg1",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 400
        },
        "data": {
          "prompt": "blurry, low resolution"
        }
      },
      {
        "id": "neg2",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 800
        },
        "data": {
          "prompt": "watermarks, text"
        }
      },
      {
        "id": "combiner",
        "type": "negativePromptNode",
        "position": {
          "x": 400,
          "y": 400
        }
      },
      {
        "id": "img",
        "type": "imageGen",
        "position": {
          "x": 800,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "neg1",
        "target": "combiner",
        "targetHandle": "exclude"
      },
      {
        "id": "e2",
        "source": "neg2",
        "target": "combiner",
        "targetHandle": "exclude"
      },
      {
        "id": "e3",
        "source": "pos",
        "target": "combiner",
        "targetHandle": "text"
      },
      {
        "id": "e4",
        "source": "combiner",
        "target": "img"
      }
    ]
  },
  {
    "id": "fallback-generator",
    "name": "Fallback Generator",
    "description": "Primary Image Gen -> Fallback Selector -> Secondary Image Gen",
    "tags": [
      "reliability",
      "image",
      "logic"
    ],
    "nodes": [
      {
        "id": "primary",
        "type": "imageGen",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "id": "fallback-sel",
        "type": "fallbackSelectorNode",
        "position": {
          "x": 400,
          "y": 0
        }
      },
      {
        "id": "secondary",
        "type": "imageGen",
        "position": {
          "x": 0,
          "y": 800
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "primary",
        "target": "fallback-sel",
        "targetHandle": "primary"
      },
      {
        "id": "e2",
        "source": "secondary",
        "target": "fallback-sel",
        "targetHandle": "fallback"
      }
    ]
  },
  {
    "id": "story-state-tracker",
    "name": "Story State Tracker",
    "description": "Prompt Input -> Story State Variable (Update) -> Read -> String Template",
    "tags": [
      "state",
      "text",
      "variables"
    ],
    "nodes": [
      {
        "id": "input",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "John's Adventure"
        }
      },
      {
        "id": "update",
        "type": "storyStateNode",
        "position": {
          "x": 400,
          "y": 0
        },
        "data": {
          "key": "gameState",
          "value": "active"
        }
      },
      {
        "id": "read",
        "type": "storyStateNode",
        "position": {
          "x": 800,
          "y": 0
        },
        "data": {
          "key": "gameState"
        }
      },
      {
        "id": "template",
        "type": "stringTemplateNode",
        "position": {
          "x": 1200,
          "y": 0
        },
        "data": {
          "template": "Playing: {{var1}}"
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "input",
        "target": "update"
      },
      {
        "id": "e2",
        "source": "read",
        "target": "template",
        "targetHandle": "var1"
      }
    ]
  },
  {
    "id": "ab-testing-fork",
    "name": "A/B Testing (Fork)",
    "description": "Prompt Input -> Fork Switch -> 2x Image Gen -> Comparison",
    "tags": [
      "testing",
      "image",
      "logic"
    ],
    "nodes": [
      {
        "id": "prompt",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 400
        },
        "data": {
          "prompt": "A futuristic car"
        }
      },
      {
        "id": "fork",
        "type": "forkSwitchNode",
        "position": {
          "x": 400,
          "y": 400
        }
      },
      {
        "id": "imgA",
        "type": "imageGen",
        "position": {
          "x": 800,
          "y": 0
        }
      },
      {
        "id": "imgB",
        "type": "imageGen",
        "position": {
          "x": 800,
          "y": 800
        }
      },
      {
        "id": "compare",
        "type": "comparisonNode",
        "position": {
          "x": 1200,
          "y": 400
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "prompt",
        "target": "fork"
      },
      {
        "id": "e2",
        "source": "fork",
        "target": "imgA"
      },
      {
        "id": "e3",
        "source": "fork",
        "target": "imgB"
      },
      {
        "id": "e4",
        "source": "imgA",
        "target": "compare",
        "targetHandle": "a"
      },
      {
        "id": "e5",
        "source": "imgB",
        "target": "compare",
        "targetHandle": "b"
      }
    ]
  },
  {
    "id": "random-style-roulette",
    "name": "Random Style Roulette",
    "description": "Seed Sequencer -> Math Node (Modulo) -> Switch Case -> Image Gen",
    "tags": [
      "random",
      "image",
      "style"
    ],
    "nodes": [
      {
        "id": "seed",
        "type": "seedSequencerNode",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "id": "math",
        "type": "mathNode",
        "position": {
          "x": 400,
          "y": 0
        },
        "data": {
          "operation": "modulo",
          "valueB": 3
        }
      },
      {
        "id": "switch",
        "type": "switchCaseNode",
        "position": {
          "x": 800,
          "y": 0
        }
      },
      {
        "id": "img",
        "type": "imageGen",
        "position": {
          "x": 1200,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "seed",
        "target": "math"
      },
      {
        "id": "e2",
        "source": "math",
        "target": "switch"
      },
      {
        "id": "e3",
        "source": "switch",
        "target": "img"
      }
    ]
  },
  {
    "id": "safe-image-loop",
    "name": "Safe Image Loop",
    "description": "Image Gen -> Vision Verify (Checking for artifacts) -> Loop Gate",
    "tags": [
      "loop",
      "vision",
      "safety"
    ],
    "nodes": [
      {
        "id": "loop",
        "type": "loopGateNode",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "id": "img",
        "type": "imageGen",
        "position": {
          "x": 400,
          "y": 0
        }
      },
      {
        "id": "verify",
        "type": "visionVerifyNode",
        "position": {
          "x": 800,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "loop",
        "target": "img"
      },
      {
        "id": "e2",
        "source": "img",
        "target": "verify",
        "targetHandle": "image"
      },
      {
        "id": "e3",
        "source": "verify",
        "target": "loop"
      }
    ]
  },
  {
    "id": "audio-video-muxer",
    "name": "Audio-Video Muxer",
    "description": "Audio Gen + Video Gen -> Composition Node",
    "tags": [
      "audio",
      "video",
      "muxing"
    ],
    "nodes": [
      {
        "id": "audio",
        "type": "audioGen",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "id": "video",
        "type": "videoGen",
        "position": {
          "x": 0,
          "y": 800
        }
      },
      {
        "id": "comp",
        "type": "composition",
        "position": {
          "x": 400,
          "y": 400
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "audio",
        "target": "comp",
        "targetHandle": "audio-track-0"
      },
      {
        "id": "e2",
        "source": "video",
        "target": "comp",
        "targetHandle": "video-track-0"
      }
    ]
  },
  {
    "id": "dynamic-image-composition",
    "name": "Dynamic Image Composition",
    "description": "Foreground + Background -> Advanced Image Editor",
    "tags": [
      "image",
      "composition",
      "editing"
    ],
    "nodes": [
      {
        "id": "fg",
        "type": "imageGen",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "id": "bg",
        "type": "imageGen",
        "position": {
          "x": 0,
          "y": 800
        }
      },
      {
        "id": "editor",
        "type": "advancedImageEditor",
        "position": {
          "x": 400,
          "y": 400
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "bg",
        "target": "editor",
        "targetHandle": "sourceImage"
      },
      {
        "id": "e2",
        "source": "fg",
        "target": "editor",
        "targetHandle": "reference"
      }
    ]
  },
  {
    "id": "data-package-builder",
    "name": "Data Package Builder",
    "description": "Multiple text/image inputs -> Package Node",
    "tags": [
      "data",
      "package",
      "routing"
    ],
    "nodes": [
      {
        "id": "text1",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "Packaged Text"
        }
      },
      {
        "id": "img1",
        "type": "imageGen",
        "position": {
          "x": 0,
          "y": 400
        }
      },
      {
        "id": "package",
        "type": "packageNode",
        "position": {
          "x": 400,
          "y": 200
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "text1",
        "target": "package",
        "targetHandle": "text"
      },
      {
        "id": "e2",
        "source": "img1",
        "target": "package",
        "targetHandle": "image"
      }
    ]
  },
  {
    "id": "string-template-formatter",
    "name": "String Template Formatter",
    "description": "Multiple variables -> String Template -> Output",
    "tags": [
      "text",
      "formatting",
      "template"
    ],
    "nodes": [
      {
        "id": "var1",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "A cat"
        }
      },
      {
        "id": "var2",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 400
        },
        "data": {
          "prompt": "in space"
        }
      },
      {
        "id": "template",
        "type": "stringTemplateNode",
        "position": {
          "x": 400,
          "y": 200
        },
        "data": {
          "template": "{{var1}} {{var2}}"
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "var1",
        "target": "template",
        "targetHandle": "var1"
      },
      {
        "id": "e2",
        "source": "var2",
        "target": "template",
        "targetHandle": "var2"
      }
    ]
  },
  {
    "id": "regex-cleaner",
    "name": "Regex Cleaner",
    "description": "Raw Prompt -> Regex Replace -> Safe Prompt",
    "tags": [
      "text",
      "regex",
      "cleaning"
    ],
    "nodes": [
      {
        "id": "raw",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "Clean this string 123"
        }
      },
      {
        "id": "regex",
        "type": "regexReplaceNode",
        "position": {
          "x": 400,
          "y": 0
        }
      },
      {
        "id": "safe",
        "type": "valueMonitorNode",
        "position": {
          "x": 800,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "raw",
        "target": "regex"
      },
      {
        "id": "e2",
        "source": "regex",
        "target": "safe"
      }
    ]
  },
  {
    "id": "list-processor",
    "name": "List Processor",
    "description": "List of Prompts -> List Length -> Loop Gate -> Image Gen",
    "tags": [
      "list",
      "loop",
      "batch"
    ],
    "nodes": [
      {
        "id": "list",
        "type": "list",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "id": "length",
        "type": "listLengthNode",
        "position": {
          "x": 400,
          "y": 0
        }
      },
      {
        "id": "gate",
        "type": "loopGateNode",
        "position": {
          "x": 800,
          "y": 0
        }
      },
      {
        "id": "img",
        "type": "imageGen",
        "position": {
          "x": 1200,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "list",
        "target": "length"
      },
      {
        "id": "e2",
        "source": "length",
        "target": "gate",
        "targetHandle": "condition"
      },
      {
        "id": "e3",
        "source": "gate",
        "target": "img"
      }
    ]
  },
  {
    "id": "prompt-mixer",
    "name": "Prompt Mixer",
    "description": "2 Prompts + Weight -> Prompt Mixer -> Image Gen",
    "tags": [
      "prompt",
      "mixing",
      "image"
    ],
    "nodes": [
      {
        "id": "p1",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 0
        },
        "data": {
          "prompt": "A dog"
        }
      },
      {
        "id": "p2",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 400
        },
        "data": {
          "prompt": "A cat"
        }
      },
      {
        "id": "mixer",
        "type": "promptMixerNode",
        "position": {
          "x": 400,
          "y": 200
        }
      },
      {
        "id": "img",
        "type": "imageGen",
        "position": {
          "x": 800,
          "y": 200
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "p1",
        "target": "mixer",
        "targetHandle": "prompt1"
      },
      {
        "id": "e2",
        "source": "p2",
        "target": "mixer",
        "targetHandle": "prompt2"
      },
      {
        "id": "e3",
        "source": "mixer",
        "target": "img"
      }
    ]
  },
  {
    "id": "visual-debugger",
    "name": "Visual Debugger",
    "description": "Any Output -> Value Monitor + Portal",
    "tags": [
      "debug",
      "utility",
      "monitor"
    ],
    "nodes": [
      {
        "id": "monitor",
        "type": "valueMonitorNode",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "id": "portal",
        "type": "portal",
        "position": {
          "x": 400,
          "y": 0
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "monitor",
        "target": "portal"
      }
    ]
  },
  {
    "id": "state-driven-story-director",
    "name": "State-Driven Story Director",
    "description": "Text Input -> Story State Write -> Story State Read -> String Template -> LLM Prompt Gen -> Image Gen -> Vision Verify -> Loop Gate (Feedback Loop)",
    "tags": [
      "state",
      "logic",
      "loop",
      "agentic"
    ],
    "nodes": [
      {
        "id": "start-text",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 200
        },
        "data": {
          "prompt": "Chapter 1: The Lost Ruins"
        }
      },
      {
        "id": "state-write",
        "type": "storyStateNode",
        "position": {
          "x": 350,
          "y": 200
        },
        "data": {
          "key": "storyStage",
          "value": "exploration"
        }
      },
      {
        "id": "state-read",
        "type": "storyStateNode",
        "position": {
          "x": 700,
          "y": 200
        },
        "data": {
          "key": "storyStage"
        }
      },
      {
        "id": "template",
        "type": "stringTemplateNode",
        "position": {
          "x": 1050,
          "y": 200
        },
        "data": {
          "template": "Generate a scenic backdrop prompt of {{var1}} during the {{var2}} stage of the adventure."
        }
      },
      {
        "id": "llm-director",
        "type": "textNode",
        "position": {
          "x": 1400,
          "y": 200
        },
        "data": {
          "prompt": "A cinematic wide shot of ancient hyper-technology ruins embedded in mossy valley cliffs, highly detailed, dramatic sunset lighting."
        }
      },
      {
        "id": "img-gen",
        "type": "imageGen",
        "position": {
          "x": 1750,
          "y": 200
        }
      },
      {
        "id": "vision-check",
        "type": "visionVerifyNode",
        "position": {
          "x": 2100,
          "y": 200
        }
      },
      {
        "id": "loop-gate",
        "type": "loopGateNode",
        "position": {
          "x": 1050,
          "y": -200
        },
        "data": {
          "maxIterations": 4
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "start-text",
        "target": "state-write"
      },
      {
        "id": "e2",
        "source": "start-text",
        "target": "template",
        "targetHandle": "var1"
      },
      {
        "id": "e3",
        "source": "state-read",
        "target": "template",
        "targetHandle": "var2"
      },
      {
        "id": "e4",
        "source": "template",
        "target": "llm-director"
      },
      {
        "id": "e5",
        "source": "llm-director",
        "target": "img-gen"
      },
      {
        "id": "e6",
        "source": "img-gen",
        "target": "vision-check",
        "targetHandle": "image"
      },
      {
        "id": "e7",
        "source": "vision-check",
        "target": "loop-gate",
        "targetHandle": "condition"
      },
      {
        "id": "e8",
        "source": "loop-gate",
        "target": "llm-director"
      }
    ]
  },
  {
    "id": "multimodal-audiobook-engine",
    "name": "Multimodal Audiobook Engine",
    "description": "Full Screenplay Input -> Character Splitters -> British/American Voice TTS + Backdrops -> Visual-Audio Composition",
    "tags": [
      "audio",
      "text",
      "composition",
      "multimodal"
    ],
    "nodes": [
      {
        "id": "full-script",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 300
        },
        "data": {
          "prompt": "MARY: (Excited) We have discovered the ancient crystal core!\nJOHN: (Whispering) Careful, Mary. It is pulsing."
        }
      },
      {
        "id": "mary-filter",
        "type": "dialogueScriptSplitterNode",
        "position": {
          "x": 350,
          "y": 100
        },
        "data": {
          "prefix": "MARY:"
        }
      },
      {
        "id": "john-filter",
        "type": "dialogueScriptSplitterNode",
        "position": {
          "x": 350,
          "y": 500
        },
        "data": {
          "prefix": "JOHN:"
        }
      },
      {
        "id": "mary-tts",
        "type": "audioGen",
        "position": {
          "x": 750,
          "y": 100
        },
        "data": {
          "voice": "female-en-uk",
          "style": "excited",
          "accent": "british"
        }
      },
      {
        "id": "john-tts",
        "type": "audioGen",
        "position": {
          "x": 750,
          "y": 500
        },
        "data": {
          "voice": "male-en-us",
          "style": "whisper",
          "accent": "american"
        }
      },
      {
        "id": "scenic-prompt",
        "type": "stringTemplateNode",
        "position": {
          "x": 750,
          "y": 900
        },
        "data": {
          "template": "Cinematic shot of a glowing blue crystal core in an ancient underground cavern."
        }
      },
      {
        "id": "scenic-img",
        "type": "imageGen",
        "position": {
          "x": 1100,
          "y": 900
        }
      },
      {
        "id": "timeline",
        "type": "composition",
        "position": {
          "x": 1500,
          "y": 400
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "full-script",
        "target": "mary-filter"
      },
      {
        "id": "e2",
        "source": "full-script",
        "target": "john-filter"
      },
      {
        "id": "e3",
        "source": "mary-filter",
        "target": "mary-tts"
      },
      {
        "id": "e4",
        "source": "john-filter",
        "target": "john-tts"
      },
      {
        "id": "e5",
        "source": "scenic-prompt",
        "target": "scenic-img"
      },
      {
        "id": "e6",
        "source": "mary-tts",
        "target": "timeline",
        "targetHandle": "audio-track-0"
      },
      {
        "id": "e7",
        "source": "john-tts",
        "target": "timeline",
        "targetHandle": "audio-track-1"
      },
      {
        "id": "e8",
        "source": "scenic-img",
        "target": "timeline",
        "targetHandle": "video-track-0"
      }
    ]
  },
  {
    "id": "closed-loop-style-consistency",
    "name": "Closed-Loop Style Consistency",
    "description": "Base Reference + Generated Character -> Feature Extractor -> Comparison Node -> Fallback Selector (with backup image model)",
    "tags": [
      "image",
      "comparison",
      "logic",
      "reliability"
    ],
    "nodes": [
      {
        "id": "base-character",
        "type": "sourceBin",
        "position": {
          "x": 0,
          "y": 150
        },
        "data": {
          "label": "Main Character Model turnaround"
        }
      },
      {
        "id": "new-prompt",
        "type": "textNode",
        "position": {
          "x": 0,
          "y": 450
        },
        "data": {
          "prompt": "The same main character running through a glowing cyberpunk market, dynamic pose."
        }
      },
      {
        "id": "primary-gen",
        "type": "imageGen",
        "position": {
          "x": 350,
          "y": 450
        },
        "data": {
          "model": "Gemini 3.5 Flash"
        }
      },
      {
        "id": "extract-ref",
        "type": "imageFeatureExtractorNode",
        "position": {
          "x": 350,
          "y": 150
        }
      },
      {
        "id": "extract-gen",
        "type": "imageFeatureExtractorNode",
        "position": {
          "x": 700,
          "y": 450
        }
      },
      {
        "id": "similarity",
        "type": "comparisonNode",
        "position": {
          "x": 1050,
          "y": 300
        }
      },
      {
        "id": "fallback-gate",
        "type": "fallbackSelectorNode",
        "position": {
          "x": 1400,
          "y": 300
        }
      },
      {
        "id": "backup-gen",
        "type": "imageGen",
        "position": {
          "x": 1050,
          "y": 650
        },
        "data": {
          "model": "Stability Image Ultra"
        }
      },
      {
        "id": "output-monitor",
        "type": "valueMonitorNode",
        "position": {
          "x": 1750,
          "y": 300
        }
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "base-character",
        "target": "extract-ref"
      },
      {
        "id": "e2",
        "source": "new-prompt",
        "target": "primary-gen"
      },
      {
        "id": "e3",
        "source": "primary-gen",
        "target": "extract-gen"
      },
      {
        "id": "e4",
        "source": "extract-ref",
        "target": "similarity",
        "targetHandle": "a"
      },
      {
        "id": "e5",
        "source": "extract-gen",
        "target": "similarity",
        "targetHandle": "b"
      },
      {
        "id": "e6",
        "source": "primary-gen",
        "target": "fallback-gate",
        "targetHandle": "primary"
      },
      {
        "id": "e7",
        "source": "backup-gen",
        "target": "fallback-gate",
        "targetHandle": "fallback"
      },
      {
        "id": "e8",
        "source": "similarity",
        "target": "fallback-gate",
        "targetHandle": "condition"
      },
      {
        "id": "e9",
        "source": "fallback-gate",
        "target": "output-monitor"
      }
    ]
  }
];

export const SEQUENTIAL_ART_LIBRARY_FUNCTIONS: StandardLibraryFunction[] = [
  {
    id: 'expression-batch-prompter',
    name: 'Expression Batch Prompter',
    description: 'Turns a reusable prompt template plus a list of expressions into a batch of image prompts.',
    usage: 'Connect a text/list input to A or emotions. Example template: Make this face express: {A}. The output is a text list that image nodes auto-batch.',
    tags: ['batch', 'template', 'image', 'character', 'sequential-art'],
    inputPorts: [
      { key: 'emotions', label: 'Emotion list', resultType: 'list', description: 'A list of words such as happy, angry, afraid.' },
      { key: 'template', label: 'Template', resultType: 'text', description: 'Prompt text containing {A} or {{emotions}}.' },
      { key: 'character_reference', label: 'Character reference', resultType: 'image', description: 'Optional character source image.' },
    ],
    outputPorts: [
      { key: 'prompts', label: 'Rendered prompts', resultType: 'list', description: 'One rendered text prompt per list item.' },
    ],
    nodes: [
      {
        id: 'template',
        type: 'stringTemplateNode',
        position: { x: 0, y: 0 },
        data: { template: 'Make this face express: {A}' },
      },
    ],
    edges: [],
  },
  {
    id: 'script-to-panel-breakdown',
    name: 'Script to Panel Breakdown',
    description: 'Uses a language model step to break a prose or screenplay scene into comic or storyboard panels.',
    usage: 'Connect script text. The function returns a numbered text list of panel beats, camera notes, and required assets.',
    tags: ['script', 'paper', 'storyboard', 'text', 'ai'],
    inputPorts: [
      { key: 'script', label: 'Script', resultType: 'text', description: 'Scene prose, screenplay, or outline.' },
      { key: 'style_rules', label: 'Style rules', resultType: 'text', description: 'Optional comic/manga/video style constraints.' },
    ],
    outputPorts: [
      { key: 'panel_beats', label: 'Panel beats', resultType: 'list', description: 'Structured panel descriptions.' },
    ],
    nodes: [
      {
        id: 'director',
        type: 'textNode',
        position: { x: 0, y: 0 },
        data: {
          mode: 'generate',
          prompt: 'Break the connected script into sequential-art panels with shot type, action, dialogue, and asset needs.',
        },
      },
    ],
    edges: [],
  },
  {
    id: 'character-consistency-checker',
    name: 'Character Consistency Checker',
    description: 'Compares generated panels against a character reference and returns a boolean consistency result plus notes.',
    usage: 'Connect the generated panel image, reference image, and optional text requirements. Route the boolean output into conditionals or loop gates.',
    tags: ['vision', 'character', 'quality-control', 'loop', 'ai'],
    inputPorts: [
      { key: 'panel_image', label: 'Panel image', resultType: 'image', description: 'Generated image to verify.' },
      { key: 'reference_image', label: 'Reference image', resultType: 'image', description: 'Character sheet or style reference.' },
      { key: 'requirements', label: 'Requirements', resultType: 'text', description: 'What must stay consistent.' },
    ],
    outputPorts: [
      { key: 'consistent', label: 'Consistent', resultType: 'text', description: 'true/false consistency result.' },
      { key: 'notes', label: 'Notes', resultType: 'text', description: 'Brief explanation.' },
    ],
    nodes: [
      { id: 'verify', type: 'visionVerifyNode', position: { x: 0, y: 0 } },
      { id: 'monitor', type: 'valueMonitorNode', position: { x: 360, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'verify', target: 'monitor' }],
  },
  {
    id: 'storyboard-image-batch',
    name: 'Storyboard Image Batch',
    description: 'Converts a list of panel descriptions into a batch of image-generation prompts and generated storyboard frames.',
    usage: 'Connect panel beats and optional style/character references. The collapsed node outputs an image envelope for Paper, Image, or Video.',
    tags: ['storyboard', 'image', 'batch', 'paper', 'video'],
    inputPorts: [
      { key: 'panel_beats', label: 'Panel beats', resultType: 'list', description: 'Panel descriptions from a script breakdown.' },
      { key: 'style_reference', label: 'Style reference', resultType: 'image', description: 'Optional visual style reference.' },
      { key: 'character_reference', label: 'Character reference', resultType: 'image', description: 'Optional character sheet.' },
    ],
    outputPorts: [
      { key: 'frames', label: 'Generated frames', resultType: 'envelope', description: 'Batch image envelope.' },
    ],
    nodes: [
      { id: 'prompt', type: 'stringTemplateNode', position: { x: 0, y: 0 }, data: { template: 'Storyboard panel: {A}' } },
      { id: 'image', type: 'imageGen', position: { x: 360, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'prompt', target: 'image' }],
  },
  {
    id: 'dialogue-to-voice-lines',
    name: 'Dialogue to Voice Lines',
    description: 'Splits script dialogue into reusable voice-line prompts for audio generation.',
    usage: 'Connect a script. Use the generated text/audio list as narration, dialogue, or timing material in Video.',
    tags: ['dialogue', 'audio', 'tts', 'script', 'video'],
    inputPorts: [
      { key: 'script', label: 'Script', resultType: 'text', description: 'Dialogue script.' },
      { key: 'voice_style', label: 'Voice style', resultType: 'text', description: 'Accent, delivery, and emotion guidance.' },
    ],
    outputPorts: [
      { key: 'voice_lines', label: 'Voice lines', resultType: 'list', description: 'Separated line prompts.' },
      { key: 'audio', label: 'Generated audio', resultType: 'envelope', description: 'Optional generated audio batch.' },
    ],
    nodes: [
      { id: 'splitter', type: 'dialogueScriptSplitterNode', position: { x: 0, y: 0 } },
      { id: 'audio', type: 'audioGen', position: { x: 360, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'splitter', target: 'audio' }],
  },
  {
    id: 'continuity-validator',
    name: 'Continuity Validator',
    description: 'Checks story state, character references, and generated assets before they move into Paper or Video assembly.',
    usage: 'Connect generated asset envelopes plus continuity rules. Route true/false output to conditionals, monitors, or loop gates.',
    tags: ['quality-control', 'continuity', 'logic', 'vision', 'story'],
    inputPorts: [
      { key: 'assets', label: 'Assets', resultType: 'envelope', description: 'Generated images/video/audio to validate.' },
      { key: 'rules', label: 'Continuity rules', resultType: 'text', description: 'Story and visual constraints.' },
    ],
    outputPorts: [
      { key: 'passed', label: 'Passed', resultType: 'text', description: 'true/false result.' },
      { key: 'repair_notes', label: 'Repair notes', resultType: 'text', description: 'What to regenerate or edit.' },
    ],
    nodes: [
      { id: 'verify', type: 'visionVerifyNode', position: { x: 0, y: 0 } },
      { id: 'conditional', type: 'conditionalNode', position: { x: 360, y: 0 } },
    ],
    edges: [{ id: 'e1', source: 'verify', target: 'conditional', targetHandle: 'condition' }],
  },
  {
    id: 'paper-page-assembler',
    name: 'Paper Page Assembler',
    description: 'Packages panel images, captions, balloons, and layout notes for Paper workspace page construction.',
    usage: 'Connect generated frames and script/caption text. Output a package that can be sent to Paper or inspected in a monitor.',
    tags: ['paper', 'comic', 'layout', 'package'],
    inputPorts: [
      { key: 'frames', label: 'Frames', resultType: 'envelope', description: 'Panel images.' },
      { key: 'captions', label: 'Captions', resultType: 'list', description: 'Captions or balloon text.' },
      { key: 'layout_rules', label: 'Layout rules', resultType: 'text', description: 'Page size, reading order, and style rules.' },
    ],
    outputPorts: [
      { key: 'page_package', label: 'Page package', resultType: 'package', description: 'Paper-ready page assembly metadata.' },
    ],
    nodes: [
      { id: 'package', type: 'packageNode', position: { x: 0, y: 0 } },
    ],
    edges: [],
  },
  {
    id: 'image-to-video-shot-motion',
    name: 'Image to Video Shot Motion',
    description: 'Turns generated panel images into short motion shots with reusable video prompt logic.',
    usage: 'Connect an image or image envelope and motion instructions. The video node batches over compatible image inputs.',
    tags: ['video', 'image', 'motion', 'batch'],
    inputPorts: [
      { key: 'frames', label: 'Frames', resultType: 'envelope', description: 'Images to animate.' },
      { key: 'motion_prompt', label: 'Motion prompt', resultType: 'text', description: 'Camera and subject motion.' },
    ],
    outputPorts: [
      { key: 'shots', label: 'Video shots', resultType: 'envelope', description: 'Generated short videos.' },
    ],
    nodes: [
      { id: 'video', type: 'videoGen', position: { x: 0, y: 0 } },
    ],
    edges: [],
  },
];

export function getFunctionLibraryEntries(customFunctions: StandardLibraryFunction[]): StandardLibraryFunction[] {
  const builtIns: StandardLibraryFunction[] = [
    ...SEQUENTIAL_ART_LIBRARY_FUNCTIONS,
    ...STANDARD_LIBRARY_FUNCTIONS,
  ].map((entry) => ({ ...entry, source: 'built-in' as const }));

  return [...builtIns, ...customFunctions];
}

export function createLibraryFunctionFromFunctionNode(node: AppNode): StandardLibraryFunction | undefined {
  const config = node.data.functionNode;
  if (node.type !== 'functionNode' || !config) {
    return undefined;
  }

  return {
    id: node.id,
    name: config.title || node.data.customTitle || 'Custom function',
    description: config.description ?? 'Reusable function collapsed from the Flow workspace.',
    usage: 'Insert as one collapsed function node, then wire its configured inputs and outputs.',
    tags: config.tags ?? ['custom'],
    source: 'custom',
    inputPorts: config.contract.inputPorts.map((port) => ({
      key: port.key,
      label: port.label,
      resultType: port.resultType,
      description: port.description,
      required: port.required,
    })),
    outputPorts: config.contract.outputPorts.map((port) => ({
      key: port.key,
      label: port.label,
      resultType: port.resultType,
      description: port.description,
      required: port.required,
    })),
    nodes: config.graph.nodes as Partial<AppNode>[],
    edges: config.graph.edges,
    functionNodeConfig: cloneConfig(config),
  };
}

export function createFunctionNodeDataFromLibraryFunction(func: StandardLibraryFunction): Partial<NodeData> {
  if (func.functionNodeConfig) {
    const config = cloneConfig(func.functionNodeConfig);
    return {
      collapsed: true,
      customTitle: config.title || func.name,
      functionNode: config,
    };
  }

  const config = createDefaultFunctionNodeConfig(func.name);
  config.description = func.description;
  config.tags = func.tags;
  config.contract.id = slugifyIdentifier(func.id || func.name);
  config.contract.title = func.name;
  config.contract.description = func.description;
  config.contract.inputPorts = buildFunctionPorts('input', func.inputPorts ?? defaultInputPortsForFunction(func));
  config.contract.outputPorts = buildFunctionPorts('output', func.outputPorts ?? defaultOutputPortsForFunction(func));
  config.graph = {
    version: 1,
    nodes: func.nodes.map((node, index) => ({
      id: node.id ?? `node-${index + 1}`,
      type: node.type ?? 'textNode',
      position: node.position ?? { x: index * 360, y: 0 },
      data: (node.data ?? {}) as Record<string, unknown>,
    })),
    edges: func.edges.map((edge, index) => ({
      id: edge.id ?? `edge-${index + 1}`,
      source: edge.source ?? '',
      target: edge.target ?? '',
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })) as Edge[],
  };
  config.inputBindings = config.contract.inputPorts.map((port) => ({
    id: `input-binding-${port.id}`,
    targetInputPortId: port.id,
    source: {
      mode: 'flow',
      sourceType: 'nodeInput',
      sourceHandle: port.id,
      sourceVariable: port.key,
    },
    transforms: [],
    resultType: port.resultType,
    missing: { strategy: 'default', value: port.defaultValue ?? '' },
  }));
  const fallbackOutputNodeId = config.graph.nodes[config.graph.nodes.length - 1]?.id ?? '';
  config.outputBindings = config.contract.outputPorts.map((port) => ({
    id: `output-binding-${port.id}`,
    targetOutputPortId: port.id,
    sourceNodeId: fallbackOutputNodeId,
    transforms: [],
    resultType: port.resultType,
    missing: { strategy: 'default', value: '' },
  }));
  config.lastRunRuntime = {
    result: 'idle',
    lastRunAt: 0,
    nodeCount: config.graph.nodes.length,
    edgeCount: config.graph.edges.length,
  };

  return {
    collapsed: true,
    customTitle: func.name,
    functionNode: config,
  };
}

function cloneConfig(config: FunctionNodeConfig): FunctionNodeConfig {
  return JSON.parse(JSON.stringify(config)) as FunctionNodeConfig;
}

function buildFunctionPorts(kind: 'input' | 'output', ports: StandardLibraryPort[]): FunctionPortKind[] {
  return ports.map((port, index) => ({
    id: `${kind}-${index + 1}-${slugifyIdentifier(port.key) || kind}`,
    key: slugifyIdentifier(port.key) || `${kind}_${index + 1}`,
    label: port.label,
    description: port.description,
    resultType: port.resultType,
    required: port.required ?? false,
    order: index,
  }));
}

function defaultInputPortsForFunction(func: StandardLibraryFunction): StandardLibraryPort[] {
  const hasMedia = func.tags.some((tag) => ['image', 'video', 'audio'].includes(tag));
  return [
    {
      key: hasMedia ? 'input_asset' : 'input_text',
      label: hasMedia ? 'Input asset' : 'Input text',
      resultType: hasMedia ? 'any' : 'text',
      description: 'Primary function input.',
    },
  ];
}

function defaultOutputPortsForFunction(func: StandardLibraryFunction): StandardLibraryPort[] {
  const resultType: FunctionValueKind = func.tags.includes('video')
    ? 'video'
    : func.tags.includes('audio')
      ? 'audio'
      : func.tags.includes('image')
        ? 'image'
        : 'text';
  return [
    {
      key: 'result',
      label: 'Result',
      resultType,
      description: 'Function result.',
    },
  ];
}

function slugifyIdentifier(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}
