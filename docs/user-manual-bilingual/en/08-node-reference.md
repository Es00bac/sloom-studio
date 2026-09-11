# Flow Node Reference

> **Current-source baseline — 0.9.16-b (2026-08-27).** The node names below are
> a working catalogue, not a promise that every route is available on every device.
> The current installed provider packs, credentials, licence state, and runtime
> capabilities decide what can execute.

This chapter catalogs the nodes available in the Flow workspace. Nodes are grouped by category. For each node, this reference describes what it does, its inputs and outputs, and usage notes. Not every node may be available in every build; some require specific providers, licenses, or platforms.

## Execution, provider packs, and safety controls

### Resolve a route before relying on it

Provider packs describe a route's supported media/input/output capabilities and the credentials it
needs. Select a provider and model in the node or its project defaults, then read its capability and
readiness state before running. Model catalogues and provider pricing change independently of this
manual, so use the installed pack and the current model card rather than an old node count or an
internet list.

If a node's requested route cannot satisfy the requested operation, Flow shows a visible refusal or
needs-remapping state. It does not quietly exchange a requested model for a different one, invent a
missing provider capability, or publish a result from an unsuccessful dispatch. Correct the route,
inputs, credential, or project policy and run again.

### Reuse results deliberately

Flow can reuse a validated result-cache receipt for unchanged work. Changing an input invalidates
the affected downstream branch, so a partial rerun can keep valid upstream results while recomputing
what actually changed. Use **Regenerate** when you intentionally need to bypass a cached generator
result. Cancellation, a stale owner, or an unsuccessful dispatch must not publish a cache entry.

### Put a ceiling on paid work

Set a project-level **Flow spend cap** in the usage bar before launching paid generation. The cap is
checked before dispatch, including concurrent reservations. If a route has unknown pricing or a run
would exceed the remaining cap, Flow refuses it rather than guessing. The cap is a project control,
not an estimate, subscription statement, or provider bill; inspect the usage ledger and provider
account for their respective records.

### A reliable run pattern

1. Add a trigger, a small input/prompt branch, and one target node.
2. Select an installed route that explicitly advertises the required capability.
3. Set a cap if the route can incur cost, run, then inspect the node result and usage record.
4. Add loops, batches, schedules, and downstream delivery only after that single route succeeds.
   Scheduled/batch work remains tied to the open application/project session and retains normal
   capability, cache, cancellation, and spend checks.

## Generate

Nodes in the Generate category create media from prompts or other inputs.

### Image

Generates an image from a text prompt using a configured image provider.

- **Inputs:** prompt, negative prompt, width, height, seed, model, provider options.
- **Outputs:** image (Source Library reference).
- **Usage:** Connect prompt assembly nodes before this node. Use a seed input for reproducibility.

### Video

Generates a video clip from a text prompt, image, or existing video.

- **Inputs:** prompt, source image/video, duration, resolution, seed, model.
- **Outputs:** video (Source Library reference).
- **Usage:** Some providers require an image keyframe. Check the Usage Bar for cost estimates.

### Audio

Generates audio or music from a prompt.

- **Inputs:** prompt, duration, tempo, model.
- **Outputs:** audio (Source Library reference).
- **Usage:** Useful for background music and sound design.

### Composition

Generates a composite image or video from multiple sources.

- **Inputs:** layers, blend mode, dimensions, background.
- **Outputs:** composite media.
- **Usage:** Use for simple layering without switching to the Video or Image workspaces.

## Inputs & Data

Nodes that bring data into the flow.

### Text Prompt

Outputs a plain text string. The fundamental input for generation nodes.

- **Inputs:** text.
- **Outputs:** prompt string.
- **Usage:** Combine with String Template or Prompt Mixer for dynamic prompts.

### Value

Outputs a single value of any type.

- **Inputs:** value.
- **Outputs:** value.
- **Usage:** Use for constants such as model names or file paths.

### Number

Outputs a numeric value.

- **Inputs:** number.
- **Outputs:** number.
- **Usage:** Use for seeds, sizes, counters, and math operations.

### Color Palette

Outputs a list of color values.

- **Inputs:** colors, name.
- **Outputs:** palette.
- **Usage:** Connect to image generation or Paper color inputs.

### Color Swatch

Outputs a single color value.

- **Inputs:** color.
- **Outputs:** color.
- **Usage:** Use as a constant color in compositions or style references.

### LoRA Spec

Defines a LoRA (Low-Rank Adaptation) specification for image generation.

- **Inputs:** model name, weight, trigger text.
- **Outputs:** LoRA spec.
- **Usage:** Connect to Image or Video generation nodes that support LoRA.

### Doodle

Captures or loads a sketch.

- **Inputs:** image, strokes.
- **Outputs:** doodle image.
- **Usage:** Use as guidance for image-to-image generation.

### Crop Image

Crops an image to a region.

- **Inputs:** image, x, y, width, height.
- **Outputs:** cropped image.
- **Usage:** Prepare images for generation or consistent framing.

### .slimg

Loads a packaged Sloom image asset.

- **Inputs:** file path or Source Bin reference.
- **Outputs:** image layers.
- **Usage:** Bring editable images from the Image Editor into Flow.

### Source Bin

Reads an item from the Source Library.

- **Inputs:** item reference.
- **Outputs:** item data (depends on kind).
- **Usage:** The most common way to feed existing assets into a flow.

### Asset Package

Imports a packaged asset bundle.

- **Inputs:** package reference.
- **Outputs:** multiple assets.
- **Usage:** Unpack shared asset collections.

## Lists & Envelopes

Nodes for working with collections and structured data.

### Typed List

Creates a list where every item has the same type.

- **Inputs:** items.
- **Outputs:** list.
- **Usage:** Feed into loop nodes or batch operations.

### Envelope

Packages multiple named values into one structured object.

- **Inputs:** named fields.
- **Outputs:** envelope.
- **Usage:** Group related values such as prompt, seed, and model.

### Expander

Takes a list or envelope and spreads fields to separate outputs.

- **Inputs:** list/envelope.
- **Outputs:** individual items or fields.
- **Usage:** Convert a list into parallel inputs for a batch generator.

### List Flattener

Flattens a nested list into a single-level list.

- **Inputs:** nested list.
- **Outputs:** flat list.
- **Usage:** Combine outputs from nested loops.

### List Length

Returns the number of items in a list.

- **Inputs:** list.
- **Outputs:** number.
- **Usage:** Drive progress indicators or loop conditions.

## Flow Control

Nodes that control execution order and branching.

### RUN ME

A manual trigger to start execution.

- **Inputs:** (none)
- **Outputs:** trigger signal.
- **Usage:** Place at the start of a flow. Press the run button to fire.

### Simple Loop

Iterates over a list.

- **Inputs:** list.
- **Outputs:** item, index, done.
- **Usage:** Connect item output to a generator. Use done to trigger post-processing.

### While Gate

Loops while a condition is true.

- **Inputs:** condition.
- **Outputs:** iteration, done.
- **Usage:** Use for retries, pagination, or convergence algorithms.

### Stop When

Halts a loop when a condition becomes true.

- **Inputs:** condition.
- **Outputs:** stopped signal.
- **Usage:** Place inside a loop body to break early.

### On/Off Switch

Enables or disables a downstream branch.

- **Inputs:** enable, input signal.
- **Outputs:** output signal or none.
- **Usage:** Toggle features without rewiring.

### Fork Switch

Routes input to one of several outputs based on a selector.

- **Inputs:** selector, input signal.
- **Outputs:** case outputs.
- **Usage:** Implement multi-way branching.

## Logic & Math

Nodes for computation and decision making.

### Boolean Logic

Performs AND, OR, NOT, XOR operations.

- **Inputs:** boolean values, operator.
- **Outputs:** boolean result.
- **Usage:** Combine conditional flags.

### If/Else

Routes data based on a boolean condition.

- **Inputs:** condition, true value, false value.
- **Outputs:** selected value.
- **Usage:** Implement conditional data flow.

### Compare

Compares two values.

- **Inputs:** a, b, operator.
- **Outputs:** boolean.
- **Usage:** Use with While Gate or If/Else.

### Switch Case

Selects an output based on matching a value against cases.

- **Inputs:** value, cases.
- **Outputs:** matched value or default.
- **Usage:** Cleaner than nested If/Else for many cases.

### Math

Performs arithmetic: add, subtract, multiply, divide, modulo, power.

- **Inputs:** a, b, operator.
- **Outputs:** number.
- **Usage:** Basic calculations.

### Math Expression

Evaluates a mathematical expression string.

- **Inputs:** expression, variables.
- **Outputs:** number.
- **Usage:** Complex formulas with variables.

### Fallback Selector

Outputs the first non-empty or valid input.

- **Inputs:** candidates.
- **Outputs:** first valid value.
- **Usage:** Provide defaults when some inputs may fail.

### JavaScript

Runs a JavaScript snippet.

- **Inputs:** inputs, script.
- **Outputs:** return value.
- **Usage:** Custom logic, data transformation, or API preparation.

### Python

Runs a Python snippet.

- **Inputs:** inputs, script.
- **Outputs:** return value.
- **Usage:** Data science, text processing, or when Python libraries are needed.

### JSON Query

Queries JSON data using a path or JSONPath expression.

- **Inputs:** json, query.
- **Outputs:** result.
- **Usage:** Extract fields from API responses.

### Regex Parse

Parses text with regular expressions.

- **Inputs:** text, pattern.
- **Outputs:** matches, groups.
- **Usage:** Extract structured data from unstructured text.

### JSON Builder

Builds a JSON object from inputs.

- **Inputs:** named fields.
- **Outputs:** json string.
- **Usage:** Prepare payloads for API Requester.

### HTML Sandbox

Renders HTML and captures output.

- **Inputs:** html, css, width, height.
- **Outputs:** image or html string.
- **Usage:** Generate styled cards, charts, or previews.

### API Requester

Makes HTTP requests.

- **Inputs:** method, url, headers, body, timeout.
- **Outputs:** status, body, headers.
- **Usage:** Connect to any REST API.

### SQL Query

Runs a SQL query against a database.

- **Inputs:** connection, query, parameters.
- **Outputs:** rows.
- **Usage:** Fetch or update data in supported databases.

### CSV Interop

Reads and writes CSV data.

- **Inputs:** csv string or file.
- **Outputs:** list of records / csv string.
- **Usage:** Batch processing with spreadsheet data.

### XML/YAML Interop

Reads and writes XML or YAML data.

- **Inputs:** xml/yaml string or file.
- **Outputs:** parsed data / serialized string.
- **Usage:** Configuration and document interchange.

## Text Tools

Nodes for manipulating prompts and text.

### String Template

Fills a template string with variables.

- **Inputs:** template, variables.
- **Outputs:** formatted string.
- **Usage:** Build dynamic prompts.

### Regex Replace

Replaces text using regular expressions.

- **Inputs:** text, pattern, replacement.
- **Outputs:** replaced text.
- **Usage:** Clean or normalize text.

### Prompt Joiner

Joins multiple prompt fragments with separators.

- **Inputs:** fragments, separator.
- **Outputs:** combined prompt.
- **Usage:** Assemble positive prompts from many sources.

### Negative Prompt

Outputs a negative prompt string.

- **Inputs:** text.
- **Outputs:** negative prompt.
- **Usage:** Connect to generation nodes to exclude content.

### Prompt Mixer

Mixes multiple prompts with weights.

- **Inputs:** prompts, weights.
- **Outputs:** mixed prompt.
- **Usage:** Blend styles and concepts.

## Story Tools

Nodes for narrative and sequential workflows.

### Story State

Maintains state across story beats.

- **Inputs:** initial state, updates.
- **Outputs:** current state.
- **Usage:** Track characters, plot points, or scene context.

### Seed Sequencer

Generates a deterministic sequence of seeds.

- **Inputs:** base seed, count.
- **Outputs:** seed list.
- **Usage:** Create reproducible variations.

### Sentiment Analyzer

Analyzes the sentiment of text.

- **Inputs:** text.
- **Outputs:** sentiment label, score.
- **Usage:** Filter or tag generated content.

### Image Feature Extractor

Extracts features or tags from an image.

- **Inputs:** image.
- **Outputs:** tags, embeddings.
- **Usage:** Drive prompts from visual content.

### Dialogue Splitter

Splits a block of text into dialogue lines.

- **Inputs:** text, separator.
- **Outputs:** dialogue list.
- **Usage:** Prepare comic or video scripts.

## Reuse & Layout

Nodes for organizing and reusing flows.

### Function

Encapsulates a reusable subgraph.

- **Inputs:** defined by Function Input nodes inside.
- **Outputs:** defined by Function Output nodes inside.
- **Usage:** Build modular, shareable logic.

### Group

Visually groups nodes without changing execution.

- **Inputs:** (none)
- **Outputs:** (none)
- **Usage:** Organize large flows.

### Function Input

Defines an input for a Function node.

- **Inputs:** default value, type.
- **Outputs:** value.
- **Usage:** Place inside a Function subgraph.

### Function Output

Defines an output for a Function node.

- **Inputs:** value.
- **Outputs:** (none, exported by Function).
- **Usage:** Place inside a Function subgraph.

### Virtual Alias

Creates an alias to another node or variable.

- **Inputs:** target.
- **Outputs:** same as target.
- **Usage:** Reduce long connection lines.

### Portal Pair

Splits a connection into input and output portals.

- **Inputs:** signal at input portal.
- **Outputs:** signal at output portal.
- **Usage:** Keep large graphs tidy.

### Image Editor

Opens or edits an image through the Image Editor workspace from Flow.

- **Inputs:** image, edit description.
- **Outputs:** edited image.
- **Usage:** Apply manual or AI edits mid-pipeline.

## Monitor & Debug

Nodes for inspecting and verifying flow execution.

### Value Monitor

Displays the current value of a signal.

- **Inputs:** value.
- **Outputs:** (none, display only).
- **Usage:** Debug data without stopping execution.

### Vision Verify

Verifies an image against criteria using vision models.

- **Inputs:** image, criteria.
- **Outputs:** pass/fail, reasoning.
- **Usage:** Gate outputs in automated pipelines.

## Settings

Nodes that interact with settings and configuration.

### Config

Reads or overrides a configuration value.

- **Inputs:** key, default value.
- **Outputs:** value.
- **Usage:** Access provider settings, defaults, or project settings from a flow.

## Using Nodes Together

Most flows use a small number of patterns:

1. **Trigger → Prepare → Generate → Output**
2. **List → Loop → Generate → Collect**
3. **Input → Validate → Branch → Process**
4. **Source Bin → Transform → Send to Workspace**

Start with the built-in examples in the Function Library, then replace nodes with your own configurations.
