(() => {
  const ui = window.LocalhostInspector
  const positions = ['start', 'center', 'end']
  const reversedPositions = [...positions].reverse()
  function position(value, reversed) {
    if (value === 'flex-start' || value === 'flow-start') return reversed ? 'end' : 'start'
    if (value === 'flex-end' || value === 'flow-end') return reversed ? 'start' : 'end'
    return positions.includes(value) ? value : null
  }
  const stretches = value => value === 'normal' || value === 'stretch'

  ui.alignmentControls = (context, controls) => {
    const { style, disabled, run, commit } = context
    const direction = controls.value('flex-direction')
    const column = direction.startsWith('column')
    const rtl = style.direction === 'rtl'
    const main = controls.value('justify-content')
    const cross = controls.value('align-items')
    // Flex stretch on the main axis falls back to flex-start. On the cross
    // axis, normal/stretch actually stretch auto-sized items and are not positions.
    const mainPosition = position(stretches(main) ? 'flex-start' : main, direction.endsWith('-reverse'))
    const crossPosition = position(cross, style.flexWrap === 'wrap-reverse')
    const horizontalWriting = style.writingMode === 'horizontal-tb'
    const oneAxis = horizontalWriting && Boolean(mainPosition) !== Boolean(crossPosition)
    let alignment
    if (horizontalWriting && mainPosition && crossPosition) {
      const matrix = ui.element('div', 'li-matrix')
      matrix.setAttribute('role', 'group')
      matrix.setAttribute('aria-label', 'Container alignment')
      const mainChoices = !column && rtl ? reversedPositions : positions
      const crossChoices = column && rtl ? reversedPositions : positions
      for (const y of column ? mainChoices : crossChoices) {
        for (const x of column ? crossChoices : mainChoices) {
          const justify = column ? y : x
          const align = column ? x : y
          const name = 'Distribute ' + justify + ', align ' + align
          const point = ui.element('button')
          point.type = 'button'
          point.disabled = disabled
          point.setAttribute('aria-label', name)
          ui.setTooltip(point, name)
          const active = justify === mainPosition && align === crossPosition
          point.setAttribute('aria-pressed', String(active))
          if (active) point.append(ui.icon('alignmentMark'))
          point.onclick = () => {
            const changes = []
            if (justify !== mainPosition) changes.push(['justify-content', justify])
            if (align !== crossPosition) changes.push(['align-items', align])
            if (changes.length) void run(() => ui.commitChanges(commit, changes))
          }
          matrix.append(point)
        }
      }
      alignment = ui.stack('Alignment', matrix)
    }

    const advanced = controls.button('More container alignment options', 'layoutSettings', () => {})
    const displayValue = value => value.replaceAll('-', ' ')
    const positionalProperty = oneAxis ? (mainPosition ? 'justify-content' : 'align-items') : null
    const currentPosition = oneAxis ? mainPosition || crossPosition : null
    const menu = []
    if (oneAxis) {
      const horizontal = mainPosition ? !column : column
      const label = horizontal ? 'Horizontal alignment' : 'Vertical alignment'
      const names = horizontal ? ['Left', 'Center', 'Right'] : ['Top', 'Center', 'Bottom']
      const choices = horizontal && rtl ? reversedPositions : positions
      const other = mainPosition
        ? 'Cross-axis: ' + (stretches(cross) ? 'stretch' : displayValue(cross))
        : 'Distribution: ' + displayValue(main)
      ui.setTooltip(advanced, label + ': ' + names[choices.indexOf(currentPosition)] + ' · ' + other)
      menu.push(...choices.map((value, index) => [
        positionalProperty + ':' + value,
        label + ': ' + names[index] + (value === currentPosition ? ' (current)' : ''),
      ]))
    }
    const isPositional = (property, value) => property === positionalProperty && positions.includes(value)
    menu.push(
      ...ui.choices.distribution.filter(value => !isPositional('justify-content', value)).map(value => [
        'justify-content:' + value,
        'Distribution: ' + displayValue(value) + (value === main && positionalProperty !== 'justify-content' ? ' (current)' : ''),
      ]),
      ...ui.choices.alignment.filter(value => !isPositional('align-items', value)).map(value => [
        'align-items:' + value,
        'Alignment: ' + (value === 'normal' ? 'automatic stretch' : displayValue(value)) +
          (value === cross && positionalProperty !== 'align-items' ? ' (current)' : stretches(cross) && !stretches(value) ? ' (stops stretch)' : ''),
      ]),
    )
    controls.attachMenu(advanced, 'Container alignment', menu, '', value => {
      const [property, requested] = value.split(':')
      if (property === positionalProperty && requested === currentPosition) return
      if (requested !== controls.value(property)) controls.change(property, requested)
    }, { commands: true })
    const row = ui.row(alignment, ui.stack('Gap', controls.numeric('gap', 'Gap', 'gapHorizontal')), advanced)
    row.classList.add('li-alignment-row')
    return row
  }
})()
