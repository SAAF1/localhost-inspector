(() => {
  'use strict'
  const ui = window.LocalhostInspector = window.LocalhostInspector || {}
  ui.styles = `
    :host {
      all: initial;
      color-scheme: light;
      color: var(--li-text);
      font: 400 var(--li-type-size)/var(--li-line-height) var(--li-font);
    }
    *, *::before, *::after { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button, input, select {
      margin: 0; font: inherit; color: inherit; letter-spacing: normal;
    }
    button { cursor: pointer; }
    button, input, select { -webkit-tap-highlight-color: transparent; }
    button:disabled, input:disabled, select:disabled,
    [aria-disabled="true"] { color: var(--li-disabled); cursor: default; }
    button:disabled .li-icon { color: inherit; }
    [aria-busy="true"] button, button[aria-busy="true"] { cursor: progress; }
    button:focus-visible, select:focus-visible {
      outline: 1px solid var(--li-active); outline-offset: 1px;
    }
    ::selection { background: var(--li-selection); color: var(--li-text); }
    .li-panel {
      position: fixed; bottom: 48px; right: 12px;
      width: var(--li-panel-width); max-height: calc(100vh - 80px);
      overflow: auto; overscroll-behavior: contain;
      background: var(--li-surface); color: var(--li-text);
      border-radius: var(--li-radius); z-index: 2147483646;
      font: 400 var(--li-type-size)/var(--li-line-height) var(--li-font);
      text-align: left; isolation: isolate;
    }
    .li-header, .li-footer { padding: var(--li-inset); }
    .li-header {
      display: flex; align-items: center; justify-content: space-between;
      gap: var(--li-gap); min-height: 57px;
      border-bottom: 1px solid var(--li-border);
    }
    .li-header-title { min-width: 0; flex: 1; font-weight: 600; overflow-wrap: anywhere; }
    .li-footer {
      display: flex; flex-direction: column; gap: var(--li-gap);
      border-top: 1px solid var(--li-border);
    }
    .li-section { border-top: 1px solid var(--li-border); }
    .li-heading, .li-section > h2 {
      display: flex; align-items: center; height: 39px;
      padding: 0 var(--li-inset); margin: 0;
      font: 600 var(--li-heading-size)/var(--li-line-height) var(--li-font);
    }
    .li-body {
      display: flex; flex-direction: column; gap: var(--li-gap);
      padding: 5px 8px 16px 16px;
    }
    .li-flow-actions { justify-content: space-between; }
    .li-bounds { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
    .li-layout-section .li-body { padding-top: 8px; }
    .li-layout-section .li-body > .li-stack:has(.li-flow-actions) + .li-stack { margin-top: -4px; }
    .li-padding { margin-top: -2px; }
    .li-padding-values { display: flex; flex-direction: column; gap: var(--li-gap); }
    .li-alignment-row > .li-icon-button { margin-top: 20px; }
    .li-type-section .li-body { gap: 4px; }
    .li-type-section .li-body > .li-row:nth-child(2) { margin-top: 2px; }
    .li-appearance-section .li-body { padding-top: 3px; }
    .li-stroke-section .li-body { gap: 6px; }
    .li-text-color { margin-top: 8px; }
    .li-row { display: flex; gap: var(--li-gap); }
    .li-stack { display: flex; flex-direction: column; gap: 4px; }
    .li-caption {
      display: block; color: var(--li-muted); margin: 0;
      font: 400 var(--li-caption-size)/16px var(--li-font);
    }
    .li-bound-caption {
      display: block; color: var(--li-muted); margin: 0;
      font: 400 var(--li-label-size)/12px var(--li-font);
    }
    .li-field {
      display: flex; align-items: center; flex: none;
      width: var(--li-field-width); height: var(--li-field-height);
      min-width: 0; gap: 4px; padding: 0 4px;
      border: 0; border-radius: var(--li-radius);
      background: var(--li-field); color: var(--li-text);
    }
    .li-field:hover { box-shadow: inset 0 0 0 1px var(--li-border); }
    .li-field:focus-within {
      outline: 1px solid var(--li-active); outline-offset: 1px;
    }
    .li-field input {
      appearance: none; display: block; flex: 1; min-width: 0; width: 0;
      height: 20px; padding: 0; border: 0; outline: none; border-radius: 0;
      background: transparent; transform: translateY(.5px);
      font: 400 var(--li-type-size)/var(--li-line-height) var(--li-font);
    }
    .li-field input::placeholder { color: var(--li-disabled); opacity: 1; }
    input[type="number"] { -moz-appearance: textfield; }
    input::-webkit-inner-spin-button, input::-webkit-outer-spin-button {
      -webkit-appearance: none; margin: 0;
    }
    .li-field:has(input:disabled) { box-shadow: none; }
    .li-field:has([aria-invalid="true"]), .li-field[aria-invalid="true"] {
      outline: 1px solid var(--li-error); outline-offset: 1px;
    }
    .li-field-glyph, .li-prefix { width: 16px; flex-shrink: 0; color: var(--li-muted); text-align: center; }
    .li-field .li-icon { color: var(--li-muted); }
    .li-constraint .li-icon { color: var(--li-constraint-icon); }
    .li-color { width: var(--li-color-field-width); padding: 0 5px; }
    .li-field:not(:has(> .li-icon, > .li-prefix, > .li-swatch)) { padding-left: 8px; padding-right: 8px; }
    .li-swatch {
      width: 14px; height: 14px; flex: 0 0 14px;
      border: 1px solid var(--li-border); border-radius: 2px;
      background: var(--li-swatch); pointer-events: none;
    }
    .li-select {
      display: flex; align-items: center; width: var(--li-field-width);
      height: var(--li-field-height); gap: 4px; padding: 0 8px;
      border: 1px solid var(--li-border); border-radius: var(--li-radius);
      background: var(--li-surface); text-align: left;
    }
    .li-select > span { flex: 1; min-width: 0; }
    .li-select select, .li-field select {
      appearance: none; flex: 1; min-width: 0; width: 0; border: 0;
      padding: 0; outline: 0; background: transparent;
    }
    .li-select:focus-within { outline: 1px solid var(--li-active); outline-offset: 1px; }
    .li-icon { display: block; width: 16px; height: 16px; flex: 0 0 16px; }
    .li-icon-button {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; flex: 0 0 24px; padding: 0;
      border: 1px solid transparent; border-radius: var(--li-radius);
      background: transparent; color: var(--li-text);
    }
    .li-icon-button:hover { background: var(--li-field); }
    .li-icon-button[aria-pressed="true"], .li-icon-button.li-selected {
      background: var(--li-control-selected-surface); color: var(--li-control-selected-icon);
    }
    .li-field-trigger {
      width: 24px; height: 24px; flex: 0 0 24px; border-radius: 0;
      border-left: 1px solid var(--li-surface);
    }
    .li-field:has(> .li-field-trigger):not(:has(> .li-prefix)) { padding-right: 0; }
    .li-field-trigger.li-width-mode-trigger { width: 16px; flex-basis: 16px; border: 0; }
    .li-field-trigger .li-icon { color: var(--li-text); }
    .li-segments {
      display: flex; width: 88px; height: 24px; background: var(--li-field); border-radius: var(--li-radius);
    }
    .li-segments button {
      display: flex; align-items: center; justify-content: center; flex: 1;
      padding: 0; min-width: 0; border: 1px solid transparent;
      border-radius: var(--li-radius); background: transparent; color: var(--li-muted);
    }
    .li-segments button[aria-pressed="true"], .li-segments button.li-selected {
      background: var(--li-surface); border-color: var(--li-border); color: var(--li-text);
    }
    .li-flow { width: 92px; }
    .li-flow button { flex: 0 0 46px; width: 46px; }
    .li-matrix {
      display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
      width: 88px; height: 56px; padding: 5px 1px;
      background: var(--li-field); border-radius: var(--li-radius);
    }
    .li-matrix button {
      display: flex; justify-content: center; align-items: center;
      position: relative; min-width: 0; padding: 0; border: 0; border-radius: 3px; background: transparent;
    }
    .li-matrix button::before {
      content: ''; width: 1.5px; height: 1.5px; border-radius: 50%; background: var(--li-disabled);
    }
    .li-matrix button[aria-pressed="true"] { color: var(--li-active); }
    .li-matrix button[aria-pressed="true"]::before { display: none; }
    .li-menu {
      position: fixed; display: flex; flex-direction: column; min-width: 168px;
      padding: 8px; border-radius: 14px; background: var(--li-dark); color: var(--li-surface);
      z-index: 2147483647; max-height: calc(100vh - 16px); overflow: auto;
      box-shadow: 0 4px 10px var(--li-shadow), 0 1px 2px var(--li-shadow);
      font: 400 var(--li-type-size)/var(--li-line-height) var(--li-font);
    }
    .li-menu-option {
      display: flex; align-items: center; flex-shrink: 0; gap: 8px; min-height: 24px;
      padding: 0 4px; border: 0; border-radius: var(--li-radius);
      color: inherit; background: transparent; text-align: left; white-space: nowrap;
    }
    .li-menu-list { display: flex; flex-direction: column; min-height: 0; overflow: auto; }
    .li-size-menu { width: 96px; min-width: 96px; }
    .li-size-menu .li-menu-option { padding: 0 7px; }
    .li-menu-scroll {
      display: flex; flex: 0 0 31px; align-items: center; justify-content: center;
      flex-direction: column; border-top: 1px solid var(--li-menu-divider); margin-top: 8px;
    }
    .li-menu-scroll .li-icon-button { width: 16px; height: 15px; flex: 0 0 15px; color: var(--li-surface); }
    .li-scroll-up .li-icon { transform: rotate(180deg); }
    .li-menu-option:hover, .li-menu-option:focus-visible,
    .li-menu-option[aria-selected="true"], .li-menu-option.li-selected {
      background: var(--li-menu-selected); outline: none;
    }
    .li-menu-option[aria-checked="true"] { background: var(--li-menu-selected); }
    .li-size-menu .li-menu-option:hover, .li-size-menu .li-menu-option:focus-visible,
    .li-size-menu .li-menu-option[aria-checked="true"] { background: var(--li-size-menu-selected); }
    .li-menu-check, .li-menu-check .li-icon { width: 12px; height: 12px; flex: 0 0 12px; }
    .li-menu-divider { height: 1px; margin: 8px 0; background: var(--li-menu-divider); }
    .li-button, .li-entry {
      height: 24px; padding: 3px 8px; border: 1px solid transparent; border-radius: var(--li-radius);
      background: var(--li-field); color: var(--li-text); line-height: 16px;
    }
    .li-button:hover, .li-entry:hover { border-color: var(--li-border); }
    .li-status { margin: 0; font: 400 var(--li-label-size)/12px var(--li-font); color: var(--li-muted); overflow-wrap: anywhere; }
    .li-status[role="alert"] { color: var(--li-error); }
    .li-empty { padding: var(--li-inset); color: var(--li-muted); }
    .li-entry { position: fixed; bottom: 12px; right: 12px; z-index: 2147483646; }
    .li-entry[aria-expanded="true"] { background: var(--li-control-selected-surface); color: var(--li-control-selected-icon); }
    .li-outline { position: fixed; pointer-events: none; border: 2px solid var(--li-active); z-index: 2147483645; }
  `
})()
