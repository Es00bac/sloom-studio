# 13. Accessibility, collaboration & automation

Sloom Studio provides local-first solo workflows and bounded team/automation routes. None of the
networked features silently uploads a project to a Sloom-owned content service: the operator chooses
and configures the server or execution environment.

## Keyboard and screen-reader operation

- Use `Tab` and `Shift+Tab` to traverse controls, `Enter`/`Space` to activate the focused control,
  and `Escape` to close menus and dialogs. Flow nodes expose labelled ports and actions to keyboard
  and assistive technology rather than relying on connector position alone.
- Use **Settings → Keyboard Shortcuts** to inspect and customize the shared command map. Conflicting
  normalized chords are reported before assignment.
- Workspace menus, panels, dialogs, live status, errors, and progress use semantic labels/status
  announcements. A feature that still requires pointer geometry should state that boundary rather
  than pretending to be keyboard-complete.
- For accessible Paper output, set the document language, author alternative text for each
  printable visual frame, then choose **Accessible PDF**. This tagged output is distinct from
  press-oriented PDF/X.

See [Keyboard & stylus](11-keyboard-and-stylus.md) for default shortcuts and pen input.

## Real-time collaboration and review

Sloom Studio can connect to a self-hosted collaboration/sync server. Configure the trusted endpoint
and access policy, then share the specific project or review space. Project operations are
server-authoritative: clients receive accepted revisions rather than merging independent local
truth silently. Team review records retain authorship, status, and project references.

This is not an automatic Sloom cloud. Server operators are responsible for access control, backup,
retention, transport security, and any regulatory requirements. Keep a portable local export before
joining or leaving a shared project.

Paper also has document-local review comments and tracked revisions. These remain in the project,
support replies/resolve/reopen or accept/reject workflows, and do not enter print, EPUB, IDML, CBZ,
or accessible-PDF output unless a specific export says otherwise.

## Self-hosted project sync

Run the supplied self-hosted sync service in an environment you control, configure its origin and
credentials, then connect Sloom Studio from Settings. Sync is explicit and bounded; local project
files remain independently exportable. A LAN phone-host handoff is a separate workflow and can be
used without a public server.

## Extensions and provider packs

- Provider packs are declarative, credential-free `.sloom-provider.json` documents. Review every
  endpoint and operation before activation. Credentials remain in named local slots.
- The extension SDK exposes bounded declared capabilities. Install only code you trust and review
  its file/network permissions. An extension is not allowed to imply a provider, model, or output it
  did not actually use.
- Flow node packs (`.sloompack`) contain graph structure, not provider credentials, live results,
  or Source Library media. Import revalidates nodes, edges, bounds, and portal references.

See [Provider packs & model cards](14-provider-packs-model-cards.md) for the full authoring flow.

## Scripting and headless automation

The project CLI and bounded scripting surfaces support inspectable, repeatable project operations.
Use a copy or version-control checkpoint for bulk changes; scripts should fail without replacing the
active project when input validation fails. Headless work must preserve the same project contracts
as the UI and report exact outputs/errors instead of presenting a queued or modelled operation as a
completed artifact.

Flow's local schedules and resumable batches are the simplest automation path. They remain inside
the open app session, preserve spend/cancellation/cache rules, and are not a distributed background
service.

## Cross-project asset catalogue

The catalogue indexes reusable asset metadata across projects you explicitly make available. It
does not grant access to missing files or copy private media to a Sloom server. Relink permissions,
scratch storage, and self-hosted access rules still apply when another project uses an entry.

---

Next: [Provider packs & model cards →](14-provider-packs-model-cards.md)
