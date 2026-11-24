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

function contextAddress(origin, { frame, route, expanded }) {
  if (!frame || !compatiblePage(frame.route, route)) return null
  const destination = new URL(location.pathname, origin)
  // Keep app filters in the fragment so a workspace request does not log them.
  const context = new URLSearchParams({ context: '1', frame: frame.id, page: route })
  if (expanded) context.set('view', 'canvas')
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

export function connectProposalView(comparison, read, message) {
  if (!comparison) return
  const select = document.querySelector('#proposal-view')
  select.value = comparison.role
  select.hidden = false
  select.addEventListener('change', () => {
    if (select.value === comparison.role) return
    select.value = comparison.role
    const destination = contextAddress(comparison.otherOrigin, read())
    if (!destination) {
      message('Open a mapped page to compare versions.')
      return
    }
    location.assign(destination)
  })
}
