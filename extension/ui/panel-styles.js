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
    .li-panel:focus { outline: none; }
    #close-inspector { position: absolute; top: var(--li-space-small); right: var(--li-inset); }
    :host([data-docked]) .li-panel {
      position: relative; inset: auto; height: var(--li-dock-height, 100vh); max-height: none;
      width: min(var(--li-panel-width), var(--li-dock-max-width, 100vw));
      border-radius: var(--li-dock-radius, 0);
      border: var(--li-dock-border-width, 0) solid var(--li-border); border-left-width: 1px;
    }
    :host([data-workspace-toolbar]) .li-panel { padding-top: var(--li-dock-workspace-top); }
    :host([data-workspace-toolbar]) :is(.li-entry, #close-inspector) { display: none; }
    :host([data-workspace-toolbar]) .li-header { min-height: 32px; }
    :host([data-workspace-toolbar]) .li-header[data-no-selection] { display: none; }
    .li-panel-toolbar {
      min-height: 40px; flex: none; padding: 0 var(--li-inset);
      display: flex; align-items: center; justify-content: flex-end; gap: var(--li-gap);
    }
    .li-header { justify-content: space-between; border-bottom: 1px solid var(--li-border); }
    .li-selected-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .li-inspector-tabs {
      display: flex; align-items: center; flex: none; gap: var(--li-space-small);
      padding: var(--li-space-small) var(--li-inset); border-bottom: 1px solid var(--li-border);
    }
    .li-inspector-tabs button {
      border: 0; border-radius: var(--li-radius); background: transparent;
      min-height: var(--li-action-size); padding-inline: var(--li-gap);
    }
    .li-inspector-tabs button:focus-visible { outline-offset: -1px; }
    .li-inspector-tabs button { color: var(--li-muted); white-space: nowrap; }
    .li-inspector-tabs button:hover, .li-inspector-tabs button[aria-selected="true"] {
      background: var(--li-field); color: var(--li-text);
    }
    .li-inspector-tabs button[aria-selected="true"] { font-weight: 600; }
    .li-design-view, .li-pending-view { display: flex; flex: 1; flex-direction: column; min-height: 0; }
    .li-pending-floating:focus { outline: none; }
    .li-pending-header {
      display: flex; justify-content: space-between; align-items: center; flex: none;
      padding: var(--li-space-small) var(--li-inset); border-bottom: 1px solid var(--li-border);
    }
    .li-select.li-pending-order { width: auto; border-color: transparent; background-color: transparent; }
    .li-select.li-pending-order:is(:hover, [aria-expanded="true"]) { background-color: var(--li-field); }
    .li-pending-list { flex: 1; overflow: auto; overscroll-behavior: contain; }
    .li-pending-empty { margin: 0; padding: var(--li-inset); color: var(--li-muted); }
    .li-pending-group { padding-block: var(--li-space-small); }
    .li-pending-group + .li-pending-group { border-top: 1px solid var(--li-border); }
    .li-pending-page {
      margin: 0; padding: var(--li-space-small) var(--li-inset);
      font-size: var(--li-caption-size); font-weight: 500; color: var(--li-muted);
    }
    .li-pending-row {
      position: relative; isolation: isolate; display: grid;
      grid-template-columns: minmax(0, 1fr) repeat(2, var(--li-action-size));
      align-items: center; padding-inline-end: var(--li-gap);
    }
    .li-pending-row + .li-pending-row { margin-block-start: var(--li-space-small); }
    .li-pending-row:is(:hover, :focus-within) { background: var(--li-field); }
    .li-pending-open:disabled { color: var(--li-text); }
    .li-pending-row[data-selected] { background: var(--li-control-selected-surface); }
    .li-pending-row > .li-icon-button { --li-action-hover: var(--li-surface); }
    @media (hover: hover) and (pointer: fine) {
      .li-pending-row:not(:hover, :focus-within) > .li-icon-button:not([aria-pressed="false"]) {
        opacity: 0; pointer-events: none;
      }
    }
    .li-pending-open {
      display: grid; text-align: left; padding: var(--li-space-small) 0 var(--li-space-small) var(--li-inset);
      border: 0; background: transparent; line-height: var(--li-line-height);
    }
    .li-pending-open:focus-visible { outline-offset: -2px; }
    .li-pending-open span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-pending-name { font-size: var(--li-type-size); font-weight: 600; }
    .li-pending-detail { color: var(--li-muted); font-size: var(--li-caption-size); }
    .li-pending-launcher, .li-pending-floating {
      position: fixed; z-index: 2147483646; right: var(--li-inset);
      background: var(--li-surface); border: 1px solid var(--li-border); border-radius: var(--li-radius);
      box-shadow: 0 2px 8px var(--li-shadow);
    }
    .li-pending-launcher {
      display: flex; align-items: center; gap: var(--li-space-small); min-height: 36px;
      bottom: var(--li-inset); right: calc(var(--li-inset) + 44px); padding-inline: var(--li-gap);
    }
    .li-pending-launcher .li-icon:last-child { width: 12px; }
    .li-pending-floating {
      bottom: calc(var(--li-inset) + 44px); width: min(312px, calc(100vw - 32px));
      max-height: min(384px, calc(100dvh - 72px)); overflow: hidden; border-radius: 12px;
    }
    :host([data-workspace-toolbar]) .li-pending-floating { top: var(--li-workspace-popover-top); right: 12px; bottom: auto; }
    .li-properties { min-height: 0; flex: 1; overflow: auto; overscroll-behavior: contain; }
    .li-properties .li-section:first-child { border-top: 0; }
    .li-canvas-section { border-bottom: 1px solid var(--li-border); }
    .li-canvas-section > h2 { justify-content: space-between; padding-right: var(--li-gap); }
    .li-canvas-paint-fields { flex: 1; min-width: 0; gap: 0; }
    .li-canvas-paint-fields > .li-color { flex: 1; min-width: 0; border-start-end-radius: 0; border-end-end-radius: 0; }
    .li-canvas-paint-fields > .li-field:has(#control-opacity) {
      width: calc(var(--li-field-width) - 3 * var(--li-gap));
      border-start-start-radius: 0; border-end-start-radius: 0;
      border-inline-start: 1px solid var(--li-surface);
    }
    .li-canvas-paint-fields :disabled + .li-caption { color: var(--li-disabled); }
    .li-guidance {
      display: flex; flex-direction: column; gap: 4px;
      padding: var(--li-inset) var(--li-inset) 12px;
    }
    .li-footer { flex: none; border-top: 1px solid var(--li-border); }
    .li-footer:has(.li-status:empty), .li-pending-view:not([hidden]) ~ .li-footer { display: none; }
    .li-footer .li-status { padding-bottom: var(--li-gap); }
    .li-panel-actions { gap: 4px; flex: none; }
    .li-panel-actions .li-icon-button[aria-pressed="true"]:hover {
      background: var(--li-control-selected-surface);
    }
    .li-comparison-label { padding: var(--li-space-small) var(--li-inset); color: var(--li-muted); }
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
    :host([data-docked]) .li-entry {
      top: var(--li-dock-entry-top, auto); bottom: var(--li-dock-entry-bottom, 54px);
      right: var(--li-dock-entry-right, var(--li-inset));
      width: var(--li-dock-entry-size, 36px); height: var(--li-dock-entry-size, 36px);
      border-radius: var(--li-dock-entry-radius, 50%);
      box-shadow: var(--li-dock-entry-shadow, var(--li-shadow));
    }
    .li-entry:active { background: var(--li-field); box-shadow: 0 1px 2px var(--li-shadow); }
    .li-tooltip {
      position: fixed; z-index: 2147483647; pointer-events: none;
      width: max-content; max-width: min(220px, calc(100vw - 16px));
      padding: 4px 8px; border-radius: var(--li-radius);
      color: var(--li-tooltip-text); background: var(--li-tooltip-surface);
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
    .li-dialog-revert { background: var(--li-destructive-surface); color: var(--li-destructive-text); border-color: var(--li-destructive-surface); }
  `
})()
