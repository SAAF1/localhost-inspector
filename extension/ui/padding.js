(() => {
  const ui = window.LocalhostInspector
  const state = new WeakMap()
  ui.paddingControls = (context, controls, refresh) => {
    const { node, disabled, commit } = context
    const padding = Object.fromEntries(
      ['left', 'right', 'top', 'bottom'].map(side => [side, controls.value('padding-' + side)]),
    )
    const asymmetric = padding.left !== padding.right || padding.top !== padding.bottom
    const expanded = state.get(node) ?? asymmetric
    const group = ui.element('div', 'li-stack li-padding')
    const toggle = controls.button(expanded ? 'Collapse individual padding' : 'Expand individual padding', 'paddingSidesToggle', () => {
      state.set(node, !expanded)
      refresh('padding-toggle')
    })
    toggle.id = 'control-padding-toggle'
    toggle.setAttribute('aria-expanded', String(expanded))
    toggle.setAttribute('aria-pressed', String(expanded))
    toggle.disabled = disabled
    group.append(ui.caption('Padding'))
    const values = ui.element('div', 'li-padding-values')
    group.append(values)
    if (expanded) {
      values.append(
        ui.row(controls.numeric('padding-left', 'Left padding', 'paddingLeft'), controls.numeric('padding-top', 'Top padding', 'paddingTop'), toggle),
        ui.row(controls.numeric('padding-right', 'Right padding', 'paddingRight'), controls.numeric('padding-bottom', 'Bottom padding', 'paddingBottom')),
      )
    } else {
      const axis = (name, first, second, icon) => {
        const a = padding[first]
        const b = padding[second]
        return controls.numeric('padding-' + name, name === 'horizontal' ? 'Horizontal padding' : 'Vertical padding', icon, {
          value: a === b ? a : '', placeholder: a === b ? a : 'Mixed',
          submit: async number => {
            // Each side remains its own durable, reversible journal entry.
            await ui.commitChanges(commit, [['padding-' + first, number + 'px'], ['padding-' + second, number + 'px']])
          },
        })
      }
      values.append(ui.row(axis('horizontal', 'left', 'right', 'paddingHorizontal'), axis('vertical', 'top', 'bottom', 'paddingVertical'), toggle))
    }
    return group
  }
})()
