(() => {
  const ui = window.LocalhostInspector
  ui.variablesStyles = `
    .li-variables {
      display: flex; flex-flow: column; min-width: 0; min-height: 0; flex: 1;
      color: var(--li-text); background: var(--li-surface);
      font: 400 var(--li-type-size)/var(--li-line-height) var(--li-font);
    }
    .li-variables-body { min-height: 0; overflow: auto; overscroll-behavior: contain; flex: 1; }
    .li-variables-header { display: flex; justify-content: space-between; align-items: center; padding: var(--li-gap) var(--li-inset) var(--li-space-small); }
    .li-variables h2, .li-variables h3 { margin: 0; font: inherit; }
    .li-variables-header h2 { font-weight: 500; }
    .li-variables .li-var-control {
      border: 0; background: transparent; padding: 0; text-align: start;
      min-height: var(--li-field-height); cursor: pointer; font: inherit; color: inherit;
    }
    .li-variables .li-var-quiet, .li-variables .li-var-back {
      display: inline-flex; gap: var(--li-space-small); align-items: center;
      border-radius: var(--li-radius); padding: 0 var(--li-space-small); color: var(--li-muted);
    }
    .li-var-quiet .li-icon, .li-var-back .li-icon { width: 12px; height: 12px; }
    .li-var-back .li-icon { transform: rotate(180deg); }
    .li-variables .li-var-back { margin: var(--li-gap) var(--li-inset); }
    .li-variables :is(.li-var-back, .li-var-quiet):hover, .li-variables .li-var-quiet[aria-expanded=true] { background: var(--li-field); }
    .li-variables .li-var-group h3 {
      padding: var(--li-inset) var(--li-inset) var(--li-space-small);
      font-size: var(--li-caption-size); font-weight: 600;
    }
    .li-variables .li-var-value {
      display: block; width: 100%; padding: var(--li-gap) 0;
      border-bottom: 1px solid var(--li-border); min-width: 0;
    }
    .li-var-group button.li-var-value { padding-inline: var(--li-inset); border-radius: 0; }
    .li-variables button.li-var-value:is(:hover, :focus-visible), .li-variables .li-var-list-row:hover { background: var(--li-field); }
    .li-var-line, .li-variables .li-var-list-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--li-gap); }
    .li-var-sample { min-width: 0; overflow-wrap: anywhere; }
    .li-var-count, .li-var-meta { color: var(--li-muted); font: 400 var(--li-caption-size)/var(--li-line-height) var(--li-font); }
    .li-var-count { flex: none; font-variant-numeric: tabular-nums; }
    .li-var-meta { display: block; overflow-wrap: anywhere; margin-top: var(--li-space-small); }
    .li-type-group > summary { padding-inline: var(--li-space-small); }
    .li-type-group:first-of-type { margin-top: var(--li-gap); }
    .li-type-group + .li-type-group { margin-top: var(--li-inset); }
    .li-type-row { display: flex; align-items: center; position: relative; }
    .li-type-row:has(button):is(:hover, :focus-within, :has([aria-expanded=true])) { background: var(--li-field); }
    .li-type-body {
      display: flex; align-items: center; gap: var(--li-gap); width: 100%; min-width: 0;
      border: 0; background: transparent; color: inherit; font: inherit; text-align: start;
      padding: calc(var(--li-gap) + 2px) var(--li-inset);
    }
    button.li-type-body { cursor: pointer; }
    .li-type-tile {
      width: calc(var(--li-field-height) + var(--li-inset)); height: calc(2 * var(--li-inset)); flex: none;
      display: grid; place-items: center; overflow: hidden; background: var(--li-field); border-radius: var(--li-radius);
    }
    .li-fit-specimen { position: relative; }
    .li-text-style-specimen.li-fit-specimen {
      height: clamp(calc(4 * var(--li-field-height)), calc(1.3 * var(--li-specimen-size)), calc(7 * var(--li-field-height)));
    }
    .li-fit-specimen > span {
      position: absolute; left: 50%; top: 50%; width: max-content; max-width: none;
      white-space: pre; overflow: visible; visibility: hidden; line-height: normal !important;
    }
    .li-specimen-marker { position: absolute; visibility: hidden; font: inherit; line-height: 1; }
    .li-type-labels { flex: 1; min-width: 0; }
    .li-type-labels > span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-type-labels .li-var-meta { margin: 0; }
    .li-type-row:not(.li-var-color-group *) .li-var-count {
      min-width: var(--li-action-size); padding-inline: var(--li-space-small); text-align: center;
      background: var(--li-field); border-radius: var(--li-field-height);
    }
    .li-type-action { position: absolute; right: var(--li-inset); opacity: 0; pointer-events: none; }
    .li-type-action[aria-expanded=false] {
      background: var(--li-surface); border-color: var(--li-border); --li-action-hover: var(--li-surface);
    }
    .li-type-action[aria-expanded=false]:hover { border-color: var(--li-muted); }
    .li-type-action[aria-expanded=true] {
      --li-action-hover: var(--li-control-selected-surface); border-color: var(--li-control-selected-icon);
    }
    .li-type-row:is(:hover,:focus-within,:has([aria-expanded=true])) .li-type-action { opacity: 1; pointer-events: auto; }
    .li-type-row:has(.li-type-action):is(:hover,:focus-within,:has([aria-expanded=true])) .li-var-count { opacity: 0; }
    .li-type-row:has(.li-type-action):is(:hover,:focus-within,:has([aria-expanded=true])) .li-type-tile {
      background: var(--li-surface);
    }
    .li-type-properties { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--li-gap); padding: var(--li-inset); border: 0; }
    .li-preview-row .li-var-value[aria-pressed=true] { background: var(--li-control-selected-surface); }
    .li-preview-row .li-type-action { background: var(--li-surface); border-color: var(--li-border); }
    .li-color-order { display: flex; align-items: center; justify-content: space-between; padding: var(--li-gap) var(--li-inset) var(--li-space-small); }
    .li-variables .li-color-order h3 { padding: 0; font-weight: 500; }
    .li-color-matches { position: relative; }
    .li-color-matches::after {
      content: ''; position: absolute; pointer-events: none; inset-block: var(--li-space-small);
      inset-inline-start: var(--li-gap); width: 2px; border-radius: var(--li-radius); background: var(--li-border);
    }
    .li-var-color-group :is(.li-preview-row, .li-color-matches) + :is(.li-preview-row, .li-color-matches) { margin-top: var(--li-space-small); }
    .li-variables .li-var-color-row {
      display: flex; align-items: center; gap: var(--li-gap); width: 100%;
      padding-block: 2px; min-height: calc(var(--li-field-height) + 4px);
    }
    .li-var-color-group button.li-var-color-row { padding-inline: var(--li-inset); border-radius: 0; }
    .li-var-color-group button.li-var-color-row:is(:hover, :focus-visible) { background: var(--li-field); }
    .li-var-color-group button.li-var-color-row[aria-pressed=true] { background: var(--li-control-selected-surface); }
    .li-var-color-group .li-var-count { min-width: 3ch; text-align: end; }
    .li-var-color-field {
      display: flex; align-items: center; gap: var(--li-space-small);
      flex: 1; min-width: 0; height: var(--li-field-height);
      padding-inline: var(--li-space-small); border: 1px solid transparent; border-radius: var(--li-radius);
      background: var(--li-field);
    }
    .li-var-color-role { background: var(--li-surface); border-color: var(--li-border); }
    button.li-var-color-row:hover .li-var-color-field { background: var(--li-field); border-color: var(--li-border); }
    .li-var-color-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .li-var-opacity {
      margin-inline-start: auto; border-inline-start: 1px solid var(--li-border);
      padding-inline: var(--li-space-small); flex: none; color: var(--li-muted);
    }
    .li-var-color-trailing {
      display: grid; grid-template-columns: minmax(3ch, auto) 20px; align-items: center;
      text-align: end; gap: var(--li-space-small); color: var(--li-muted);
    }
    .li-var-color-trailing .li-icon { width: 12px; height: 12px; justify-self: center; }
    .li-var-color-detail { padding-inline: var(--li-inset); }
    .li-var-color-detail .li-var-color-row { max-width: calc(100% - 26px); }
    .li-variables .li-var-color-detail h3 { font-weight: 500; margin-top: var(--li-gap); }
    .li-variables .li-var-color-page, .li-variables .li-var-color-use { align-items: center; }
    .li-var-color-page[aria-expanded=true] { background: var(--li-field); }
    .li-variables .li-var-list-row.li-var-color-use { padding-inline-start: calc(var(--li-inset) + var(--li-space-small)); }
    .li-var-color-use > :first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-var-use-property { flex: none; margin-inline-start: auto; color: var(--li-muted); font-size: var(--li-caption-size); }
    .li-variables .li-inspector-tabs button[aria-pressed=true] { background: var(--li-field); color: var(--li-text); font-weight: 600; }
    .li-var-list { padding: var(--li-gap) var(--li-gap); }
    .li-variables .li-var-list-row { width: 100%; border-radius: var(--li-radius); padding: var(--li-gap); }
    .li-var-list-row > :first-child { overflow-wrap: anywhere; }
    .li-var-list-row[aria-current=true] { background: var(--li-control-selected-surface); }
    .li-var-list-row .li-icon { width: 12px; height: 12px; }
    .li-var-detail { padding: 0 var(--li-inset); border-bottom: 1px solid var(--li-border); }
    .li-var-detail > .li-var-value { border: 0; }
    .li-variables .li-var-detail-title { padding: var(--li-inset) var(--li-inset) var(--li-space-small); font-weight: 600; font-size: 13px; }
    .li-variables .li-var-message { padding: var(--li-gap) var(--li-inset); margin: 0; color: var(--li-muted); }
    .li-var-message:empty { display: none; }
  `
})()
