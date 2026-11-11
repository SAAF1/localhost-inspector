(() => {
  const ui = window.LocalhostInspector ||= {}
  const layouts = new Set(['flex', 'inline-flex', 'grid', 'inline-grid'])
  ui.widthModes = node => {
    const parent = node.parentElement && getComputedStyle(node.parentElement)
    const own = getComputedStyle(node)
    if (!parent || layouts.has(parent.display) || !['block', 'flow-root', 'flex', 'grid'].includes(own.display) ||
        own.boxSizing !== 'border-box' || !['static', 'relative'].includes(own.position)) return []
    return ['fill', 'hug']
  }
  ui.supported = (property, node, style = getComputedStyle(node)) => {
    if (['gap', 'justify-content', 'align-items'].includes(property)) return layouts.has(style.display)
    if (property === 'flex-direction') return ['flex', 'inline-flex'].includes(style.display)
    if (property === 'justify-items') return style.display.includes('grid')
    if (['border-width', 'border-color'].includes(property)) return style.borderTopStyle !== 'none'
    return true
  }
  ui.choices = {
    distribution: ['normal', 'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly', 'stretch'],
    alignment: ['normal', 'start', 'center', 'end', 'stretch', 'baseline'],
    text: ['start', 'center', 'end', 'left', 'right', 'justify'],
    weights: ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
    sizes: [10, 11, 12, 13, 14, 15, 16, 20, 24, 32, 36, 40, 48, 64, 96, 128],
  }
})()
