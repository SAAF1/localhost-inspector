(() => {
  const ui = window.LocalhostInspector

  ui.openCreateColorVariable = (anchor, picker, { value, submit }, onCreated) => {
    const popup = ui.element('div', 'li-menu li-context-popup li-color-create')
    popup.setAttribute('role', 'dialog')
    popup.setAttribute('aria-label', 'Variable')
    const dismiss = ui.action('Close variable form', 'dismiss', () => close())
    const form = ui.element('form', 'li-color-create-form')
    const inputRow = (label, initial = '') => {
      const row = ui.element('div', 'li-color-create-field')
      const field = ui.element('span', 'li-field')
      const input = ui.element('input')
      input.autocomplete = 'off'
      input.spellcheck = false
      input.value = initial
      input.id = 'li-create-color-' + label.toLowerCase()
      const caption = ui.element('label', '', label)
      caption.htmlFor = input.id
      field.append(input)
      row.append(caption, field)
      form.append(row)
      return { field, input }
    }
    const name = inputRow('Name').input
    name.maxLength = 80
    const color = inputRow('Value', value)
    color.input.maxLength = 100
    let colorControls
    const choose = ui.colorSwatchTrigger('Open variable color picker', ui.colorValue(value), openPicker)
    const swatch = choose.firstElementChild
    color.field.prepend(choose)
    function openPicker() {
      if (saving) return
      if (choose.getAttribute('aria-expanded') === 'true') { colorControls?.(); return }
      const value = ui.normalizeSolidColor(ui.colorValue(color.input.value.trim())) ?? '#000000'
      const solid = ui.solidColorPicker(value, next => {
        color.input.value = ui.colorText(next)
        updateDraft()
      })
      const editor = ui.element('div', 'li-menu li-context-popup li-color-create li-color-draft-picker')
      editor.setAttribute('role', 'dialog')
      editor.setAttribute('aria-label', 'Color picker')
      editor.append(ui.popupHeader('Custom', ui.action('Close color picker', 'dismiss', () => colorControls?.())), solid.panel)
      editor.onkeydown = event => {
        if (event.key !== 'Escape' || event.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        colorControls?.()
      }
      colorControls = ui.mountPopup(choose, editor, (_, width) => {
        const bounds = popup.getBoundingClientRect()
        return [bounds.left >= width + 8 ? bounds.left - width : bounds.right, bounds.top]
      }, { parent: popup, matchAnchorWidth: false, onClose: solid.stopSampling })
      solid.panel.querySelector('button').focus({ preventScroll: true })
    }
    const submitButton = ui.element('button', 'li-color-create-submit', 'Create variable')
    submitButton.type = 'submit'
    const error = ui.element('p', 'li-color-create-error')
    error.id = 'li-color-create-error'
    error.setAttribute('role', 'alert')
    error.hidden = true
    form.append(error, submitButton)
    popup.append(ui.popupHeader('Variable', dismiss), form)

    let saving = false
    function updateDraft() {
      swatch.style.backgroundColor = ui.normalizeSolidColor(ui.colorValue(color.input.value.trim())) ?? ''
      for (const input of [name, color.input]) {
        input.removeAttribute('aria-invalid')
        input.removeAttribute('aria-describedby')
      }
      error.hidden = true
    }
    form.oninput = event => {
      if (event.target === name || event.target === color.input) updateDraft()
    }
    form.onsubmit = async event => {
      event.preventDefault()
      if (saving) return
      saving = true
      submitButton.disabled = true
      form.setAttribute('aria-busy', 'true')
      name.readOnly = color.input.readOnly = true
      error.hidden = true
      try {
        const created = await submit(name.value.trim(), color.input.value.trim())
        if (!popup.isConnected) return
        close(false)
        onCreated(created)
      } catch (cause) {
        if (!popup.isConnected) return
        error.textContent = cause.message
        error.hidden = false
        const invalid = cause.field === 'value' ? color.input : cause.field === 'name' ? name : null
        if (invalid) {
          invalid.setAttribute('aria-invalid', 'true')
          invalid.setAttribute('aria-describedby', error.id)
          invalid.focus({ preventScroll: true })
        }
      } finally {
        saving = false
        submitButton.disabled = false
        form.removeAttribute('aria-busy')
        name.readOnly = color.input.readOnly = false
      }
    }
    popup.onkeydown = event => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    const close = ui.mountPopup(anchor, popup, (_, width) => {
      const rect = picker.getBoundingClientRect()
      return [rect.left >= width + 8 ? rect.left - width : rect.left, rect.top]
    }, { parent: picker, matchAnchorWidth: false, onClose: () => colorControls?.(false) })
    name.focus({ preventScroll: true })
    return close
  }
})()
