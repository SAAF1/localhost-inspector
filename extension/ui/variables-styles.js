(() => {
  const ui = window.LocalhostInspector
  ui.variablesStyles = `
    .li-variables {
      display: flex; flex-flow: column; min-width: 0; min-height: 0; flex: 1;
      color: var(--li-text); background: var(--li-surface);
      font: 400 var(--li-type-size)/var(--li-line-height) var(--li-font);
    }
    .li-variables-body { min-height: 0; overflow: auto; overscroll-behavior: contain; flex: 1; }
    .li-variables-header {
      position: sticky; top: 0; z-index: 1; background: var(--li-surface);
      display: flex; justify-content: space-between; align-items: center;
      min-height: calc(var(--li-action-size) + 2 * var(--li-gap)); padding-inline: var(--li-gap);
    }
    .li-variables h2, .li-variables h3 { margin: 0; font: inherit; }
    .li-variables-header h2 { font-weight: 500; }
    .li-variables .li-var-control {
      border: 0; background: transparent; padding: 0; text-align: start;
      min-height: var(--li-field-height); cursor: pointer; font: inherit; color: inherit;
    }
    .li-variables .li-var-category {
      display: inline-flex; gap: var(--li-space-small); align-items: center;
      border-radius: var(--li-radius); padding-inline: var(--li-gap); font-weight: 600;
    }
    .li-var-category .li-icon { width: var(--li-icon-size); height: var(--li-icon-size); }
    .li-variables .li-var-category:hover, .li-variables :is(.li-var-category, .li-color-sort)[aria-expanded=true] { background: var(--li-field); }
    .li-var-detail-nav { display: flex; padding: var(--li-space-small) var(--li-gap) 0; }
    .li-list-folded > :is(.li-var-list,.li-var-color-group),
    .li-list-folded .li-type-uses > .li-type-use { display: none; }
    .li-variables-header > h2 { margin-inline-end: auto; }
    .li-var-detail-nav .li-var-back { margin-inline-end: auto; }
    .li-var-detail:has(.li-type-row):is(:hover,:focus-within) { background: var(--li-field); }
    .li-variables button.li-all-text {
      display: flex; align-items: center; justify-content: space-between; width: 100%;
      padding: var(--li-gap) var(--li-inset); border: 0; border-radius: 0; background: transparent;
      font: inherit; font-weight: 600; color: inherit; cursor: pointer;
    }
    .li-variables button.li-all-text:hover { background: var(--li-field); }
    .li-variables button.li-all-text[aria-pressed=true] { background: var(--li-control-selected-surface); }
    .li-var-back .li-icon { transform: rotate(180deg); }
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
    :is(.li-type-row, .li-type-uses) .li-var-count {
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
    .li-preview-row:has(.li-var-value):is(:hover,:focus-within) .li-var-count { opacity: 0; }
    .li-type-row:has(.li-type-action):is(:hover,:focus-within,:has([aria-expanded=true])) .li-type-tile {
      background: var(--li-surface);
    }
    .li-type-properties { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--li-gap); padding: var(--li-inset); border: 0; }
    .li-preview-row .li-var-value[aria-pressed=true] { background: var(--li-control-selected-surface); }
    .li-preview-row .li-type-action { background: var(--li-surface); border-color: var(--li-border); }
    .li-color-matches > summary {
      padding-inline: var(--li-inset); min-height: calc(var(--li-field-height) + var(--li-gap));
      gap: var(--li-gap); font-weight: 400; border-radius: 0;
    }
    .li-color-matches > summary .li-icon { width: 12px; margin-inline-start: calc(var(--li-gap) - 12px); opacity: 1; color: var(--li-muted); }
    .li-color-matches > summary .li-swatch { width: var(--li-inset); height: var(--li-inset); }
    .li-color-role-count { margin-inline-start: auto; color: var(--li-muted); font-size: var(--li-caption-size); }
    .li-var-color-group .li-preview-row {
      --li-color-indent: calc(2 * var(--li-inset));
      display: grid; grid-template-columns: var(--li-color-indent) auto minmax(0, 1fr) var(--li-action-size) auto var(--li-inset);
    }
    .li-color-matches .li-preview-row { --li-color-indent: calc(3 * var(--li-inset)); }
    .li-color-matches .li-var-meta { display: none; }
    .li-variables .li-var-color-row {
      display: flex; align-items: center; gap: var(--li-gap); min-width: 0; padding-block: var(--li-gap);
    }
    .li-var-color-group button.li-var-color-row {
      display: grid; grid-template-columns: subgrid; column-gap: 0; grid-column: 1 / -1; grid-row: 1;
    }
    .li-var-color-unnamed { color: var(--li-muted); }
    .li-var-color-row .li-swatch { grid-column: 2; width: var(--li-inset); height: var(--li-inset); flex: none; }
    .li-var-color-group .li-type-labels { grid-column: 3; padding-inline: var(--li-gap) var(--li-space-small); }
    .li-var-color-group .li-type-action {
      position: relative; right: auto; grid-column: 4; grid-row: 1;
    }
    .li-var-color-group .li-preview-row:focus-within:not(:hover):not(:has(:focus-visible)) .li-type-action { opacity: 0; pointer-events: none; }
    .li-var-color-group .li-var-count { grid-column: 5; margin-inline-start: var(--li-space-small); }
    .li-var-color-group .li-preview-row:has(button[aria-pressed=true]) { background: var(--li-control-selected-surface); }
    .li-var-color-group .li-preview-row:is(:hover, :focus-within) .li-var-count { background: var(--li-surface); }
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
    .li-var-list { padding: var(--li-gap) var(--li-gap); }
    .li-variables .li-var-list-row { width: 100%; border-radius: var(--li-radius); padding: var(--li-gap); }
    .li-var-list-row > :first-child { overflow-wrap: anywhere; }
    .li-var-list-row[aria-current=true] { background: var(--li-control-selected-surface); }
    .li-var-list-row .li-icon { width: 12px; height: 12px; }
    .li-var-detail {
      display: flex; align-items: center; gap: var(--li-space-small);
      min-width: 0; padding-inline: var(--li-gap); border-bottom: 1px solid var(--li-border);
    }
    .li-var-detail > :is(.li-var-color-row, .li-var-value, .li-type-row) { flex: 1; min-width: 0; }
    .li-var-detail :is(.li-var-project-jump, .li-type-action) { flex: none; }
    .li-var-detail .li-type-action { position: static; opacity: 1; pointer-events: auto; }
    .li-var-detail .li-type-body { flex: 1; padding-inline: 0 var(--li-gap); }
    .li-var-detail .li-type-tile { width: clamp(20px, 18.5cqw, 40px); }
    .li-var-detail { container-type: inline-size; }
    .li-component-details { padding-block: var(--li-gap); }
    .li-component-details h2 { font-weight: 600; }
    .li-var-detail .li-type-labels h2 { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-type-use-toolbar { display: flex; align-items: center; gap: var(--li-space-small); padding: var(--li-gap) var(--li-inset); }
    .li-type-use-toolbar { color: var(--li-muted); }
    .li-type-use-toolbar > .li-var-count { margin-inline-end: auto; }
    .li-type-previous .li-icon { transform: rotate(180deg); }
    .li-type-page > summary { display: flex; align-items: center; gap: var(--li-space-small); padding-inline: var(--li-gap); cursor: pointer; }
    .li-type-page-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-type-page > summary { padding-inline-end: var(--li-inset); }
    .li-type-page > summary .li-var-count { margin-inline-start: auto; }
    .li-type-page > summary .li-icon { opacity: 1; width: 12px; height: 12px; }
    .li-type-page > summary > .li-icon:nth-child(2) { transform: none; }
    .li-variables .li-var-list-row.li-type-use { justify-content: start; align-items: center; padding: 2px var(--li-inset); min-height: var(--li-field-height); border-radius: 0; }
    .li-type-use .li-icon { flex: none; color: var(--li-muted); }
    .li-variables .li-type-page .li-type-use { padding-inline-start: calc(2 * var(--li-inset)); }
    .li-type-use > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-var-detail > .li-var-value { border: 0; }
    .li-variables .li-var-message { padding: var(--li-gap) var(--li-inset); margin: 0; color: var(--li-muted); }
    .li-var-message:empty { display: none; }
  `
})()
