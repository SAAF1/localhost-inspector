(() => {
  const ui = window.LocalhostInspector
  ui.typographyControls = controls => {
    const weight = controls.select('font-weight', 'Font weight', ui.choices.weights, ui.weightName)
    const metrics = ui.row(
      ui.stack('Line height', controls.numeric('line-height', 'Line height', 'lineHeight')),
      ui.stack('Letter spacing', controls.numeric('letter-spacing', 'Letter spacing', 'letterSpacing')),
    )
    const logicalAlign = controls.value('text-align')
    const rtl = controls.value('direction') === 'rtl'
    const visualAlign = logicalAlign === 'start' ? (rtl ? 'right' : 'left') : logicalAlign === 'end' ? (rtl ? 'left' : 'right') : logicalAlign
    const segments = controls.segments('text-align', 'Text alignment', [
      ['left', 'Align text left', 'textAlignLeft'], ['center', 'Align text center', 'textAlignCenter'], ['right', 'Align text right', 'textAlignRight'],
    ], visualAlign)
    const more = controls.button('More text alignment options', 'layoutSettings', () => {})
    controls.attachMenu(more, 'Text alignment', ui.choices.text.map(value => [value, value]), controls.value('text-align'), value => controls.change('text-align', value))
    const textColor = ui.stack('Text color', controls.color('color', 'Text color'))
    textColor.classList.add('li-text-color')
    const section = ui.section('Typography',
      ui.row(weight, controls.numeric('font-size', 'Font size')), metrics,
      ui.stack('Alignment', ui.row(segments, more)), textColor,
    )
    section.classList.add('li-type-section')
    return section
  }
  ui.renderInspector = (container, context) => {
    ui.closeMenu()
    container.replaceChildren()
    const controls = ui.createControls(context)
    const refresh = () => ui.renderInspector(container, { ...context, style: getComputedStyle(context.node) })
    const appearance = ui.section('Appearance', ui.stack('Corner radius', controls.numeric('border-radius', 'Corner radius', 'cornerRadius')))
    appearance.classList.add('li-appearance-section')
    container.append(
      ui.layoutControls(context, controls, refresh),
      appearance,
      ui.typographyControls(controls),
      ui.section('Fill', controls.color('background-color', 'Fill color')),
    )
    if (ui.supported('border-width', context.node, context.style)) {
      const stroke = ui.section('Stroke', controls.color('border-color', 'Stroke color'), ui.stack('Weight', controls.numeric('border-width', 'Stroke weight', 'strokeWeight')))
      stroke.classList.add('li-stroke-section')
      container.append(stroke)
    }
  }
})()
