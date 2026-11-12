(() => {
  const ui = window.LocalhostInspector
  ui.layoutControls = (context, controls, refresh) => {
    const { node, style } = context
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
    content.push(...ui.resizingControls(context, controls, refresh))
    if (['flex', 'inline-flex'].includes(style.display)) {
      content.push(ui.alignmentControls(context, controls))
    }
    content.push(ui.paddingControls(context, controls, refresh))
    const section = ui.section('Auto layout', ...content)
    section.classList.add('li-layout-section')
    return section
  }
})()
