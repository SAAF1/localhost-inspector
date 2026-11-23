(() => {
  const ui = window.LocalhostInspector
  const namePattern = /^--[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/
  const absoluteColor = /^(#[a-f0-9]+|(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([a-z\d.,% /+-]+\)|[a-z]+)$/i
  const excluded = /^(currentcolor|inherit|initial|unset|revert|revert-layer)$/i
  const colorStyle = document.createElement('span').style

  ui.normalizeSolidColor = color => {
    if (color.length > 100 || !absoluteColor.test(color) || excluded.test(color)) return null
    colorStyle.backgroundColor = ''
    colorStyle.backgroundColor = color
    const resolved = colorStyle.backgroundColor
    // Named colors are serialized to RGB when computed.
    if (/^[a-z]+$/i.test(resolved)) {
      const context = document.createElement('canvas').getContext('2d')
      context.fillStyle = resolved
      colorStyle.backgroundColor = resolved === 'transparent' ? '#0000' : context.fillStyle
    }
    return colorStyle.backgroundColor || null
  }
  ui.resolveColorVariable = (node, name) => namePattern.test(name)
    ? ui.normalizeSolidColor(getComputedStyle(node).getPropertyValue(name).trim()) : null
  ui.colorVariableValue = name => 'var(' + name + ')'

  const sides = ['top', 'right', 'bottom', 'left']
  ui.supportsColorVariable = (node, property, style = getComputedStyle(node)) => {
    if (property === 'background-color') return style.backgroundImage === 'none'
    if (property === 'color') return true
    if (property !== 'border-color' || style.borderImageSource !== 'none') return false
    // A shorthand must round-trip all sides through one value.
    const width = style.getPropertyValue('border-top-width')
    const color = style.getPropertyValue('border-top-color')
    return sides.every(side =>
      style.getPropertyValue('border-' + side + '-style') === 'solid' &&
      style.getPropertyValue('border-' + side + '-width') === width &&
      style.getPropertyValue('border-' + side + '-color') === color
    ) && (node.style.getPropertyValue(property) ||
      sides.every(side => !node.style.getPropertyValue('border-' + side + '-color')))
  }

  function reference(node, property) {
    return /^var\(\s*(--[a-zA-Z_][a-zA-Z0-9_-]{0,79})\s*\)$/.exec(ui.authoredProperty(node, property) ?? '')?.[1]
  }
  function sameValue(values) {
    return values.every(value => value === values[0]) ? values[0] : null
  }

  const shapes = 'path,rect,circle,ellipse,polygon,polyline,line,text,tspan,use'
  const exclusions = 'defs,symbol,clipPath,mask,pattern,marker,script,style,template'
  const colorFunctions = /(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\([^()]*\)/gi

  ui.selectionPaints = roots => {
    const rows = new Map()
    const seen = new Set()
    function add(node, property, value, editable = true, opacity = 1) {
      if (!value || value === 'none' || !CSS.supports('color', value) ||
          value === 'transparent' || (/^rgba\(.*?,\s*0\)$/.test(value) || /\/\s*0%?\)$/.test(value)) || opacity <= 0) return
      const declared = editable && ui.authoredProperty(node, property)
      const reference = declared && /^var\(\s*(--[\w-]+)\s*\)$/.exec(declared)?.[1]
      const name = reference && ui.resolveColorVariable(node, reference) === value ? reference : ''
      const key = JSON.stringify([name, value, opacity])
      if (!rows.has(key)) rows.set(key, { key, name, value, opacity, paints: [], layers: new Set() })
      const row = rows.get(key)
      row.paints.push({ node, property, editable })
      row.layers.add(node.ownerSVGElement?.closest('svg') ?? node)
    }

    function box(node, style, pseudo = false) {
      add(node, 'background-color', style.backgroundColor, !pseudo)
      for (const side of sides) {
        const prefix = 'border-' + side + '-'
        if (parseFloat(style.getPropertyValue(prefix + 'width')) > 0 &&
            !['none', 'hidden'].includes(style.getPropertyValue(prefix + 'style'))) {
          add(node, prefix + 'color', style.getPropertyValue(prefix + 'color'), !pseudo)
        }
      }
      if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) add(node, 'outline-color', style.outlineColor, !pseudo)
      for (const property of ['background-image', 'box-shadow', 'text-shadow']) {
        const raw = style.getPropertyValue(property).replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/gi, '')
        for (const value of raw.match(colorFunctions) ?? []) add(node, property, value, false)
      }
    }
    function visit(node) {
      if (seen.has(node) || node.matches(exclusions) || node.matches('#localhost-inspector, #localhost-inspector-outlines')) return
      seen.add(node)
      const style = getComputedStyle(node)
      if (style.display === 'none' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return
      if (style.position === 'absolute' && parseFloat(style.width) <= 1 && parseFloat(style.height) <= 1 &&
          (style.clip !== 'auto' || style.clipPath !== 'none')) return
      if (style.visibility === 'visible' && node.getClientRects().length) {
        if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
          if (node.matches(shapes)) {
            if (node.localName !== 'line') add(node, 'fill', style.fill, true, Number(style.fillOpacity))
            if (parseFloat(style.strokeWidth) > 0) add(node, 'stroke', style.stroke, true, Number(style.strokeOpacity))
          }
          if (node.localName === 'svg') box(node, style)
        } else {
          box(node, style)
          if ([...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()) ||
              (node.matches('input,textarea,select') && node.value)) add(node, 'color', style.color)
          for (const pseudo of ['::before', '::after']) {
            const generated = getComputedStyle(node, pseudo)
            if (['none', 'normal'].includes(generated.content) || generated.display === 'none' ||
                generated.visibility !== 'visible' || Number(generated.opacity) === 0) continue
            box(node, generated, true)
            if (generated.content !== '""') add(node, 'color', generated.color, false)
          }
        }
      }
      for (const child of node.children) visit(child)
    }
    for (const root of roots) visit(root)
    return [...rows.values()]
  }

  ui.colorBinding = (context, controls, { property, label, title = label, targets = [context.node] }) => {
    const { node, colorCatalog, run, commit, disabled, pendingColorFor } = context
    const literal = controls.color(property, label)
    const fill = property === 'background-color'
    const hasCustom = fill || property === 'border-color'
    if ((!colorCatalog && !hasCustom) || !targets.every(target => ui.supportsColorVariable(target, property))) {
      return { field: literal }
    }
    const options = () => (colorCatalog?.names ?? []).flatMap(id => {
      const values = targets.map(target => ui.resolveColorVariable(target, id))
      return values.every(Boolean) ? [{ id, name: id.slice(2), value: sameValue(values) }] : []
    })
    const pending = fill ? pendingColorFor(node) : null
    const references = targets.map(target => reference(target, property))
    const name = sameValue(references)
    let applied
    if (pending) applied = { id: pending.name, name: pending.label, value: pending.value, pending: true }
    else if (colorCatalog?.names.includes(name)) {
      const values = targets.map(target => ui.resolveColorVariable(target, name))
      if (values.every((value, index) => value && getComputedStyle(targets[index]).getPropertyValue(property) === value)) {
        applied = { id: name, name: name.slice(2), value: sameValue(values) }
      }
    }
    if (!applied && name && targets.every(target =>
      ui.resolveColorVariable(target, name) === getComputedStyle(target).getPropertyValue(property),
    )) ui.setTooltip(literal.querySelector('input'), 'Source variable ' + name)
    const mixed = targets.length > 1 && (name === null || (applied && applied.value === null))
    if (mixed) {
      const input = literal.querySelector('input')
      input.defaultValue = ''
      input.placeholder = 'Mixed'
      input.title = 'Mixed'
      literal.firstElementChild.style.backgroundColor = ''
    }
    const save = (id, detach = false) => run(async () => {
      const updates = targets.flatMap(target => {
        const current = pending ? pendingColorFor(target)?.name : reference(target, property)
        if (!ui.supportsColorVariable(target, property)) throw Error('This color cannot be edited.')
        const value = pending?.value ?? ui.resolveColorVariable(target, id)
        if (detach) {
          if (current !== id || !value || getComputedStyle(target).getPropertyValue(property) !== value) {
            throw Error('This variable is no longer applied.')
          }
          return [[property, value, target]]
        }
        if (!ui.resolveColorVariable(target, id)) throw Error('This color variable is unavailable.')
        return current === id ? [] : [[property, ui.colorVariableValue(id), target, { colorToken: { source: colorCatalog.source, name: id } }]]
      })
      await ui.commitChanges(commit, updates)
    }, { keepPopup: !detach, rethrow: !detach })

    const open = (event, initialTab = 'libraries') => {
      const colors = options()
      if (pending) colors.unshift(applied)
      const canCreate = fill && colorCatalog?.canCreate
      const custom = hasCustom ? {
        value: getComputedStyle(node).getPropertyValue(property),
        onChange: value => run(async () => {
          if (!ui.supportsColorVariable(node, property)) throw Error('This color cannot be edited.')
          await commit(property, value)
        }, { keepPopup: true, rethrow: true }),
      } : null
      const root = event.currentTarget.getRootNode()
      ui.openColorVariablePicker(event.currentTarget, {
        colors, current: applied?.id, sourceLabel: colorCatalog?.source,
        onChoose: save, custom, initialTab, showLibraries: Boolean(colorCatalog),
        fallbackFocus: () => root.querySelector(fill ? '#control-fill-variable, #control-background-color' : '#control-' + property + '-variable, #control-' + property),

        create: canCreate ? {
          get value() { return ui.colorText(getComputedStyle(node).backgroundColor) },
          submit: (label, input) => run(async () => {
            const name = '--' + label.toLowerCase().replace(/ +/g, '-')
            const value = ui.normalizeSolidColor(ui.colorValue(input))
            if (!/^[a-z][a-z0-9 -]{0,79}$/i.test(label) || !namePattern.test(name)) {
              throw Object.assign(Error('Use a name starting with a letter. Use letters, numbers, spaces or hyphens.'), { field: 'name' })
            }
            if (!value) throw Object.assign(Error('Enter a solid color.'), { field: 'value' })
            if (colorCatalog.names.includes(name) || getComputedStyle(node).getPropertyValue(name).trim()) {
              throw Object.assign(Error('That variable name is already in use.'), { field: 'name' })
            }
            try {
              await commit(property, value, node, { pendingColor: { source: colorCatalog.source, name, label, value } })
            } catch (error) {
              if (error.message === 'That variable name is already in use.') error.field = 'name'
              throw error
            }
            return { id: name, name: label, value, pending: true }
          }, { keepPopup: true, rethrow: true }),
        } : null,
      })
    }
    const popupTrigger = button => {
      button.setAttribute('aria-haspopup', 'dialog')
      button.setAttribute('aria-expanded', 'false')
      return button
    }
    const trigger = colorCatalog ? popupTrigger(controls.button(title + ' variables', 'variables', open)) : null
    if (!applied || mixed) {
      if (!hasCustom) return { field: literal, trigger }
      const swatch = ui.colorSwatchTrigger('Open ' + label.toLowerCase() + ' picker', controls.value(property),
        event => open(event, 'custom'), disabled)
      literal.firstElementChild.replaceWith(swatch)
      return { field: literal, trigger }
    }
    const chip = popupTrigger(ui.element('button', 'li-field li-color li-color-token'))
    chip.type = 'button'
    chip.id = fill ? 'control-fill-variable' : 'control-' + property + '-variable'
    chip.disabled = disabled
    chip.onclick = open
    chip.setAttribute('aria-label', title + ' variable ' + applied.name)
    ui.setTooltip(chip, applied.name + ' · ' + ui.colorText(applied.value))
    chip.append(ui.colorSwatch(applied.value), ui.element('span', '', applied.name))
    const detach = controls.button('Detach ' + title.toLowerCase() + ' variable', 'unlink', () => save(applied.id, true))
    const field = ui.row(chip, detach)
    field.classList.add('li-color-token-row')
    const notice = pending ? ui.caption('Preview · Source change pending') : null
    return { field, trigger, notice }
  }
})()
