---
name: inspector-variant-feedback
description: Use when a designer gives feedback on screens or variants in a Localhost Inspector canvas, including requests to combine parts of several alternatives. Records which variants the designer responded to in Activity.
---

Resolve the designer’s references against the current Inspector canvas before changing it. Run the bundled helper relative to this skill’s directory. Supply the canvas directory or its linked app project root.

```sh
scripts/activity list "/path/to/app-or-canvas"
```

Use variant names, sections and the conversation to identify the stable IDs the feedback addresses. For a comment about a piece of a screen, use the containing variant. If a reference is ambiguous, resolve it with the designer before acknowledging it. Opening a screen, asking what is available or listing work leaves the inbox alone.

When the designer expresses a preference, gives feedback, or asks for a revision, record the addressed IDs together. For example, a request to combine the header from one alternative with the body from another addresses both. Acknowledge the response when received, even if building the revision takes longer.

```sh
scripts/activity respond "/path/to/app-or-canvas" variant-a variant-b
```

Check the command result. Addressed variants move to Recent. New variants produced in response enter Inbox through ordinary canvas registration.
