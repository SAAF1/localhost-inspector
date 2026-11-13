# Localhost Inspector

Localhost Inspector brings a Figma-style design inspector to a running local web app. Command-click an element, adjust its design properties, and see the result in the browser. The app stays usable while you work, so you can follow a real flow and judge the edit in context.

The Chrome extension handles selection and previews. A local helper remembers which working copy serves the app and saves edits to a JSON journal. A coding agent can read that journal, inspect the source, and make a scoped change without a clipboard handoff.

## Contributing

Read [AGENTS.md](AGENTS.md) before changing the extension. It describes the module boundaries, edit-safety rules, current scope, and the checks expected before handoff.

## The workflow

1. Start a local app as usual and attach the inspector to its tab.
2. Command-click to select. Use **Parent** when the surrounding layout owns the property you want to change.
3. Adjust supported layout, sizing, spacing, typography, or appearance controls. Use **Undo** to reverse an edit and **Before/After** to compare.
4. Hand the saved journal to a coding agent. Verify the resulting source change in a fresh view with previews off.

Edits save as you work. A preview can return after navigation or reload when the inspector can confidently identify its target. An optional development-only `data-inspector-target` attribute permits stable, unique target identity where the app supplies one. Unkeyed or ambiguous elements can still be edited and saved, but cannot be promised automatic recovery after remount. The helper rejects stale Save/Undo/Reset operations so an out-of-date tab cannot overwrite newer decisions.

## Design standards

- **Make scope visible.** Show what is selected and which element an edit will affect. Keep ordinary app clicks working outside the selection gesture.
- **Show controls that fit the context.** A layout container owns spacing and alignment. A sizing mode should be available only where the browser can produce the expected result.
- **Keep previews reversible and saves durable.** Undo should remove the inspector’s contribution while preserving unrelated app changes. Report a failed save or an edit that could not be restored.
- **Verify against source.** A preview is a design decision. The agent resolves the intended scope in source, then checks the running app with previews disabled.
- **Keep setup small.** Attach to an existing development server. The inspector does not require an app plugin, a build-tool migration, or a hosted service.

## Current development status (November 13, 2026)

This branch includes named color and spacing variable controls and project-backed text styles in addition to the original inspector. These capabilities use **registered, project-owned CSS sources** rather than discovering every possible design-system rule. Source registration is per connected app, for example:

```sh
node local-helper.mjs "$HOME/.localhost-inspector" register-colors 5173 src/styles/theme.css --primary --secondary
node local-helper.mjs "$HOME/.localhost-inspector" register-spacing 5173 src/styles/theme.css --space-2 --space-4
node local-helper.mjs "$HOME/.localhost-inspector" register-text-styles 5173 src/styles/theme.css --text-body --text-page-title
```

Replace port, path, and variable names with declarations that actually exist in the connected project; these are examples, not a promise that a new app contains them. A text style prefix must define supported font-family, font-weight, font-size, line-height, and letter-spacing variables. The helper validates the source. The coding agent can help identify an authoritative source; the Inspector does not automatically infer CSS authoring from a matching computed value.

The current stable-target repair was tested through installed extension and real helper on deliberately keyed Shadcn and MUI reference elements. Broader setup/wiring cost is not established. The new text-style functionality has browser-test and helper evidence; a full installed-extension end-to-end check for the combined latest build remains pending. Work-computer support and clean independent installation remain unqualified. [Second Brain current assessment](https://drive.google.com/file/d/15u8d2u3FiKvacbsjaFA7WnouljnuUO7s/view).

**Next release gate:** use the newest installed extension and real helper to make a realistic color/spacing/text-style/layout edit batch, browse and undo, implement via existing local agent, verify against source with previews disabled, and assess ordinary target identity burden. Then prototype one legitimate component property, with clear scope and without dumping raw props.

## Roadmap

| Stage | Outcome |
|---|---|
| 1. Live inspector | Polish a running screen, retain edits across navigation, and hand a saved batch to a coding agent. |
| 2. Design-system values | Choose colors, spacing, and typography from an authoritative token source while preserving token identity. |
| 3. Layers and components | Find meaningful elements and parents, and edit supported component variants and slots. |
| 4. Live canvas and flows | Arrange live views and revisit reproducible states of the running app. |
| 5. Variations and promotion | Explore isolated alternatives and carry a chosen variation into source through a reviewable change. |

## Try the macOS development build

The initial 0.1.0 candidate and later development slices were exercised in Shadcn Admin and MUI fixtures. The newest integrated build still needs full installed-extension acceptance and independent installation. To try the build, use macOS, Node.js, desktop Chrome with unpacked extensions enabled, and an app serving HTTP on `127.0.0.1`. The helper currently verifies a direct local server by its listening process and working directory. Port `5188` must be free for the helper.

From the repository root, with the app already running, substitute your app's port and working-copy path:

```sh
state="$HOME/.localhost-inspector"
node local-helper.mjs "$state" bind 5173 "/absolute/path/to/working-copy"
node local-helper.mjs "$state" serve
```

In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/`. Open the extension's options and enter the pairing key from the state directory's `pairing-key` file. Open the bound app URL and invoke **Attach Localhost Inspector** from Chrome's Extensions menu.

In a separate terminal at the repository root, run `node local-helper.mjs "$HOME/.localhost-inspector" status` to find the journal. Use the same state directory you chose during setup.
