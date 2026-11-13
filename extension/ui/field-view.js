(() => {
  const ui = window.LocalhostInspector
  const handlers = ['onclick', 'onkeydown', 'oninput', 'onchange']
  const validationAttributes = ['aria-invalid', 'aria-describedby']

  function sameControl(current, next) {
    if (current.nodeType !== next.nodeType) return false
    if (next.nodeType !== Node.ELEMENT_NODE) return true
    if (current.localName !== next.localName || current.namespaceURI !== next.namespaceURI) return false
    if (current.id || next.id) return current.id === next.id
    return ['data-inspector-section', 'class', 'aria-label'].every(
      name => current.getAttribute(name) === next.getAttribute(name),
    )
  }

  function updateControl(current, next, active) {
    if (next.nodeType !== Node.ELEMENT_NODE) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue
      return
    }
    const input = next.localName === 'input'
    const retainError = input && !next.disabled && current.defaultValue === next.defaultValue &&
      current.hasAttribute('aria-invalid')
    const keepDraft = input && !next.disabled && (retainError ||
      (current === active && current.value !== current.defaultValue))
    for (const { name } of Array.from(current.attributes)) {
      if (!next.hasAttribute(name) && !(retainError && validationAttributes.includes(name))) current.removeAttribute(name)
    }
    for (const { name, value } of Array.from(next.attributes)) {
      if (name === 'aria-expanded' && current.getAttribute('aria-haspopup') === 'dialog' &&
          current.getAttribute(name) === 'true') continue
      if (current.getAttribute(name) !== value) current.setAttribute(name, value)
    }
    if (input && !keepDraft && current.value !== next.value) current.value = next.value
    for (const handler of handlers) current[handler] = next[handler]
    updateChildren(current, Array.from(next.childNodes), active)
  }

  function updateChildren(parent, nextChildren, active) {
    const existing = Array.from(parent.childNodes)
    for (const [index, next] of nextChildren.entries()) {
      const match = existing.findIndex(current => sameControl(current, next))
      const current = match === -1 ? next : existing.splice(match, 1)[0]
      if (current !== next) updateControl(current, next, active)
      if (current !== parent.childNodes[index]) parent.insertBefore(current, parent.childNodes[index] ?? null)
    }
    for (const obsolete of existing) {
      if (obsolete.matches?.('.li-validation') && parent.querySelector('input[aria-invalid="true"]')) continue
      obsolete.remove()
    }
  }

  // These are the Inspector's own synchronous control trees. Preserve mounted
  // controls while applying fresh labels, values and handlers for this selection.
  ui.updateInspectorFields = (container, sections) => {
    updateChildren(container, sections, container.getRootNode().activeElement)
  }

  ui.setFieldsSaving = (container, saving) => {
    for (const input of container.querySelectorAll('input')) input.readOnly = saving
    for (const button of container.querySelectorAll('button')) {
      if (saving && !button.disabled) {
        button.setAttribute('data-preview-pending', '')
        button.setAttribute('aria-disabled', 'true')
      } else if (button.hasAttribute('data-preview-pending')) {
        button.removeAttribute('data-preview-pending')
        button.removeAttribute('aria-disabled')
      }
    }
  }
})()
