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
    const kind = host.parentElement.dataset.canvasPaintKind || 'Canvas'
    const target = host.parentElement.dataset.canvasPaintTarget
    const current = () => host.parentElement?.dataset.canvasPaintTarget === target
    const change = next => {
      if (!current()) return
      status('')
      apply(host, { ...paint, ...next })
      refresh()
    }
    const literalColor = input => {
      const color = ui.normalizeSolidColor(input)
      if (!color) throw Error('Enter a solid color for the ' + kind.toLowerCase() + ' background.')
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
        custom: { value: paint.color, onChange: literalColor, onPreview: color => {
          if (current()) host.dispatchEvent(new CustomEvent('preview-inspector-canvas-color', { detail: color }))
        } },
        onChoose: id => {
          const color = resolve(id)
          if (!color) throw Error('This color style is unavailable.')
          change({ color, variable: id })
        },
      })
    }
    const color = controls.color('background-color', kind + ' background color')
    color.firstElementChild.replaceWith(ui.colorSwatchTrigger(
      'Open ' + kind.toLowerCase() + ' color picker', paint.color, event => open(event, 'custom'),
    ))
    const opacity = controls.numeric('opacity', kind + ' background opacity', null, {
      displayValue: String(paint.opacity), submit: value => change({ opacity: value }),
    })
    const opacityInput = opacity.querySelector('input')
    opacityInput.max = '100'
    opacityInput.disabled = !paint.visible
    opacity.append(ui.caption('%'))
    const visibility = ui.visibilityAction(kind.toLowerCase() + ' background', paint.visible, visible => change({ visible }))
    const paintFields = ui.row(color, opacity)
    paintFields.classList.add('li-canvas-paint-fields')
    const section = ui.section(kind === 'Canvas' ? kind : 'Fill', ui.row(paintFields, visibility))
    section.classList.add('li-canvas-section')
    if (colorCatalog) {
      const styles = ui.action(kind + ' color styles', 'variables', event => open(event, 'libraries'))
      styles.setAttribute('aria-haspopup', 'dialog')
      styles.setAttribute('aria-expanded', 'false')
      section.firstElementChild.append(styles)
    }
    if (kind === 'Canvas') return section
    const geometry = JSON.parse(host.parentElement.dataset.surfaceGeometry)
    const update = changes => {
      if (!current()) return
      host.dispatchEvent(new CustomEvent('set-inspector-surface-geometry', {
        detail: JSON.stringify({ key: target, changes }),
      }))
    }
    const numeric = (key, label, glyph, settings) => {
      const field = controls.numeric(key, label, glyph, { displayValue: String(geometry[key]), submit: n => update({ [key]: n }), ...settings })
      field.querySelector('input').max = '8192'
      return field
    }
    const dimension = (key, prefix) => {
      const field = numeric(key, kind + ' ' + key, null, { prefix, readOnly: kind === 'Section',
        description: kind === 'Section' ? 'Fits the frames in this section' : undefined })
      field.querySelector('input').min = '1'
      return field
    }
    const strokeControls = ui.createControls({ node: document.documentElement, value: () => geometry.stroke,
      run: action => { try { action() } catch (error) { status(error.message, true) } },
      commit: (_, value) => update({ stroke: ui.normalizeSolidColor(value) }) })
    const stroke = strokeControls.color('border-color', kind + ' stroke color')
    stroke.firstElementChild.replaceWith(ui.colorSwatchTrigger('Open stroke color picker', geometry.stroke, event =>
      ui.openColorVariablePicker(event.currentTarget, { initialTab: 'custom', colors: [], custom: {
        value: geometry.stroke, onChange: value => update({ stroke: ui.normalizeSolidColor(value) }),
      } })))
    return [
      ui.section(kind),
      ui.section('Layout', ui.stack('Dimensions', ui.row(dimension('width', 'W'), dimension('height', 'H')))),
      ui.section('Appearance', ui.stack('Corner radius', numeric('radius', kind + ' corner radius', 'cornerRadius'))),
      section,
      ui.section('Stroke', stroke, ui.stack('Weight', numeric('weight', kind + ' stroke weight', 'strokeWeight'))),
    ]
  }
})()
