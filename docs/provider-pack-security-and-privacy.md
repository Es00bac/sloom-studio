# Provider-pack security and privacy

> **Current-source baseline:** Sloom Studio `0.9.16-b`, August 27, 2026. This document describes
> the app's enforced pack boundary. It cannot change what a third-party provider retains after a
> user deliberately sends that provider a request.

Provider packs are untrusted declarative documents. They describe cards and requests; they do not
receive code execution privileges.

## What is stored where

| Data | Storage | Exported in pack | Embedded in project |
|---|---|---:|---:|
| Provider/card definitions | IndexedDB plus immutable bundled copies | Yes | Referenced subset |
| Draft card versions | IndexedDB | Only on explicit pack export | No |
| Personal layouts | Device preference storage | Only when deliberately promoted | No |
| Node layout overrides | Project node data | No | Yes, presentation only |
| Credential-slot names | Pack | Yes | Only if referenced |
| Credential values | OS keychain or WebCrypto-encrypted device storage | Never | Never |
| Dynamic credentials in settings backup | Passphrase-encrypted outer envelope | Never as a pack | Never |
| Trust/origin approvals | Local registry state | Never | Never |
| Release-policy locks | Sloom release configuration | Never | Never |

Prompts and media are sent only when a user runs or explicitly live-tests a card. Live testing is
optional, may incur provider charges, and should use non-sensitive test data unless the provider's
terms and the user's data policy explicitly permit more.

## Origin and credential boundary

- Credential slots bind to one exact approved origin.
- Pack overrides preserve a credential only when the slot ID and exact origin are unchanged.
- URLs cannot contain usernames, passwords, or wildcard destinations.
- HTTPS is required. Plain HTTP is accepted only for an explicitly approved loopback/private-LAN
  provider.
- Cross-origin discovery schemas are fetched without credentials unless that exact origin is
  separately approved.
- Redirects are handled manually or rejected; credentials are never forwarded across an origin.
- Forbidden headers include host/origin spoofing, cookies, proxy authorization, and static
  credential-like headers.
- Web/Android use direct CORS-capable requests or Sloom's separately configured explicit backend
  proxy. Desktop custom requests use a restricted native broker with bounded bodies/responses,
  exact-origin checks, a header allow boundary, redirect rejection, and cancellation.

## Import boundary

Imports are limited to 10 MiB and bounded counts for cards, fields, operations, transports,
catalogs, containers, and elements. Validation rejects:

- JavaScript URLs, executable code/templates, plugins, HTML, and arbitrary expressions;
- prototype-pollution keys;
- embedded credential values and credential-looking model fields;
- malformed, wildcard, credential-bearing, or unsupported origins;
- unsafe request paths, JSON pointers, headers, or polling relationships;
- duplicate field/path bindings;
- unbounded connectable media arrays; and
- unsafe interactive geometry.

Imported packs stay inactive until differences and exact origins are approved. Trust provenance is
local metadata outside the pack. A visual card is therefore not execution authority: execution also
requires the active exact pack hash, approved origin, and locally configured credential.

## Project portability boundary

Sloom embeds only the cards and transport/catalog definitions referenced by the project. The
snapshot is credential-free, content-hashed, and revalidated during project import. Node-local
snapshot payloads are discarded; only trusted top-level snapshots are attached to matching nodes.
Credential-shaped dynamic values and execution-shaped layout properties are redacted or removed.

A project-embedded pack can render but cannot execute on a new device. Execution requires an exact
installed pack hash, approved origins, and locally supplied credentials. Personal device layouts
do not silently alter shared projects.

## Logs, previews, and sharing

Request previews redact authorization and media bytes. Packs, projects, logs, diagnostics,
community Markdown, and exported metadata do not contain credential values. Response metadata is
bounded and credential-shaped content is not used as a credential source. Redaction reduces
accidental disclosure; authors must still inspect exports and screenshots before sharing them.

The generated community post requires endpoint disclosure and reminds the author not to attach
credentials. Its SHA-256 lets readers compare the discussed pack with the imported file.

## Release policy

Sloom can apply a release-owned overlay that disables provider packs, cards, operations, fields,
origins, or values. It is evaluated outside the pack at validation, rendering, and execution
boundaries. Imported packs and personal layouts cannot weaken it. Microsoft Store or other channel
policy decisions are intentionally separate from provider-pack schema version 1.

## Reporting

Do not publish a suspected malicious pack. Preserve the file and its SHA-256, disclose the exact
origins it declares, and use the **Security advisory** community label described in
`docs/release/provider-pack-community-distribution.md`.
