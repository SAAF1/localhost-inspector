// A proposal runs on its own loopback origin. Its app and Inspector stay in the
// same origin as each other while review and Undo remain separate from the original.
export function proposalEntry(data, query) {
  const hash = new URLSearchParams(location.hash.slice(1))
  const params = hash.get('context') === '1' ? hash : new URLSearchParams(query)
  const id = params.get('frame')
  const page = params.get('page')
  if (!data.comparison && !id) return null
  if (!id && !page) return null
  const frame = resolveProposalFrame(data.frames, id, page, location.origin)
  if (!frame) return { unavailable: true }
  return { frame: { ...frame, route: page || frame.route }, expanded: params.get('view') === 'canvas' }
}

export function resolveProposalFrame(frames, id, page, origin) {
  if (id) {
    const frame = frames.find(item => item.id === id)
    return frame && (!page || compatiblePage(frame.route, page, origin)) ? frame : null
  }
  const candidates = frames.filter(item => !item.steps?.length && compatiblePage(item.route, page, origin))
  const exact = candidates.filter(item => item.route === page)
  const matches = exact.length ? exact : candidates
  return matches.length === 1 ? matches[0] : null
}

function compatiblePage(route, page, origin = location.origin) {
  if (!page?.startsWith('/')) return false
  const basis = new URL(route, origin)
  const target = new URL(page, origin)
  if (target.origin !== origin || target.pathname !== basis.pathname) return false
  const [baseHash, baseQuery] = basis.hash.split('?')
  const [targetHash, targetQuery] = target.hash.split('?')
  const includesQuery = (next, prior) => [...prior].every(([name, value]) => next.getAll(name).includes(value))
  return targetHash === baseHash && includesQuery(target.searchParams, basis.searchParams) &&
    includesQuery(new URLSearchParams(targetQuery), new URLSearchParams(baseQuery))
}

function contextAddress(origin, { frame, route, expanded, variant }) {
  if (!frame || !compatiblePage(frame.route, route)) return null
  const destination = new URL(location.pathname, origin)
  // Keep app filters in the fragment so a workspace request does not log them.
  const context = new URLSearchParams({ context: '1', frame: frame.id, page: route })
  if (expanded) context.set('view', 'canvas')
  if (expanded && variant) context.set('variant', variant)
  destination.hash = context.toString()
  return destination
}

// Keep the address usable by the coding agent, including when normal in-app
// navigation or a same-route dialog changes the active scenario.
export function trackContext(frame, read) {
  const doc = frame.contentDocument
  if (doc.URL === 'about:blank') return
  const win = doc.defaultView
  let timer
  const syncAddress = () => {
    if (!frame.isConnected || frame.contentDocument !== doc) return
    const address = contextAddress(location.origin, read())
    if (address && address.href !== location.href) history.replaceState(history.state, '', address)
    else if (!address && location.hash.startsWith('#context=')) history.replaceState(history.state, '', location.pathname)
  }
  const update = () => {
    clearTimeout(timer)
    timer = setTimeout(syncAddress, 80)
  }
  const surfaces = 'dialog, [role=dialog], [role=alertdialog], [role=menu], [role=listbox], [role=tabpanel], h1, h2'
  const observer = new MutationObserver(changes => {
    if (changes.some(change => change.type === 'attributes' ||
        [...change.addedNodes, ...change.removedNodes].some(node => node.matches?.(surfaces) || node.querySelector?.(surfaces)))) update()
  })
  observer.observe(doc, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['open', 'aria-selected', 'aria-expanded', 'data-state'] })
  const viewObserver = new MutationObserver(syncAddress)
  viewObserver.observe(document.body, { attributes: true, attributeFilter: ['data-expanded'] })
  win.navigation?.addEventListener('currententrychange', update)
  win.addEventListener('pageshow', update)
  update()
  return () => {
    clearTimeout(timer)
    observer.disconnect()
    viewObserver.disconnect()
    win.navigation?.removeEventListener('currententrychange', update)
    win.removeEventListener('pageshow', update)
  }
}

export function addLinkedFrame(map, comparison, frame, route, gap, selectComparison) {
  const name = comparison.role === 'proposal' ? 'Original' : 'Proposal'
  const url = new URL('./linked-frame.html', new URL(location.pathname, comparison.otherOrigin))
  url.hash = new URLSearchParams({ context: '1', frame: frame.id, page: route })
  return previewFrame(map, frame.id, frame.label + ' · ' + name, name, url, gap, null, null, null, selectComparison)
}

function localPreviewUrl(route, origin) {
  if (typeof route !== 'string' || !route.startsWith('/') || typeof origin !== 'string') return
  let url
  try { url = new URL(route, origin) } catch { return }
  if (url.origin === origin && ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url
}

export function addVariantFrame(map, variant, gap, inspect) {
  if (!variant.id || !variant.label) return
  const url = localPreviewUrl(variant.route, variant.origin)
  if (!url) return
  return previewFrame(map, variant.anchor, variant.label, variant.label, url, gap, variant.id, inspect, variant)
}

function previewFrame(map, anchor, label, name, url, gap, variant, inspect, definition, selectComparison) {
  const wrapper = document.createElement('section')
  if (variant) wrapper.dataset.variant = variant
  wrapper.className = 'linked-frame'
  const title = document.createElement('h2')
  title.textContent = label
  const caption = document.createElement('header')
  caption.className = 'frame-caption'
  caption.append(title)
  if (typeof definition?.note === 'string' && definition.note.trim()) {
    const note = document.createElement('p')
    note.textContent = definition.note
    caption.append(note)
  }
  const app = document.createElement('iframe')
  app.title = name + ' preview'
  app.inert = true
  app.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals')
  let ready = false
  let point
  const inspection = variant && { variant, app, origin: url.origin, label, editable: definition?.editable === true, stop: () => stop(false) }
  if (variant) app.loading = 'lazy'
  if (variant) app.addEventListener('load', () => {
    ready = false
    app.contentWindow.postMessage('connect-canvas-wheel', url.origin)
  })
  app.src = url.href
  const cover = document.createElement('button')
  cover.type = 'button'
  cover.setAttribute('aria-label', 'Interact with ' + name)
  wrapper.append(caption, app, cover)
  map.append(wrapper)

  function stop(focus) {
    if (!app.inert && variant) {
      app.contentWindow.postMessage('stop-inspecting-variant', url.origin)
      inspect?.(inspection, 'stop')
    }
    if (!app.inert) selectComparison?.(false)
    point = undefined
    app.inert = true
    cover.hidden = false
    if (focus) cover.focus({ preventScroll: true })
  }
  function open(event) {
    selectComparison?.(true)
    if (variant) {
      const rect = app.getBoundingClientRect()
      point = event?.metaKey && event.detail ? {
        x: (event.clientX - rect.left) * app.offsetWidth / rect.width,
        y: (event.clientY - rect.top) * app.offsetHeight / rect.height,
      } : undefined
      inspect?.(inspection, 'start')
      if (ready) app.contentWindow.postMessage({ type: 'inspect-canvas-variant', point }, url.origin)
    }
    app.inert = false
    cover.hidden = true
    app.focus({ preventScroll: true })
  }
  cover.onclick = open
  if (variant) caption.addEventListener('click', () => open())
  function exit(event) {
    if (event.origin !== url.origin || event.source !== app.contentWindow) return
    if (variant && event.data === 'variant-inspection-ready') {
      ready = true
      if (inspection.editable) inspect?.(inspection, definition.hasEdits ? 'restore' : 'ready')
      if (!app.inert) {
        inspect?.(inspection, 'reload')
        app.contentWindow.postMessage({ type: 'inspect-canvas-variant', point }, url.origin)
      }
      point = undefined
      return
    }
    if (app.inert) return
    if (variant && event.data?.type === 'variant-selection') {
      point = undefined
      inspect?.(inspection, 'selection', event.data.details)
      return
    }
    if (variant && event.data?.type === 'focus-variant-layer') {
      const { x, y } = event.data
      if (Number.isFinite(x) && Number.isFinite(y)) inspect?.(inspection, 'focus-layer', { x, y })
      return
    }
    if (event.data === 'leave-linked-frame') { stop(true); return }
    const wheel = event.data
    if (wheel?.type !== 'canvas-preview-wheel' ||
        ![wheel.clientX, wheel.clientY, wheel.deltaX, wheel.deltaY].every(Number.isFinite)) return
    const rect = app.getBoundingClientRect()
    wrapper.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaX: wheel.deltaX, deltaY: wheel.deltaY,
      ctrlKey: wheel.ctrlKey, metaKey: wheel.metaKey,
      clientX: rect.left + wheel.clientX * rect.width / app.offsetWidth,
      clientY: rect.top + wheel.clientY * rect.height / app.offsetHeight,
    }))
  }
  function outside(event) {
    if (!app.inert && !wrapper.contains(event.target) &&
        !(variant && event.composedPath().some(node => node.matches?.('#workspace-sidebar,#variant-properties')))) stop(false)
  }
  window.addEventListener('message', exit)
  document.addEventListener('pointerdown', outside, true)

  return {
    id: anchor,
    variant, label, open,
    get section() { return wrapper.closest('.variant-section') },
    placeIn(parent) {
      if (wrapper.parentElement !== parent) parent.moveBefore(wrapper, null)
    },
    bounds: null,
    get captionHeight() { return caption.offsetHeight },
    setPreviewOrigin(origin) {
      const next = localPreviewUrl(url.pathname + url.search + url.hash, origin)
      if (!variant || !next || next.origin === url.origin) return
      stop(false)
      ready = false
      inspect?.(inspection, 'dispose')
      url = next
      inspection.origin = next.origin
      app.src = next.href
    },
    place(card, column) {
      const x = card.x + (card.width + gap) * column
      this.bounds = { ...card, x }
      Object.assign(wrapper.style, { left: x + 'px',
        top: card.y + card.labelHeight + 'px', width: card.width + 'px', height: card.height + 'px' })
    },
    remove() {
      if (inspection) inspect?.(inspection, 'dispose')
      window.removeEventListener('message', exit)
      document.removeEventListener('pointerdown', outside, true)
      wrapper.remove()
    },
  }
}
