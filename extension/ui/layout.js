(() => {
  const ui = window.LocalhostInspector
  ui.layoutControls = (context, controls, refresh) => {
    const { node, style, disabled, run, commit } = context
    const content = []
    if (ui.supported('flex-direction', node, style)) {
      const direction = controls.value('flex-direction')
      const column = direction.startsWith('column')
      const reversed = direction.endsWith('-reverse')
      const flow = controls.segments('flex-direction', 'Flow direction', [
        ['column' + (reversed ? '-reverse' : ''), 'Vertical flow', 'flowColumn'],
        ['row' + (reversed ? '-reverse' : ''), 'Horizontal flow', 'flowRow'],
      ])
      flow.classList.add('li-flow')
      const reverse = controls.button('Reverse flow', 'reverseDirection', () => controls.change('flex-direction', (column ? 'column' : 'row') + (reversed ? '' : '-reverse')))
      reverse.setAttribute('aria-pressed', String(reversed))
      const row = ui.row(flow, reverse)
      row.classList.add('li-flow-actions')
      content.push(ui.stack('Flow', row))
    }
    content.push(ui.stack('Resizing', ui.row(
      controls.numeric('width', 'Width', null, { prefix: 'W' }), controls.numeric('height', 'Height', null, { prefix: 'H' }),
    )))
    const bound = (property, label, icon) => ui.stack(label, controls.numeric(property, label, icon, {
      placeholder: controls.value(property) === 'none' ? (property === 'max-width' ? 'Max W' : 'Max H') : controls.value(property),
    }), true)
    const bounds = ui.element('div', 'li-bounds')
    bounds.append(
      ui.row(bound('min-width', 'Min width', 'minWidth'), bound('max-width', 'Max width', 'maxWidth')),
      ui.row(bound('min-height', 'Min height', 'minHeight'), bound('max-height', 'Max height', 'maxHeight')),
    )
    content.push(bounds)
    // Grid-only editing remains deferred; no grid mode or grid conversion is added.
    if (['flex', 'inline-flex'].includes(style.display)) {
      const matrix = ui.element('div', 'li-matrix')
      matrix.setAttribute('role', 'group')
      matrix.setAttribute('aria-label', 'Container alignment')
      const column = controls.value('flex-direction').startsWith('column')
      const reverse = controls.value('flex-direction').endsWith('-reverse')
      const rtl = style.direction === 'rtl'
      const positions = ['start', 'center', 'end']
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
        const main = column ? y : x
        const justify = positions[!column && rtl ? 2 - main : main]
        const cross = column ? x : y
        const align = positions[column && rtl ? 2 - cross : cross]
        const button = ui.element('button', 'li-matrix-point')
        button.type = 'button'
        button.disabled = disabled
        button.setAttribute('aria-label', 'Distribute ' + justify + ', align ' + align)
        const matches = (property, expected) => {
          const current = controls.value(property)
          if (!current.startsWith('flex-')) return current === expected
          const position = current.slice(5)
          return (property === 'justify-content' && reverse ? (position === 'start' ? 'end' : 'start') : position) === expected
        }
        const active = matches('justify-content', justify) && matches('align-items', align)
        button.setAttribute('aria-pressed', String(active))
        button.append(active ? ui.icon('alignmentMark') : ui.element('span', 'li-dot'))
        button.onclick = () => run(async () => {
          await ui.commitPair(commit, [['justify-content', justify], ['align-items', align]])
        })
        matrix.append(button)
        }
      }
      const advanced = controls.button('More container alignment options', 'layoutSettings', () => {})
      controls.attachMenu(advanced, 'Container alignment', [
        ...[...new Set([controls.value('justify-content'), ...ui.choices.distribution])].map(value => ['justify-content:' + value, 'Distribution: ' + value]),
        ...[...new Set([controls.value('align-items'), ...ui.choices.alignment])].map(value => ['align-items:' + value, 'Alignment: ' + value]),
      ], '', value => { const [property, requested] = value.split(':'); controls.change(property, requested) })
      const row = ui.row(ui.stack('Alignment', matrix), ui.stack('Gap', controls.numeric('gap', 'Gap', 'gapHorizontal')), advanced)
      row.classList.add('li-alignment-row')
      content.push(row)
    }
    content.push(ui.paddingControls(context, controls, refresh))
    const section = ui.section('Auto layout', ...content)
    section.classList.add('li-layout-section')
    return section
  }
})()
