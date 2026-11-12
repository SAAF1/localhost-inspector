(() => {
  if (!window.phaseABridge) return
  const ui = window.LocalhostInspector
  const { host, root, panel, setOpen, get } = ui.createPanel()
  const selection = ui.createSelection({ host, panel, get, onSelect: renderFields })
  const revertDialog = ui.createRevertDialog(root)
  const temporary = new Set()
  const recovery = ui.createPreviewRecovery({ apply: applyRestored, remove, canEdit })
  const fields = get('fields')
  let renderedSelection
  let busy = false
  let loadingRoute = true
  let comparing = false
  let recoveryScheduled = false
  let recoveryRequested = false
  let activeRouteVersion = 0

  function canEdit(node, property) {
    return node.isConnected && !overlayFor(node) && ui.supported(property, node)
  }
  function overlayFor(node) {
    return node?.closest('[role=menu], [role=dialog], [role=alertdialog], [role=listbox], dialog[open], :popover-open')
  }
  function renderActions() {
    const pageActionsUnavailable = busy || loadingRoute
    const parent = get('parent')
    parent.hidden = !selection.parent()
    parent.disabled = busy
    get('undo').disabled = pageActionsUnavailable || comparing || !recovery.hasSaved
    const compare = get('clear')
    compare.disabled = pageActionsUnavailable || (!comparing && !recovery.hasAttached)
    compare.setAttribute('aria-pressed', String(comparing))
    ui.setTooltip(compare, comparing ? 'Show previews' : 'Show original')
    get('comparison-mode').hidden = !comparing
    get('reset').disabled = pageActionsUnavailable || !recovery.hasSaved
  }
  function renderFields() {
    ui.dismissTooltip()
    ui.closeMenu()
    renderActions()
    const node = selection.current
    const hasSelection = Boolean(node?.isConnected)
    get('guidance').hidden = hasSelection
    if (node !== renderedSelection) {
      renderedSelection = node
      fields.replaceChildren()
    }
    if (!hasSelection) return
    if (overlayFor(node)) {
      ui.updateInspectorFields(fields, [ui.element('p', 'li-empty', 'Editing inside an open overlay is unavailable.')])
      return
    }
    const version = activeRouteVersion
    try {
      ui.renderInspector(fields, {
        node, style: getComputedStyle(node), disabled: comparing || loadingRoute, run,
        commit: async (property, requested, target = node) => {
          if (selection.current !== node || !node.isConnected || !isCurrentRoute(currentRoute, version) || loadingRoute ||
              (target !== node && (!node.contains(target) || !ui.textTargets(node).includes(target)))) {
            throw Error('Selection changed. Earlier saved changes remain available to Undo.')
          }
          await commitEdit(target, property, requested)
        },
      })
      ui.setFieldsSaving(fields, busy)
    } catch (error) {
      console.error('Localhost Inspector controls failed to render:', error)
      const message = 'Inspector controls could not load. Reload the extension and try again.'
      ui.updateInspectorFields(fields, [ui.element('p', 'li-empty', message)])
      status(message, true)
    }
  }
  function remove(entry) {
    const { node, property, prior, priorPriority, requested } = entry
    if (node.style.getPropertyValue(property) !== requested || node.style.getPropertyPriority(property) !== '') return
    if (prior) node.style.setProperty(property, prior, priorPriority)
    else node.style.removeProperty(property)
  }
  async function apply(node, property, requested, isCurrent) {
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
    const entry = { node, property, requested: declared, before: baseline, prior, priorPriority }
    temporary.add(entry)
    let observed = getComputedStyle(node).getPropertyValue(property)
    const mode = ['100%', 'fit-content'].includes(requested)
    const dimensions = property === 'width' || property === 'height'
    const changedSize = () => Math.abs(measure() - beforeSize) > 0.5
    const sameValue = () => observed === declared || observed === requested ||
      (['min-width', 'min-height'].includes(property) && requested === 'auto' && observed === '0px')
    const verified = () => mode ? changedSize() : sameValue() && (!dimensions || changedSize() || baseline === observed)
    const deadline = performance.now() + 550
    while (isCurrent() && node.isConnected && !verified() && performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      observed = getComputedStyle(node).getPropertyValue(property)
    }
    if (!isCurrent() || !node.isConnected || !verified()) {
      discardTemporary(entry)
      throw Error(dimensions ? 'The box did not resize as requested. Check its layout constraints.' : 'The browser kept a different value')
    }
    entry.observed = observed
    return entry
  }
  function discardTemporary(entry) {
    if (temporary.delete(entry)) remove(entry)
  }
  async function applyRestored(node, property, value, isCurrent) {
    const entry = await apply(node, property, value, isCurrent)
    return temporary.delete(entry) ? entry : null
  }
  const route = () => location.pathname + location.search
  const isCurrentRoute = (path, version) => path === route() && version === activeRouteVersion
  function status(message, error = false) {
    const notice = get('status')
    notice.textContent = message
    notice.toggleAttribute('data-error', error)
  }
  const send = (message) => window.phaseABridge(message)
  async function run(action) {
    if (busy || loadingRoute || currentRoute !== route()) return
    const startedRoute = route()
    const version = activeRouteVersion
    const focusedAction = root.activeElement?.closest('.li-panel-actions button')
    busy = true
    status('')
    panel.setAttribute('aria-busy', 'true')
    renderActions()
    ui.setFieldsSaving(fields, true)
    try {
      await action()
    } catch (error) {
      if (isCurrentRoute(startedRoute, version)) status(error.message, true)
    } finally {
      busy = false
      panel.setAttribute('aria-busy', 'false')
      renderFields()
      selection.syncOutline()
      queueRecovery()
      const owner = panel.ownerDocument
      if (focusedAction && !panel.hidden && !root.activeElement && owner.activeElement === owner.body) {
        const focusTarget = focusedAction.disabled || focusedAction.hidden ? panel : focusedAction
        focusTarget.focus({ preventScroll: true })
      }
    }
  }
  fields.addEventListener('click', event => {
    if (!busy || !event.target.closest?.('button')) return
    event.preventDefault()
    event.stopPropagation()
  }, true)
  const entry = get('entry')
  const closeInspector = get('close-inspector')
  function toggleInspector() {
    const open = panel.hidden
    ui.dismissTooltip()
    ui.closeMenu()
    setOpen(open)
    selection.syncOutlines()
    const focusTarget = open ? closeInspector : entry
    focusTarget.focus({ preventScroll: true })
  }
  entry.onclick = toggleInspector
  closeInspector.onclick = toggleInspector
  get('parent').onclick = () => {
    const parent = selection.parent()
    if (!parent) return
    selection.select(parent)
    if (!selection.parent()) closeInspector.focus({ preventScroll: true })
  }
  ui.bindInspectorShortcuts({ root, panel, selection, undo: get('undo'), parent: get('parent') })
  window.addEventListener('pagehide', () => { ui.dismissTooltip(); ui.closeMenu(); revertDialog.dismiss() })
  async function commitEdit(node, property, requested) {
    if (comparing || !canEdit(node, property)) return
    const editRoute = currentRoute
    const version = activeRouteVersion
    const isCurrent = () => isCurrentRoute(editRoute, version)
    const target = ui.describePreviewTarget(node)
    const entry = await apply(node, property, requested, isCurrent)
    if (!isCurrent() || !ui.matchesPreviewTarget(node, target)) {
      discardTemporary(entry)
      throw Error('Selection changed. Earlier saved changes remain available to Undo.')
    }
    const edit = {
      id: crypto.randomUUID(), route: editRoute, target, property, before: entry.before,
      requested, observed: entry.observed,
      restore: ui.findPreviewTarget(target) === node ? 'unique' : 'ambiguous',
      viewport: { width: innerWidth, height: innerHeight },
    }
    try {
      await send({ type: 'save', record: edit })
    } catch (error) {
      discardTemporary(entry)
      throw error
    }
    if (!isCurrent()) {
      discardTemporary(entry)
      if (currentRoute === editRoute) window.phaseAInspectorReady = loadRoute()
      return
    }
    if (ui.matchesPreviewTarget(node, target)) {
      temporary.delete(entry)
      recovery.remember(edit, entry)
    } else {
      discardTemporary(entry)
      recovery.remember(edit)
      recoveryRequested = true
    }
    reportRecovery()
  }
  get('undo').onclick = () => run(async () => {
    const id = recovery.lastSavedId
    if (!id || comparing) return
    const requestedRoute = currentRoute
    const version = activeRouteVersion
    await send({ type: 'undo', id })
    if (isCurrentRoute(requestedRoute, version)) {
      recovery.forget(id)
      reportRecovery()
    } else if (currentRoute === requestedRoute) {
      window.phaseAInspectorReady = loadRoute()
    }
  })
  get('clear').onclick = () => run(async () => {
    comparing = !comparing
    if (comparing) {
      recovery.showOriginal()
    } else {
      const requestedRoute = currentRoute
      const version = activeRouteVersion
      try {
        await loadSavedEdits(requestedRoute, version)
      } catch (error) {
        if (isCurrentRoute(requestedRoute, version)) comparing = true
        throw error
      }
      await restore(requestedRoute, version, true)
    }
  })
  const reset = get('reset')
  reset.onclick = async () => {
    const requestedRoute = route()
    const version = activeRouteVersion
    if (reset.disabled || !await revertDialog.confirm()) return
    if (!isCurrentRoute(requestedRoute, version) || reset.disabled) return
    closeInspector.focus({ preventScroll: true })
    await run(async () => {
      await send({ type: 'reset', route: requestedRoute })
      if (route() !== requestedRoute) return
      if (currentRoute !== requestedRoute) {
        onRouteChange()
        return
      }
      // A return visit can restore previews while the confirmed revert is pending.
      const revisit = version !== activeRouteVersion
      if (revisit) {
        const staleLoad = window.phaseAInspectorReady
        const epoch = ++activeRouteVersion
        await staleLoad
        if (!isCurrentRoute(requestedRoute, epoch)) return
      }
      comparing = false
      recovery.clear()
      if (revisit) {
        window.phaseAInspectorReady = loadRoute()
        await window.phaseAInspectorReady
      }
    })
  }
  function reportRecovery() {
    const notice = get('status')
    if (notice.hasAttribute('data-error')) return
    status(!comparing && recovery.hasUnattached ? 'Some saved previews could not be restored.' : '')
  }
  async function restore(requestedRoute, version, fromOriginal = false) {
    await recovery.restore(() => isCurrentRoute(requestedRoute, version) && !comparing, fromOriginal)
    if (isCurrentRoute(requestedRoute, version)) reportRecovery()
  }
  async function loadSavedEdits(requestedRoute, version) {
    const journal = await send({ type: 'load' })
    if (isCurrentRoute(requestedRoute, version)) {
      recovery.load(journal.filter(edit => !edit.undone && edit.route === requestedRoute))
    }
  }
  let currentRoute = route()
  async function loadRoute() {
    const requestedRoute = currentRoute
    const version = ++activeRouteVersion
    loadingRoute = true
    status('')
    recovery.clear()
    renderActions()
    try {
      await loadSavedEdits(requestedRoute, version)
      if (isCurrentRoute(requestedRoute, version)) await restore(requestedRoute, version)
    } catch (error) {
      if (isCurrentRoute(requestedRoute, version)) status(error.message, true)
    } finally {
      if (isCurrentRoute(requestedRoute, version)) {
        loadingRoute = false
        renderFields()
        queueRecovery()
      }
    }
  }
  function queueRecovery() {
    if (recoveryScheduled || !recoveryRequested || busy || loadingRoute || comparing) return
    recoveryScheduled = true
    requestAnimationFrame(() => {
      recoveryScheduled = false
      if (busy || loadingRoute || comparing || route() !== currentRoute) return
      recoveryRequested = false
      if (!recovery.needsRestore) return
      const requestedRoute = currentRoute
      const version = activeRouteVersion
      void run(() => restore(requestedRoute, version))
    })
  }
  function onRouteChange() {
    if (currentRoute === route()) return
    currentRoute = route()
    revertDialog.dismiss()
    comparing = false
    recoveryRequested = false
    for (const entry of temporary) discardTemporary(entry)
    window.phaseAInspectorReady = loadRoute()
    selection.select(null)
  }
  new MutationObserver(() => {
    onRouteChange()
    selection.refresh()
    if (!recovery.hasSaved) return
    recoveryRequested = true
    queueRecovery()
  }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['id', 'data-slot'],
  })
  window.addEventListener('popstate', onRouteChange)
  window.navigation?.addEventListener('currententrychange', onRouteChange)
  window.phaseAInspectorReady = loadRoute()
})()
