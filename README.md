# Localhost Inspector

Localhost Inspector brings a Figma-style design inspector to a running local web app. Command-click an element, adjust its design properties, and see the result in the browser. The app stays usable while you work, so you can follow a real flow and judge the edit in context.

The Chrome extension handles selection and previews. A local helper remembers which working copy serves the app and saves edits to a JSON journal. A coding agent can read that journal, inspect the source, and make a scoped change without a clipboard handoff.

The [editable Inbox and Reports studies](designs/shadcn-admin/README.md) include the ticket comparison, every saved flow step, and the combined conversion and retention report.

## Evaluate it on an existing project

The [evaluation guide](docs/EVALUATION.md) covers supported edits, project fit, design-system setup, and a source handoff you can verify with previews off.

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

## Current development status

This development branch includes registered CSS colors, spacing, and project-backed text styles. The [evaluation guide](docs/EVALUATION.md) documents catalog setup, test evidence, and the remaining release checks.

## Roadmap

| Stage | Outcome |
|---|---|
| 1. Live inspector | Polish a running screen, retain edits across navigation, and hand a saved batch to a coding agent. |
| 2. Design-system values | Choose colors, spacing, and typography from an authoritative token source while preserving token identity. |
| 3. Layers and components | Find meaningful elements and parents, and edit supported component variants and slots. |
| 4. Live canvas and flows | Arrange live views and revisit reproducible states of the running app. |
| 5. Variations and promotion | Explore isolated alternatives and carry a chosen variation into source through a reviewable change. |

## Try the macOS development build

The initial 0.1.0 candidate and later development slices were exercised in Shadcn Admin and MUI fixtures. A later installed-extension trial verified a spacing and text-style source handoff in a small keyed fixture. Independent installation and representative project qualification remain open. To try the build, use macOS, Node.js, desktop Chrome with unpacked extensions enabled, and an app serving HTTP on `127.0.0.1`. The helper currently verifies a direct local server by its listening process and working directory. Port `5188` must be free for the helper.

From the repository root, with the app already running, substitute your app's port and working-copy path:

```sh
state="$HOME/.localhost-inspector"
node local-helper.mjs "$state" bind 5173 "/absolute/path/to/working-copy"
node local-helper.mjs "$state" serve
```

In `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/`. Open the extension's options and enter the pairing key from the state directory's `pairing-key` file. Open the bound app URL and invoke **Attach Localhost Inspector** from Chrome's Extensions menu.

In a separate terminal at the repository root, run `node local-helper.mjs "$HOME/.localhost-inspector" status` to find the journal. Use the same state directory you chose during setup.

### Publish a multi-step canvas flow

For a Vite app, run `node scripts/flow/canvas.mjs add-flow CANVAS FLOW_ID ANCHOR --from-source APP_ROOT MANIFEST_JSON [VITE_CONFIG]`. Inspector uses the app’s Vite configuration, builds all steps once, and wires supported component instances to their live props. Each step should have its own starting route.

To publish an existing build, run `node scripts/flow/canvas.mjs add-flow CANVAS FLOW_ID ANCHOR BUILT_PREVIEW MANIFEST_JSON [EDITABLE_SOURCE]`. If you need a separate instrumented Vite build, use `npm run build:preview -- APP_ROOT NEW_OUTPUT_DIRECTORY [VITE_CONFIG]`. The manifest supplies the section title and the steps in reading order.

```json
{
  "section": "Swap a ticket",
  "steps": [
    { "key": "draft", "label": "Original attachment", "route": "/chats?demo=draft" },
    { "key": "choose", "label": "Choose a replacement", "route": "/chats?demo=choose" },
    { "key": "updated", "label": "Updated attachment", "route": "/chats?demo=updated" }
  ]
}
```

Each step can include a short `note`. All steps share one saved build and editable source. Each has its own preview origin, Inspector edits, and activity ID (`FLOW_ID~key`). The command publishes the section after all steps are ready. For a single-screen variant, use `canvas.mjs add`.

To review a saved flow, run `npm run review:flow -- CANVAS_URL FLOW_ID OUTPUT_DIRECTORY` against the running Inspector. A separate headless Chromium session opens each saved step, captures its preview, and switches through Components, Text styles, Colors, Spacing, and Layers. The output directory receives numbered PNGs and a `review.json` with each step’s route, rendered-text hash, inventory samples, and browser errors. This checks the published states. Testing the actions between states requires an interaction test.

A step can include a `sectionPath` such as `["Components", "Ticket attachment"]`. Each name creates a nested section below the flow; steps sharing the same path share a section. A component review frame can import the actual component and render its supported states together. Put the source name and the comparison to make in the step’s `note`. The headless report includes this note, the section path, and a direct canvas link.

Proposal creation and component lookup include the project's typography utilities and named color and spacing variables with their CSS source paths. Linked projects prefer the canvas registrations for each registered category. Unregistered categories use exported theme declarations. The lookup reports a typography class only when its utility binds the full recipe.

A flow step can add a plain-text `reviewNote` beneath its preview for a comparison or interaction to try. The shorter `note` remains the caption. Nested sections alternate surface colors automatically in light and dark themes.

Select a section title or a mockup frame title to change its fill in Design. The picker, opacity, and visibility controls work like Canvas fill. Both surfaces support a uniform corner radius and a single stroke color and weight. Width and height resize the mockup viewport. Section dimensions follow the frames inside. These workspace appearance settings are saved in the current browser for that localhost origin. Clicking the preview still opens the mockup for interaction.
