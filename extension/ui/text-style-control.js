(() => {
  const ui = window.LocalhostInspector
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

  ui.textStyleControl = (context, controls, targets) => {
    const { textStyleCatalog: catalog, textStyleUnavailable, commitTextStyle, createTextStyle, pendingTextStyles, pendingTextStyleFor, run, disabled } = context
    if (!commitTextStyle || !targets.every(ui.supportsTextStyle)) return {}
    const singleLayer = targets.length === 1 && targets[0] === context.node
    const pending = singleLayer ? pendingTextStyleFor?.(context.node) : null
    const names = targets.map(target => ui.textStyleName(target, catalog))
    const current = pending?.name ?? (names.every(name => name === names[0]) ? names[0] : null)
    const displayName = pending?.label ?? (current ? labelFor(current) : '')
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
    if (!current) {
      return { trigger: popupTrigger(controls.button('Apply text styles', 'variables', open), headerId) }
    }
    const chip = popupTrigger(ui.element('button', 'li-field li-color-token li-text-style-token'), fieldId)
    chip.type = 'button'
    chip.disabled = disabled
    chip.setAttribute('aria-label', 'Text style ' + displayName)
    if (pending) chip.setAttribute('aria-describedby', 'li-pending-text-style')
    chip.onclick = open
    ui.setTooltip(chip, pending ? 'Pending source change' : current)
    const glyph = ui.element('span', 'li-text-style-glyph', 'T')
    const sampleGlyph = ui.element('span', 'li-text-style-glyph li-text-style-preview-glyph', 'Ag')
    const name = ui.element('span', 'li-text-style-option-name', displayName)
    const samples = targets.map(target => {
      const style = getComputedStyle(target)
      return metrics({ 'font-size': style.fontSize, 'line-height': style.lineHeight })
    })
    const label = samples.every(sample => sample === samples[0]) ? samples[0] : 'Mixed'
    const detail = ui.element('span', 'li-text-style-metrics', '· ' + label)
    glyph.setAttribute('aria-hidden', 'true')
    sampleGlyph.setAttribute('aria-hidden', 'true')
    detail.setAttribute('aria-hidden', 'true')
    chip.append(glyph, sampleGlyph, name, detail)
    const detach = controls.button('Detach text style', 'unlink', async event => {
      const root = event.currentTarget.getRootNode()
      await run(() => commitTextStyle(targets, null))
      root.getElementById(headerId)?.focus({ preventScroll: true })
    })
    const field = ui.row(chip, detach)
    field.classList.add('li-color-token-row', 'li-text-style-row')
    if (!pending) return { field }
    const notice = ui.element('p', 'li-text-style-pending', 'Pending source change')
    notice.id = 'li-pending-text-style'
    const binding = ui.element('div', 'li-stack')
    binding.append(field, notice)
    return { field: binding }
  }
})()
