(() => {
  const ui = window.LocalhostInspector
  ui.panelStyles = `
    .li-panel {
      position: fixed; bottom: var(--li-inset); right: var(--li-inset);
      display: flex; flex-direction: column;
      width: min(var(--li-panel-width), calc(100vw - 2 * var(--li-inset)));
      max-height: calc(100vh - 2 * var(--li-inset));
      background: var(--li-surface); color: var(--li-text);
      border-radius: var(--li-radius); z-index: 2147483646;
      text-align: left; isolation: isolate; overflow: hidden;
    }
    :host([data-docked]) .li-panel {
      position: relative; inset: auto; height: 100vh; max-height: none;
      width: min(var(--li-panel-width), 100vw); border-radius: 0; border-left: 1px solid var(--li-border);
    }
    .li-panel-toolbar {
      min-height: 40px; flex: none; padding: 0 var(--li-inset);
      display: flex; align-items: center; justify-content: flex-end; gap: var(--li-gap);
    }
    .li-header { border-bottom: 1px solid var(--li-border); }
    .li-properties { min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; }
    .li-properties .li-section:first-child { border-top: 0; }
    .li-guidance {
      display: flex; flex-direction: column; gap: 4px;
      padding: var(--li-inset) var(--li-inset) 12px;
    }
    .li-footer { flex: none; border-top: 1px solid var(--li-border); }
    .li-panel-actions { gap: 4px; flex: none; }
    .li-panel-actions .li-icon-button[aria-pressed="true"]:hover {
      background: var(--li-control-selected-surface);
    }
    .li-comparison-label { margin-right: auto; }
    .li-status {
      display: block; padding: var(--li-gap) var(--li-inset) 0;
      overflow-wrap: anywhere;
    }
    .li-status:empty { padding: 0; }
    .li-status[data-error] { color: var(--li-error); }
    .li-empty { padding: var(--li-inset); color: var(--li-muted); }
    .li-entry {
      position: fixed; bottom: var(--li-inset); right: var(--li-inset); z-index: 2147483646;
      width: 36px; height: 36px; border-radius: 50%;
      background: var(--li-surface); border-color: var(--li-border);
      box-shadow: 0 2px 6px var(--li-shadow);
    }
    :host([data-docked]) .li-entry { bottom: 54px; }
    .li-entry:active { background: var(--li-field); box-shadow: 0 1px 2px var(--li-shadow); }
    .li-tooltip {
      position: fixed; z-index: 2147483647; pointer-events: none;
      width: max-content; max-width: min(220px, calc(100vw - 16px));
      padding: 4px 8px; border-radius: var(--li-radius);
      color: var(--li-surface); background: var(--li-dark);
      box-shadow: 0 2px 6px var(--li-shadow); overflow-wrap: anywhere;
    }
    .li-revert-dialog {
      width: min(320px, calc(100vw - 32px)); padding: var(--li-inset);
      border: 1px solid var(--li-border); border-radius: var(--li-radius);
      background: var(--li-surface); color: var(--li-text);
      box-shadow: 0 4px 16px var(--li-shadow);
    }
    .li-revert-dialog::backdrop { background: rgb(0 0 0 / 24%); }
    .li-revert-dialog h2 { margin: 0 0 var(--li-gap); font-size: 13px; }
    .li-revert-dialog p { margin: 0 0 var(--li-inset); }
    .li-dialog-actions { display: flex; justify-content: flex-end; gap: var(--li-gap); }
    .li-dialog-button {
      padding: 4px 8px; border: 1px solid var(--li-border); border-radius: var(--li-radius);
      background: var(--li-field);
    }
    .li-dialog-button:hover { box-shadow: inset 0 0 0 1px var(--li-shadow); }
    .li-dialog-revert { background: var(--li-error); color: var(--li-surface); border-color: var(--li-error); }
  `
})()
