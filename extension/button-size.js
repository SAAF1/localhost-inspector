(() => {
  const ui = window.LocalhostInspector
  const choices = ['default', 'sm', 'lg', 'icon']
  const labels = { default: 'Default', sm: 'Small', lg: 'Large', icon: 'Icon' }

  function currentSize(node, key) {
    if (!key || node?.localName !== 'button' || node.getAttribute('data-slot') !== 'button' ||
        node.getAttribute('data-inspector-target') !== key ||
        ui.findPreviewTarget({ tag: 'button', slot: 'button', key }) !== node) return null
    const size = node.getAttribute('data-inspector-button-size')
    return choices.includes(size) ? size : null
  }

  async function setSize(node, key, before, requested, route) {
    if (!choices.includes(requested) || currentSize(node, key) !== before) return false
    const applied = await window.phaseABridge({ type: 'previewButtonSize', key, before, requested, route })
    return applied === true && currentSize(node, key) === requested
  }

  ui.buttonSize = { choices, currentSize, setSize }
  ui.buttonSizeSection = context => {
    if (!context.buttonSize && !context.component) return null
    const rows = []
    if (context.component?.library) rows.push(ui.caption(context.component.library))
    if (context.component?.description) rows.push(ui.element('p', 'li-component-description', context.component.description))
    function addProperty(label, control) {
      const row = ui.row(ui.caption(label), control)
      row.classList.add('li-component-prop')
      rows.push(row)
    }
    for (const prop of context.component?.properties ?? []) {
      if (prop.id === 'size' && context.buttonSize) continue
      if (prop.id === 'children') {
        const text = ui.textEditing.singleLabel(context.node)
        if (text) {
          const before = text.data
          const input = ui.element(before.includes('\n') ? 'textarea' : 'input', 'li-component-value')
          input.setAttribute('aria-label', 'Text')
          input.defaultValue = before
          input.maxLength = 16000
          input.disabled = context.disabled
          input.onchange = e => {
            if (e.currentTarget.value !== before) void context.editText(text, before, e.currentTarget.value)
          }
          input.onkeydown = e => {
            if (e.isComposing) return
            if (e.key === 'Escape') e.currentTarget.value = before
            if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur() }
          }
          addProperty('Text', input)
          continue
        }
      }
      const words = prop.id.replace(/([a-z0-9])([A-Z])/g, (_, first, second) => first + ' ' + second.toLowerCase()).replace(/[_-]+/g, ' ')
      const label = prop.label || (prop.id === 'children' ? 'Content' : words.charAt(0).toUpperCase() + words.slice(1))
      const component = context.component
      const options = prop.options ?? []
      const optionLabel = option => typeof option === 'object' && option !== null ? option.label ?? option.value : String(option)
      const optionValue = option => typeof option === 'object' && option !== null ? option.value : option
      const matched = options.find(option => optionValue(option) === prop.value)
      const value = matched === undefined ? String(prop.value ?? 'None') : optionLabel(matched)
      if (!options.length || !(prop.prepared || component.sourcePreview || prop.registeredSlot) || prop.unavailableReason) {
        const summary = ui.element('span', 'li-component-value', prop.unavailableReason || value)
        summary.title = prop.unavailableReason || label + ' · Read only'
        addProperty(label, summary)
        continue
      }
      if (typeof prop.value === 'boolean' && options.length === 2 && options.includes(true) && options.includes(false)) {
        const toggle = ui.element('button', 'li-prop-switch')
        toggle.type = 'button'
        toggle.setAttribute('role', 'switch')
        toggle.setAttribute('aria-label', label)
        toggle.setAttribute('aria-checked', String(prop.value))
        toggle.disabled = context.disabled
        toggle.onclick = () => context.run(() =>
          context.previewComponentProperty(context.node, component, prop, !prop.value, false))
        addProperty(label, toggle)
        continue
      }
      const trigger = ui.selectTrigger(label)
      trigger.disabled = context.disabled
      trigger.firstElementChild.textContent = value
      const menu = options.map(option => [optionValue(option), optionLabel(option)])
      if (prop.registeredSlot && prop.value !== null) menu.push([null, 'None'])
      if (prop.overridden) menu.push([null, 'Restore original', { separator: true, command: true }])
      ui.createControls(context).attachMenu(trigger, label, menu, prop.value, next => context.run(() =>
        context.previewComponentProperty(context.node, component, prop, next, component.sourcePreview && next === null)),
      { description: prop.prepared ? 'Saved in Edits · Shared source use' : 'Saved in Edits · Preview resets on reload' })
      addProperty(label, trigger)
    }
    const title = context.component?.name || 'Component'
    if (!context.buttonSize) return ui.section(title, ...rows)
    const controls = ui.createControls({
      ...context,
      value: () => context.buttonSize,
      commit: (_property, size) => context.commitButtonSize(size),
    })
    addProperty('Size', controls.select('button-size', 'Button size', choices, size => labels[size]))
    return ui.section(title, ...rows)
  }
})()
