(() => {
  const ui = window.LocalhostInspector
  const resolve = name => ui.resolveColorVariable(document.documentElement, name) ||
    ui.resolveColorVariable(document.body, name)
  const apply = (host, paint) => host.dispatchEvent(new CustomEvent('set-inspector-canvas-background', {
    detail: JSON.stringify(paint),
  }))

  ui.syncCanvasBackground = (host, colorCatalog) => {
    if (!host.parentElement?.dataset.canvasBackground) return null
    let paint
    try { paint = JSON.parse(host.parentElement.dataset.canvasBackground) }
    catch { return null }
    if (!paint || typeof paint.color !== 'string') return null
    const resolved = paint.variable && colorCatalog?.names.includes(paint.variable) && resolve(paint.variable)
    if (resolved && resolved !== paint.color) {
      paint.color = resolved
      apply(host, paint)
    }
    return paint
  }

  ui.canvasBackgroundSection = ({ host, colorCatalog, paint, refresh, status }) => {
    if (!paint || !host.parentElement?.hasAttribute('data-canvas-page')) return null
    const change = next => {
      status('')
      apply(host, { ...paint, ...next })
      refresh()
    }
    const literalColor = input => {
      const color = ui.normalizeSolidColor(input)
      if (!color) throw Error('Enter a solid color for the canvas background.')
      change({ color, variable: undefined })
    }
    const controls = ui.createControls({
      node: document.documentElement,
      value: () => paint.color,
      run: action => {
        try { action() }
        catch (error) { status(error.message, true) }
      },
      commit: (_, value) => literalColor(value),
    })
    const open = (event, initialTab) => {
      const anchor = event.currentTarget
      const colors = (colorCatalog?.names ?? []).flatMap(id => {
        const value = resolve(id)
        return value ? [{ id, name: id.slice(2), value }] : []
      })
      ui.openColorVariablePicker(anchor, {
        colors,
        current: paint.variable,
        sourceLabel: colorCatalog?.source,
        showLibraries: Boolean(colorCatalog),
        initialTab,
        custom: { value: paint.color, onChange: literalColor },
        onChoose: id => {
          const color = resolve(id)
          if (!color) throw Error('This color style is unavailable.')
          change({ color, variable: id })
        },
      })
    }
    const color = controls.color('background-color', 'Canvas background color')
    color.firstElementChild.replaceWith(ui.colorSwatchTrigger(
      'Open canvas color picker', paint.color, event => open(event, 'custom'),
    ))
    const opacity = controls.numeric('opacity', 'Canvas background opacity', null, {
      displayValue: String(paint.opacity), submit: value => change({ opacity: value }),
    })
    opacity.querySelector('input').max = '100'
    opacity.append(ui.caption('%'))
    const visibility = ui.action('Show canvas background', paint.visible ? 'eye' : 'eyeOff',
      () => change({ visible: !paint.visible }))
    visibility.setAttribute('aria-pressed', String(paint.visible))
    const row = ui.row(color, opacity, visibility)
    row.classList.add('li-canvas-background-row')
    const section = ui.section('Canvas', ui.stack('Background', row),
      paint.variable && ui.caption('Style · ' + paint.variable.slice(2)))
    section.classList.add('li-canvas-section')
    if (colorCatalog) {
      const styles = ui.action('Canvas color styles', 'variables', event => open(event, 'libraries'))
      styles.setAttribute('aria-haspopup', 'dialog')
      styles.setAttribute('aria-expanded', 'false')
      section.firstElementChild.append(styles)
    }
    return section
  }
})()
