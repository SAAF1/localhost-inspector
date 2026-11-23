(() => {
  const ui = window.LocalhostInspector
  function manualTypographyFields(controls, targets, catalog) {
    const palettes = targets.map(node => ui.fontFamilyOptions(node, catalog))
    const families = [...palettes[0].keys()].filter(value => palettes.every(palette => palette.has(value)))
    const family = controls.select('font-family', 'Font family', families, value =>
      palettes[0].get(value) ?? value.replace(/^["']([^"']+)["'].*$/, '$1').split(',')[0].trim())
    family.disabled ||= !families.some(value => value !== controls.value('font-family'))
    return [family,
      ui.row(controls.select('font-weight', 'Font weight', ui.choices.weights, ui.weightName),
        controls.numeric('font-size', 'Font size')),
      ui.row(
        ui.stack('Line height', controls.numeric('line-height', 'Line height', 'lineHeight')),
        ui.stack('Letter spacing', controls.numeric('letter-spacing', 'Letter spacing', 'letterSpacing')),
      ),
    ]
  }
  function typographyControls(controls, binding, textStyle, targets, catalog) {
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
    const fontFields = textStyle.field ? [textStyle.field] : manualTypographyFields(controls, targets, catalog)
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
    return typographyControls(controls, binding, ui.textStyleControl?.(context, controls, targets) ?? {}, targets, context.fontFamilies ?? [])
  }
  let expanded = true
  ui.selectionColors = (roots, context) => {
    const rows = ui.selectionPaints(roots)
    if (!rows.length) return null
    const section = ui.section('Selection colors')
    const [heading, body] = section.children
    const toggle = ui.element('button', 'li-selection-heading', 'Selection colors')
    toggle.prepend(ui.icon('chevronRight'))
    toggle.setAttribute('aria-expanded', String(expanded))
    toggle.onclick = event => {
      const button = event.currentTarget
      expanded = button.getAttribute('aria-expanded') !== 'true'
      button.setAttribute('aria-expanded', String(expanded))
      button.closest('section').lastElementChild.hidden = !expanded
    }
    heading.replaceChildren(toggle)
    body.hidden = !expanded
    for (const row of rows) {
      const hex = ui.colorFieldText(row.value)
      const percent = Math.round((hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1) * row.opacity * 100)
      const title = row.name ? row.name.slice(2) : hex.slice(0, 6)
      const disabled = context.disabled || row.paints.some(paint => !paint.editable)
      const save = async value => {
        const current = ui.selectionPaints(roots).find(item => item.key === row.key)
        if (!current || current.paints.length !== row.paints.length || row.paints.some((paint, index) =>
          paint.node !== current.paints[index].node || paint.property !== current.paints[index].property)) {
          throw Error('Selection colors changed. Reopen the color to edit it.')
        }
        const color = ui.normalizeSolidColor(ui.colorValue(value))
        if (!color) throw Error('Enter a valid solid color.')
        await context.changePaints(row.paints, color)
      }
      const open = event => ui.openColorVariablePicker(event.currentTarget, {
        colors: [], showLibraries: false, initialTab: 'custom',
        custom: { value: row.value, onChange: value => context.run(() => save(value), { rethrow: true }) },
      })
      const label = 'Change selection color ' + title
      const field = ui.element('div', 'li-field li-selection-paint' + (row.name ? ' li-color-token' : ''))
      const swatch = ui.colorSwatchTrigger(label, row.value, open, disabled)
      field.append(swatch)
      const editField = (label, value, submit) => {
        const input = ui.element('input')
        input.setAttribute('aria-label', label)
        input.defaultValue = value
        input.disabled = disabled
        input.onfocus = event => event.currentTarget.select()
        input.onkeydown = event => {
          if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
          if (event.key === 'Escape') { event.currentTarget.value = value; event.currentTarget.blur() }
        }
        input.onchange = event => {
          const text = event.currentTarget.value.trim()
          if (text !== value) context.run(() => submit(text))
        }
        return input
      }
      if (row.name) {
        const chip = ui.element('button', 'li-selection-token-name', title)
        chip.type = 'button'
        chip.disabled = disabled
        chip.onclick = open
        field.append(chip)
      } else {
        field.append(editField('Selection hex ' + title, title, value => {
          // A six-digit edit keeps the existing paint alpha.
          return save(/^[a-f\d]{6}$/i.test(value) && hex.length === 8 ? value + hex.slice(6) : value)
        }))
      }
      if (!row.name || percent !== 100) {
        const alpha = editField('Selection opacity ' + title, String(percent), value => {
          const number = Number(value)
          if (!value || !Number.isFinite(number) || number < 0 || number > 100 * row.opacity) {
            throw Error('Enter an opacity between 0 and ' + Math.round(100 * row.opacity) + '%.')
          }
          return save(hex.slice(0, 6) + Math.round(255 * number / (100 * row.opacity)).toString(16).padStart(2, '0'))
        })
        alpha.classList.add('li-selection-alpha')
        field.append(alpha, ui.element('small', '', '%'))
      }
      const layers = [...row.layers]
      const locate = ui.action('Select item using this color', 'selectColorLayer', () => context.locate(layers))
      const detach = row.name && ui.action('Detach selection color ' + title, 'unlink',
        () => context.run(() => save(row.value)), disabled)
      const line = ui.row(field, detach, locate)
      line.classList.add('li-selection-color-row')
      body.append(line)
    }
    return section
  }

  function paintSection(title, binding, ...fields) {
    const section = ui.section(title, binding.field, ...fields)
    section.classList.add('li-paint-section')
    if (binding.trigger) section.firstElementChild.append(binding.trigger)
    return section
  }
  ui.renderInspector = (container, context) => {
    const palette = ui.selectionColors([context.node], context.palette)
    if (context.node.namespaceURI === 'http://www.w3.org/2000/svg') {
      ui.updateInspectorFields(container, palette ? [palette] : [])
      return
    }
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
    if (palette) sections.push(palette)
    ui.updateInspectorFields(container, sections)
  }
})()
