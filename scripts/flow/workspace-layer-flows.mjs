export function createLayerFlows({ ui, onFlowPopover, onOpenOutline, warmNavigation, revealBranches }) {
  const popover = ui.element('div', 'workspace-layer-flow-overlay')
  const menu = ui.element('div', 'workspace-layer-flow-menu')
  const title = ui.element('h3', 'workspace-layer-flow-title', 'Flows')
  const list = ui.element('div', 'workspace-layer-flow-list')
  menu.append(title, list)
  const headerButton = ui.action('Show flows', 'bulletedList')
  headerButton.classList.add('workspace-layer-flow-header-button')
  headerButton.setAttribute('aria-expanded', 'false')
  headerButton.hidden = true
  menu.setAttribute('role', 'group')
  menu.setAttribute('aria-label', 'Flows and frames')
  popover.popover = 'manual'
  popover.append(menu)
  let mount
  let tree
  let options = []
  let active
  let sourceFlow
  let menuSignature
  let rows = new Map()
  let snapshot
  let markedRow
  let restoreSession
  let motion = 0
  let queued = 0
  const resize = new ResizeObserver(schedule)

  function schedule() {
    if (!queued) queued = requestAnimationFrame(layout)
  }

  function layout() {
    queued = 0
    if (!snapshot || !mount?.isConnected || headerButton.hidden) return
    const bounds = mount.getBoundingClientRect()
    popover.style.left = bounds.right + 'px'
    const buttonBounds = headerButton.getBoundingClientRect()
    title.style.height = headerButton.parentElement.offsetHeight + 'px'
    const titleCenter = title.offsetHeight / 2 + menu.clientTop
    const y = Math.max(0, buttonBounds.top + buttonBounds.height / 2 - titleCenter)
    popover.style.top = y + 'px'
    menu.style.maxHeight = Math.min(bounds.bottom, innerHeight - 3) - y + 'px'
    onFlowPopover?.(popover.getBoundingClientRect().toJSON())
  }

  function close(restore) {
    if (!snapshot) return
    warmNavigation?.(null)
    cancelAnimationFrame(motion)
    const prior = snapshot
    snapshot = null
    markPreview(null)
    revealBranches([], false)
    if (restore && mount) mount.scrollTo({ top: prior.scroll, behavior: 'instant' })
    mount?.removeAttribute('data-flow-scrolling')
    active = restore ? prior.active : active
    popover.hidePopover()
    onFlowPopover?.(null)
    headerButton.setAttribute('aria-expanded', 'false')
    document.removeEventListener('keydown', escape, true)
    schedule()
  }
  function escape(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    close(true)
    headerButton.focus({ preventScroll: true })
  }
  function open() {
    if (snapshot || !mount || headerButton.hidden) return
    const currentGroup = options.find(option => option.dataset.group !== undefined && option.dataset.flow === sourceFlow)
    if (currentGroup) currentGroup.parentElement.open = true
    capture()
    mount.setAttribute('data-flow-scrolling', '')
    headerButton.setAttribute('aria-expanded', 'true')
    for (const button of options) button.toggleAttribute('data-current',
      button.hasAttribute('data-group') && button.dataset.flow === active)
    popover.showPopover()
    layout()
    document.addEventListener('keydown', escape, true)
  }
  function capture() {
    snapshot = { scroll: mount.scrollTop, active }
  }
  function markPreview(row) {
    markedRow?.removeAttribute('data-hovered')
    markedRow = row
    markedRow?.setAttribute('data-hovered', '')
  }
  function preview(option, commit = false) {
    if (!snapshot || !option) return
    // A committed jump can repaint Layers before the next preview begins.
    if (!commit && !markedRow) capture()
    active = option.dataset.flow
    const previewPath = []
    if (!option.hasAttribute('data-group')) previewPath.push('flow:' + active)
    revealBranches(previewPath, commit)
    const row = rows.get(option.dataset.key) ?? rows.get('flow:' + active)
    if (row) {
      markPreview(row.parentElement)
      const view = mount.getBoundingClientRect()
      const rect = row.getBoundingClientRect()
      const scale = view.height / mount.offsetHeight || 1
      const viewBottom = view.top + mount.clientHeight * scale
      const rowGap = parseFloat(getComputedStyle(tree).rowGap) || 0
      const rowPitch = rect.height + rowGap * scale
      const needsScroll = rect.top < view.top || rect.top + 3 * rowPitch >= viewBottom
      const top = needsScroll ? mount.scrollTop + (rect.top + rect.height / 2 - view.top) / scale - mount.clientHeight / 2 : mount.scrollTop
      const instant = commit || matchMedia('(prefers-reduced-motion: reduce)').matches
      cancelAnimationFrame(motion)
      const start = mount.scrollTop
      const end = Math.max(0, Math.min(top, mount.scrollHeight - mount.clientHeight))
      const distance = end - start
      if (instant || Math.abs(distance) < 2) mount.scrollTop = end
      else {
        const duration = Math.min(150, 70 + Math.abs(distance) * 0.12)
        const began = performance.now()
        function step(now) {
          const progress = Math.min(1, Math.max(0, (now - began) / duration))
          mount.scrollTop = start + distance * (1 - (1 - progress) ** 3)
          if (progress < 1) motion = requestAnimationFrame(step)
        }
        motion = requestAnimationFrame(step)
      }
    }
    for (const item of options) item.toggleAttribute('data-current', item === option)
    schedule()
  }
  function choose(option) {
    preview(option, true)
    const key = option.dataset.key
    const expanded = key.startsWith('section:') || rows.get(key)?.parentElement.getAttribute('aria-expanded') === 'true'
    capture()
    markPreview(null)
    const openFlows = [...list.querySelectorAll('details[open]')].map(group => group.firstElementChild.dataset.flow)
    onOpenOutline(key, expanded, { key, menuScroll: list.scrollTop, openFlows })
  }

  function resume(session) {
    restoreSession = session
    restore()
  }

  function restore() {
    if (!restoreSession || !mount?.isConnected || !tree || headerButton.hidden) return
    const session = restoreSession
    restoreSession = null
    const option = options.find(item => item.dataset.key === session.key)
    if (!option) return
    open()
    if (Array.isArray(session.openFlows)) {
      for (const group of list.querySelectorAll('details')) group.open = session.openFlows.includes(group.firstElementChild.dataset.flow)
    }
    list.scrollTop = session.menuScroll
    preview(option, true)
    capture()
    markPreview(null)
  }

  headerButton.addEventListener('pointerenter', open)
  headerButton.onclick = () => {
    open()
    list.querySelector('[data-current]')?.focus({ preventScroll: true })
  }
  function dismissOutside(event) {
    const next = event.relatedTarget
    if (!next || !(headerButton.contains(next) || popover.contains(next))) close(true)
  }
  headerButton.addEventListener('pointerleave', dismissOutside)
  popover.addEventListener('pointerleave', dismissOutside)
  menu.addEventListener('pointerover', event => {
    const option = event.target.closest('[data-key]')
    if (option && !option.contains(event.relatedTarget)) {
      warmNavigation?.(option.dataset.key.startsWith('frame:') ? option.dataset.key.slice(6) : null)
      preview(option)
    }
  })
  menu.onfocusin = event => preview(event.target.closest('[data-key]'))
  menu.onclick = event => {
    const option = event.target.closest('[data-key]')
    if (!option) return
    if (option.tagName === 'SUMMARY') {
      event.preventDefault()
      option.parentElement.open = !option.parentElement.open
      if (!option.parentElement.open || event.target.closest('svg')) return
    }
    choose(option)
  }
  headerButton.addEventListener('focusout', event => { if (event.relatedTarget) dismissOutside(event) })
  popover.addEventListener('focusout', event => { if (event.relatedTarget) dismissOutside(event) })

  function option(flow, item, count) {
    const button = ui.element('button', 'workspace-layer-flow-option')
    button.type = 'button'
    button.dataset.flow = flow.key
    button.dataset.key = item.key
    button.append(ui.icon(item.kind === 'section' ? 'section' : 'frame'), ui.element('span', '', item.label))
    if (count) {
      const badge = ui.element('small', '', String(count))
      badge.setAttribute('aria-label', count + (count === 1 ? ' variant' : ' variants'))
      button.append(badge)
    }
    return button
  }

  function connect(nextMount, nextFlows, contextKey, nextTree, selectedKey) {
    if (nextMount !== mount) {
      cancelAnimationFrame(motion)
      mount?.removeAttribute('data-flow-scrolling')
    }
    if (nextMount !== mount || nextTree !== tree) {
      resize.disconnect()
      mount = nextMount
      tree = nextTree
      if (mount && tree) {
        // The File panel can detach its scroll container while changing screens.
        // Keep the open popover in the stable panel shadow root.
        const root = mount.getRootNode()
        if (popover.parentNode !== root) root.append(popover)
        resize.observe(mount)
      }
    }
    rows = new Map([...tree?.querySelectorAll('[data-outline-key]') ?? []]
      .map(item => [item.dataset.outlineKey, item.firstElementChild]))
    headerButton.hidden = nextFlows.length < 2
    if (headerButton.hidden) {
      close(false)
      if (options.length) list.replaceChildren()
      options = []
      menuSignature = undefined
      return
    }
    const signature = JSON.stringify(nextFlows.map(flow => [flow.key, flow.label,
      flow.items.map(item => [item.key, item.label, item.variantCount, item.children.map(child => [child.key, child.label])])]))
    if (sourceFlow !== contextKey) {
      if (!snapshot) active = contextKey
      sourceFlow = contextKey
    }
    if (signature !== menuSignature) {
      if (snapshot) close(false)
      menuSignature = signature
      list.replaceChildren()
      active = contextKey
      for (const flow of nextFlows) {
        const screens = flow.items.filter(item => item.kind === 'section' || item.key.startsWith('frame:'))
        const only = screens.length === 1 && screens[0].kind === 'frame' && screens[0]
        if (only) {
          const button = option(flow, only, only.variantCount)
          button.querySelector('svg').remove()
          button.querySelector('span').textContent = flow.label
          button.classList.add('single-flow', 'flow-group')
          list.append(button)
          continue
        }
        const group = ui.sidebarDisclosure(flow.label, 'flow-group', flow.key === contextKey)
        const heading = group.firstElementChild
        heading.dataset.group = ''
        heading.dataset.flow = flow.key
        heading.dataset.key = 'flow:' + flow.key
        const children = ui.element('div', 'flow-children')
        for (const item of screens) {
          children.append(option(flow, item, item.kind === 'section' ? item.children.length : item.variantCount))
        }
        group.append(children)
        list.append(group)
      }
      options = [...list.querySelectorAll('[data-key]')]
    }
    for (const item of options) item.toggleAttribute('data-selected', Boolean(selectedKey && item.dataset.key === selectedKey))
    if (markedRow && !markedRow.isConnected) markPreview(rows.get(markedRow.dataset.outlineKey)?.parentElement)
    restore()
    schedule()
  }
  return { headerButton, connect, resume, suspend: () => close(false) }
}
