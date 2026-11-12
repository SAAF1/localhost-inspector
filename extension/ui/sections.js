(() => {
  const ui = window.LocalhostInspector
  ui.typographyControls = controls => {
    const weight = controls.select('font-weight', 'Font weight', ui.choices.weights, ui.weightName)
    const metrics = ui.row(
      ui.stack('Line height', controls.numeric('line-height', 'Line height', 'lineHeight')),
      ui.stack('Letter spacing', controls.numeric('letter-spacing', 'Letter spacing', 'letterSpacing')),
    )
    const alignment = controls.value('text-align')
    const segments = controls.segments('text-align', 'Text alignment', [
      ['left', 'Align text left', 'textAlignLeft'], ['center', 'Align text center', 'textAlignCenter'], ['right', 'Align text right', 'textAlignRight'],
    ], alignment)
    const more = controls.button('More text alignment options', 'layoutSettings', () => {})
    controls.attachMenu(more, 'Text alignment', ui.choices.text.map(value => [value, value]), controls.value('text-align'), value => controls.change('text-align', value))
    const textColor = ui.stack('Text color', controls.color('color', 'Text color'))
    textColor.classList.add('li-text-color')
    const section = ui.section('Typography',
      ui.row(weight, controls.numeric('font-size', 'Font size')), metrics,
      ui.stack(alignment === null ? 'Alignment · Mixed' : 'Alignment', ui.row(segments, more)), textColor,
    )
    section.classList.add('li-type-section')
    return section
  }
  function typography(context) {
    const targets = ui.textTargets(context.node)
    if (!targets.length) return null
    const styles = targets.map(target => getComputedStyle(target))
    const controls = ui.createControls({
      ...context,
      value: property => {
        const first = ui.textStyleValue(styles[0], property)
        return styles.every(style => ui.textStyleValue(style, property) === first) ? first : null
      },
      commit: (property, requested) => {
        const changes = targets
          .filter(target => getComputedStyle(target).getPropertyValue(property).trim() !== requested)
          .map(target => [property, requested, target])
        return ui.commitChanges(context.commit, changes)
      },
    })
    return ui.typographyControls(controls)
  }
  ui.renderInspector = (container, context) => {
    const controls = ui.createControls(context)
    const refresh = focusProperty => {
      ui.renderInspector(container, { ...context, style: getComputedStyle(context.node) })
      if (focusProperty) container.querySelector('#control-' + focusProperty)?.focus()
    }
    const appearance = ui.section('Appearance', ui.stack('Corner radius', controls.numeric('border-radius', 'Corner radius', 'cornerRadius')))
    appearance.classList.add('li-appearance-section')
    const sections = [
      ui.layoutControls(context, controls, refresh),
      appearance,
      typography(context),
      ui.section('Fill', controls.color('background-color', 'Fill color')),
    ].filter(Boolean)
    if (ui.supported('border-width', context.node, context.style)) {
      const stroke = ui.section('Stroke', controls.color('border-color', 'Stroke color'), ui.stack('Weight', controls.numeric('border-width', 'Stroke weight', 'strokeWeight')))
      stroke.classList.add('li-stroke-section')
      sections.push(stroke)
    }
    ui.updateInspectorFields(container, sections)
  }
})()
