# Flow Workspace

> Current manual baseline: **Sloom Studio source 0.9.16-b**, verified August 27, 2026. Saved graphs are migrated and validated on open; a visually present card or connector is not proof that its runtime route can execute.

The Flow workspace is the node-based automation canvas at the heart of Sloom Studio. In this workspace you build directed graphs of nodes that generate media, transform data, evaluate logic, loop over lists, and communicate with external services. Flow is where repeatability lives: once a flow is built, you can rerun it with new inputs, batch it over lists, and reuse it as a function.

This chapter covers the Flow canvas, node operations, runtime behavior, diagnostics, variables, batch execution, Source Bin integration, import/export, and drag-and-drop workflows.

## Canvas Navigation

The Flow canvas is an infinite 2D plane. You can navigate it in several ways:

- **Middle-click and drag** — Pan the canvas.
- **Two-finger pinch** — Zoom in and out on trackpads and touchscreens.
- **Scroll wheel** — Vertical scroll; hold `Shift` to scroll horizontally.
- **Keyboard zoom** — `Ctrl+=` to zoom in, `Ctrl+-` to zoom out, `Ctrl+0` to reset.
- **Zoom to fit** — Fit all nodes into view from the bottom toolbar or Command Palette.
- **Minimap** — A small overview in the corner; click to jump to a region.

Nodes can be selected by clicking them. Hold `Shift` and click to add or remove nodes from the selection. Drag a selection rectangle to select multiple nodes. Press `Ctrl+A` / `Cmd+A` to select all nodes.

## Adding Nodes

There are several ways to add a node:

1. **Bottom toolbar** — Click **Add Node** to open the node catalog.
2. **Middle-click search** — Middle-click on an empty area of the canvas to open a quick search for nodes.
3. **Context menu** — Right-click the canvas and choose **Add Node**.
4. **Drag-and-drop** — Drag a Source Bin item onto the canvas to create a Source Bin node or a compatible input.
5. **Command Palette** — Search for "Add Node" or a specific node name.

The node catalog is organized into categories. See `08-node-reference.md` for a complete catalog.

## Connecting Nodes

Nodes have input handles on the left and output handles on the right. Some nodes also have additional handles for control flow or special routing.

To connect two nodes:

1. Click and drag from an output handle.
2. Drop the connection onto a compatible input handle.

Compatible handles highlight when the dragged connection is near. Incompatible handles dim. You can only connect types that match or can be coerced, such as number to string.

To remove a connection:

- Click the connection line to select it and press `Delete`.
- Right-click the connection and choose **Delete**.
- Drag the connection away from the handle and release.

## Context Menu

Right-clicking the canvas or a selected node opens a context menu with context-sensitive commands:

- **Add Node**
- **Copy / Cut / Paste**
- **Duplicate**
- **Delete**
- **Select All**
- **Add Source Bin Node**
- **Group Selected**
- **Create Function**
- **Bookmark Node**
- **Layout Defaults**
- **Clean Flow**

Right-clicking a connection may show **Delete** or **Add Router** options.

## Clean Flow and Auto-Organize

**Clean Flow** reorganizes the canvas, straightens connections, and runs diagnostics. It is useful when a flow has grown messy or when you want to share a readable graph.

When Clean Flow runs:

- Nodes are arranged in a left-to-right hierarchy based on dependencies.
- Long connection lines are routed around nodes.
- Overlapping nodes are separated.
- Disconnected groups are aligned.

**Caveat:** Clean Flow blocks interaction while it works. For very large graphs, this may take a few seconds. Save your project before running Clean Flow if you have a preferred manual layout you might want to restore.

Sloom Studio can also use Vertex Gemini to suggest layouts for complex flows. This is available from the **Clean Flow** options menu when Vertex authentication is configured.

## Diagnostics

The Diagnostics panel reports problems with the current flow:

- **Disconnected inputs** — Required inputs with no connection.
- **Type mismatches** — Connections between incompatible types.
- **Cycles** — Loops in the graph that cannot be resolved.
- **Unused outputs** — Nodes that do not contribute to any output.
- **Performance hints** — Suggestions to batch or simplify expensive nodes.

Open the Diagnostics panel from **View > Diagnostics** or the Command Palette. Click a diagnostic entry to pan to the relevant node.

## Variables

Flow supports variables that store values between runs or across nodes. Variables are scoped to the current Flow workspace by default, but can be read by cross-workspace commands.

To create or edit a variable:

1. Open the Variables panel from the workspace menu or Command Palette.
2. Click **Add Variable**.
3. Enter a name, type, and default value.

Variables can be referenced by name in compatible nodes such as String Template, Math Expression, JavaScript, and Python. Use the variable picker in node inspectors to avoid typing names manually.

### Variable Scoping

- **Workspace scope** — Available to all nodes in the same Flow workspace.
- **Function scope** — Available only inside a Function node.
- **Loop scope** — Temporary variables created by loop nodes such as Simple Loop and While Gate.

Be careful with names: a variable in an inner scope can shadow a workspace variable.

## Batch and List Execution

Many Flow nodes accept lists. When a node receives a list, it can run once per item or process the whole list at once, depending on its implementation.

### Typed List and Envelope Nodes

- **Typed List** — Creates a list of values with a fixed item type.
- **Envelope** — Packages multiple values into a structured object.
- **Expander** — Takes a list and spreads it to multiple outputs.
- **List Flattener** — Flattens nested lists.
- **List Length** — Returns the number of items.

### Loop Control

- **RUN ME** — A trigger node that starts execution.
- **Simple Loop** — Iterates over a list and outputs each item.
- **While Gate** — Continues looping while a condition is true.
- **Stop When** — Halts a loop when a condition is met.
- **On/Off Switch** — Enables or disables a branch.
- **Fork Switch** — Routes data to one of several outputs.

When running a list, the Activity Trail shows progress for each iteration. You can cancel a long batch run from the run button or Activity Trail.

### List Type Safety

Lists are typed. Connecting a list of strings to a node that expects a list of numbers will produce a type mismatch diagnostic. Use conversion nodes or the Expander to reshape data.

## Node Run Model

When you press **Run**, Sloom Studio evaluates the flow:

1. It builds a dependency graph from node connections.
2. It detects cycles and reports them if present.
3. It determines which nodes are stale because inputs changed.
4. It runs stale nodes in dependency order, respecting parallel limits.
5. It caches node outputs so unchanged nodes do not rerun.
6. It writes results to output nodes, variables, or the Source Library.

### Signal Evaluation

Data flows as signals. A signal carries a value and metadata such as type, envelope fields, and provider tags. Nodes read input signals, compute output signals, and pass them on. Some nodes, such as Value Monitor, let you inspect the current signal value.

### Attempts History

Each node keeps an attempts history showing recent runs, durations, and errors. Open a node's inspector and expand the **Attempts** section to review.

### Dependencies and Caching

A node only reruns if one of its inputs changes or if you explicitly force it. Right-click a node and choose **Force Run** to rerun it regardless of cache state. This is useful when a node depends on external state that Sloom Studio cannot detect, such as a remote file or a database row.

## Source Bin Nodes

A Source Bin node reads an item from the Source Library and makes it available to the flow. When the source item changes, the node becomes stale and will rerun.

To create a Source Bin node:

1. Drag an item from the Source Bin sidebar onto the canvas.
2. Or right-click the canvas and choose **Add Source Bin Node**, then pick an item.
3. Or use the node catalog and select **Inputs & Data > Source Bin**.

Source Bin nodes can output image data, video paths, audio paths, text, or document references depending on the source kind.

## Multiple Flow Workspaces

A project can contain more than one Flow workspace. Each Flow workspace has its own canvas, variables, and Source Bin nodes. Use multiple Flow workspaces to:

- Separate a preprocessing pipeline from a generation pipeline.
- Keep experimental flows without cluttering the main graph.
- Run different flows in parallel.

Switch between Flow workspaces from the workspace tab area or the Project Library modal.

## Import and Export

### Importing a Flow

You can import a `.sloom-script` file or another `.sloom` project's flow into the current workspace:

1. Choose **File > Import**.
2. Select the file.
3. Choose whether to merge into the current workspace or create a new Flow workspace.

### Exporting a Flow

To share a flow without sharing the whole project:

1. Select the nodes you want to export.
2. Right-click and choose **Export Selected**.
3. Save as `.sloom-script`.

To export the entire project, use **File > Export Project**.

### Drag-and-Drop Import

Drag a `.sloom-script` or `.sloom` file from your operating system's file manager onto the Flow canvas. Sloom Studio will prompt you to import it as nodes or as a whole project.

## Portal Auto-Creation

When a connection would be long or cross a large gap, Sloom Studio can automatically create portal pairs. A portal pair splits one logical connection into an input portal and an output portal, keeping the canvas tidy.

To create a portal manually:

1. Right-click a connection.
2. Choose **Create Portal**.
3. Move the portal nodes to convenient locations.

Changes at one portal are reflected at the other instantly.

## Workspace Metrics

The Flow workspace can display metrics such as:

- Number of nodes and connections.
- Estimated run time.
- Cache hit ratio.
- Provider cost estimate.

Open the metrics overlay from **View > Workspace Metrics**.

## Current production execution controls

### Validated cache and partial rerun

Run the downstream target you actually need. Flow computes the required dependency slice and reuses a cached result only when its input/model/route signature still matches. A reused node reports **Reused cached result**. Change an upstream input or deliberately force the node when external state invalidates that signature. Cache state is performance evidence, not provider execution evidence.

### Enforced spend cap

Set **Flow spend cap (USD)** before dispatching a paid graph. Admission totals recorded, reserved, and planned priced requests. A plan with unknown provider pricing, or one whose projected cost exceeds the cap, is rejected before outbound work starts. Raising or removing the cap is a deliberate user decision; the runtime does not bypass it by selecting another provider.

### Prompt batches

A generation node can receive a bounded prompt batch and compatible connected media list. Their lengths must match, or one side must be a single broadcastable item. Each item retains its own attempt/result state so a recoverable failure does not erase successful siblings. Resume the remaining items rather than manually duplicating the whole graph.

### Local schedules

The **RUN ME** node exposes an optional bounded interval schedule. Enable it, choose the interval, and keep the application session running. Schedules persist with the Flow snapshot but execute locally and session-bound; they are not a cloud scheduler, do not overlap a still-running dispatch, and stop when disabled or the application is closed.

### Credential-free node packs

Select the intended nodes and use the node-pack export command to create a portable pack. Secrets are redacted and imported data is schema validated. The receiving user must configure their own provider credentials/routes. A pack never proves that a paid or hardware-dependent route is available on another machine.

## Caveats and Best Practices

| Issue | Guidance |
|-------|----------|
| Clean Flow blocks interaction | Save before running on large graphs. |
| List type safety | Match list types or convert explicitly. |
| Cycle detection | Do not create feedback loops unless using a loop node designed for it. |
| Variable scoping | Use descriptive names to avoid shadowing. |
| Browser vs native | File system nodes may behave differently in browser builds. Use native builds for heavy file I/O. |
| Cache surprises | Use **Force Run** when a node depends on external state. |
| Paid batch is refused | Resolve unknown pricing or raise the explicit spend cap; do not route around the gate. |
| Scheduled run did not occur | Confirm the RUN ME schedule is enabled and the local application session remained open. |

## Common Flow Workflows

### Batch Image Generation

1. Add a **Text Prompt** node with a base prompt.
2. Add a **Typed List** of seed values or prompt variations.
3. Connect the list to a **Simple Loop**.
4. Inside the loop, connect the prompt and current item to an **Image Generate** node.
5. Run the flow. Generated images appear in the Source Bin.

### Prompt Assembly

1. Add **Text Prompt**, **Negative Prompt**, and **Prompt Mixer** nodes.
2. Connect a **LoRA Spec** node to mix in style weights.
3. Use **String Template** to inject variables.
4. Connect the assembled prompt to an image or video generator.

### External API Glue

1. Add an **API Requester** node.
2. Set the method, URL, headers, and body.
3. Use **JSON Query** or **Regex Parse** to extract the result.
4. Pass the result to another node or store it in a variable.

For a complete catalog of every node, see `08-node-reference.md`.
