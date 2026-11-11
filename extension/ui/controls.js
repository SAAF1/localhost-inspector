(() => {
  const ui = window.LocalhostInspector
  const weightNames = ['Thin', 'Extra Light', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black']
  ui.weightName = value => weightNames[ui.choices.weights.indexOf(value)] || value
  ui.colorText = value => {
    const match = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value)
    return match ? match.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : value
  }
  ui.colorValue = value => /^[a-f\d]{6}([a-f\d]{2})?$/i.test(value) ? '#' + value : value
  ui.commitPair = async (commit, updates) => {
    for (let index = 0; index < updates.length; index++) {
      try { await commit(...updates[index]) }
      catch (error) {
        if (index > 0) throw Error('First change saved; next change failed. Undo is available. ' + error.message)
        throw error
      }
    }
  }

  ui.createControls = context => {
    const { node, style, disabled, run, commit } = context
    const value = property => style.getPropertyValue(property).trim()
    const change = (property, requested) => run(() => commit(property, requested))
    const button = (label, glyph, handler) => ui.action(label, glyph, handler, disabled)
    const attachMenu = (anchor, label, options, selected, onChoose, settings) => {
      anchor.setAttribute('aria-haspopup', 'menu')
      anchor.setAttribute('aria-expanded', 'false')
      anchor.onclick = () => ui.openMenu(anchor, options, selected, onChoose, { label, ...settings })
      anchor.onkeydown = event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); anchor.click() }
      }
    }
    const inputEvents = (input, submit) => {
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur() }
      })
      input.onchange = () => run(async () => {
        if (!node.isConnected) return
        if (!input.checkValidity() || !input.value.trim()) {
          input.setAttribute('aria-invalid', 'true')
          throw Error('Enter a valid value')
        }
        await submit(input)
      })
    }
    const numeric = (property, label, glyph, settings = {}) => {
      const field = ui.element('div', 'li-field')
      if (/^(min|max)-/.test(property)) field.classList.add('li-constraint')
      if (glyph) field.append(ui.icon(glyph))
      else if (settings.prefix) field.append(ui.element('span', 'li-prefix', settings.prefix))
      const input = ui.element('input')
      input.id = 'control-' + property
      input.setAttribute('aria-label', label)
      input.type = 'number'
      input.step = 'any'
      input.min = property === 'letter-spacing' ? '-20' : '0'
      input.max = '2000'
      input.disabled = disabled
      const current = settings.value ?? value(property)
      input.value = /^-?[\d.]+px$/.test(current) ? String(parseFloat(current)) : ''
      input.placeholder = settings.placeholder ?? current
      input.title = label + (current ? ': ' + current : '')
      inputEvents(input, entry => settings.submit ? settings.submit(entry.valueAsNumber) : commit(property, entry.valueAsNumber + 'px'))
      field.append(input)
      if (property === 'font-size') {
        const trigger = button('Font size presets', 'chevronDown', () => {})
        trigger.classList.add('li-field-trigger')
        attachMenu(trigger, 'Font size presets', ui.choices.sizes.map(size => [String(size), String(size)]), input.value,
          size => change(property, size + 'px'), { size: true })
        field.append(trigger)
      }
      if (property === 'width' && ui.widthModes(node).length) {
        const trigger = button('Width mode', 'chevronDown', () => {})
        trigger.classList.add('li-field-trigger', 'li-width-mode-trigger')
        attachMenu(trigger, 'Width mode', [['fill', 'Fill container'], ['hug', 'Hug contents']], '',
          mode => change(property, mode === 'fill' ? '100%' : 'fit-content'))
        field.append(trigger)
      }
      return field
    }
    const color = (property, label) => {
      const field = ui.element('div', 'li-field li-color')
      const swatch = ui.element('span', 'li-swatch')
      swatch.style.backgroundColor = value(property)
      const input = ui.element('input')
      input.id = 'control-' + property
      input.setAttribute('aria-label', label)
      input.value = ui.colorText(value(property))
      input.disabled = disabled
      input.spellcheck = false
      inputEvents(input, entry => commit(property, ui.colorValue(entry.value.trim())))
      field.append(swatch, input)
      return field
    }
    const select = (property, label, choices, format = item => item) => {
      const current = value(property)
      const trigger = ui.element('button', 'li-select')
      trigger.type = 'button'
      trigger.disabled = disabled
      trigger.id = 'control-' + property
      trigger.setAttribute('aria-label', label)
      trigger.append(ui.element('span', '', format(current)), ui.icon('chevronDown'))
      const options = [...new Set([current, ...choices])].map(item => [item, format(item)])
      attachMenu(trigger, label, options, current, item => change(property, item))
      return trigger
    }
    const segments = (property, label, options, active = value(property)) => {
      const group = ui.element('div', 'li-segments')
      group.setAttribute('role', 'group')
      group.setAttribute('aria-label', label)
      for (const [key, title, glyph] of options) {
        const item = button(title, glyph, () => change(property, key))
        item.setAttribute('aria-pressed', String(key === active))
        group.append(item)
      }
      return group
    }
    return { value, change, button, numeric, color, select, segments, attachMenu }
  }
})()
