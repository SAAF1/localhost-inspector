(() => {
  const ui = window.LocalhostInspector
  let closeActive = () => {}
  ui.closeMenu = () => closeActive()

  ui.openMenu = (anchor, options, current, onChoose, { label = 'Options', size = false, commands = false } = {}) => {
    closeActive()
    const root = anchor.getRootNode()
    const menu = ui.element('div', 'li-menu' + (size ? ' li-size-menu' : ''))
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', label)
    anchor.setAttribute('aria-expanded', 'true')
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
      button.setAttribute('role', commands ? 'menuitem' : 'menuitemradio')
      if (!commands) button.setAttribute('aria-checked', String(value === current))
      const check = ui.element('span', 'li-menu-check')
      if (!commands && value === current) check.append(ui.icon('menuCheck'))
      button.append(check)
      if (detail.icon) button.append(ui.icon(detail.icon))
      button.append(ui.element('span', '', name))
      button.onclick = () => { close(); onChoose(value) }
      list.append(button)
      return button
    })
    if (size) {
      const footer = ui.element('div', 'li-menu-scroll')
      const up = ui.action('Scroll font sizes up', 'chevronDown', () => list.scrollBy({ top: -72 }))
      const down = ui.action('Scroll font sizes down', 'chevronDown', () => list.scrollBy({ top: 72 }))
      up.classList.add('li-scroll-up')
      footer.append(up, down)
      menu.append(footer)
    }
    const close = (focus = true) => {
      menu.remove()
      anchor.setAttribute('aria-expanded', 'false')
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', reposition, true)
      closeActive = () => {}
      if (focus && anchor.isConnected) anchor.focus()
    }
    const outside = event => {
      if (!event.composedPath().includes(menu) && !event.composedPath().includes(anchor)) close(false)
    }
    const reposition = event => { if (!event.composedPath().includes(menu)) close(false) }
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
    root.append(menu)
    const rect = anchor.getBoundingClientRect()
    const selected = Math.max(0, options.findIndex(([value]) => value === current))
    const height = Math.min(menu.scrollHeight, innerHeight - 16)
    menu.style.maxHeight = (innerHeight - 16) + 'px'
    menu.style.left = Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px'
    menu.style.top = Math.max(8, Math.min(rect.top - selected * 24 - 8, innerHeight - height - 8)) + 'px'
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', reposition, true)
    closeActive = close
    buttons[selected]?.focus({ preventScroll: true })
    buttons[selected]?.scrollIntoView({ block: 'nearest' })
  }
})()
