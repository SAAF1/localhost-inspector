(() => {
  const ui = window.LocalhostInspector
  const labels = ['Font family', 'Weight', 'Size', 'Line height', 'Letter spacing']

  ui.openCreateTextStyle = (anchor, picker, { capture, submit }, onCreated) => {
    const values = capture()
    if (!values) return null
    const title = 'Create new text style'
    const popup = ui.element('div', 'li-menu li-context-popup li-create-definition li-text-style-create')
    popup.setAttribute('role', 'dialog')
    popup.setAttribute('aria-label', title)
    const dismiss = ui.action('Close text style form', 'dismiss', () => close())
    const specimen = ui.element('div', 'li-text-style-specimen')
    const sample = ui.element('span', '', 'Rag 123')
    for (const [property, value] of Object.entries(values)) sample.style.setProperty(property, value)
    specimen.append(sample)
    const form = ui.element('form', 'li-create-definition-form')
    const name = ui.createDefinitionField(form, 'li-create-text-style', 'Name').input
    name.placeholder = 'New text style'
    name.maxLength = 70
    const description = ui.createDefinitionField(form, 'li-create-text-style', 'Description', '', true).input
    description.placeholder = 'What’s it for?'
    description.maxLength = 240
    description.rows = 2

    const properties = ui.element('dl', 'li-text-style-properties')
    properties.id = 'li-create-text-style-properties'
    properties.hidden = true
    for (const [index, property] of ui.textStyleProperties.entries()) {
      const value = values[property]
      const label = value === 'normal' ? (property === 'line-height' ? 'Auto' : '0') : value
      properties.append(ui.element('dt', '', labels[index]), ui.element('dd', '', label))
    }
    const more = ui.element('button', 'li-text-style-more', 'Show more options')
    more.type = 'button'
    more.setAttribute('aria-controls', properties.id)
    more.setAttribute('aria-expanded', 'false')
    more.onclick = () => {
      properties.hidden = !properties.hidden
      more.setAttribute('aria-expanded', String(!properties.hidden))
      more.textContent = properties.hidden ? 'Show more options' : 'Hide options'
    }

    const error = ui.element('p', 'li-create-definition-error')
    error.id = 'li-create-text-style-error'
    error.setAttribute('role', 'alert')
    error.hidden = true
    const create = ui.element('button', 'li-create-definition-submit', 'Create style')
    create.type = 'submit'
    form.append(properties, error, ui.row(more, create))
    popup.append(ui.popupHeader(title, dismiss), specimen, form)

    let saving = false
    function showError(message, invalidField) {
      error.textContent = message
      error.hidden = !message
      for (const field of [name, description]) {
        field.removeAttribute('aria-invalid')
        field.removeAttribute('aria-describedby')
      }
      if (invalidField) {
        invalidField.setAttribute('aria-invalid', 'true')
        invalidField.setAttribute('aria-describedby', error.id)
        invalidField.focus({ preventScroll: true })
      }
    }
    name.oninput = description.oninput = () => showError('')
    form.onsubmit = async event => {
      event.preventDefault()
      if (saving) return
      const label = name.value.trim()
      if (!/^[a-z][a-z0-9 -]{0,69}$/i.test(label)) {
        showError(label ? 'Start with a letter and use letters, numbers, spaces or hyphens.' : 'Enter a style name.', name)
        return
      }
      saving = create.disabled = dismiss.disabled = name.readOnly = description.readOnly = true
      form.setAttribute('aria-busy', 'true')
      showError('')
      try {
        await submit({ label, description: description.value.trim(), values })
        if (popup.isConnected) {
          close(false)
          onCreated()
        }
      } catch (cause) {
        if (popup.isConnected) {
          const invalid = cause.field === 'description' ? description :
            cause.field === 'name' || /name.*in use/i.test(cause.message) ? name : undefined
          showError(cause.message, invalid)
        }
      } finally {
        saving = create.disabled = dismiss.disabled = name.readOnly = description.readOnly = false
        form.removeAttribute('aria-busy')
      }
    }
    popup.onkeydown = event => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      if (!saving) close()
    }
    const close = ui.mountDefinitionForm(anchor, picker, popup, { trackSize: true })
    name.focus({ preventScroll: true })
    return close
  }
})()
