(() => {
  const ui = window.LocalhostInspector
  const delay = 1000
  const buttonFor = event => event.target.closest?.('button[data-inspector-tooltip]')
  const inside = (button, target) => target?.nodeType && button.contains(target)
  ui.setTooltip = (button, label) => { button.dataset.inspectorTooltip = label }

  ui.bindTooltips = root => {
    const tooltip = ui.element('div', 'li-tooltip')
    tooltip.id = 'inspector-tooltip'
    tooltip.hidden = true
    tooltip.setAttribute('role', 'tooltip')
    root.append(tooltip)
    const owner = root.ownerDocument
    const viewport = owner.defaultView
    let anchor, timer, activeEvents

    function dismiss() {
      clearTimeout(timer)
      activeEvents?.abort()
      if (anchor && !tooltip.hidden) {
        const described = anchor.getAttribute('aria-describedby')
        if (described?.split(/\s+/).includes(tooltip.id)) {
          const remaining = described.split(/\s+/).filter(id => id !== tooltip.id).join(' ')
          if (remaining) anchor.setAttribute('aria-describedby', remaining)
          else anchor.removeAttribute('aria-describedby')
        }
      }
      anchor = null
      tooltip.hidden = true
    }
    ui.dismissTooltip = dismiss

    function show() {
      const popup = root.querySelector('dialog[open], .li-menu')
      if (!anchor?.isConnected || anchor.closest('[hidden]') || (popup && !popup.contains(anchor))) {
        dismiss()
        return
      }
      tooltip.textContent = anchor.dataset.inspectorTooltip
      tooltip.hidden = false
      const rect = anchor.getBoundingClientRect()
      const { width, height } = tooltip.getBoundingClientRect()
      const edge = 8
      const gap = 6
      const left = Math.max(edge, Math.min(rect.left + (rect.width - width) / 2, viewport.innerWidth - width - edge))
      const above = rect.top - height - gap
      const top = above >= edge ? above : Math.max(edge, Math.min(rect.bottom + gap, viewport.innerHeight - height - edge))
      tooltip.style.left = left + 'px'
      tooltip.style.top = top + 'px'
      if (tooltip.textContent !== anchor.getAttribute('aria-label')) {
        const described = anchor.getAttribute('aria-describedby')
        anchor.setAttribute('aria-describedby', [described, tooltip.id].filter(Boolean).join(' '))
      }
    }

    function schedule(button) {
      if (anchor === button) return
      dismiss()
      anchor = button
      activeEvents = new AbortController()
      const options = { capture: true, signal: activeEvents.signal }
      for (const surface of new Set([root, owner, document])) {
        surface.addEventListener('scroll', dismiss, options)
        surface.addEventListener('pointerdown', dismiss, options)
        surface.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss() }, options)
      }
      viewport.addEventListener('resize', dismiss, options)
      viewport.addEventListener('blur', dismiss, options)
      timer = setTimeout(show, delay)
    }

    root.addEventListener('pointerover', event => {
      const button = buttonFor(event)
      if (button && event.pointerType !== 'touch' && !inside(button, event.relatedTarget)) schedule(button)
    })
    root.addEventListener('focusin', event => {
      const button = buttonFor(event)
      if (button?.matches(':focus-visible')) schedule(button)
    })
    for (const type of ['pointerout', 'focusout']) {
      root.addEventListener(type, event => {
        if (anchor && buttonFor(event) === anchor && !inside(anchor, event.relatedTarget)) dismiss()
      })
    }
    root.addEventListener('click', dismiss, true)
  }
})()
