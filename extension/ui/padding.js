(() => {
  const ui = window.LocalhostInspector
  const state = new WeakMap()
  ui.paddingControls = (context, controls, refresh) => {
    const { node, disabled, commit } = context
    const padding = Object.fromEntries(
      ['left', 'right', 'top', 'bottom'].map(side => [side, controls.value('padding-' + side)]),
    )
    const asymmetric = padding.left !== padding.right || padding.top !== padding.bottom
    const hasDifferentBindings = [['left', 'right'], ['top', 'bottom']].some(([first, second]) => {
      const a = node.style.getPropertyValue('padding-' + first)
      const b = node.style.getPropertyValue('padding-' + second)
      return a !== b && context.spacingCatalog?.names.some(name => {
        const reference = ui.spacingVariableValue(name)
        return a === reference || b === reference
      })
    })
    const expanded = state.get(node) ?? (asymmetric || hasDifferentBindings)
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
        ui.row(ui.spacingField(context, controls, 'padding-left', 'Left padding', 'paddingLeft'), ui.spacingField(context, controls, 'padding-top', 'Top padding', 'paddingTop'), toggle),
        ui.row(ui.spacingField(context, controls, 'padding-right', 'Right padding', 'paddingRight'), ui.spacingField(context, controls, 'padding-bottom', 'Bottom padding', 'paddingBottom')),
      )
    } else {
      const axis = (name, first, second, icon) => {
        const a = padding[first]
        const b = padding[second]
        return ui.spacingField(context, controls, 'padding-' + name, name === 'horizontal' ? 'Horizontal padding' : 'Vertical padding', icon, {
          properties: ['padding-' + first, 'padding-' + second],
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
