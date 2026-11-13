(() => {
  const ui = window.LocalhostInspector
  const length = /^(\d+(?:\.\d+)?|\.\d+)(px|rem)?$/i
  const namePattern = /^--[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/
  const reference = /^var\((--[a-zA-Z_][a-zA-Z0-9_-]{0,79})\)$/

  ui.spacingVariableValue = name => 'var(' + name + ')'

  ui.resolveSpacingLength = (node, name) => {
    if (!namePattern.test(name)) return null
    const match = length.exec(getComputedStyle(node).getPropertyValue(name).trim())
    if (!match) return null
    const number = Number(match[1])
    const unit = match[2]?.toLowerCase()
    if (!unit && number !== 0) return null
    const pixels = unit === 'rem'
      ? number * parseFloat(getComputedStyle(node.ownerDocument.documentElement).fontSize) : number
    return Number.isFinite(pixels) && pixels <= 2000 ? pixels : null
  }

  ui.supportsSpacingGap = node => {
    const style = getComputedStyle(node)
    return ['flex', 'inline-flex'].includes(style.display) && !ui.autoSpacing(style.justifyContent) &&
      style.rowGap === style.columnGap && /^\d+(?:\.\d+)?px$/.test(style.rowGap) &&
      (node.style.getPropertyValue('gap') ||
        !node.style.getPropertyValue('row-gap') && !node.style.getPropertyValue('column-gap'))
  }

  ui.supportsSpacingVariable = (node, property) => {
    if (property === 'gap') return ui.supportsSpacingGap(node)
    if (!/^padding-(top|right|bottom|left)$/.test(property)) return false
    const inline = node.style
    const previous = inline.getPropertyValue(property)
    // A pending-substitution shorthand hides the prior side. Rewriting a
    // physical side can also reorder it against inline logical padding.
    const properties = Array.from(inline)
    return !(!previous && (inline.padding || properties.includes(property))) &&
      !(previous && properties.some(name => /^padding-(block|inline)(-|$)/.test(name)))
  }

  ui.spacingVariableMatches = (node, property, name, observed = getComputedStyle(node).getPropertyValue(property)) => {
    const value = ui.resolveSpacingLength(node, name)
    return value !== null && /^\d+(?:\.\d+)?px$/.test(observed) &&
      Math.abs(parseFloat(observed) - value) <= Math.max(0.0001, value * 0.000005)
  }

  ui.spacingField = (context, controls, property, label, glyph, settings = {}) => {
    const { node, spacingCatalog, run, commit, disabled } = context
    const properties = settings.properties ?? [property]
    const canBind = () => properties.every(side => ui.supportsSpacingVariable(node, side))
    const eligible = spacingCatalog && canBind()
    const name = reference.exec(node.style.getPropertyValue(properties[0]))?.[1]
    const hasBinding = (side, id) => node.style.getPropertyValue(side) === ui.spacingVariableValue(id) &&
      ui.spacingVariableMatches(node, side, id)
    const bound = eligible && spacingCatalog.names.includes(name) && properties.every(side => hasBinding(side, name))
    const open = anchor => {
      if (!canBind()) return
      const root = anchor.getRootNode()
      const variables = spacingCatalog.names.flatMap(id => {
        const value = ui.resolveSpacingLength(node, id)
        return value === null ? [] : [{ id, name: id.slice(2), value: String(Number(value.toFixed(3))) }]
      })
      ui.openSpacingVariablePicker(anchor, {
        variables, current: bound ? name : null, sourceLabel: spacingCatalog.source,
        fallbackFocus: () => root.getElementById('control-' + property),
        onChoose: id => run(() => ui.commitChanges(commit, properties
          .filter(side => !hasBinding(side, id))
          .map(side => [side, ui.spacingVariableValue(id), node, { spacingToken: { name: id, source: spacingCatalog.source } }]),
        ), { keepPopup: true, rethrow: true }),
      })
    }
    const menu = settings.menu
    const field = controls.numeric(property, label, glyph, eligible && menu ? {
      ...settings,
      menu: {
        ...menu,
        options: [...menu.options, ['variable', 'Apply variable…', { separator: true, icon: 'applyVariable', command: true }]],
        choose: (choice, anchor) => choice === 'variable' ? open(anchor) : menu.choose(choice),
      },
    } : settings)
    if (!eligible) return field
    const input = field.querySelector('input')
    const key = input.onkeydown
    input.onkeydown = event => {
      if (event.key !== '=' || event.isComposing || event.currentTarget.readOnly) return key(event)
      event.preventDefault()
      open(event.currentTarget)
    }
    if (!bound && !menu) {
      const trigger = controls.button('Apply variable to ' + label.toLowerCase(), 'applyVariable',
        event => open(event.currentTarget))
      trigger.classList.add('li-spacing-variable-trigger')
      trigger.setAttribute('aria-haspopup', 'dialog')
      trigger.setAttribute('aria-expanded', 'false')
      field.append(trigger)
    }
    if (!bound) return field
    const pill = ui.element('button', 'li-spacing-variable-pill', input.value)
    pill.type = 'button'
    pill.disabled = disabled
    pill.id = input.id
    pill.dataset.spacingProperties = properties.join(' ')
    pill.setAttribute('aria-label', input.value + ', ' + label + ' variable ' + name.slice(2))
    pill.setAttribute('aria-haspopup', 'dialog')
    pill.setAttribute('aria-expanded', 'false')
    ui.setTooltip(pill, name + ' · ' + input.value + ' px')
    pill.onclick = event => open(event.currentTarget)
    pill.onkeydown = event => {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return
      event.preventDefault()
      const root = event.currentTarget.getRootNode()
      void run(() => {
        const style = getComputedStyle(node)
        return ui.commitChanges(commit, properties.map(side => [side, style.getPropertyValue(side)]))
      }).then(() => {
        const focus = root.getElementById('control-' + property) ?? root.getElementById('control-padding-toggle')
        focus?.focus({ preventScroll: true })
      })
    }
    input.replaceWith(pill)
    return field
  }

  ui.spacingStyles = `
    .li-spacing-picker {
      background: var(--li-popup-surface, var(--li-surface));
      color: var(--li-popup-text, var(--li-text));
    }
    .li-spacing-picker .li-color-picker-search {
      border: 0; border-bottom: 1px solid var(--li-popup-border, var(--li-border));
    }
    .li-spacing-picker .li-color-picker-source {
      border-bottom: 1px solid var(--li-popup-border, var(--li-border));
    }
    .li-spacing-picker :is(.li-color-picker-message, .li-color-picker-source, .li-spacing-option-value) {
      color: var(--li-popup-muted, var(--li-muted));
    }
    .li-spacing-picker .li-color-picker-list .li-menu-option[aria-selected="true"] {
      background: var(--li-popup-selected-surface, var(--li-control-selected-surface));
      color: var(--li-popup-selected-text, var(--li-text));
    }
    .li-spacing-picker .li-color-picker-list .li-menu-option[aria-selected="false"]:is(:hover, [data-active]) {
      background: var(--li-popup-field, var(--li-field));
    }
    .li-spacing-option-value { margin-inline-start: auto; }
    .li-spacing-variable-trigger { opacity: 0; }
    .li-field:is(:hover, :focus-within) > .li-spacing-variable-trigger,
    .li-spacing-variable-trigger[aria-expanded="true"] { opacity: 1; }
    @media (hover: none) { .li-spacing-variable-trigger { opacity: 1; } }
    .li-spacing-variable-pill {
      min-width: 0; padding: 0 3px; border-radius: 3px;
      border: 1px solid var(--li-border); background: var(--li-surface); color: var(--li-text);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
  `
})()
