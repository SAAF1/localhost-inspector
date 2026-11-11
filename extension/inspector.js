(() => {
  if (!window.phaseABridge) return
  const ui = window.LocalhostInspector
  const { host, root, panel, get } = ui.createPanel()
  const entries = new Map()
  const history = []
  let selected
  let busy = false
  let comparing = false
  let comparison = []
  let selectionObserver
  let activeRouteVersion = 0

  const normalize = (text) => text?.trim().replace(/\s+/g, ' ') ?? ''
  function describe(node) {
    return {
      tag: node.localName,
      id: node.id || null,
      slot: node.getAttribute('data-slot'),
      text: normalize(node.innerText).slice(0, 100),
    }
  }
  function candidates(target) {
    return Array.from(document.getElementsByTagName(target.tag)).filter(node =>
      node.isConnected && (target.id ? node.id === target.id : (
        node.getAttribute('data-slot') === target.slot &&
        Boolean(target.text) && normalize(node.innerText).slice(0, 100) === target.text
      ))
    )
  }
  const supported = ui.supported
  function syncOutline() {
    const outline = get('outline')
    outline.hidden = panel.hidden || !selected?.isConnected
    if (outline.hidden) return
    const box = selected.getBoundingClientRect()
    Object.assign(outline.style, { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' })
  }
  function overlayFor(node) {
    return node?.closest('[role=menu], [role=dialog], [role=alertdialog], [role=listbox], dialog[open], :popover-open')
  }
  function renderFields() {
    ui.closeMenu()
    const fields = get('fields')
    fields.replaceChildren()
    get('parent').disabled = busy || !selected?.parentElement
    get('undo').disabled = busy || comparing || history.length === 0
    get('clear').disabled = busy
    get('reset').disabled = busy
    if (!selected?.isConnected) return
    if (overlayFor(selected)) {
      fields.append(ui.element('p', 'li-empty', 'Editing inside an open overlay is unavailable.'))
      return
    }
    const node = selected
    const version = activeRouteVersion
    try {
      ui.renderInspector(fields, {
        node, style: getComputedStyle(node), disabled: comparing || busy, run,
        commit: async (property, requested) => {
          if (selected !== node || !node.isConnected || version !== activeRouteVersion) {
            throw Error('Selection changed. Earlier saved changes remain available to Undo.')
          }
          await commitEdit(node, property, requested)
        },
      })
    } catch (error) {
      console.error('Localhost Inspector controls failed to render:', error)
      const message = 'Inspector controls could not load. Reload the extension and try again.'
      fields.replaceChildren(ui.element('p', 'li-empty', message))
      status(message)
    }
  }
  function select(node) {
    selected = node
    selectionObserver?.disconnect()
    if (node) {
      selectionObserver = new ResizeObserver(syncOutline)
      selectionObserver.observe(node)
    }
    get('target').textContent = node ? node.localName + ' · ' + normalize(node.innerText).slice(0, 36) : 'Command-click an element'
    renderFields()
    syncOutline()
  }
  window.addEventListener('scroll', syncOutline, true)
  window.addEventListener('resize', syncOutline)
  function remove(entry) {
    const { node, property, prior, priorPriority, requested } = entry
    if (node.style.getPropertyValue(property) !== requested || node.style.getPropertyPriority(property) !== '') return
    if (prior) node.style.setProperty(property, prior, priorPriority)
    else node.style.removeProperty(property)
  }
  async function apply(node, property, requested) {
    if (!CSS.supports(property, requested)) throw Error('That value is not valid for this control')
    const baseline = getComputedStyle(node).getPropertyValue(property)
    const prior = node.style.getPropertyValue(property)
    const priorPriority = node.style.getPropertyPriority(property)
    if (property === 'padding' && [...node.style].some(key => /^padding-(top|right|bottom|left)$/.test(key))) {
      throw Error('Use individual sides when padding is already set inline')
    }
    const measure = () => {
      const box = node.getBoundingClientRect()
      return property === 'height' ? box.height : box.width
    }
    const beforeSize = measure()
    node.style.setProperty(property, requested)
    const declared = node.style.getPropertyValue(property)
    let observed = getComputedStyle(node).getPropertyValue(property)
    const mode = ['100%', 'fit-content'].includes(requested)
    const dimensions = property === 'width' || property === 'height'
    const changedSize = () => Math.abs(measure() - beforeSize) > 0.5
    const sameValue = () => observed === declared || observed === requested ||
      (['min-width', 'min-height'].includes(property) && requested === 'auto' && observed === '0px')
    const verified = () => mode ? changedSize() : sameValue() && (!dimensions || changedSize() || baseline === observed)
    const deadline = performance.now() + 550
    while (node.isConnected && !verified() && performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      observed = getComputedStyle(node).getPropertyValue(property)
    }
    const entry = { node, property, input: requested, requested: declared, before: baseline, observed, prior, priorPriority }
    if (!node.isConnected || !verified()) {
      remove(entry)
      throw Error(dimensions ? 'The box did not resize as requested. Check its layout constraints.' : 'The browser kept a different value')
    }
    return entry
  }
  const route = () => location.pathname + location.search
  const status = (message) => { get('status').textContent = message }
  const send = (message) => window.phaseABridge(message)
  async function run(action) {
    if (busy) return
    busy = true
    root.querySelectorAll('input, button').forEach(control => { if (control.id !== 'entry') control.disabled = true })
    try { await action() } catch (error) { status(error.message) }
    finally { busy = false; renderFields(); syncOutline() }
  }
  get('entry').onclick = () => { ui.closeMenu(); panel.hidden = !panel.hidden; get('entry').setAttribute('aria-expanded', String(!panel.hidden)); syncOutline() }
  get('parent').onclick = () => { if (selected?.parentElement) select(selected.parentElement) }
  function isSelectionGesture(event) {
    return !panel.hidden && event.metaKey && event.button === 0 && !event.composedPath().includes(host)
  }
  function preventPress(event) {
    if (!isSelectionGesture(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  document.addEventListener('pointerdown', preventPress, true)
  document.addEventListener('mousedown', preventPress, true)
  document.addEventListener('click', event => {
    if (event.composedPath().includes(host) || panel.hidden) return
    if (!event.metaKey) { select(null); return }
    if (!isSelectionGesture(event)) return
    const node = event.composedPath().find(target => target instanceof HTMLElement)
    if (!node) return
    event.preventDefault()
    event.stopImmediatePropagation()
    select(node)
  }, true)
  async function commitEdit(node, property, requested) {
    if (comparing || !node.isConnected || overlayFor(node) || !supported(property, node)) return
    const editRoute = route()
    const version = activeRouteVersion
    const target = describe(node)
    const unique = candidates(target).length === 1
    status('Saving preview…')
    const entry = await apply(node, property, requested)
    const id = crypto.randomUUID()
    try {
      await send({ type: 'save', record: {
        id, route: editRoute, target, property, before: entry.before,
        requested, observed: entry.observed, restore: unique ? 'unique' : 'ambiguous',
        viewport: { width: innerWidth, height: innerHeight },
      } })
    } catch (error) {
      remove(entry)
      throw error
    }
    if (activeRouteVersion === version && node.isConnected) {
      entries.set(id, entry)
      history.push(id)
    } else remove(entry)
    status(unique ? 'Preview saved' : 'Preview saved · target ambiguous on reload')
  }
  get('undo').onclick = () => run(async () => {
    const id = history.at(-1)
    if (!id || comparing) return
    const entry = entries.get(id)
    status('Undoing…')
    await send({ type: 'undo', id })
    remove(entry)
    entries.delete(id)
    const index = history.lastIndexOf(id)
    if (index >= 0) history.splice(index, 1)
    status('Undone')
  })
  function clearVisible() {
    for (const entry of Array.from(entries.values()).reverse()) remove(entry)
    entries.clear()
    history.length = 0
  }
  get('clear').onclick = () => run(async () => {
    comparing = !comparing
    get('clear').textContent = comparing ? 'After' : 'Before'
    if (comparing) {
      comparison = Array.from(entries, ([id, entry]) => ({ id, entry, target: describe(entry.node) }))
      clearVisible()
    } else {
      for (const { id, entry, target } of comparison) {
        const { node, property, before, input } = entry
        if (!node.isConnected || JSON.stringify(describe(node)) !== JSON.stringify(target) ||
            getComputedStyle(node).getPropertyValue(property) !== before) continue
        entries.set(id, await apply(node, property, input))
        history.push(id)
      }
      comparison = []
      await restore(route(), activeRouteVersion)
    }
    status(comparing ? 'Original view' : 'Previews on')
  })
  get('reset').onclick = () => run(async () => {
    await send({ type: 'reset', route: route() })
    comparison = []
    clearVisible()
    status('Previews reset on this page')
  })
  async function restore(requestedRoute, version) {
    const journal = await send({ type: 'load' })
    for (const edit of journal.filter(e => !e.undone && e.route === requestedRoute)) {
      if (version !== activeRouteVersion || comparing || route() !== requestedRoute) return
      if (edit.restore !== 'unique' || entries.has(edit.id)) continue
      let matches = candidates(edit.target)
      const deadline = performance.now() + 1800
      while (route() === requestedRoute && matches.length === 0 && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 40))
        matches = candidates(edit.target)
      }
      if (version !== activeRouteVersion || comparing || route() !== requestedRoute) return
      if (matches.length !== 1) continue
      if (getComputedStyle(matches[0]).getPropertyValue(edit.property) !== edit.before) continue
      const entry = await apply(matches[0], edit.property, edit.requested)
      if (version !== activeRouteVersion || comparing || route() !== requestedRoute || !entry.node.isConnected) { remove(entry); return }
      entries.set(edit.id, entry)
      history.push(edit.id)
    }
  }
  let currentRoute = route()
  let generation = 0
  function loadRoute() {
    const requestedRoute = currentRoute
    const version = ++generation
    status('Loading previews…')
    const epoch = ++activeRouteVersion
    return (comparing ? Promise.resolve() : restore(requestedRoute, epoch)).then(() => {
      if (generation === version) { status('Ready'); renderFields() }
    }).catch(error => {
      if (generation === version) { status(error.message); renderFields() }
    })
  }
  function onRouteChange() {
    if (selected && !selected.isConnected) select(null)
    if (currentRoute === route()) return
    currentRoute = route()
    comparison = []
    clearVisible()
    select(null)
    window.phaseAInspectorReady = loadRoute()
  }
  new MutationObserver(onRouteChange).observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('popstate', onRouteChange)
  window.phaseAInspectorReady = loadRoute()
})()
