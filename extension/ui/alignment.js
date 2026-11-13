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

  const pixels = value => parseFloat(value) || 0
  function overflowingAxes(node, style) {
    // Alignment positions the item against the content edges. If an item
    // cannot fit between those edges, "end" can place it before "start".
    const width = node.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight)
    const height = node.clientHeight - pixels(style.paddingTop) - pixels(style.paddingBottom)
    let x = false
    let y = false
    for (const child of node.children) {
      const item = getComputedStyle(child)
      if (item.display === 'none' || item.display === 'contents' ||
          item.position === 'absolute' || item.position === 'fixed') continue
      // Use layout dimensions for HTML items, ignoring visual transforms.
      // SVG flex items have no offset size, but their computed dimensions
      // normally resolve to the item's layout size.
      const itemWidth = child.offsetWidth ?? pixels(item.width)
      const itemHeight = child.offsetHeight ?? pixels(item.height)
      x ||= itemWidth + pixels(item.marginLeft) + pixels(item.marginRight) > width + 1
      y ||= itemHeight + pixels(item.marginTop) + pixels(item.marginBottom) > height + 1
      if (x && y) break
    }
    return { x, y }
  }

  function alignmentGlyph(column, cross, rtl) {
    const glyph = ui.icon('alignmentMark')
    const start = column && rtl ? 'end' : 'start'
    const end = start === 'start' ? 'end' : 'start'
    for (const bar of glyph.querySelectorAll('rect')) {
      if (cross === start) bar.setAttribute('y', '3')
      if (cross === end) bar.setAttribute('y', String(13 - Number(bar.getAttribute('height'))))
    }
    if (column) glyph.classList.add('li-alignment-glyph-vertical')
    return glyph
  }

  ui.alignmentControls = (context, controls) => {
    const { node, style, disabled, run, commit } = context
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
    const auto = ui.autoSpacing(main)
    const horizontalPosition = column ? crossPosition : mainPosition
    const verticalPosition = column ? mainPosition : crossPosition
    const overflow = overflowingAxes(node, style)
    const showsHorizontal = horizontalWriting && !overflow.x && (horizontalPosition !== null || (auto && column))
    const showsVertical = horizontalWriting && !overflow.y && (verticalPosition !== null || (auto && !column))
    let alignment
    if (showsHorizontal || showsVertical) {
      const matrix = ui.element('div', 'li-matrix')
      matrix.setAttribute('role', 'group')
      matrix.setAttribute('aria-label', 'Container alignment')
      if (auto) {
        matrix.classList.add('li-matrix-auto', column ? 'li-matrix-auto-column' : 'li-matrix-auto-row')
        if (stretches(cross)) {
          const stretch = ui.element('span', 'li-matrix-auto-mark li-matrix-stretch')
          stretch.append(ui.element('i'), ui.element('i'), ui.element('i'))
          stretch.setAttribute('aria-hidden', 'true')
          matrix.setAttribute('aria-description', 'Items stretch across the cross axis.')
          matrix.append(stretch)
        }
      } else {
        if (!showsHorizontal) matrix.classList.add('li-matrix-vertical')
        if (!showsVertical) matrix.classList.add('li-matrix-horizontal')
      }
      const horizontalChoices = showsHorizontal ? (rtl ? reversedPositions : positions) : [null]
      const verticalChoices = showsVertical ? positions : [null]
      for (const [rowIndex, y] of verticalChoices.entries()) {
        for (const [columnIndex, x] of horizontalChoices.entries()) {
          const justify = column ? y : x
          const align = column ? x : y
          const name = showsHorizontal && showsVertical
            ? 'Distribute ' + justify + ', align ' + align
            : 'Align ' + (showsHorizontal ? ['left', 'center', 'right'][columnIndex] : ['top', 'center', 'bottom'][rowIndex])
          const point = ui.element('button')
          point.type = 'button'
          point.disabled = disabled
          point.setAttribute('aria-label', name)
          ui.setTooltip(point, auto && stretches(cross) ? name + ' (stops stretch)' : name)
          const changes = []
          if (justify !== null && justify !== mainPosition) changes.push(['justify-content', justify])
          if (align !== null && align !== crossPosition) changes.push(['align-items', align])
          const active = changes.length === 0
          point.setAttribute('aria-pressed', String(active))
          if (auto) {
            const mark = ui.element('span', 'li-matrix-auto-mark')
            mark.setAttribute('aria-hidden', 'true')
            mark.append(ui.element('i'), ui.element('i'), ui.element('i'))
            point.append(mark)
          } else {
            point.append(alignmentGlyph(column, align, rtl))
          }
          point.onclick = () => {
            if (!active) void run(() => ui.commitChanges(commit, changes))
          }
          matrix.append(point)
        }
      }
      alignment = ui.stack('Alignment', matrix)
    }
    if (overflow.x || overflow.y) {
      const dimension = overflow.x && overflow.y ? 'width and height' : overflow.x ? 'width' : 'height'
      const note = ui.caption('Content exceeds the available ' + dimension + '.')
      note.classList.add('li-alignment-overflow')
      if (alignment) alignment.append(note)
      else alignment = ui.stack('Alignment', note)
    }

    const gapValue = controls.value('gap')
    const fixedGap = /^\d+(?:\.\d+)?px$/.test(gapValue) ? String(parseFloat(gapValue)) : null
    const gap = ui.spacingField(context, controls, 'gap', 'Gap', 'gapHorizontal', {
      placeholder: auto ? 'Auto' : undefined,
      displayValue: auto ? '' : undefined,
      submit: async value => {
        const changes = []
        if (gapValue !== value + 'px') changes.push(['gap', value + 'px'])
        if (auto) changes.push(['justify-content', 'start'])
        await ui.commitChanges(commit, changes)
      },
      menu: {
        label: 'Gap options',
        options: [['fixed', fixedGap ?? 'Fixed'], ['auto', 'Auto']],
        current: auto ? 'auto' : 'fixed',
        radio: true,
        choose: requested => {
          if ((requested === 'auto') === auto) return
          controls.change('justify-content', requested === 'auto' ? 'space-between' : 'start')
        },
      },
    })

    const advanced = controls.button('Auto layout settings', 'layoutSettings', () => {})
    advanced.classList.add('li-layout-settings-trigger')
    advanced.setAttribute('aria-haspopup', 'dialog')
    advanced.setAttribute('aria-expanded', 'false')
    advanced.onclick = event => ui.openAlignmentSettings(event.currentTarget, {
      read: () => {
        const axes = overflowingAxes(node, style)
        return {
          direction: style.flexDirection,
          main: style.justifyContent,
          cross: style.alignItems,
          horizontalWriting: style.writingMode === 'horizontal-tb',
          rtl: style.direction === 'rtl',
          crossOverflow: style.flexDirection.startsWith('column') ? axes.x : axes.y,
          crossPositionsInMatrix: horizontalWriting && position(style.alignItems, style.flexWrap === 'wrap-reverse') !== null,
        }
      },
      change: (property, value) => run(() => commit(property, value), { keepPopup: true }),
    })
    const row = ui.row(alignment, ui.stack('Gap', gap), advanced)
    row.classList.add('li-alignment-row')
    return row
  }
})()
