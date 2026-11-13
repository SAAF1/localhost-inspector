(() => {
  'use strict'
  const ui = window.LocalhostInspector = window.LocalhostInspector || {}
  ui.outlineStyles = `
    .li-outline[hidden] { display: none !important; }
    .li-outline {
      box-sizing: border-box; position: fixed; pointer-events: none;
      border: 2px solid var(--li-active); z-index: 2147483645;
    }
    .li-outline-hover { border-width: 1px; border-style: dashed; }
  `
  ui.styles = `
    :host {
      all: initial;
      color-scheme: var(--li-inspector-scheme);
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
    [aria-disabled="true"]:not([data-preview-pending]) { color: var(--li-disabled); cursor: default; }
    button:disabled .li-icon { color: inherit; }
    [aria-busy="true"] button, button[aria-busy="true"] { cursor: progress; }
    button:focus-visible, select:focus-visible {
      outline: 1px solid var(--li-action-focus, var(--li-active)); outline-offset: 1px;
    }
    ::selection { background: var(--li-selection); color: var(--li-text); }
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
    .li-bounds { display: flex; flex-direction: column; gap: 8px; }
    .li-layout-section .li-body { padding-top: 8px; }
    .li-layout-section .li-body > .li-stack:has(.li-flow-actions) + .li-stack { margin-top: -4px; }
    .li-padding { margin-top: -2px; }
    .li-padding-values { display: flex; flex-direction: column; gap: var(--li-gap); }
    .li-alignment-row > .li-icon-button { margin-top: 20px; }
    .li-alignment-overflow { width: var(--li-field-width); }
    .li-type-section > h2 { justify-content: space-between; }
    #control-text-style-picker[aria-expanded="true"] {
      background: var(--li-control-selected-surface); color: var(--li-control-selected-icon);
    }
    .li-text-style-row { align-items: center; width: calc(2 * var(--li-field-width) + 2 * var(--li-gap) + var(--li-action-size)); }
    .li-field.li-text-style-token { flex: 1; width: auto; text-align: left; padding-inline: var(--li-space-small); }
    .li-text-style-token:is(:hover, [aria-expanded="true"]) { background: var(--li-field); }
    .li-text-style-token[aria-expanded="true"] { border-color: var(--li-active); }
    .li-text-style-glyph { flex-shrink: 0; min-width: var(--li-icon-size); text-align: center; }
    .li-text-style-token .li-text-style-metrics, .li-text-style-token .li-text-style-preview-glyph { display: none; }
    .li-text-style-token[aria-expanded="true"] > .li-text-style-glyph:first-child { display: none; }
    .li-text-style-token[aria-expanded="true"] > :is(.li-text-style-metrics, .li-text-style-preview-glyph) { display: inline; }
    .li-text-style-row:has([aria-expanded="true"]) > .li-icon-button { opacity: 1; }
    .li-text-style-option-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-text-style-metrics { flex-shrink: 0; color: var(--li-popup-muted); }
    .li-text-style-picker .li-color-picker-search { border-bottom: 1px solid var(--li-popup-border); }
    .li-text-style-picker .li-color-picker-message { text-align: center; }
    .li-type-section .li-body { gap: 4px; }
    .li-type-section .li-body > .li-row:nth-child(2) { margin-top: 2px; }
    .li-appearance-section .li-body { padding-top: 3px; }
    .li-paint-section .li-body { gap: 6px; }
    .li-text-color { margin-top: 8px; }
    .li-color-label { align-items: center; justify-content: space-between; }
    .li-color-label > .li-icon-button { margin-block: -4px; }
    .li-color-label > [aria-expanded="true"] {
      background: var(--li-control-selected-surface); color: var(--li-control-selected-icon);
    }
    .li-row { display: flex; gap: var(--li-gap); }
    .li-stack { display: flex; flex-direction: column; gap: 4px; }
    .li-caption {
      display: block; color: var(--li-muted); margin: 0;
      font: 400 var(--li-caption-size)/var(--li-line-height) var(--li-font);
    }
    .li-bound-caption {
      display: block; color: var(--li-muted); margin: 0;
      font: 400 var(--li-label-size)/var(--li-label-line-height) var(--li-font);
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
      box-shadow: inset 0 0 0 1px var(--li-active); outline: none;
    }
    .li-field input {
      appearance: none; display: block; flex: 1; min-width: 0; width: 0;
      height: 20px; padding: 0; border: 0; outline: none; border-radius: 0;
      background: transparent;
      font: 400 var(--li-type-size)/var(--li-line-height) var(--li-font);
    }
    .li-field input::placeholder { color: var(--li-muted); opacity: 1; }
    .li-field input:disabled::placeholder { color: var(--li-disabled); }
    input[type="number"] { -moz-appearance: textfield; }
    input::-webkit-inner-spin-button, input::-webkit-outer-spin-button {
      -webkit-appearance: none; margin: 0;
    }
    .li-field:has(input:disabled) { box-shadow: none; }
    .li-field:has([aria-invalid="true"]), .li-field[aria-invalid="true"] {
      outline: 1px solid var(--li-error); outline-offset: 1px;
    }
    .li-field:has(> .li-validation) { position: relative; margin-bottom: 20px; }
    .li-validation {
      position: absolute; top: 100%; left: 0; margin-top: 4px;
      color: var(--li-error); white-space: nowrap;
    }
    .li-field-glyph, .li-prefix { width: 16px; flex-shrink: 0; color: var(--li-muted); text-align: center; }
    .li-field .li-icon { color: var(--li-muted); }
    .li-constraint .li-icon { color: var(--li-constraint-icon); }
    .li-color { width: var(--li-color-field-width); padding: 0 5px; }
    .li-field:not(:has(> .li-icon, > .li-prefix, > .li-swatch)) { padding-left: 8px; padding-right: 8px; }
    .li-paint-section > h2 { justify-content: space-between; padding-right: var(--li-gap); }
    .li-paint-section > h2 > [aria-expanded="true"] {
      background: var(--li-control-selected-surface); color: var(--li-control-selected-icon);
    }
    .li-paint-section .li-color { width: var(--li-paint-width); max-width: 100%; }
    .li-paint-section .li-color-token {
      max-width: calc(100% - var(--li-action-size) - var(--li-gap));
    }
    .li-paint-section .li-color-token:is(:hover, [aria-expanded="true"]) { background: var(--li-field); }
    .li-paint-section .li-color input:not(:focus) { text-overflow: ellipsis; }
    .li-color-token { background: var(--li-surface); border: 1px solid var(--li-border); }
    .li-color-token > span:last-child { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .li-color-token-row:not(:hover, :focus-within) > .li-icon-button:not(:focus-visible) { opacity: 0; }
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
    .li-select > span {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; transform: translateY(-.5px);
    }
    #control-font-weight { width: calc(var(--li-field-width) + 10px); padding-inline: 6px; gap: 2px; }
    #control-font-weight .li-icon { width: 12px; height: 12px; flex-basis: 12px; }
    .li-select select, .li-field select {
      appearance: none; flex: 1; min-width: 0; width: 0; border: 0;
      padding: 0; outline: 0; background: transparent;
    }
    .li-select:focus-within { outline: 1px solid var(--li-active); outline-offset: 1px; }
    .li-icon { display: block; width: var(--li-icon-size); height: var(--li-icon-size); flex: 0 0 var(--li-icon-size); }
    .li-icon-button {
      display: flex; align-items: center; justify-content: center;
      width: var(--li-action-size); height: var(--li-action-size); flex: 0 0 var(--li-action-size); padding: 0;
      border: 1px solid transparent; border-radius: var(--li-radius);
      background: transparent; color: var(--li-action-text, var(--li-text));
    }
    .li-icon-button:not(:disabled):hover { background: var(--li-action-hover, var(--li-field)); }
    .li-icon-button:disabled { color: var(--li-disabled); }
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
      display: flex; width: var(--li-field-width); height: var(--li-field-height); background: var(--li-field); border-radius: var(--li-radius);
    }
    .li-segments button {
      display: flex; align-items: center; justify-content: center; flex: 1;
      padding: 0; min-width: 0; border: 1px solid transparent;
      border-radius: var(--li-radius); background: transparent; color: var(--li-muted);
    }
    .li-segments button[aria-pressed="true"], .li-segments button.li-selected {
      background: var(--li-surface); border-color: var(--li-border); color: var(--li-text);
    }
    .li-flow { width: var(--li-flow-width); }
    .li-flow button { flex: 0 0 var(--li-flow-option-width); width: var(--li-flow-option-width); }
    .li-matrix {
      direction: ltr; writing-mode: horizontal-tb;
      display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
      width: var(--li-field-width); height: var(--li-alignment-height); padding: 5px 1px;
      background: var(--li-field); border-radius: var(--li-radius);
    }
    .li-matrix-vertical { grid-template-columns: 1fr; }
    .li-matrix-horizontal { grid-template-rows: 1fr; }
    .li-matrix button {
      display: flex; justify-content: center; align-items: center;
      position: relative; min-width: 0; padding: 0; border: 0; border-radius: 3px; background: transparent;
    }
    .li-matrix button::before {
      content: ''; width: 1.5px; height: 1.5px; border-radius: 50%; background: var(--li-disabled);
    }
    .li-matrix button .li-icon { position: absolute; visibility: hidden; pointer-events: none; }
    .li-alignment-glyph-vertical { transform: rotate(-90deg); }
    .li-matrix button:not(:disabled):is(:hover, :focus-visible) { color: var(--li-alignment-hover); }
    .li-matrix button[aria-pressed="true"]:not(:disabled) { color: var(--li-active); }
    .li-matrix button:is([aria-pressed="true"], :not(:disabled):hover, :not(:disabled):focus-visible) .li-icon {
      visibility: visible;
    }
    .li-matrix button:is([aria-pressed="true"], :not(:disabled):hover, :not(:disabled):focus-visible)::before {
      visibility: hidden;
    }
    .li-matrix-auto {
      position: relative;
      background-image: radial-gradient(circle, var(--li-disabled) .75px, transparent 1px), linear-gradient(var(--li-field), var(--li-field));
      background-size: calc(100% / 3) calc(100% / 3);
      background-origin: content-box;
      background-clip: content-box, border-box;
    }
    .li-matrix-auto-column > button { grid-row: 1 / -1; }
    .li-matrix-auto-row > button { grid-column: 1 / -1; }
    .li-matrix-auto > button::before { content: none; }
    .li-matrix-auto-mark {
      position: absolute; inset: 0; display: flex; align-items: center;
      justify-content: space-around; visibility: hidden; pointer-events: none;
    }
    .li-matrix-auto-column .li-matrix-auto-mark { flex-direction: column; }
    .li-matrix-auto-mark i { width: 10px; height: 2px; background: currentColor; border-radius: 1px; }
    .li-matrix-auto-mark i:nth-child(2) { width: 5px; }
    .li-matrix-auto-row .li-matrix-auto-mark i { width: 2px; height: 10px; }
    .li-matrix-auto-row .li-matrix-auto-mark i:nth-child(2) { height: 5px; }
    .li-matrix-auto button:is([aria-pressed="true"], :not(:disabled):hover, :not(:disabled):focus-visible) .li-matrix-auto-mark {
      visibility: visible;
    }
    .li-matrix-stretch { inset: 5px 10px; color: var(--li-active); visibility: visible; }
    .li-matrix-auto-column .li-matrix-stretch i { width: 100%; }
    .li-matrix-auto-row .li-matrix-stretch i { height: 100%; }
    .li-matrix-auto:has(button:is(:hover, :focus-visible)) .li-matrix-stretch { visibility: hidden; }
    .li-menu {
      position: fixed; display: flex; flex-direction: column; min-width: 168px;
      padding: 8px; border-radius: 14px; background: var(--li-menu-surface); color: var(--li-menu-text);
      color-scheme: dark;
      --li-action-text: var(--li-menu-text);
      --li-action-hover: var(--li-menu-hover);
      --li-action-focus: var(--li-menu-focus);
      z-index: 2147483647; max-height: calc(100vh - 16px); overflow: auto;
      box-shadow: 0 4px 10px var(--li-shadow), 0 1px 2px var(--li-shadow);
      font: 400 var(--li-type-size)/var(--li-line-height) var(--li-font);
    }
    .li-context-popup {
      color-scheme: var(--li-inspector-scheme);
      background: var(--li-popup-surface); color: var(--li-popup-text);
      --li-action-text: var(--li-popup-text);
      --li-action-hover: var(--li-popup-field);
      --li-action-focus: var(--li-active);
    }
    .li-layout-settings-trigger[aria-expanded="true"] {
      background: var(--li-control-selected-surface); color: var(--li-control-selected-icon);
    }
    .li-layout-settings {
      width: min(var(--li-panel-width), calc(100vw - 16px)); min-width: 0; padding: 0;
      border: 1px solid var(--li-popup-border);
      box-shadow: 0 8px 20px var(--li-shadow), 0 2px 6px var(--li-shadow);
    }
    .li-popup-header {
      display: flex; flex: 0 0 40px; justify-content: space-between; align-items: center;
      padding: 0 var(--li-gap) 0 var(--li-inset); font-weight: 600;
    }
    .li-popup-actions { display: flex; align-items: center; }
    .li-settings-preview {
      display: grid; flex: 0 0 120px; place-items: center; background: var(--li-popup-field);
      border-bottom: 1px solid var(--li-popup-border);
    }
    .li-settings-preview-frame {
      position: relative; display: flex; width: 104px; height: 80px; padding: 9px 11px;
      border: 1px solid var(--li-muted); border-radius: var(--li-radius); color: var(--li-popup-diagram);
    }
    .li-settings-preview-item {
      flex: 0 0 auto; width: 8px; height: var(--li-bar-length);
      border-radius: 2px; background: currentColor; font-size: 0;
      --li-bar-length: 52px;
    }
    .li-settings-preview-item:nth-child(2) { --li-bar-length: 36px; }
    .li-settings-preview-item:nth-child(3) { --li-bar-length: 60px; }
    .li-settings-preview-frame[data-flow="column"] .li-settings-preview-item {
      width: var(--li-bar-length); height: var(--li-gap);
    }
    .li-settings-preview-frame[data-stretch="true"] .li-settings-preview-item { width: auto; }
    .li-settings-preview-frame[data-baseline="true"] .li-settings-preview-item {
      width: auto; height: auto; background: transparent;
      font-size: var(--li-field-height); font-weight: 600; line-height: 1;
    }
    .li-settings-preview-frame[data-baseline="true"] .li-settings-preview-item:nth-child(2) { font-size: var(--li-icon-size); }
    .li-settings-preview-frame[data-baseline="true"] .li-settings-preview-item:last-child {
      display: inline-flex; width: var(--li-icon-size); height: var(--li-icon-size); border: 1px solid currentColor;
    }
    .li-settings-preview-frame[data-baseline="true"] { padding-top: var(--li-field-height); }
    .li-settings-preview-frame[data-aligned="true"]::before {
      content: ''; position: absolute; inset: 46px var(--li-space-small) auto; height: 1px; background: var(--li-active);
    }
    .li-layout-settings-fields { padding: var(--li-gap) var(--li-inset) var(--li-inset); }
    .li-layout-settings-row {
      display: grid; grid-template-columns: 1fr minmax(0, min(112px, 55%)); gap: var(--li-gap);
      min-height: calc(var(--li-field-height) + var(--li-gap)); align-items: center; color: var(--li-popup-text);
    }
    .li-layout-settings-row > span { white-space: nowrap; }
    .li-layout-settings-segments { display: flex; justify-content: flex-end; margin-right: calc(-1 * var(--li-gap)); }
    .li-layout-settings-segments button[aria-pressed="true"] {
      background: var(--li-popup-field); border-color: var(--li-popup-border);
    }
    .li-layout-settings-row:has(button:disabled) { color: var(--li-muted); }
    .li-layout-settings-row .li-select {
      width: 100%; border-color: var(--li-popup-border); color: var(--li-popup-text); background: transparent;
    }
    .li-layout-settings-row .li-select:disabled { color: var(--li-muted); }
    .li-layout-settings-row .li-select[aria-expanded="true"] { border-color: var(--li-active); }
    .li-layout-settings-segments .li-icon { width: 12px; height: 12px; flex-basis: 12px; }
    .li-settings-menu {
      min-width: 0; padding: var(--li-space-small); border: 1px solid var(--li-menu-divider); border-radius: 10px;
    }
    .li-settings-menu .li-menu-list { gap: 2px; }
    .li-settings-menu:has(.li-menu-option:is(:hover, :focus-visible))
      .li-menu-option[aria-checked="true"]:not(:hover, :focus-visible),
    .li-settings-menu:has(.li-menu-option:hover) .li-menu-option:focus-visible:not(:hover) {
      background: transparent;
    }
    @media (max-width: 255px) {
      .li-layout-settings-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
      .li-layout-settings-row > span { white-space: normal; }
    }
    .li-field input[aria-valuetext="Auto"]::placeholder { color: var(--li-text); }
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
    .li-menu-scroll .li-icon-button { width: 16px; height: 15px; flex: 0 0 15px; }
    .li-scroll-up .li-icon { transform: rotate(180deg); }
    .li-menu-option:hover, .li-menu-option:focus-visible,
    .li-menu-option[aria-selected="true"], .li-menu-option.li-selected {
      background: var(--li-menu-selected); outline: none;
    }
    .li-menu-option[aria-checked="true"] { background: var(--li-menu-selected); }
    .li-field:has(> .li-color-swatch-trigger) { padding-left: 0; column-gap: 0; }
    .li-color-swatch-trigger {
      appearance: none; display: grid; place-items: center; flex: none;
      width: var(--li-action-size); height: 100%; border: 0; border-radius: var(--li-radius);
      padding: 0; background: transparent; cursor: pointer; color: inherit;
    }
    .li-color-swatch-trigger:focus-visible { outline: 1px solid var(--li-active); outline-offset: 1px; }
    .li-color-tabs { display: flex; gap: 2px; }
    .li-color-tabs > button {
      border: 0; padding: 4px 8px; border-radius: var(--li-radius);
      background: transparent; color: var(--li-popup-muted); font: inherit; cursor: pointer;
    }
    .li-color-tabs > button[aria-selected="true"] {
      color: var(--li-popup-text); background: var(--li-popup-field);
    }
    .li-color-libraries { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .li-solid-color {
      display: grid; gap: var(--li-gap); padding: var(--li-inset);
      border-top: 1px solid var(--li-popup-border); overflow-y: auto;
    }
    .li-color-plane {
      position: relative; display: block; width: 100%; aspect-ratio: 1;
      min-height: 80px; border: 0; border-radius: var(--li-radius);
      background-image: linear-gradient(transparent, black), linear-gradient(to right, white, transparent);
      touch-action: none; cursor: crosshair;
    }
    .li-color-reticle {
      position: absolute; width: 13px; height: 13px; border: 3px solid white;
      border-radius: 50%; box-shadow: 0 0 2px #000; transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .li-color-tracks { display: flex; align-items: center; gap: var(--li-gap); }
    .li-color-tracks > .li-icon-button:disabled { opacity: 0.45; }
    .li-color-sliders { display: grid; gap: var(--li-gap); flex: 1; }
    .li-color-slider {
      appearance: none; width: 100%; height: 8px; margin: 3px 0;
      border-radius: 10px; cursor: pointer;
    }
    .li-color-slider::-webkit-slider-thumb {
      appearance: none; width: 14px; height: 14px; border: 3px solid white;
      border-radius: 50%; box-shadow: 0 0 2px #000; background: transparent;
    }
    .li-color-hue { background: linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red); }
    .li-color-opacity {
      background:
        linear-gradient(to right, transparent, rgb(var(--li-picked-rgb))),
        repeating-conic-gradient(#444 0% 25%, #777 0% 50%) 0 / 10px 10px;
    }
    .li-solid-color-value { width: 100%; background: var(--li-popup-field); color: var(--li-popup-text); }
    .li-solid-color-value input { color: inherit; }
    .li-solid-color-value .li-prefix { width: auto; padding-inline: 5px; color: var(--li-popup-muted); }
    .li-color-draft-picker { z-index: 2; }
    .li-color-picker {
      width: min(var(--li-panel-width), calc(100vw - 16px)); min-width: 0; padding: 0;
      border: 1px solid var(--li-popup-border);
    }
    .li-create-definition {
      width: min(var(--li-panel-width), calc(100vw - 16px)); min-width: 0; padding: 0;
      border: 1px solid var(--li-popup-border); z-index: 1;
    }
    .li-create-definition-form { display: grid; gap: var(--li-gap); padding: var(--li-inset); overflow: auto; }
    .li-create-definition-field {
      display: grid; grid-template-columns: 1fr 3fr; align-items: center; gap: var(--li-gap);
      color: var(--li-popup-muted);
    }
    .li-create-definition-form .li-field { width: 100%; color: var(--li-popup-text); background: var(--li-popup-field); }
    .li-create-definition-form input { color: inherit; }
    .li-create-definition-submit {
      justify-self: end; height: var(--li-field-height); padding-inline: var(--li-gap);
      color: var(--li-primary-text); background: var(--li-primary-surface);
      border: 0; border-radius: var(--li-radius); font: inherit; cursor: pointer;
    }
    .li-create-definition-submit:disabled { opacity: 0.55; cursor: default; }
    .li-create-definition-error { color: var(--li-error); margin: 0; }
    .li-text-style-specimen {
      display: grid; place-items: center; min-height: calc(4 * var(--li-field-height));
      background: var(--li-popup-field); border-bottom: 1px solid var(--li-popup-border);
      padding: var(--li-gap); overflow: hidden;
    }
    .li-text-style-specimen span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .li-text-style-create .li-create-definition-field { grid-template-columns: minmax(68px, 1fr) 2fr; }
    .li-text-style-create .li-field:has(textarea) { height: auto; }
    .li-text-style-create textarea {
      box-sizing: border-box; width: 100%; padding: var(--li-space-small) 0;
      font: inherit; color: inherit; background: transparent; border: 0; outline: none; resize: none;
    }
    .li-text-style-create .li-row { justify-content: space-between; align-items: center; }
    .li-text-style-more {
      padding: 0; color: var(--li-active); background: transparent; border: 0; font: inherit; cursor: pointer;
    }
    .li-text-style-properties {
      display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--li-space-small) var(--li-gap);
      margin: 0; padding-block: var(--li-gap); border-block: 1px solid var(--li-popup-border);
    }
    .li-text-style-properties[hidden] { display: none; }
    .li-text-style-properties dt { color: var(--li-popup-muted); }
    .li-text-style-properties dd { margin: 0; overflow-wrap: anywhere; }
    .li-text-style-pending { margin: 0; color: var(--li-muted); }

    .li-color-picker-search {
      display: flex; flex: 0 0 40px; align-items: center; gap: var(--li-space-small);
      padding: 0 var(--li-gap); border-block: 1px solid var(--li-popup-border);
    }
    .li-color-picker-search input {
      flex: 1; width: 0; min-width: 0; border: 0; outline: none; background: transparent;
    }
    .li-color-picker-search input::placeholder { color: var(--li-popup-muted); }
    .li-color-picker-search:focus-within { box-shadow: inset 0 0 0 1px var(--li-active); }
    .li-color-picker-source, .li-color-picker-message {
      padding: var(--li-gap) var(--li-inset); margin: 0; color: var(--li-popup-muted);
    }
    .li-color-picker-source { overflow-wrap: anywhere; }
    .li-color-picker-list { flex: 1 1 auto; overscroll-behavior: contain; padding-bottom: var(--li-gap); }
    .li-color-picker-list .li-menu-option {
      min-height: calc(var(--li-field-height) + var(--li-gap)); padding: 0 var(--li-inset);
      border-radius: 0; cursor: pointer; white-space: normal; overflow-wrap: anywhere;
    }
    .li-color-picker-list .li-menu-option[aria-selected="true"] { background: var(--li-popup-selected-surface); color: var(--li-popup-selected-text); }
    .li-color-picker-list .li-menu-option[aria-selected="false"]:is(:hover, [data-active]) {
      background: var(--li-popup-field);
    }
    .li-color-picker-list .li-menu-option[aria-selected="true"]:is(:hover, [data-active]) {
      box-shadow: inset 0 0 0 1px var(--li-active);
    }
    .li-menu-check, .li-menu-check .li-icon { width: 12px; height: 12px; flex: 0 0 12px; }
    .li-menu-divider { height: 1px; margin: 8px 0; background: var(--li-menu-divider); }
    ${ui.outlineStyles}
  `
})()
