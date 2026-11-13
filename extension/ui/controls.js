(() => {
  const ui = window.LocalhostInspector
  const weightNames = ['Thin', 'Extra Light', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black']
  ui.weightName = value => weightNames[ui.choices.weights.indexOf(value)] || value
  ui.colorText = value => {
    const match = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value)
    return match ? match.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase() : value
  }
  ui.colorValue = value => /^[a-f\d]{6}([a-f\d]{2})?$/i.test(value) ? '#' + value : value
  ui.commitChanges = async (commit, updates) => {
    for (let index = 0; index < updates.length; index++) {
      try { await commit(...updates[index]) }
      catch (error) {
        if (index > 0) {
          const saved = index === 1 ? 'First change saved' : index + ' changes saved'
          throw Error(saved + '; next change failed. Undo is available. ' + error.message)
        }
        throw error
      }
    }
  }

  ui.selectTrigger = label => {
    const trigger = ui.element('button', 'li-select')
    trigger.type = 'button'
    trigger.setAttribute('aria-label', label)
    trigger.append(ui.element('span'), ui.icon('chevronDown'))
    return trigger
  }

  ui.createControls = context => {
    const { node, style, disabled, run, commit } = context
    const value = context.value ?? (property => style.getPropertyValue(property).trim())
    const change = (property, requested) => run(() => commit(property, requested))
    const button = (label, glyph, handler) => ui.action(label, glyph, handler, disabled)
    const attachMenu = (anchor, label, options, selected, onChoose, settings) => {
      anchor.setAttribute('aria-haspopup', 'menu')
      anchor.setAttribute('aria-expanded', 'false')
      anchor.onclick = event => ui.openMenu(event.currentTarget, options, selected, onChoose, { label, ...settings })
      anchor.onkeydown = event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.currentTarget.click() }
      }
    }
    const inputEvents = (input, submit, invalidMessage = 'Enter a valid value.') => {
      function clearValidation(input) {
        input.parentElement.querySelector('.li-validation')?.remove()
        input.removeAttribute('aria-invalid')
        input.removeAttribute('aria-describedby')
      }
      input.oninput = event => clearValidation(event.currentTarget)
      input.onkeydown = event => {
        if (event.key !== 'Enter' || event.currentTarget.readOnly) return
        event.preventDefault()
        const field = event.currentTarget
        const panel = field.closest('.li-panel')
        field.blur()
        if (field.getAttribute('aria-invalid') === 'true') field.focus({ preventScroll: true })
        else panel?.focus({ preventScroll: true })
      }
      input.onchange = event => {
        const input = event.currentTarget
        if (!node.isConnected || input.readOnly) return
        clearValidation(input)
        if (!input.checkValidity() || !input.value.trim()) {
          const message = ui.element('span', 'li-validation', invalidMessage)
          message.id = input.id + '-error'
          message.setAttribute('role', 'alert')
          input.setAttribute('aria-invalid', 'true')
          input.setAttribute('aria-describedby', message.id)
          input.parentElement.append(message)
          return
        }
        if (input.value === input.defaultValue) return
        return run(() => submit(input))
      }
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
      input.defaultValue = settings.displayValue ?? (/^-?[\d.]+px$/.test(current) ? String(parseFloat(current)) : '')
      input.placeholder = settings.placeholder ?? (current ?? 'Mixed')
      input.title = label + (current ? ': ' + current : current === null ? ': Mixed' : '')
      if (settings.placeholder === 'Auto') input.setAttribute('aria-valuetext', 'Auto')
      else if (current === null) input.setAttribute('aria-valuetext', 'Mixed')
      inputEvents(input, entry => settings.submit
        ? settings.submit(entry.valueAsNumber)
        : commit(property, entry.valueAsNumber + 'px'), property === 'gap' ? 'Enter a valid gap value.' : undefined)
      field.append(input)
      if (property === 'font-size') {
        const trigger = button('Font size presets', 'chevronDown', () => {})
        trigger.classList.add('li-field-trigger')
        attachMenu(trigger, 'Font size presets', ui.choices.sizes.map(size => [String(size), String(size)]), input.value,
          size => change(property, size + 'px'), { size: true })
        field.append(trigger)
      }
      if (settings.menu?.options.length) {
        const { label: menuLabel, options, choose, current: selected = '', radio = false } = settings.menu
        const trigger = button(menuLabel, 'chevronDown', () => {})
        trigger.classList.add('li-field-trigger')
        if (property === 'width' || property === 'height') trigger.classList.add('li-width-mode-trigger')
        attachMenu(trigger, menuLabel, options, selected, choose, { commands: !radio })
        field.append(trigger)
      }
      return field
    }
    const color = (property, label) => {
      const field = ui.element('div', 'li-field li-color')
      const current = value(property)
      const input = ui.element('input')
      input.id = 'control-' + property
      input.setAttribute('aria-label', label)
      input.defaultValue = current === null ? '' : ui.colorFieldText(current)
      input.title = current === null ? 'Mixed' : current
      if (current === null) input.placeholder = 'Mixed'
      input.disabled = disabled
      input.spellcheck = false
      inputEvents(input, entry => commit(property, ui.colorValue(entry.value.trim())))
      field.append(ui.colorSwatch(current), input)
      return field
    }
    const select = (property, label, choices, format = item => item) => {
      const current = value(property)
      const trigger = ui.selectTrigger(label)
      trigger.disabled = disabled
      trigger.id = 'control-' + property
      const text = current === null ? 'Mixed' : format(current)
      ui.setTooltip(trigger, label + ': ' + text)
      trigger.firstElementChild.textContent = text
      const options = [...new Set(current === null ? choices : [current, ...choices])].map(item => [item, format(item)])
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
