const checkPath = 'm2 5.5 3 3L10 3'

export function workspaceInspectorState(dock) {
  if (!dock.hasAttribute('data-inspector-open')) return 'closed'
  if (dock.hasAttribute('data-inspector-floating') && document.body.hasAttribute('data-expanded')) return 'floating'
  return 'docked'
}

export function connectViewControls({ apply, read, presets }) {
  const toolbar = document.querySelector('#workspace-toolbar')
  const dock = document.querySelector('#localhost-inspector-dock')
  const inspector = toolbar.querySelector('#inspector-toggle')
  const trigger = toolbar.querySelector('#frame-view-toggle')
  const menu = toolbar.querySelector('#frame-view-menu')
  const pending = toolbar.querySelector('#pending-toggle')
  const zoom = toolbar.querySelector('#zoom-control')

  function syncInspector() {
    inspector.hidden = !dock.firstElementChild
    inspector.disabled = dock.inert
    const state = workspaceInspectorState(dock)
    const open = state !== 'closed'
    const host = dock.firstElementChild
    const count = Number(host?.dataset.pendingCount) || 0
    pending.hidden = open || !count || dock.inert
    pending.querySelector('span').textContent = count
    pending.setAttribute('aria-label', 'Pending edits, ' + count)
    pending.setAttribute('aria-expanded', String(Boolean(host?.hasAttribute('data-pending-open'))))
    zoom.hidden = !open || dock.inert || !document.body.hasAttribute('data-expanded')
    inspector.setAttribute('aria-expanded', String(open))
    inspector.setAttribute('aria-label', { closed: 'Open Inspector', floating: 'Dock Inspector', docked: 'Collapse Inspector' }[state])
    if (open) document.documentElement.style.setProperty('--li-workspace-panel-width', dock.offsetWidth + 'px')
  }
  const inspectorObserver = new MutationObserver(syncInspector)
  inspectorObserver.observe(dock, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['inert', 'data-inspector-open', 'data-inspector-floating', 'data-pending-count', 'data-pending-open'],
  })
  inspectorObserver.observe(document.body, { attributes: true, attributeFilter: ['data-expanded'] })
  syncInspector()
  pending.addEventListener('click', () => dock.firstElementChild?.dispatchEvent(new Event('toggle-pending-edits')))

  function close(focus = false) {
    menu.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    if (focus && !trigger.hidden) trigger.focus()
  }

  function group(label, choices, current, onChoose) {
    const section = document.createElement('div')
    section.setAttribute('role', 'group')
    section.setAttribute('aria-label', label)
    for (const [key, name, detail, disabled] of choices) {
      const row = document.createElement('button')
      row.type = 'button'
      row.disabled = Boolean(disabled)
      row.setAttribute('role', 'menuitemradio')
      row.setAttribute('aria-checked', String(current === key))
      row.tabIndex = -1
      const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      check.classList.add('frame-view-check')
      check.setAttribute('viewBox', '0 0 12 12')
      check.setAttribute('aria-hidden', 'true')
      const path = document.createElementNS(check.namespaceURI, 'path')
      path.setAttribute('d', checkPath)
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', 'currentColor')
      check.append(path)
      const text = document.createElement('span')
      text.textContent = name
      row.append(check, text)
      if (detail) {
        const dimensions = document.createElement('span')
        dimensions.className = 'frame-view-dimensions'
        dimensions.textContent = detail
        row.append(dimensions)
      }
      row.addEventListener('click', () => { close(true); void onChoose(key) })
      section.append(row)
    }
    return section
  }

  function open(last = false) {
    const state = read()
    if (!state || trigger.getAttribute('aria-disabled') === 'true') return
    const separator = document.createElement('div')
    separator.className = 'frame-view-divider'
    separator.setAttribute('role', 'separator')
    menu.replaceChildren(
      group('Frame size', Object.entries(presets).map(([key, size]) =>
        [key, size.label, size.width + ' × ' + size.height]), state.preset, preset => apply({ preset })),
      separator,
      group('Frame height', [
        ['fixed', 'Fixed height', null, !state.mode],
        ['hug', 'Hug page contents', null, !state.canHug],
      ], state.mode, mode => apply({ mode })),
    )
    menu.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    const enabled = [...menu.querySelectorAll('button:enabled')]
    const checked = enabled.find(row => row.getAttribute('aria-checked') === 'true')
    const target = last ? enabled.at(-1) : checked ?? enabled[0]
    target?.focus()
  }
  trigger.addEventListener('click', () => { if (menu.hidden) open(); else close(true) })
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    open(event.key === 'ArrowUp')
  })
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      close(true)
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const rows = [...menu.querySelectorAll('button:enabled')]
      const index = rows.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 :
        (index + (event.key === 'ArrowUp' ? -1 : 1) + rows.length) % rows.length
      rows[next]?.focus()
    }
  })
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) close()
  }, true)
  return function sync(show, busy, showBusy) {
    trigger.hidden = !show
    trigger.setAttribute('aria-disabled', String(busy))
    trigger.toggleAttribute('data-busy', showBusy)
    if (!show || busy) close()
  }
}

const preferenceKey = 'localhost-inspector.canvas-background'
const variablePattern = /^--[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/

export function connectCanvasBackground(dock, viewport) {
  const fallback = getComputedStyle(document.documentElement).backgroundColor
  const defaults = { color: fallback, opacity: 100, visible: true }
  let paint = defaults

  function valid(value) {
    return typeof value?.color === 'string' && value.color.length <= 100 &&
      CSS.supports('color', value.color) && !/^(?:var\(|currentcolor|inherit|initial|unset|revert)/i.test(value.color) &&
      Number.isFinite(value.opacity) && value.opacity >= 0 && value.opacity <= 100 &&
      typeof value.visible === 'boolean' &&
      (value.variable === undefined || (typeof value.variable === 'string' && variablePattern.test(value.variable)))
  }

  function apply() {
    dock.dataset.canvasBackground = JSON.stringify(paint)
    const background = paint.visible
      ? 'color-mix(in srgb, ' + paint.color + ' ' + paint.opacity + '%, ' + fallback + ')'
      : fallback
    viewport.style.setProperty('--canvas-page-background', background)
    viewport.toggleAttribute('data-canvas-colored', paint.visible && paint.opacity > 0 && paint.color !== fallback)
    viewport.toggleAttribute('data-canvas-background-hidden', !paint.visible)
  }

  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey))
    if (valid(stored)) paint = stored
  } catch { /* A blocked or invalid preference leaves the default usable. */ }
  apply()

  dock.addEventListener('set-inspector-canvas-background', event => {
    if (event.target !== dock.firstElementChild || typeof event.detail !== 'string') return
    let candidate
    try { candidate = JSON.parse(event.detail) }
    catch { return }
    if (!valid(candidate)) return
    const { color, opacity, visible, variable } = candidate
    paint = { color, opacity, visible, variable }
    apply()
    try { localStorage.setItem(preferenceKey, JSON.stringify(paint)) }
    catch { /* Keep the current workspace color when storage is unavailable. */ }
  }, true)
}
