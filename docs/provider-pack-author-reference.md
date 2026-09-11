# Sloom provider-pack author reference

> **Current-source baseline:** Sloom Studio `0.9.16-b`, August 27, 2026.
> The portable pack schema remains **version 1**. A pack's `minimumSloomVersion` is a compatibility
> floor owned by that pack/release policy; it is not the documentation baseline or a claim that all
> later application releases have tested every community pack.

This document defines the author-facing contract for schema version 1. Runtime TypeScript
contracts live in `src/lib/providerPackContracts.ts`; import validation is implemented in
`src/lib/providerPackValidation.ts`. The file extension is `.sloom-provider.json`.

## Design rules

- A pack is declarative JSON. It cannot contain JavaScript, HTML, plugins, executable templates,
  arbitrary expressions, credential values, or credential-bearing URLs.
- One `FlowModelCardV1` describes one model across all of its operations.
- Stable IDs are immutable identity. Change labels and layout freely, but do not recycle field,
  output, operation, transport, slot, or card IDs for different semantics.
- Every request destination is an exact origin. HTTPS is required except for explicitly approved
  loopback/private-LAN HTTP.
- Complex authentication is named through a registered built-in engine. A community pack cannot
  supply authentication code.
- A structurally incomplete card may be saved as `draft`; it cannot be activated or run.

## Hard limits

| Item | Limit |
|---|---:|
| Import bytes | 10 MiB |
| Cards per pack | 2,000 |
| Fields per card | 512 |
| Operations per card | 32 |
| Outputs per card | 128 |
| Layout containers per card | 256 |
| Layout elements per card | 1,024 |
| Layout handle placements per card | 4,096 |
| Transport profiles per pack | 128 |
| Credential slots per pack | 32 |
| Approved origins per pack | 64 |
| Discovery recipes per pack | 64 |
| Option-catalog entries | 10,000 |
| General string length | 16,384 characters |
| Card width | 260–1,040 px |
| Bundled default visible height | 900 logical px, unless an approved exception is recorded |

## Top-level `ProviderPackV1`

```json
{
  "schemaVersion": 1,
  "packId": "studio.example.provider",
  "version": "1.0.0",
  "displayName": "Example Provider",
  "provider": {
    "name": "Example",
    "documentationUrl": "https://docs.example.test",
    "privacyUrl": "https://example.test/privacy",
    "termsUrl": "https://example.test/terms"
  },
  "approvedOrigins": [
    { "origin": "https://api.example.test", "label": "Example API" }
  ],
  "credentialSlots": [],
  "discovery": [],
  "optionCatalogs": [],
  "transports": [],
  "cards": [],
  "release": {
    "minimumSloomVersion": "0.9.16-b",
    "sourceDocumentationUrls": ["https://docs.example.test/models"]
  }
}
```

`packId` plus `version` identifies the authored release; Sloom additionally hashes the canonical,
credential-free pack with SHA-256. Flow nodes pin that exact hash. The release-owned metadata in
`src/lib/providerPackReleaseMetadata.ts` currently retains a lower `0.9.12-w` compatibility floor
for the bundled release configuration; do not confuse that retained floor with the application
version shown above, and update it deliberately when the compatibility contract changes.

### Provider identity and origins

`provider` may contain `homepageUrl`, `documentationUrl`, `privacyUrl`, `termsUrl`, and
`supportUrl`. URLs must use safe schemes.

Each `approvedOrigins[].origin` must be an origin only, such as
`https://api.example.test`—no path, query, fragment, username, or password. Set
`allowPlainHttpPrivateNetwork: true` only for a user-approved loopback or private-LAN origin.
Wildcard destinations are invalid.

### Credential slots

A slot contains identity and authentication behavior, never a value:

```json
{
  "id": "default",
  "label": "Example API key",
  "authType": "bearer",
  "approvedOrigin": "https://api.example.test",
  "required": true
}
```

Supported `authType` values are `none`, `bearer`, `api-key-header`, `basic`, `oauth`,
`vertex-adc`, `signed-cloud`, and `custom-built-in`. The last four require a registered
`builtInEngineId`. Query-string credentials are not supported.

## `TransportProfileV1`

Transport kinds:

| Kind | Use |
|---|---|
| `built-in` | Existing Sloom provider/auth engine, including OAuth, Vertex ADC, or signed requests. |
| `http` | Synchronous JSON or binary HTTP. |
| `sse` | Server-sent text streaming. |
| `submit-poll` | Submit a job, poll state, optionally cancel, then fetch its result. |

Generic transports declare `approvedOrigin`, `method`, relative `endpointPath`, `bodyKind`, request
bindings, and output extractions. `bodyKind` is `json`, `multipart`, `raw`, or `none`. Static
headers cannot include authentication, cookies, origin-forging headers, or credential-like names.

Example:

```json
{
  "id": "generate",
  "label": "Generate",
  "kind": "http",
  "approvedOrigin": "https://api.example.test",
  "credentialSlotId": "default",
  "method": "POST",
  "endpointPath": "/v1/images",
  "bodyKind": "json",
  "timeoutMs": 120000
}
```

For `submit-poll`, add:

```json
{
  "poll": {
    "statusPath": "/jobs/{id}",
    "idPointer": "/id",
    "resultPath": "/jobs/{id}/result",
    "statePointer": "/state",
    "pendingValues": ["queued", "running"],
    "successValues": ["done"],
    "failureValues": ["failed", "cancelled"],
    "errorPointer": "/error/message",
    "cancelPath": "/jobs/{id}/cancel",
    "intervalMs": 1000,
    "timeoutMs": 600000
  }
}
```

Paths are declarative only. Redirects are never followed with credentials.

## `FlowModelCardV1`

A model card contains:

- stable `id`, provider `modelId`, name, description, tags, and modalities;
- fields and typed outputs;
- one or more adaptive operations;
- evidence/confidence;
- activation status; and
- the pack-default layout.

Modalities are `text`, `image`, `video`, and `audio`. Confidence is `provider-verified`,
`sloom-recognized`, `inferred`, `manual`, or `untested`. Status is `draft`,
`ready-untested`, or `tested`.

## `ModelFieldV1`

Every field has an immutable `id`, user label, API path, semantic role, value type, cardinality,
operation IDs, optional constraints/encoding/options, and presentation control.

Value types: `string`, `number`, `integer`, `boolean`, `enum`, `image`, `video`, `audio`, `json`,
and `binary`.

Semantic roles:

| Modality | Roles |
|---|---|
| Text | `prompt`, `system-instruction`, `context`, `media-context` |
| Image | `source-image`, `mask`, `reference-image`, `control-image`, `width`, `height` |
| Video | `source-video`, `start-frame`, `end-frame`, `reference-video`, `duration`, `frame-rate`, `resolution` |
| Audio | `script`, `source-audio`, `voice`, `style`, `duration`, `format` |
| Shared | `seed`, `quantity`, `advanced`, `metadata` |

Encodings are `json`, `url`, `data-uri`, `base64`, `binary`, `multipart`, and `raw`.

Schema-to-control conventions:

- enum → `dropdown`;
- boolean → `toggle`;
- bounded number/integer → `slider`;
- prompt/long text → `prompt` or `textarea`;
- media → `media`;
- bounded media list → `reference-gallery`;
- infrequent provider-specific values → `advanced-value`.

Required media must be connectable. A connectable media array must declare a trustworthy finite
`maxItems`, or the author must choose a finite `visiblePortCount` before activation. The count
creates exact, stable `field ID + slot index` Flow handles.

## `ModelOutputV1` and extraction

Output semantic roles are `text-output`, `json-output`, `image-output`, `video-output`,
`audio-output`, and `metadata-output`. Result types are `text`, `json`, `image`, `video`, `audio`,
`package`, and `list`. At least one output is primary.

Generic operations must extract their primary output using:

- `json-pointer`, with an RFC 6901-style safe pointer such as `/data/0/url`;
- `binary`, with an optional default MIME type; or
- `sse-text`, optionally pointing to the streamed fragment.

Use `list: true` or output cardinality `many` for typed list/package results.

## `ModelCardOperationV1`

An operation declares:

- stable `id` and label;
- `transportProfileId` and optional route override;
- `requiredFieldIds`, `visibleFieldIds`, and `inputPortFieldIds`;
- `outputIds`;
- request bindings; and
- output extractions.

Every required field must also be visible. Every operation needs defined routing. Bind each field
and request path once. Generate/Edit/Inpaint can share fields; shared controls retain their layout
position when the operation changes.

## `CardLayoutV1`

The layout defines a width, fit target, height budget, containers, and elements.

Container kinds:

- `freeform`
- `grid`
- `reference-gallery`
- `collapsible`
- `tabs`
- `inline-row`
- `pinned-media`

Containers support 1–14 columns, per-operation column counts, default collapse, tab parent/child
relationships, geometry, and operation/field conditions. Elements bind exactly one field or
output and hold their presentation geometry and visibility.

`handlePlacements` positions the operation's stable Flow ports without changing their meaning:

```json
{
  "portId": "model-card:referenceImages:13",
  "anchor": "element",
  "elementId": "element:referenceImages",
  "side": "bottom",
  "offsetPercent": 80
}
```

`anchor` is `card` or `element`; an element anchor requires an element belonging to the same
field or output. `side` is `left`, `right`, `top`, or `bottom`, and `offsetPercent` is bounded
from 5–95. Every input/output keeps its stable field/output-and-slot port ID regardless of visual
placement. Duplicate placements and handle collisions block activation.

Interactive controls must stay inside the card, not overlap or clip, and meet a 32 px minimum hit
target. Required controls cannot be hidden. A collapsed required section must surface its required
state. Full-card internal scrolling is not a valid height solution.

## Presentation-only overrides

`ModelCardLayoutOverrideV1` can contain only:

- card/operation identity;
- width and fit target;
- container order, columns, collapse, and geometry; and
- element container, order, geometry, span, and hidden state; and
- stable port handle anchor, side, and edge offset.

It cannot contain request paths, endpoints, transports, credentials, semantic roles, field
bindings, or output mappings. Resolution order is node override → personal device preference →
pack layout → automatic layout.

## Discovery recipes

Recipe kinds mirror Sloom's fixed discovery sequence:

1. `sloom-manifest`
2. `advertised-schema`
3. `openapi` / `json-schema`
4. `known-profile`
5. `model-list`
6. `sample-request`
7. `manual`

The cURL/sample importer parses text only. It rejects command substitution, pipes, redirects,
local-file uploads, and other shell behavior.

## Import, hashing, snapshots, and updates

Exports are canonicalized, stripped of credential material, and SHA-256 hashed. Same-ID imports
remain inactive until the user reviews endpoint, model, capability, transport, layout,
credential-slot, and trust differences. Bundled copies are immutable recovery versions.

Projects embed trimmed, credential-free snapshots of referenced cards and transports only. The
snapshot records the original full-pack hash and its own content hash. It can render on a new
device but cannot execute until installed/trusted locally.

## Validation and testing

Activation blocks malformed request/output relationships, undefined routes, duplicate bindings,
unbounded media ports, unsafe origins or headers, executable content, invalid semantic types, and
unsafe geometry. Height above the user's target is normally a warning. Bundled cards over 900 px
require `approvedHeightException` with a reason and approver.

Live tests are optional because they may be billable. Test each operation independently, retain the
exact model/endpoint response evidence outside the pack when appropriate, and keep untested status
honest. A successful live request does not grant broad trust to a changed pack hash or origin.

## Release-policy overlay

Release metadata can apply an external `ProviderPackReleasePolicyV1` that locks pack, card,
operation, field/control, origin, or specific values. The policy is not part of the imported pack;
packs and personal layouts cannot weaken it. Store/moderation decisions belong in release policy,
not the portable schema.

## Complete minimal generic text card

```json
{
  "schemaVersion": 1,
  "packId": "studio.example.text",
  "version": "1.0.0",
  "displayName": "Example Text",
  "provider": {
    "name": "Example",
    "documentationUrl": "https://docs.example.test"
  },
  "approvedOrigins": [{ "origin": "https://api.example.test" }],
  "credentialSlots": [{
    "id": "default",
    "label": "API key",
    "authType": "bearer",
    "approvedOrigin": "https://api.example.test",
    "required": true
  }],
  "discovery": [],
  "optionCatalogs": [],
  "transports": [{
    "id": "generate",
    "label": "Generate",
    "kind": "http",
    "approvedOrigin": "https://api.example.test",
    "credentialSlotId": "default",
    "method": "POST",
    "endpointPath": "/v1/generate",
    "bodyKind": "json"
  }],
  "cards": [{
    "schemaVersion": 1,
    "id": "model:example-text",
    "modelId": "example-text",
    "displayName": "Example Text",
    "modalities": ["text"],
    "fields": [{
      "id": "prompt",
      "label": "Prompt",
      "apiPath": "prompt",
      "semanticRole": "prompt",
      "valueType": "string",
      "cardinality": "one",
      "required": true,
      "connectable": true,
      "operationIds": ["generate"],
      "control": "prompt"
    }],
    "outputs": [{
      "id": "text",
      "label": "Text",
      "semanticRole": "text-output",
      "resultType": "text",
      "primary": true,
      "cardinality": "one",
      "operationIds": ["generate"]
    }],
    "operations": [{
      "id": "generate",
      "label": "Generate",
      "transportProfileId": "generate",
      "requiredFieldIds": ["prompt"],
      "visibleFieldIds": ["prompt"],
      "inputPortFieldIds": ["prompt"],
      "outputIds": ["text"],
      "requestBindings": [{
        "fieldId": "prompt",
        "requestPath": "prompt",
        "omitWhenEmpty": false,
        "encoding": "json"
      }],
      "outputExtractions": [{
        "outputId": "text",
        "kind": "json-pointer",
        "pointer": "/text"
      }]
    }],
    "evidence": [{
      "title": "Example generate endpoint",
      "url": "https://docs.example.test/generate"
    }],
    "confidence": "manual",
    "status": "ready-untested",
    "layout": {
      "schemaVersion": 1,
      "id": "example-text-layout",
      "width": 390,
      "minWidth": 260,
      "maxWidth": 1040,
      "fitTarget": "1080p",
      "heightBudget": 900,
      "containers": [{
        "id": "main",
        "kind": "grid",
        "label": "Prompt",
        "order": 0,
        "columns": 1
      }],
      "elements": [{
        "id": "field:prompt",
        "fieldId": "prompt",
        "containerId": "main",
        "order": 0,
        "height": 96
      }]
    }
  }]
}
```
