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
    if (!context.buttonSize) return null
    const controls = ui.createControls({
      ...context,
      value: () => context.buttonSize,
      commit: (_property, size) => context.commitButtonSize(size),
    })
    return ui.section('Component', ui.stack('Size', controls.select('button-size', 'Button size', choices, size => labels[size])))
  }
})()
