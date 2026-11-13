(() => {
  const ui = window.LocalhostInspector
  const settingsLabel = 'Auto layout settings'
  const baselineLabel = 'Align text baseline'
  const spacingLabel = 'Auto spacing'
  const crossLabel = 'CSS cross-axis alignment'
  const spacingOptions = [
    ['space-between', 'Between'], ['space-evenly', 'Evenly'], ['space-around', 'Around'],
  ]
  ui.autoSpacing = value => spacingOptions.some(([option]) => option === value)

  const crossOptions = new Map([
    ['start', 'Start'], ['center', 'Center'], ['end', 'End'], ['stretch', 'Stretch'],
    ['baseline', 'Baseline'], ['last baseline', 'Last baseline'],
    ['flex-start', 'Flex start'], ['flex-end', 'Flex end'],
  ])
  const usesBaseline = value => ['baseline', 'first baseline', 'last baseline'].includes(value)
  function crossValue(value) {
    if (value === 'normal') return 'stretch'
    if (value === 'first baseline') return 'baseline'
    return value
  }

  function layoutPreview() {
    const preview = ui.element('div', 'li-settings-preview')
    preview.setAttribute('aria-hidden', 'true')
    const frame = ui.element('div', 'li-settings-preview-frame')
    const items = ['A', 'g', ''].map(letter => ui.element('span', 'li-settings-preview-item', letter))
    frame.append(...items)
    preview.append(frame)
    return { preview, frame }
  }

  function settingsRow(label, control) {
    const row = ui.element('div', 'li-layout-settings-row')
    row.append(ui.element('span', '', label), control)
    return row
  }

  ui.openAlignmentSettings = (anchor, { read, change }) => {
    if (anchor.getAttribute('aria-expanded') === 'true') { ui.closeMenu(); return }
    const popup = ui.element('div', 'li-menu li-context-popup li-layout-settings')
    popup.setAttribute('role', 'dialog')
    popup.setAttribute('aria-label', settingsLabel)
    const dismiss = ui.action('Close ' + settingsLabel, 'dismiss', () => close())
    const heading = ui.popupHeader(settingsLabel, dismiss)

    const { preview, frame } = layoutPreview()
    const fields = ui.element('div', 'li-layout-settings-fields')
    const baseline = ui.element('div', 'li-layout-settings-segments')
    baseline.setAttribute('role', 'group')
    baseline.setAttribute('aria-label', baselineLabel)
    let previousCross = 'start'
    const off = ui.action('Off', 'minus', () => {
      if (usesBaseline(read().cross)) return choose('align-items', previousCross)
    })
    const on = ui.action('On', 'menuCheck', () => {
      const { cross } = read()
      if (usesBaseline(cross)) return
      previousCross = cross
      return choose('align-items', 'baseline')
    })
    baseline.append(off, on)
    const spacing = ui.selectTrigger(spacingLabel)
    const alignment = ui.selectTrigger(crossLabel)
    fields.append(
      settingsRow(baselineLabel, baseline),
      settingsRow(spacingLabel, spacing),
      settingsRow('CSS cross-axis', alignment),
    )
    popup.append(heading, preview, fields)

    let closeChild
    function selectField(trigger, label, options, value, property) {
      trigger.firstElementChild.textContent = options.find(([key]) => key === value)?.[1] ?? value
      trigger.setAttribute('aria-haspopup', 'menu')
      trigger.setAttribute('aria-expanded', 'false')
      trigger.onclick = () => {
        if (popup.getAttribute('aria-busy') === 'true') return
        const open = trigger.getAttribute('aria-expanded') === 'true'
        closeChild?.(false)
        if (!open) closeChild = ui.openMenu(trigger, options, value, item => {
          if (item !== value) return choose(property, item)
        }, {
          label, parent: popup,
          onPreview: item => renderPreview({ [property === 'align-items' ? 'cross' : 'main']: item }),
          onClose: () => renderPreview(),
        })
      }
      trigger.onkeydown = event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        trigger.click()
      }
    }

    function renderPreview(overrides = {}) {
      const { direction, main, cross, horizontalWriting, rtl } = { ...read(), ...overrides }
      const column = direction.startsWith('column')
      const auto = ui.autoSpacing(main)
      const baselineAvailable = !column && horizontalWriting
      const aligned = usesBaseline(cross)
      const value = crossValue(cross)
      frame.dataset.flow = column ? 'column' : 'row'
      frame.dataset.baseline = String(baselineAvailable)
      frame.dataset.stretch = String(column && value === 'stretch')
      frame.dataset.aligned = String(baselineAvailable && aligned)
      frame.style.direction = rtl ? 'rtl' : 'ltr'
      frame.style.flexDirection = direction
      frame.style.justifyContent = auto ? main : 'center'
      frame.style.alignItems = value
      frame.style.gap = auto ? '0' : baselineAvailable ? 'var(--li-gap)' : 'var(--li-space-small)'
    }

    function refresh() {
      const { direction, main, cross, horizontalWriting, crossPositionsInMatrix, crossOverflow } = read()
      const column = direction.startsWith('column')
      const auto = ui.autoSpacing(main)
      const aligned = usesBaseline(cross)
      const baselineAvailable = !column && horizontalWriting
      const value = crossValue(cross)
      const options = [...crossOptions].filter(([key]) => (
        key === value || key === 'stretch' || (!crossPositionsInMatrix && ['start', 'center', 'end'].includes(key))
      ))
      if (!crossOptions.has(value)) options.unshift([value, value])
      off.disabled = on.disabled = !baselineAvailable
      off.setAttribute('aria-pressed', String(!aligned))
      on.setAttribute('aria-pressed', String(aligned))
      spacing.disabled = !auto
      alignment.disabled = crossOverflow
      selectField(spacing, spacingLabel, spacingOptions, auto ? main : 'space-between', 'justify-content')
      selectField(alignment, crossLabel, options, value, 'align-items')

      renderPreview()
    }

    async function choose(property, value) {
      if (popup.getAttribute('aria-busy') === 'true' || read()[property === 'align-items' ? 'cross' : 'main'] === value) return
      popup.setAttribute('aria-busy', 'true')
      try {
        await change(property, value)
      } finally {
        if (popup.isConnected) {
          if (!anchor.isConnected || anchor.disabled) close()
          else {
            anchor.setAttribute('aria-expanded', 'true')
            popup.removeAttribute('aria-busy')
            refresh()
          }
        }
      }
    }

    popup.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      if (event.key !== 'Tab') return
      const controls = Array.from(fields.querySelectorAll('button:not(:disabled)'))
      const boundary = event.shiftKey ? dismiss : controls.at(-1)
      if (event.target === boundary) close()
    }
    refresh()
    const close = ui.mountPopup(anchor, popup, (rect, width) => [
      anchor.closest('.li-panel').getBoundingClientRect().left - width, rect.top,
    ], { closeOnPanelScroll: true, onClose: () => closeChild?.(false) })
    dismiss.focus({ preventScroll: true })
  }
})()
