(() => {
  const ui = window.LocalhostInspector
  function manualTypographyFields(controls) {
    return [
      ui.row(controls.select('font-weight', 'Font weight', ui.choices.weights, ui.weightName),
        controls.numeric('font-size', 'Font size')),
      ui.row(
        ui.stack('Line height', controls.numeric('line-height', 'Line height', 'lineHeight')),
        ui.stack('Letter spacing', controls.numeric('letter-spacing', 'Letter spacing', 'letterSpacing')),
      ),
    ]
  }
  function typographyControls(controls, binding, textStyle) {
    const alignment = controls.value('text-align')
    const segments = controls.segments('text-align', 'Text alignment', [
      ['left', 'Align text left', 'textAlignLeft'], ['center', 'Align text center', 'textAlignCenter'], ['right', 'Align text right', 'textAlignRight'],
    ], alignment)
    const more = controls.button('More text alignment options', 'layoutSettings', () => {})
    controls.attachMenu(more, 'Text alignment', ui.choices.text.map(value => [value, value]), controls.value('text-align'), value => controls.change('text-align', value))
    const heading = ui.row(ui.caption('Text color'), binding.trigger)
    heading.classList.add('li-color-label')
    const textColor = ui.element('div', 'li-stack li-text-color')
    textColor.append(heading, binding.field)
    const fontFields = textStyle.field ? [textStyle.field] : manualTypographyFields(controls)
    const section = ui.section('Typography', ...fontFields,
      ui.stack(alignment === null ? 'Alignment · Mixed' : 'Alignment', ui.row(segments, more)), textColor,
    )
    section.classList.add('li-type-section')
    if (textStyle.trigger) section.firstElementChild.append(textStyle.trigger)
    return section
  }
  function typography(context) {
    const targets = ui.textTargets(context.node)
    if (!targets.length) return null
    const styles = targets.map(target => getComputedStyle(target))
    const textContext = {
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
    }
    const controls = ui.createControls(textContext)
    const binding = ui.colorBinding(context, controls, { property: 'color', label: 'Text color', targets })
    return typographyControls(controls, binding, ui.textStyleControl?.(context, controls, targets) ?? {})
  }
  function paintSection(title, binding, ...fields) {
    const section = ui.section(title, binding.field, ...fields)
    section.classList.add('li-paint-section')
    if (binding.trigger) section.firstElementChild.append(binding.trigger)
    return section
  }
  ui.renderInspector = (container, context) => {
    const controls = ui.createControls(context)
    const refresh = focusProperty => {
      ui.renderInspector(container, { ...context, style: getComputedStyle(context.node) })
      if (focusProperty) container.querySelector('#control-' + focusProperty)?.focus()
    }
    const appearance = ui.section('Appearance', ui.stack('Corner radius', controls.numeric('border-radius', 'Corner radius', 'cornerRadius')))
    appearance.classList.add('li-appearance-section')
    const fillBinding = ui.colorBinding(context, controls, { property: 'background-color', label: 'Fill color', title: 'Fill' })
    const fill = paintSection('Fill', fillBinding, fillBinding.notice)
    const sections = [
      ui.buttonSizeSection(context),
      ui.layoutControls(context, controls, refresh),
      appearance,
      typography(context),
      fill,
    ].filter(Boolean)
    if (ui.supported('border-width', context.node, context.style)) {
      const binding = ui.colorBinding(context, controls, { property: 'border-color', label: 'Stroke color', title: 'Stroke' })
      sections.push(paintSection('Stroke', binding, ui.stack('Weight', controls.numeric('border-width', 'Stroke weight', 'strokeWeight'))))
    }
    ui.updateInspectorFields(container, sections)
  }
})()
