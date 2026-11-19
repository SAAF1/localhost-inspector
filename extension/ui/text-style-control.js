(() => {
  const ui = window.LocalhostInspector
  const manualView = new WeakMap()
  const headerId = 'control-text-style-picker'
  const fieldId = 'control-text-style'
  const formatPixels = value => value.endsWith('px') ? value.slice(0, -2) : value
  const labelFor = name => name.replace(/^--(?:text-)?/, '').split('-').map(word =>
    word ? word[0].toUpperCase() + word.slice(1) : word,
  ).join(' ')
  function metrics(values) {
    const size = formatPixels(values['font-size'])
    const lineHeight = values['line-height'] === 'normal' ? 'Auto' : formatPixels(values['line-height'])
    return size + '/' + lineHeight
  }

  function exactMatch(node, catalog, drafts) {
    const observed = ui.captureTextStyle(node)
    if (!observed || !catalog) return null
    const matches = values => values && ui.textStyleProperties.every(property =>
      ui.textStyleMatches(observed[property], values[property]))
    const names = catalog.names.filter(name => matches(ui.textStyleValues(node, name)))
    const draftsByName = new Map(drafts.filter(style => style.source === catalog.source &&
      !catalog.names.includes(style.name) && matches(style.values)).map(style => [style.name, style.label]))
    if (names.length + draftsByName.size !== 1) return null
    return names.length ? { name: names[0], label: labelFor(names[0]) } :
      { name: draftsByName.keys().next().value, label: draftsByName.values().next().value, pending: true }
  }

  ui.textStyleControl = (context, controls, targets) => {
    const { textStyleCatalog: catalog, textStyleUnavailable, commitTextStyle, createTextStyle, pendingTextStyles, pendingTextStyleFor, run, disabled } = context
    if (!commitTextStyle || !targets.every(ui.supportsTextStyle)) return {}
    const singleLayer = targets.length === 1 && targets[0] === context.node
    const pending = singleLayer ? pendingTextStyleFor?.(context.node) : null
    const names = targets.map(target => ui.textStyleName(target, catalog))
    const current = pending?.name ?? (names.every(name => name === names[0]) ? names[0] : null)
    const match = !current && singleLayer && !disabled && exactMatch(context.node, catalog, pendingTextStyles ?? [])
    const showMatch = match && manualView.get(context.node) !== match.name
    const displayName = pending?.label ?? (current ? labelFor(current) : match?.label)
    const canCreate = catalog?.canCreate && createTextStyle && singleLayer && !current && ui.captureTextStyle(context.node)
    const open = event => {
      const anchor = event.currentTarget
      const root = anchor.getRootNode()
      const styles = (catalog?.names ?? []).flatMap(name => {
        const values = targets.map(target => ui.textStyleValues(target, name))
        if (values.some(value => !value)) return []
        const label = metrics(values[0])
        return [{ id: name, name: labelFor(name), metrics: values.every(value => metrics(value) === label) ? label : 'Mixed' }]
      })
      if (singleLayer) {
        const drafts = (pendingTextStyles ?? []).filter(style => style.source === catalog?.source && !catalog.names.includes(style.name))
        styles.unshift(...drafts.map(style => ({ id: style.name, name: style.label, metrics: metrics(style.values), pending: true })))
      }
      ui.openTextStylePicker(anchor, {
        styles, current, sourceLabel: catalog?.source,
        create: canCreate ? {
          capture: () => ui.captureTextStyle(context.node),
          submit: draft => run(() => createTextStyle(targets, draft), { keepPopup: true, rethrow: true }),
        } : undefined,
        emptyMessage: textStyleUnavailable ? 'The text style source is unavailable.' :
          catalog ? 'No text styles are available for this selection.' : 'No text style source connected.',
        onChoose: name => run(() => commitTextStyle(targets, name), { keepPopup: true, rethrow: true }),
        fallbackFocus: () => root.getElementById(fieldId) ?? root.getElementById(headerId),
      })
    }
    function popupTrigger(button, id) {
      button.id = id
      button.setAttribute('aria-haspopup', 'dialog')
      button.setAttribute('aria-expanded', 'false')
      return button
    }
    if (!current && !showMatch) {
      return { trigger: popupTrigger(controls.button('Apply text styles', 'variables', open), headerId) }
    }
    const chip = popupTrigger(ui.element('button', 'li-field li-color-token li-text-style-token'), fieldId)
    chip.type = 'button'
    chip.disabled = disabled
    chip.setAttribute('aria-label', 'Text style ' + displayName)
    const pendingDefinition = Boolean(pending || (showMatch && match.pending))
    if (pendingDefinition) chip.setAttribute('aria-describedby', 'li-pending-text-style')
    chip.onclick = open
    ui.setTooltip(chip, showMatch ? 'Matches ' + displayName : pending ? 'Pending source change' : current)
    const glyph = ui.element('span', 'li-text-style-glyph', 'Ag')
    const name = ui.element('span', 'li-text-style-option-name', displayName)
    const samples = targets.map(target => {
      const style = getComputedStyle(target)
      return metrics({ 'font-size': style.fontSize, 'line-height': style.lineHeight })
    })
    const label = samples.every(sample => sample === samples[0]) ? samples[0] : 'Mixed'
    const detail = ui.element('span', 'li-text-style-metrics', '· ' + label)
    glyph.setAttribute('aria-hidden', 'true')
    detail.setAttribute('aria-hidden', 'true')
    chip.append(glyph, name, detail)
    const detach = controls.button('Detach text style', 'unlink', async event => {
      const root = event.currentTarget.getRootNode()
      if (showMatch) {
        manualView.set(context.node, match.name)
        context.refreshTypography()
      } else {
        await run(async () => {
          await commitTextStyle(targets, null)
          manualView.set(context.node, current)
        })
      }
      root.getElementById(headerId)?.focus({ preventScroll: true })
    })
    const field = ui.row(chip)
    field.classList.add('li-text-style-row')
    if (showMatch) {
      const explanation = 'This text looks like ' + displayName + '. Changes to ' + displayName + ' won’t update it.'
      const info = controls.button('About this style match', 'info', () => {})
      info.dataset.tooltipOnClick = 'true'
      info.setAttribute('aria-description', explanation)
      ui.setTooltip(info, explanation)
      field.append(info)
    }
    field.append(detach)
    if (!pendingDefinition) return { field }
    const notice = ui.element('p', 'li-text-style-pending', 'Pending source change')
    notice.id = 'li-pending-text-style'
    const binding = ui.element('div', 'li-stack')
    binding.append(field, notice)
    return { field: binding }
  }
})()
