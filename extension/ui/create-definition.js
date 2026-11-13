(() => {
  const ui = window.LocalhostInspector

  ui.createDefinitionField = (form, idPrefix, label, initial = '', multiline = false) => {
    const row = ui.element('div', 'li-create-definition-field')
    const field = ui.element('span', 'li-field')
    const input = ui.element(multiline ? 'textarea' : 'input')
    input.autocomplete = 'off'
    input.spellcheck = false
    input.value = initial
    input.id = idPrefix + '-' + label.toLowerCase()
    const caption = ui.element('label', '', label)
    caption.htmlFor = input.id
    field.append(input)
    row.append(caption, field)
    form.append(row)
    return { field, input }
  }

  ui.mountDefinitionForm = (anchor, picker, popup, options) => ui.mountPopup(anchor, popup, (_, width) => {
    const rect = picker.getBoundingClientRect()
    return [rect.left >= width + 8 ? rect.left - width : rect.left, rect.top]
  }, { parent: picker, matchAnchorWidth: false, ...options })
})()
