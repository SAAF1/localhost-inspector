# Localhost Inspector contributor rules

This extension edits a running local app and records reversible previews. The helper saves a journal; promoting an edit into application source remains a separate, reviewed coding-agent task. Read [README.md](README.md) for installation and [the evaluation guide](docs/EVALUATION.md) for supported behavior and verification boundaries.

## Architecture

- extension/worker.js owns attachment, pairing, and ordered script injection.
- extension/bridge.js is the extension messaging boundary.
- extension/inspector.js owns selection, edit validation, save/rollback, Undo, comparison, and route restoration.
- extension/ui/ contains presentation: tokens/styles/icons, DOM controls/menus, then padding/layout/section composition and panel assembly.
- local-helper.mjs owns local-server verification, authorization, validation, and durable journal storage.

The UI uses classic scripts in Chrome's isolated world, ordered by worker.js. Modules share one LocalhostInspector namespace. Keep dependencies explicit in that injection list; do not create a generic plugin/container framework. The shipped extension requires no runtime npm dependencies or compilation.

## Architecture checkpoints

Before committing to a new host or storage model, broad component integration, a live canvas lifecycle, or variation isolation, record the assumption, what reversing it would require, and the result of the smallest representative proof. Use the [stage checkpoints](docs/EVALUATION.md#architecture-checkpoints). Routine fixes and reversible prototypes can proceed directly.

## Editing safety

- Every property edit goes through the inspector's commit path. UI controls must never write styles directly to the inspected app.
- Preserve browser validation, supported-context checks, failed-save rollback, and careful restoration of prior inline values and priorities.
- Keep ordinary app clicks working. Selection uses Command-click; overlays remain inspect-only.
- Before comparison disables editing. Route changes and stale selections must not redirect pending edits to another element.
- Paired padding/alignment actions currently produce separate journal entries. A second failure may leave the first change saved: report it and preserve Undo. Never claim atomic behavior without implementing it end to end.
- Collapsing padding changes presentation only. Preserve unequal side values and show Mixed; never silently coerce them.

## Maintainable implementation

- Prefer plain, direct code with names that explain the role. Extract repeated or independently understandable parts; avoid speculative abstraction and one-use frameworks.
- Aim for files below 300 lines when cohesive. This is a review signal, not a reason to split code arbitrarily.
- Reuse tokens, field/menu primitives, and icon factories. Keep product state out of tokens and sample design values out of production data.
- No new framework, build system, runtime dependency, broad refactor, or feature expansion without a concrete need in the task.
- Use real buttons, accessible input names, keyboard-operable menus, visible focus, and truthful disabled/error states. Put user/app text into textContent, not HTML interpolation.

## Scope and visual verification

- Keep editing inside the supported contexts described in the evaluation guide. Grid editing, direct font-family editing, and broader paint controls are outside the current scope. Component editing is limited to the opt-in direct Button Size proof.
- Keep direct numeric and literal controls usable where they are supported. Preserve the distinction between an intentional named binding and a coincidentally equal value.
- Reuse the existing Inspector controls and tokens when introducing a state or interaction.
- Compare a screenshot of the assembled implementation with each relevant source-photo section. Check field geometry, optical alignment, icons, labels, menus, and states. A component gallery alone is insufficient.
- Distinguish verified fidelity, intentional scope adaptations, and unresolved differences. Do not claim pixel perfection from a glance or successful server startup.

## Checks and tests

Use Node 22.13+ and npm ci. Run npm run check, npm run test:browser, and npm run build before handoff. Install the matching Chromium once with npx playwright install chromium. A cached browser may be selected with INSPECTOR_BROWSER. Browser fixtures use disposable processes and close them in finally blocks; they do not replace a real-extension installation check.

Test user-visible contracts and credible regressions: save failure, Undo/comparison/restoration, validation boundaries, keyboard menus, and partial paired edits. Prefer a few end-to-end assertions over mocks of implementation details. Do not add tests for every icon, static label, trivial wrapper, or CSS declaration; no coverage quota or snapshot bulk.

Keep public documentation self-contained. Use synthetic examples and omit private project identifiers, machine-specific paths, pairing keys, and real journals.

Keep changes focused and reviewable. State what was checked and what remains unverified. Do not commit, push, open a pull request, or deploy unless requested.
