(() => {
  const ui = window.LocalhostInspector
  const revealed = new WeakMap()
  ui.resizingControls = (context, controls, refresh) => {
    const { node, run, commit } = context
    if (!revealed.has(node)) revealed.set(node, new Set())
    const pending = revealed.get(node)
    const meaningful = property => {
      const value = controls.value(property)
      if (property.startsWith('max-')) return value !== 'none'
      if (value === 'auto') return false
      if (value !== '0px') return true
      // Computed block minima resolve auto to zero. An explicit inline zero,
      // or a flex/grid item's zero instead of auto, is still a real constraint.
      const inline = node.style.getPropertyValue(property)
      if (inline === 'auto') return false
      return Boolean(inline) ||
        /^(inline-)?(flex|grid)$/.test(getComputedStyle(node.parentElement || node).display)
    }
    const visible = property => pending.has(property) || meaningful(property)
    const add = property => { pending.add(property); refresh(property) }
    const dimension = axis => {
      const title = axis === 'width' ? 'Width' : 'Height'
      const current = controls.value(axis)
      const options = /^-?[\d.]+px$/.test(current) ? [['fixed', 'Fixed ' + axis + ' (' + current.slice(0, -2) + ')']] : []
      if (axis === 'width' && ui.widthModes(node).length) options.push(['fill', 'Fill container'], ['hug', 'Hug contents'])
      for (const bound of ['min', 'max']) {
        const property = bound + '-' + axis
        if (!visible(property)) options.push([property, 'Add ' + bound + ' ' + axis + '…', { icon: bound + title, separator: !options.some(([key]) => key === 'min-' + axis || key === 'max-' + axis) }])
      }
      return controls.numeric(axis, title, null, {
        prefix: axis === 'width' ? 'W' : 'H',
        menu: { label: title + ' resizing', options, choose: choice => {
          if (choice.startsWith('min-') || choice.startsWith('max-')) add(choice)
          else controls.change(axis, choice === 'fixed' ? current : choice === 'fill' ? '100%' : 'fit-content')
        } },
      })
    }
    const result = [ui.stack('Resizing', ui.row(dimension('width'), dimension('height')))]
    const bounds = ui.element('div', 'li-bounds')
    for (const axis of ['width', 'height']) {
      const fields = []
      for (const bound of ['min', 'max']) {
        const property = bound + '-' + axis
        if (!visible(property)) continue
        const label = bound[0].toUpperCase() + bound.slice(1) + ' ' + axis
        const current = controls.value(property)
        const actual = meaningful(property)
        fields.push(ui.stack(label, controls.numeric(property, label, bound + (axis === 'width' ? 'Width' : 'Height'), {
          value: actual ? current : '', placeholder: bound[0].toUpperCase() + bound.slice(1) + ' ' + (axis === 'width' ? 'W' : 'H'),
          menu: { label: label + ' options', options: [['remove', 'Remove ' + bound + ' ' + axis]], choose: () => {
            if (!actual) { pending.delete(property); refresh(); return }
            run(async () => {
              await commit(property, bound === 'min' ? 'auto' : 'none')
              pending.delete(property)
            })
          } },
        })))
      }
      if (fields.length) bounds.append(ui.row(...fields))
    }
    if (bounds.childElementCount) result.push(bounds)
    return result
  }
})()
