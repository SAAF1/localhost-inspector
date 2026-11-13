# Evaluate Localhost Inspector

Use this guide to decide whether the Inspector fits an existing web project and to run one representative design-to-source trial. Start with the [README installation steps](../README.md#try-the-macos-development-build).

## Evaluate a specific revision

Record `git rev-parse --short HEAD` before testing. The integrated baseline described here is `f1ba749` on `saaf1/local-host-inspector-overview`. Check the revision you installed before assuming a default-branch checkout or packaged release includes these features.

| Area | Available on the integrated baseline |
| --- | --- |
| Selection and editing | Command-click to select, Command-hover to preview the target, and Parent to move up the DOM. The Inspector exposes supported layout, sizing, padding, typography, fill and stroke controls according to the selection. |
| Reversible previews | Save to a local journal as you work. Undo, compare with the original, and revert the current route. Replay depends on target identity and a compatible CSS baseline. |
| Design-system values | Register named CSS colors and spacing values. Apply colors to supported Fill, Stroke and Text color targets. Bind spacing in eligible Gap and Padding fields. Apply, replace and detach a named text style as one undoable action. |
| Source handoff | A coding agent reads the journal and inspects the source, then proposes or makes the requested source change. Source verification happens separately with previews off. |
| Planned | Editing real component inputs through their public API. Component discovery, Figma synchronization, and automatic source writeback are outside this baseline. |

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

Registration tells the Inspector which choices the project maintains. A matching rendered color or size alone cannot establish which token authored an existing value. Keep the project stylesheet or its maintained upstream source authoritative.

## Follow a saved edit into source

The extension selects a live element and writes a reversible preview. The helper verifies the app binding and persists the journal with revision checks. Use the helper's `status` command to locate the journal. A record can include the route, target evidence, CSS property, prior value, requested value, observed value, and token identity. This example is an excerpt for reading the journal.

```json
{
  "route": "/example",
  "target": { "tag": "div", "id": null, "slot": null, "text": "Example item", "key": "example-item:summary" },
  "property": "gap",
  "before": "8px",
  "requested": "var(--space-4)",
  "observed": "16px",
  "spacingToken": { "source": "src/styles/theme.css", "name": "--space-4" },
  "restore": "unique",
  "intent": "selected occurrence only"
}
```

Use the journal as evidence of intent. Skip undone records and account for later edits that supersede earlier ones. Keep grouped text-style operations together. Verify the authored use, ownership, and scope in the repository before patching. Preserve the named reference in the project's usual source representation. If one source expression renders many rows, editing it can affect every row even when the journal uniquely identifies one rendered item. Surface that scope before making a shared change.

Run the app with the Inspector detached or in a fresh uninstrumented browser view. Verify the source-produced result, the neighboring instance, and any relevant theme. Treat an edit as promoted only after that check. Keep unresolved decisions available for review.

For preview replay, a stable, unique `data-inspector-target` on the actual editable element can identify a rendered occurrence across remounts. The Inspector also checks compatible target and style evidence. Missing, duplicate, or stale evidence can leave the edit saved without replaying it. Track how often an ordinary session requires extra target annotations or reselection.

## Local data boundary

The extension runs on loopback HTTP pages. The helper listens on loopback, checks a pairing key, and writes into the state directory you choose. No hosted service is required. The journal can contain local working-copy paths, route details including query strings, selected text, and identifiers. Keep the journal and pairing key in the approved environment. Check separately what the coding agent can read or transmit before giving it the journal or repository.

## Evidence and next checkpoint

Earlier installed-extension trials on two React reference apps exercised saved edits, navigation, Undo, and scoped source changes with previews off. For the integrated baseline, 66 browser regression tests passed. A separate unpacked-extension trial with the real helper saved a gap edit and named text style in a disposable app with preassigned target keys. Both previews returned after reload and browser Back. A fresh coding agent used the journal to apply both decisions in source. A browser with the Inspector absent verified the named reference, the intended occurrence, and an unchanged neighbor. Independent installation, managed-workstation fit, and the effort of adding stable identities in an ordinary project remain open.

For the next trial, use the actual unpacked extension and real helper. Make a small batch with a named color, spacing value, text style, and layout change. Navigate away and back, reload, and Undo one choice. Give the remaining journal and repository to a coding agent. The trial passes when the intended source changes reproduce with previews off, named references survive, the neighboring instance is unaffected, and the evaluator can account for setup and recovery effort.

The next component experiment is one real Button Size choice, with a direct use, a wrapper, and a repeated use. The catalog would describe supported choices. Runtime evidence would identify the selected occurrence. Source evidence would establish which public input to change and what else it affects. Any development integration should earn its installation cost by rendering the actual component in context and preserving Undo and source verification.

For contributor checks, see [AGENTS.md](../AGENTS.md#checks-and-tests).
