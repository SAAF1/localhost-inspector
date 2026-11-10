# Localhost Inspector

Localhost Inspector brings a Figma-style design inspector to a running local web app. Command-click an element, adjust its design properties, and see the result in the browser. The app stays usable while you work, so you can follow a real flow and judge the edit in context.

The Chrome extension handles selection and previews. A local helper remembers which working copy serves the app and saves edits to a JSON journal. A coding agent can read that journal, inspect the source, and make a scoped change without a clipboard handoff.

## The workflow

1. Start a local app as usual and attach the inspector to its tab.
2. Command-click to select. Use **Parent** when the surrounding layout owns the property you want to change.
3. Adjust supported layout, sizing, spacing, typography, or appearance controls. Use **Undo** to reverse an edit and **Before/After** to compare.
4. Hand the saved journal to a coding agent. Verify the resulting source change in a fresh view with previews off.

Edits save as you work. A preview can return after navigation or reload when the inspector can confidently identify its target. If a target is ambiguous, the journal preserves the edit for review.

## Design standards

- **Make scope visible.** Show what is selected and which element an edit will affect. Keep ordinary app clicks working outside the selection gesture.
- **Show controls that fit the context.** A layout container owns spacing and alignment. A sizing mode should be available only where the browser can produce the expected result.
- **Keep previews reversible and saves durable.** Undo should remove the inspector’s contribution while preserving unrelated app changes. Report a failed save or an edit that could not be restored.
- **Verify against source.** A preview is a design decision. The agent resolves the intended scope in source, then checks the running app with previews disabled.
- **Keep setup small.** Attach to an existing development server. The inspector does not require an app plugin, a build-tool migration, or a hosted service.

## Roadmap

| Stage | Outcome |
|---|---|
| 1. Live inspector | Polish a running screen, retain edits across navigation, and hand a saved batch to a coding agent. |
| 2. Design-system values | Choose colors, spacing, and typography from an authoritative token source while preserving token identity. |
| 3. Layers and components | Find meaningful elements and parents, and edit supported component variants and slots. |
| 4. Live canvas and flows | Arrange live views and revisit reproducible states of the running app. |
| 5. Variations and promotion | Explore isolated alternatives and carry a chosen variation into source through a reviewable change. |

## Try the macOS development build

The 0.1.0 candidate was exercised on Shadcn Admin and a separate MUI fixture in a disposable Chromium profile. Independent installation is still pending. To try the build, use macOS, Node.js, desktop Chrome with unpacked extensions enabled, and an app serving HTTP on `127.0.0.1`. The helper currently verifies a direct local server by its listening process and working directory. Port `5188` must be free for the helper.

From the repository root, with the app already running, substitute your app's port and working-copy path:

```sh
state="$HOME/.localhost-inspector"
node local-helper.mjs "$state" bind 5173 "/absolute/path/to/working-copy"
node local-helper.mjs "$state" serve
```

In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/`. Open the extension's options and enter the pairing key from the state directory's `pairing-key` file. Open the bound app URL and invoke **Attach Localhost Inspector** from Chrome's Extensions menu.

In a separate terminal at the repository root, run `node local-helper.mjs "$HOME/.localhost-inspector" status` to find the journal. Use the same state directory you chose during setup.
