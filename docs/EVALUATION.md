# Evaluate Localhost Inspector

Use this guide to decide whether the Inspector fits an existing web project and to run one representative design-to-source trial. Start with the [README installation steps](../README.md#try-the-macos-development-build).

## Evaluate a specific revision

Record `git rev-parse --short HEAD` before testing. The tested development baseline described here is `19d0535` on `saaf1/local-host-inspector-overview`. Check the revision you installed before assuming a default-branch checkout or packaged release includes these features.

| Area | Available on the integrated baseline |
| --- | --- |
| Selection and editing | Command-click to select, Command-hover to preview the target, and Parent to move up the DOM. The Inspector exposes supported layout, sizing, padding, typography, fill and stroke controls according to the selection. |
| Reversible previews | Save to a local journal as you work. Undo, compare with the original, and revert the current route. Replay depends on target identity and a compatible CSS baseline. |
| Design-system values | Register named CSS colors and spacing values. Apply colors to supported Fill, Stroke and Text color targets. Bind spacing in eligible Gap and Padding fields. Apply, replace and detach a named text style as one undoable action. Create a pending style from one eligible text layer and reuse it on the same route. |
| Source handoff | A coding agent reads the journal and inspects the source, then proposes or makes the requested source change. Source verification happens separately with previews off. |
| Component experiment | An explicitly registered direct React Button can preview its public Size prop. The preview is session-scoped. General component discovery and automatic source writeback are outside this baseline. |

## Check whether your project fits

1. **Workstation.** The demonstrated setup uses macOS, Node.js 22.13 or newer, and desktop Chrome with unpacked Manifest V3 extensions permitted. Check your browser policy and whether the local Node helper can run.
2. **Development server.** Use an app served over HTTP at `127.0.0.1` and leave port `5188` free for the helper. The helper checks that a single listening process has the connected working copy as its working directory. In a monorepo, check the actual server process before choosing a directory. Containers, reverse proxies, remote servers, and embedded app frames need their own qualification.
3. **Design-system source.** Trace the running app's stylesheet imports to the maintained source. The current registration commands take an explicit list of CSS names in a stylesheet inside the connected working copy. If the source is a package, confirm where the runtime names are declared and whether that file meets the working-copy boundary. Evaluate a package or generated output on its own evidence.
4. **Source ownership.** Pick a real task where you can identify the intended edit and a neighboring instance that should stay the same. Check whether the value belongs to this source use, a parent layout, a repeated template, or a shared component definition.

A useful evaluation report marks each check as passed, blocked, or still unknown, records the evidence, and names any extra steps the evaluator had to take.

## Register an existing CSS source

Run these commands from the Inspector checkout after binding the app. Use the same state directory and port as the app connection. The stylesheet path is relative to the **connected app working copy**. The names below are synthetic. Substitute real declarations from your project.

```sh
state="$HOME/.localhost-inspector"
node local-helper.mjs "$state" register-colors 5173 src/styles/theme.css --surface --accent
node local-helper.mjs "$state" register-spacing 5173 src/styles/theme.css --space-2 --space-4
node local-helper.mjs "$state" register-text-styles 5173 src/styles/theme.css --text-body
```

A text-style prefix such as `--text-body` needs five declarations ending in `-font-family`, `-font-weight`, `-font-size`, `-line-height`, and `-letter-spacing`. The first implementation supports bounded CSS forms, including px and rem metrics, unitless line height, and normal line height or letter spacing. Use flat text elements or eligible groups of them. Direct type controls remain useful when a target contains separately styled inline text. Refresh after registration and confirm that the picker shows the expected names on a real target.

For creation, register a writable text-style stylesheet. Omit style names to start with an empty catalog. Select one text layer with no applied style and use **Typography → Text styles → +**. The helper records a pending definition and its grouped application for source handoff. The stylesheet changes only during that handoff.

Registration tells the Inspector which choices the project maintains. A matching rendered color or size alone cannot establish which token authored an existing value. Keep the project stylesheet or its maintained upstream source authoritative.

## Follow a saved edit into source

The extension selects a live element and writes a reversible preview. The helper verifies the app binding and persists the journal with revision checks. Use the helper's `status` command to locate the journal. A record can include the route, target evidence, CSS property, prior value, requested value, observed value, and token identity. This example is an excerpt for reading the journal.

```json
{
  "route": "/example",
  "target": { "tag": "div", "id": null, "slot": null, "key": "example-item:summary" },
  "property": "gap",
  "before": "8px",
  "requested": "var(--space-4)",
  "observed": "16px",
  "spacingToken": { "source": "src/styles/theme.css", "name": "--space-4" },
  "restore": "unique",
  "intent": "selected occurrence only"
}
```

Use the journal as evidence of intent. Account for later edits that supersede earlier ones. Undo and Revert all remove the affected records from the active journal. Keep grouped text-style operations together. Verify the authored use, ownership, and scope in the repository before patching. Preserve the named reference in the project's usual source representation. If one source expression renders many rows, editing it can affect every row even when the journal uniquely identifies one rendered item. Surface that scope before making a shared change.

Run the app with the Inspector detached or in a fresh uninstrumented browser view. Verify the source-produced result, the neighboring instance, and any relevant theme. Treat an edit as promoted only after that check. Keep unresolved decisions available for review.

For preview replay, a stable, unique `data-inspector-target` on the actual editable element can identify a rendered occurrence across remounts. The Inspector also checks compatible target and style evidence. Missing, duplicate, or stale evidence can leave the edit saved without replaying it. Track how often an ordinary session requires extra target annotations or reselection.

## Local data boundary

The extension runs on loopback HTTP pages. The helper listens on loopback, checks a pairing key, and writes into the state directory you choose. No hosted service is required. The journal can contain local working-copy paths, route paths, and element identifiers. Query values are replaced by a keyed digest so routes remain distinct. Selected text is omitted. An ID-based preview can retain a text fingerprint to reject a different element that reuses the ID. The helper rewrites an older journal when it first opens it. Existing copies and backups can still contain the original data. Keep the journal and pairing key in the approved environment. Check separately what the coding agent can read or transmit before giving it the journal or repository.

## Evidence and next checkpoint

All 73 browser regression tests passed on the tested development baseline. An installed-extension trial on a disposable copy of a React dashboard created and reapplied a text style. A separate coding agent carried the journal into source. A clean browser with previews off verified the heading and two unaffected comparisons. The unkeyed heading did not replay in a fresh browser session. The agent resolved the source occurrence using the route, the requested scope, and the source. Independent installation and managed-workstation fit remain open.

The installed Button proof verified a real Size change, Undo, neighboring app state, and a manual source handoff. It required an app-side development registration and a helper registration for the one authored occurrence. A full reload clears its runtime preview while preserving the journaled intent. Same-document navigation can require a reload to clear the runtime change. Wrapper, parent-controlled, and repeated cases can have identical markup and different source ownership.

For the next trial, use the installed extension on one ordinary screen. Check same-tab reload and navigation with an unkeyed target and a uniquely keyed counterpart. Record attachment, correct replay or explicit abstention, and the amount of wiring needed. Use the result to decide whether to improve recovery or proceed with a second component integration.

## Architecture checkpoints

| Before committing to | Required evidence |
| --- | --- |
| A new host or storage model | Prove selection, one CSS edit, and Undo in the proposed host. If it persists edits, prove the journal-to-source round trip and check its security boundary. |
| Broad component integration | Identify the rendered occurrence, property owner, and source scope for direct, wrapped, controlled, and repeated cases. Verify a supported prop change and Undo. Measure app setup. Leave ambiguous edits unavailable. |
| A live canvas host or frame lifecycle | Run two views of the same route with distinct state. Reordering must preserve unsaved input, and selection, edits, and Undo must stay scoped to their view. Check reload behavior before building around that lifecycle. |
| Variation isolation or promotion | Prove pending edits and runtime state remain separate. Check shared data effects with disposable data. Promote one variation, discard the other, and verify the source with previews off. |

Record the assumption, the cost of reversing the choice, and the result before building the dependent feature. A reversible experiment can supply that evidence.

For contributor checks, see [AGENTS.md](../AGENTS.md#checks-and-tests).
