(() => {
  'use strict'
  const ui = window.LocalhostInspector = window.LocalhostInspector || {}
  ui.tokens = `
    :host {
      --li-panel-width: 240px;
      --li-field-width: 88px;
      --li-field-height: 24px;
      --li-color-field-width: 100px;
      --li-paint-width: 156px;
      --li-action-size: 24px;
      --li-inset: 16px;
      --li-gap: 8px;
      --li-space-small: 4px;
      --li-radius: 6px;
      --li-icon-size: 16px;
      --li-alignment-height: 56px;
      --li-flow-width: 92px;
      --li-flow-option-width: 46px;
      --li-font: 'Localhost Inspector Inter', Inter, sans-serif;
      --li-type-size: 11px;
      --li-line-height: 16px;
      --li-label-line-height: 12px;
      --li-caption-size: 9.75px;
      --li-label-size: 9px;
      --li-heading-size: 11px;
      --li-inspector-scheme: light;
      --li-surface: #fff;
      --li-field: #f5f5f5;
      --li-text: #1c1c1c;
      --li-muted: #666;
      --li-alignment-hover: #666;
      --li-disabled: #aaa;
      --li-border: #e6e6e6;
      --li-active: #0074cc;
      --li-selection: #aad2fa;
      --li-constraint-icon: #767676;
      --li-control-selected-surface: #e5f4ff;
      --li-control-selected-icon: #006bb8;
      --li-swatch: #d9d9d9;
      --li-shadow: #0000001f;
      --li-error: #b42318;
      --li-destructive-surface: #b42318;
      --li-destructive-text: #fff;
      --li-primary-surface: #006fc9;
      --li-primary-text: #fff;

      --li-popup-surface: var(--li-surface);
      --li-popup-field: var(--li-field);
      --li-popup-text: var(--li-text);
      --li-popup-muted: var(--li-muted);
      --li-popup-border: var(--li-border);
      --li-popup-selected-surface: var(--li-control-selected-surface);
      --li-popup-selected-text: var(--li-text);
      --li-popup-diagram: #006bb8;

      /* Compact command menus and tooltips retain their dark surfaces. */
      --li-menu-surface: #1e1e1e;
      --li-menu-text: #fff;
      --li-menu-selected: #006fc9;
      --li-menu-divider: #454545;
      --li-menu-hover: #383838;
      --li-menu-focus: #75bdff;
      --li-tooltip-surface: #1e1e1e;
      --li-tooltip-text: #fff;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --li-inspector-scheme: dark;
        --li-surface: #2c2c2c;
        --li-field: #383838;
        --li-text: #f5f5f5;
        --li-muted: #bdbdbd;
        --li-alignment-hover: #bdbdbd;
        --li-disabled: #878787;
        --li-border: #515151;
        --li-active: #75bdff;
        --li-selection: #334a63;
        --li-constraint-icon: #bdbdbd;
        --li-control-selected-surface: #334a63;
        --li-control-selected-icon: #a9d7ff;
        --li-swatch: #777;
        --li-shadow: #00000060;
        --li-error: #ff9a90;
        --li-popup-selected-surface: #384257;
        --li-popup-diagram: #aad2fa;
      }
    }
  `
})()
