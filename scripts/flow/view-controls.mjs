const checkPath = 'm2 5.5 3 3L10 3'

// A browser pinch can magnify the page independently of the canvas camera.
// Keep the workspace controls inside the part of the layout actually on screen.
export function followVisibleViewport() {
  const view = window.visualViewport
  if (!view) return
  const root = document.documentElement
  function sync() {
    const magnified = view.scale > 1.001
    root.toggleAttribute('data-magnified', magnified)
    if (!magnified) return
    root.style.setProperty('--visible-left', view.offsetLeft + 'px')
    root.style.setProperty('--visible-top', view.offsetTop + 'px')
    root.style.setProperty('--visible-right', Math.max(0, root.clientWidth - view.offsetLeft - view.width) + 'px')
    // Controls keep their normal on-screen size as the browser magnifies the canvas.
    root.style.setProperty('--chrome-scale', 1 / view.scale)
    root.style.setProperty('--chrome-height', view.height * view.scale + 'px')
    root.style.setProperty('--chrome-width', view.width * view.scale + 'px')
    root.style.setProperty('--visible-bottom', Math.max(0, innerHeight - view.offsetTop - view.height) + 'px')
  }
  view.addEventListener('resize', sync)
  view.addEventListener('scroll', sync)
  sync()
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
    const variantOpen = dock.hasAttribute('data-variant-inspection')
    const open = variantOpen || dock.hasAttribute('data-inspector-open')
    const host = dock.firstElementChild
    inspector.hidden = false
    inspector.disabled = !document.body.hasAttribute('data-workspace-ready') || (Boolean(host) && dock.inert && !open)
    const count = Number(host?.dataset.pendingCount) || 0
    pending.hidden = open || !count || dock.inert
    pending.querySelector('span').textContent = count
    pending.setAttribute('aria-label', 'Pending edits, ' + count)
    pending.setAttribute('aria-expanded', String(Boolean(host?.hasAttribute('data-pending-open'))))
    zoom.hidden = !open || (!variantOpen && dock.inert) || !document.body.hasAttribute('data-expanded')
    inspector.setAttribute('aria-expanded', String(open))
    inspector.setAttribute('aria-label', open ? 'Collapse Inspector' : host || document.body.hasAttribute('data-canvas-editor') ? 'Open Inspector' : 'Connect Inspector')
    if (open && !variantOpen) document.documentElement.style.setProperty('--li-workspace-panel-width', dock.offsetWidth + 'px')
  }
  const inspectorObserver = new MutationObserver(syncInspector)
  inspectorObserver.observe(dock, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['inert', 'data-inspector-open', 'data-variant-inspection', 'data-pending-count', 'data-pending-open'],
  })
  inspectorObserver.observe(document.body, { attributes: true, attributeFilter: ['data-expanded', 'data-workspace-ready'] })
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
  let target
  const overrides = new Map()
  let canvasPaint = defaults
  let paint = defaults

  function valid(value) {
    return typeof value?.color === 'string' && value.color.length <= 100 &&
      CSS.supports('color', value.color) && !/^(?:var\(|currentcolor|inherit|initial|unset|revert)/i.test(value.color) &&
      Number.isFinite(value.opacity) && value.opacity >= 0 && value.opacity <= 100 &&
      typeof value.visible === 'boolean' &&
      (value.variable === undefined || (typeof value.variable === 'string' && variablePattern.test(value.variable)))
  }

  function surfaceColor(paint) {
    if (!paint) return null
    if (!paint.visible) return 'transparent'
    return 'color-mix(in srgb, ' + paint.color + ' ' + paint.opacity + '%, transparent)'
  }

  function render(paint) {
    if (target) {
      target.render(surfaceColor(paint))
      return
    }
    const background = paint.visible
      ? 'color-mix(in srgb, ' + paint.color + ' ' + paint.opacity + '%, ' + fallback + ')'
      : fallback
    viewport.style.setProperty('--canvas-page-background', background)
    viewport.toggleAttribute('data-canvas-colored', paint.visible && paint.opacity > 0 && paint.color !== fallback)
    viewport.toggleAttribute('data-canvas-background-hidden', !paint.visible)
  }

  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey))
    if (valid(stored)) canvasPaint = paint = stored
  } catch { /* A blocked or invalid preference leaves the default usable. */ }
  function apply() {
    dock.dataset.canvasBackground = JSON.stringify(paint)
    render(target ? overrides.get(target.key) : paint)
  }
  apply()
  dock.addEventListener('preview-inspector-canvas-color', event => {
    if (event.target !== dock.firstElementChild) return
    if (event.detail === null) render(target ? overrides.get(target.key) : paint)
    else {
      const preview = { ...paint, color: event.detail }
      if (valid(preview)) render(preview)
    }
  }, true)

  dock.addEventListener('set-inspector-canvas-background', event => {
    if (event.target !== dock.firstElementChild || typeof event.detail !== 'string') return
    let candidate
    try { candidate = JSON.parse(event.detail) }
    catch { return }
    if (!valid(candidate)) return
    const { color, opacity, visible, variable } = candidate
    paint = { color, opacity, visible, variable }
    if (target) overrides.set(target.key, paint)
    else canvasPaint = paint
    apply()
    try { localStorage.setItem(target ? preferenceKey + '/' + target.key : preferenceKey, JSON.stringify(paint)) }
    catch { /* Keep the current workspace color when storage is unavailable. */ }
  }, true)
  function restore(surface) {
    if (!surface.loadedGeometry) {
      surface.loadedGeometry = true
      try {
        surface.savedGeometry = JSON.parse(localStorage.getItem(preferenceKey + '/geometry/' + surface.key)) ?? {}
        updateGeometry(surface, surface.savedGeometry)
      } catch { /* Preserve the fitted geometry without storage. */ }
    }
    if (!overrides.has(surface.key)) {
      try {
        const stored = JSON.parse(localStorage.getItem(preferenceKey + '/' + surface.key))
        if (valid(stored)) overrides.set(surface.key, stored)
      } catch { /* The original fill remains usable without storage. */ }
    }
    const saved = overrides.get(surface.key)
    if (saved && target?.key !== surface.key) surface.render(surfaceColor(saved))
  }
  function syncGeometry() {
    if (!target) { delete dock.dataset.surfaceGeometry; return }
    const style = getComputedStyle(target.element)
    const bounds = target.bounds
    const geometry = { width: bounds ? bounds.right - bounds.left : target.element.offsetWidth,
      height: bounds ? bounds.bottom - bounds.top : target.element.offsetHeight,
      radius: parseFloat(style.borderTopLeftRadius), stroke: style.borderTopColor, weight: parseFloat(style.borderTopWidth) }
    const encoded = JSON.stringify(geometry)
    if (dock.dataset.surfaceGeometry !== encoded) dock.dataset.surfaceGeometry = encoded
  }
  function updateGeometry(surface, values) {
    const { radius, stroke, weight, width, height } = values ?? {}
    const size = value => Number.isFinite(value) && value >= 0 && value <= 8192
    if (size(radius)) surface.element.style.borderRadius = radius + 'px'
    if (size(weight)) surface.element.style.borderWidth = weight + 'px'
    if (typeof stroke === 'string' && valid({ ...defaults, color: stroke })) surface.element.style.borderColor = stroke
    if (surface.resize && ((size(width) && width >= 1) || (size(height) && height >= 1))) {
      surface.resize(size(width) && width >= 1 ? width : undefined, size(height) && height >= 1 ? height : undefined)
    }
  }
  dock.addEventListener('set-inspector-surface-geometry', event => {
    if (!target || event.target !== dock.firstElementChild) return
    const request = JSON.parse(event.detail)
    if (request.key !== target.key) return
    const values = { ...target.savedGeometry, ...request.changes }
    updateGeometry(target, request.changes)
    target.savedGeometry = values
    try { localStorage.setItem(preferenceKey + '/geometry/' + target.key, JSON.stringify(values)) } catch { /* session only */ }
    syncGeometry()
  }, true)
  const observer = new ResizeObserver(syncGeometry)
  function select(surface) {
    if (target?.key === surface?.key) return
    render(target ? overrides.get(target.key) : canvasPaint)
    observer.disconnect()
    target = surface
    if (surface) observer.observe(surface.element)
    syncGeometry()
    paint = surface ? overrides.get(surface.key) ?? { ...defaults, color: surface.color() } : canvasPaint
    dock.dataset.canvasPaintKind = surface?.kind ?? 'Canvas'
    dock.dataset.canvasPaintTarget = surface?.key ?? ''
    apply()
  }
  function savedSurfaceKeys() {
    const keys = new Set(overrides.keys())
    try {
      for (const key of Object.keys(localStorage)) {
        const prefix = preferenceKey + '/'
        if (key.startsWith(prefix)) keys.add(key.slice(prefix.length).replace(/^geometry\//, ''))
      }
    } catch { /* Storage can be unavailable. */ }
    return keys
  }
  return { restore, select, savedSurfaceKeys }
}
