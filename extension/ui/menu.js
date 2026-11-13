(() => {
  const ui = window.LocalhostInspector
  let closeActive = () => {}
  ui.closeMenu = () => closeActive()

  function mountPopup(anchor, popup, position, { closeOnPanelScroll = false, parent, onClose, matchAnchorWidth = true, fallbackFocus, trackSize = false } = {}) {
    ui.dismissTooltip()
    if (!parent) closeActive(false)
    const root = anchor.getRootNode()
    const owner = anchor.ownerDocument
    const viewport = owner.defaultView
    const targets = new Set([owner, document])
    if (closeOnPanelScroll) targets.add(root)
    const outside = event => {
      if (!event.composedPath().includes(popup) && !event.composedPath().includes(anchor)) close(false)
    }
    const onScroll = event => {
      if (event.composedPath().includes(popup)) return
      if (trackSize && event.target === anchor.closest('.li-properties')) place()
      else close(root.activeElement && popup.contains(root.activeElement))
    }
    const resize = trackSize ? new ResizeObserver(place) : null
    function close(focus = true) {
      if (!popup.isConnected) return
      resize?.disconnect()
      onClose?.()
      popup.remove()
      anchor.setAttribute('aria-expanded', 'false')
      for (const target of targets) {
        target.removeEventListener('pointerdown', outside, true)
        target.removeEventListener('scroll', onScroll, true)
      }
      viewport.removeEventListener('resize', onScroll)
      if (!parent) closeActive = () => {}
      if (focus) (anchor.isConnected ? anchor : fallbackFocus?.())?.focus({ preventScroll: true })
    }
    const container = parent ?? root
    container.append(popup)
    anchor.setAttribute('aria-expanded', 'true')
    popup.style.maxHeight = Math.max(0, viewport.innerHeight - 16) + 'px'
    if (parent && matchAnchorWidth) popup.style.width = anchor.offsetWidth + 'px'
    let rect = anchor.getBoundingClientRect()
    function place() {
      if (anchor.isConnected) rect = anchor.getBoundingClientRect()
      const width = popup.offsetWidth
      const [left, top] = position(rect, width)
      popup.style.left = Math.max(8, Math.min(left, viewport.innerWidth - width - 8)) + 'px'
      const height = Math.min(popup.scrollHeight, viewport.innerHeight - 16)
      const y = parent && top + height > viewport.innerHeight - 8 ? rect.top - height - 2 : top
      popup.style.top = Math.max(8, Math.min(y, viewport.innerHeight - height - 8)) + 'px'
    }
    place()
    resize?.observe(popup)
    for (const target of targets) {
      target.addEventListener('pointerdown', outside, true)
      target.addEventListener('scroll', onScroll, true)
    }
    viewport.addEventListener('resize', onScroll)
    if (!parent) closeActive = close
    return close
  }

  ui.mountPopup = mountPopup

  ui.openMenu = (anchor, options, current, onChoose, { label = 'Options', size = false, commands = false, parent, onPreview, onClose } = {}) => {
    const root = anchor.getRootNode()
    const menu = ui.element('div', 'li-menu' + (size ? ' li-size-menu' : ''))
    if (parent) menu.classList.add('li-settings-menu')
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', label)
    const list = ui.element('div', 'li-menu-list')
    menu.append(list)
    const buttons = options.map(([value, name, detail = {}]) => {
      if (detail.separator) {
        const divider = ui.element('div', 'li-menu-divider')
        divider.setAttribute('role', 'separator')
        list.append(divider)
      }
      const button = ui.element('button', 'li-menu-option')
      button.type = 'button'
      button.setAttribute('role', commands || detail.command ? 'menuitem' : 'menuitemradio')
      if (!commands && !detail.command) button.setAttribute('aria-checked', String(value === current))
      const check = ui.element('span', 'li-menu-check')
      if (!commands && value === current) check.append(ui.icon('menuCheck'))
      button.append(check)
      if (detail.icon) button.append(ui.icon(detail.icon))
      button.append(ui.element('span', '', name))
      if (onPreview) {
        button.onpointerenter = () => onPreview(value)
        button.onfocus = () => {
          if (!list.querySelector('.li-menu-option:hover')) onPreview(value)
        }
      }
      button.onclick = () => { close(); onChoose(value, anchor) }
      list.append(button)
      return button
    })
    if (onPreview) list.onpointerleave = () => onPreview(current)
    if (size) {
      const footer = ui.element('div', 'li-menu-scroll')
      const up = ui.action('Scroll font sizes up', 'chevronDown', () => list.scrollBy({ top: -72 }))
      const down = ui.action('Scroll font sizes down', 'chevronDown', () => list.scrollBy({ top: 72 }))
      up.classList.add('li-scroll-up')
      footer.append(up, down)
      menu.append(footer)
    }
    menu.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      // Restore the trigger before native Tab traversal, so focus advances from
      // its position rather than from the menu node we just removed.
      if (event.key === 'Tab') { close(); return }
      const controls = Array.from(menu.querySelectorAll('button'))
      const index = controls.indexOf(root.activeElement)
      const moves = { ArrowDown: (index + 1) % controls.length, ArrowUp: (index - 1 + controls.length) % controls.length }
      if (event.key in moves) { event.preventDefault(); controls[moves[event.key]].focus() }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus()
      }
    }
    const selected = Math.max(0, options.findIndex(([value]) => value === current))
    const close = mountPopup(anchor, menu, (rect, width) => [
      rect.right - width, parent ? rect.bottom + 3 : rect.top - selected * 24 - 8,
    ], { parent, onClose })
    buttons[selected]?.focus({ preventScroll: true })
    buttons[selected]?.scrollIntoView({ block: 'nearest' })
    return close
  }
})()
