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
  let journalRevision = null
  let colorCatalog = null
  let spacingCatalog = null

  function canEdit(node, property) {
    return node.isConnected && !overlayFor(node) && ui.supported(property, node)
  }
  function overlayFor(node) {
    return node?.closest('[role=menu], [role=dialog], [role=alertdialog], [role=listbox], dialog[open], :popover-open')
  }
  function renderActions() {
    const pageActionsUnavailable = busy || loadingRoute
    const writesUnavailable = pageActionsUnavailable || journalRevision === null
    const parent = get('parent')
    parent.hidden = !selection.parent()
    parent.disabled = busy
    get('undo').disabled = writesUnavailable || comparing || !recovery.hasSaved
    const compare = get('clear')
    compare.disabled = pageActionsUnavailable || (!comparing && !recovery.hasAttached)
    compare.setAttribute('aria-pressed', String(comparing))
    ui.setTooltip(compare, comparing ? 'Show previews' : 'Show original')
    get('comparison-mode').hidden = !comparing
    get('reset').disabled = writesUnavailable || !recovery.hasSaved
  }
  function renderFields({ keepPopup = false } = {}) {
    ui.dismissTooltip()
    if (!keepPopup) ui.closeMenu()
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
        node, style: getComputedStyle(node), disabled: comparing || loadingRoute || journalRevision === null, run, colorCatalog, spacingCatalog,
        pendingColorFor: target => recovery.pendingColorFor(target),
        commit: async (property, requested, target = node, tokenOptions) => {
          if (selection.current !== node || !node.isConnected || !isCurrentRoute(currentRoute, version) || loadingRoute || journalRevision === null ||
              (target !== node && (!node.contains(target) || !ui.textTargets(node).includes(target)))) {
            throw Error('Selection changed. Earlier saved changes remain available to Undo.')
          }
          await commitEdit(target, property, requested, tokenOptions)
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
    const { node, property, prior, priorPriority } = entry
    if (!ui.ownsPreviewDeclaration(entry)) return
    if (prior) node.style.setProperty(property, prior, priorPriority)
    else node.style.removeProperty(property)
  }
  async function apply(node, property, requested, isCurrent, { colorToken, pendingColor, spacingToken } = {}) {
    if (colorToken && (
      !ui.supportsColorVariable(node, property) || requested !== ui.colorVariableValue(colorToken.name) ||
      colorToken.source !== colorCatalog?.source || !colorCatalog.names.includes(colorToken.name) ||
      !ui.resolveColorVariable(node, colorToken.name)
    )) throw Error('This color variable is unavailable for the selected color.')
    if (pendingColor && (
      property !== 'background-color' || !ui.supportsColorVariable(node, property) ||
      pendingColor.source !== colorCatalog?.source || requested !== pendingColor.value
    )) throw Error('The color source is unavailable.')
    if (spacingToken && (
      requested !== ui.spacingVariableValue(spacingToken.name) ||
      spacingToken.source !== spacingCatalog?.source || !spacingCatalog.names.includes(spacingToken.name) ||
      !ui.supportsSpacingVariable(node, property) || ui.resolveSpacingLength(node, spacingToken.name) === null
    )) throw Error('This spacing variable is unavailable for the selected field.')
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
    const entry = { node, property, requested: declared, before: baseline, prior, priorPriority, colorToken, pendingColor, spacingToken }
    temporary.add(entry)
    let observed = getComputedStyle(node).getPropertyValue(property)
    const mode = ['100%', 'fit-content'].includes(requested)
    const dimensions = property === 'width' || property === 'height'
    const changedSize = () => Math.abs(measure() - beforeSize) > 0.5
    const sameValue = () => observed === declared || observed === requested ||
      (['min-width', 'min-height'].includes(property) && requested === 'auto' && observed === '0px')
    const verified = () => {
      if (colorToken) return ui.ownsPreviewDeclaration(entry) && observed === ui.resolveColorVariable(node, colorToken.name)
      if (spacingToken) return ui.ownsPreviewDeclaration(entry) && ui.spacingVariableMatches(node, property, spacingToken.name, observed)
      if (mode) return changedSize()
      return sameValue() && (!dimensions || changedSize() || baseline === observed)
    }
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
  async function applyRestored(node, edit, isCurrent) {
    const entry = await apply(node, edit.property, edit.requested, isCurrent, edit)
    return temporary.delete(entry) ? entry : null
  }
  const route = () => {
    const { pathname, search, hash } = location
    const routeFragment = /^#!?\//.test(hash) ? hash : ''
    return pathname + search + routeFragment
  }
  const isCurrentRoute = (path, version) => path === route() && version === activeRouteVersion
  function status(message, error = false) {
    const notice = get('status')
    notice.textContent = message
    notice.toggleAttribute('data-error', error)
  }
  const send = (message) => window.phaseABridge(message)
  async function write(message, path, version) {
    if (journalRevision === null || !isCurrentRoute(path, version)) throw Error('Reload the page and try again.')
    try {
      const result = await send({ ...message, expectedRevision: journalRevision })
      if (!Number.isSafeInteger(result?.revision)) throw Error('Reload the page with the updated local helper.')
      if (isCurrentRoute(path, version)) journalRevision = result.revision
    } catch (error) {
      if (error.code === 'WRITE_REJECTED') throw error
      // A stale write or a lost acknowledgment requires a fresh snapshot.
      if (isCurrentRoute(path, version)) journalRevision = null
      else if (currentRoute === path) window.phaseAInspectorReady = loadRoute()
      if (error.code === 'STALE_JOURNAL') throw error
      throw Error('Could not confirm the change. Reload the page before editing again.', { cause: error })
    }
  }
  async function run(action, { background = false, keepPopup = false, rethrow = false } = {}) {
    if (busy || loadingRoute || currentRoute !== route()) {
      if (rethrow) throw Error('The inspector is busy.')
      return
    }
    const startedRoute = route()
    const version = activeRouteVersion
    const focusedAction = root.activeElement?.closest('.li-panel-actions button')
    busy = true
    if (!background) status('')
    panel.setAttribute('aria-busy', 'true')
    renderActions()
    ui.setFieldsSaving(fields, true)
    try {
      return await action()
    } catch (error) {
      if (isCurrentRoute(startedRoute, version)) status(error.message, true)
      if (rethrow) throw error
    } finally {
      busy = false
      panel.setAttribute('aria-busy', 'false')
      renderFields({ keepPopup })
      selection.syncOutline()
      recoveryRequested ||= recovery.hasStyleConflict()
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
  async function commitEdit(node, property, requested, tokenOptions) {
    if (comparing || !canEdit(node, property)) {
      if (tokenOptions) throw Error('The selected property cannot be edited.')
      return
    }
    const editRoute = currentRoute
    const version = activeRouteVersion
    const isCurrent = () => isCurrentRoute(editRoute, version)
    const target = ui.describePreviewTarget(node)
    const entry = await apply(node, property, requested, isCurrent, tokenOptions)
    if (!isCurrent() || !ui.matchesPreviewTarget(node, target)) {
      discardTemporary(entry)
      throw Error('Selection changed. Earlier saved changes remain available to Undo.')
    }
    const edit = {
      id: crypto.randomUUID(), route: editRoute, target, property, before: entry.before,
      requested, observed: entry.observed, ...tokenOptions,
      restore: ui.findPreviewTarget(target, node) === node ? 'unique' : 'ambiguous',
      viewport: { width: innerWidth, height: innerHeight },
    }
    try {
      await write({ type: 'save', record: edit }, editRoute, version)
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
    await write({ type: 'undo', id }, requestedRoute, version)
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
      const priorRevision = journalRevision
      try {
        const revision = await loadSavedEdits(requestedRoute, version)
        if (revision === null || !isCurrentRoute(requestedRoute, version)) return
        await restore(requestedRoute, version, revision === priorRevision)
        if (isCurrentRoute(requestedRoute, version)) journalRevision = revision
      } catch (error) {
        if (isCurrentRoute(requestedRoute, version)) comparing = true
        throw error
      }
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
      await write({ type: 'reset', route: requestedRoute }, requestedRoute, version)
      if (currentRoute !== requestedRoute || route() !== requestedRoute) return
      comparing = false
      if (isCurrentRoute(requestedRoute, version)) recovery.clear()
      else {
        window.phaseAInspectorReady = loadRoute()
        await window.phaseAInspectorReady
      }
    })
  }
  function reportRecovery() {
    const notice = get('status')
    if (notice.hasAttribute('data-error')) return
    const message = comparing ? '' : recovery.hasConflicts
      ? 'The app changed a previewed style. Your edit is still saved.'
      : recovery.hasUnattached ? 'Some saved previews could not be restored.' : ''
    if (notice.textContent !== message) status(message)
  }
  async function restore(requestedRoute, version, fromOriginal = false) {
    await recovery.restore(() => isCurrentRoute(requestedRoute, version) && !comparing, fromOriginal)
    if (isCurrentRoute(requestedRoute, version)) reportRecovery()
  }
  async function loadSavedEdits(requestedRoute, version) {
    const snapshot = await send({ type: 'load' })
    if (!isCurrentRoute(requestedRoute, version)) return null
    if (!Number.isSafeInteger(snapshot?.revision) || !Array.isArray(snapshot.edits)) {
      throw Error('Restart the local helper with the updated Inspector.')
    }
    recovery.load(snapshot.edits.filter(edit => !edit.undone && edit.route === requestedRoute))
    return snapshot.revision
  }
  let currentRoute = route()
  async function loadRoute() {
    const requestedRoute = currentRoute
    const version = ++activeRouteVersion
    loadingRoute = true
    journalRevision = null
    colorCatalog = null
    spacingCatalog = null
    status('')
    for (const entry of temporary) discardTemporary(entry)
    recovery.clear()
    renderActions()
    try {
      const [revision, catalog, spacing] = await Promise.all([
        loadSavedEdits(requestedRoute, version),
        send({ type: 'colorCatalog' }).catch(() => null),
        send({ type: 'spacingCatalog' }).catch(() => null),
      ])
      if (revision === null || !isCurrentRoute(requestedRoute, version)) return
      colorCatalog = catalog
      spacingCatalog = spacing
      await restore(requestedRoute, version)
      if (isCurrentRoute(requestedRoute, version)) journalRevision = revision
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
      void run(() => restore(requestedRoute, version), { background: true })
    })
  }
  function onRouteChange() {
    if (currentRoute === route()) return
    currentRoute = route()
    revertDialog.dismiss()
    comparing = false
    recoveryRequested = false
    window.phaseAInspectorReady = loadRoute()
    selection.select(null)
  }
  new MutationObserver(records => {
    onRouteChange()
    selection.refresh()
    const styleChanges = records.filter(record => ['style', 'class', 'data-theme'].includes(record.attributeName))
    const node = selection.current
    if ((colorCatalog || spacingCatalog) && !busy && !loadingRoute && node &&
      styleChanges.some(record => record.target.contains(node) || node.contains(record.target))) {
      const targets = [node, ...ui.textTargets(node)]
      if (fields.querySelector('.li-spacing-variable-pill') || targets.some(target => ['background-color', 'color', 'border-color', 'gap'].some(
        property => target.style.getPropertyValue(property).startsWith('var('),
      ))) renderFields({ keepPopup: true })
    }
    if (!recovery.hasSaved) return
    recoveryRequested ||= styleChanges.length !== records.length ||
      (!busy && !loadingRoute && !comparing && recovery.hasStyleConflict(styleChanges))
    queueRecovery()
  }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['id', 'data-slot', 'data-inspector-target', 'style', 'class', 'data-theme'],
  })
  function refreshResponsiveSpacing() {
    const node = selection.current
    if (!node || busy || loadingRoute) return
    const pills = fields.querySelectorAll('.li-spacing-variable-pill')
    if (!pills.length) return
    const style = getComputedStyle(node)
    if (Array.from(pills).some(pill => pill.dataset.spacingProperties.split(' ').some(property =>
      style.getPropertyValue(property) !== pill.textContent + 'px',
    ))) renderFields({ keepPopup: true })
  }
  window.addEventListener('resize', refreshResponsiveSpacing)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshResponsiveSpacing)
  window.addEventListener('popstate', onRouteChange)
  window.addEventListener('hashchange', onRouteChange)
  window.navigation?.addEventListener('currententrychange', onRouteChange)
  window.phaseAInspectorReady = loadRoute()
})()
