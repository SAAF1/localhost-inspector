(() => {
  if (!window.phaseABridge) return
  const ui = window.LocalhostInspector
  const { host, root, panel, setOpen, get } = ui.createPanel()
  const isCanvasExpanded = window.localhostInspectorIsCanvasExpanded
  const isFloating = () => host.parentElement?.hasAttribute('data-inspector-floating')
  const selection = ui.createSelection({
    host, panel, get,
    onSelect: () => {
      if (!selection.current && isFloating()) setOpen(false)
      renderSelection()
    },
    inspect: () => editsUI.showDesign(),
    openPanel: () => setOpen(true, isCanvasExpanded?.()),
  })
  function renderSelection() {
    renderFields()
    const node = selection.current
    const key = buttonSizeKey
    const path = currentRoute
    const version = activeRouteVersion
    const size = ui.buttonSize.currentSize(node, key)
    if (!size || buttonSizeRequiresReload || confirmedButton === node) return
    void ui.buttonSize.setSize(node, key, size, size, path).then(confirmed => {
      if (confirmed && !buttonSizeRequiresReload && selection.current === node && isCurrentRoute(path, version)) {
        confirmedButton = node
        renderFields({ keepPopup: true })
      }
    }).catch(() => {})
  }
  const revertDialog = ui.createRevertDialog(root)
  const temporary = new Set()
  const recovery = ui.createPreviewRecovery({
    apply: applyRestored, remove, canEdit,
    removeButtonSize: entry => ui.buttonSize.setSize(entry.node, entry.target.key, entry.requested, entry.before, entry.path),
  })
  const fields = get('fields')
  let renderedSelection
  let scopeHovered = false
  let busy = false
  let loadingRoute = true
  let comparing = false
  let recoveryScheduled = false
  let recoveryRequested = false
  let activeRouteVersion = 0
  let evidenceVersion = 0
  let journalRevision = null
  let colorCatalog = null
  let spacingCatalog = null
  let textStyleCatalog = null
  let textStyleUnavailable = false
  let buttonSizeKey = null
  let confirmedButton = null
  let pendingButtonSize = false
  let buttonSizeRequiresReload = false
  let pendingRows = []
  let savedRoute
  let scopedPreviewTargets = false
  let refreshing = false
  let editNavigation = 0
  const editDestinationKey = 'localhost-inspector.pending-destination'
  const editsUI = ui.createPendingEdits({
    host, root, panel, get,
    locate: id => recovery.previewNode(id),
    openEdit: goToEdit,
    removeEdit: id => run(() => removeJournalEdit(id)),
    refresh: refreshJournal,
    highlight: id => selection.previewRelated(id ? () => recovery.previewNode(id) : null),
  })

  function syncPending() {
    editsUI.update(pendingRows, savedRoute)
  }

  async function goToEdit(edit) {
    const navigation = ++editNavigation
    status('')
    if (edit.route === savedRoute) {
      if (await selectEditTarget(edit.id, navigation)) {
        if (panel.hidden) setOpen(true, isCanvasExpanded?.())
        if (isCanvasExpanded?.()) openEditRoute(route())
        selection.syncOutlines()
        return true
      }
      if (navigation !== editNavigation || edit.route !== savedRoute) return false
      if (isCanvasExpanded?.()) {
        if (edit.frameState && rememberEditDestination(edit)) {
          if (!openEditRoute(route(), edit.frameState)) return true
          sessionStorage.removeItem(editDestinationKey)
        }
        openEditRoute(route())
      }
      status('Couldn’t locate the element for this edit.', true)
      return false
    }
    const address = new URL(edit.route, location.origin)
    if (address.origin !== location.origin || edit.route.includes('?')) {
      status('Open the page in the app to locate this edit.', true)
      return false
    }
    if (!rememberEditDestination(edit)) {
      status('Open the page in the app to locate this edit.', true)
      return false
    }
    if (openEditRoute(edit.route, edit.frameState)) location.assign(address.href)
    return true
  }

  function rememberEditDestination({ id, route }) {
    try {
      sessionStorage.setItem(editDestinationKey, JSON.stringify({ id, route }))
      return true
    } catch { return false }
  }

  function openEditRoute(path, frameState) {
    const detail = frameState ? JSON.stringify({ path, frameState }) : path
    return host.dispatchEvent(new CustomEvent('open-inspector-edit-route', { cancelable: true, detail }))
  }

  async function selectEditTarget(id, navigation) {
    const path = currentRoute
    const version = activeRouteVersion
    const isCurrent = () => navigation === editNavigation && isCurrentRoute(path, version)
    const node = await recovery.locateSavedNode(id, isCurrent)
    if (!node?.isConnected || !isCurrent() || !node.getClientRects().length ||
        getComputedStyle(node).visibility !== 'visible') return false
    node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    selection.select(node)
    return true
  }

  async function pickDestination() {
    let destination
    try { destination = JSON.parse(sessionStorage.getItem(editDestinationKey)) }
    catch { return }
    if (destination?.route !== savedRoute) return
    sessionStorage.removeItem(editDestinationKey)
    if (!pendingRows.some(edit => edit.id === destination.id)) return
    if (panel.hidden) setOpen(true, isCanvasExpanded?.())
    editsUI.showEdits()
    const navigation = ++editNavigation
    if (await selectEditTarget(destination.id, navigation)) editsUI.markSelected(destination.id)
    else if (navigation === editNavigation && destination.route === savedRoute) {
      status('Opened the page. Couldn’t locate the element for this edit.', true)
    }
  }

  async function refreshJournal() {
    if (refreshing || busy || loadingRoute) return
    const path = currentRoute
    const version = activeRouteVersion
    const startedRevision = journalRevision
    refreshing = true
    try {
      const snapshot = await send({ type: 'load', route: path })
      if (busy || !isCurrentRoute(path, version) || journalRevision !== startedRevision || snapshot?.revision === journalRevision) return
      if (!validSnapshot(snapshot)) throw Error('Invalid journal snapshot')
      if (startedRevision !== null && recovery.matchesSnapshot(snapshot.edits.filter(edit => edit.route === snapshot.route))) {
        acceptSnapshot(snapshot)
        journalRevision = snapshot.revision
        syncPending()
        return
      }
      if (recovery.hasAttachedButtonSize) {
        pendingRows = Array.isArray(snapshot.pending) ? snapshot.pending : pendingRows
        journalRevision = null
        status('Saved edits changed. Reload the page to refresh the Button preview.', true)
        syncPending()
        renderActions()
        return
      }
      window.phaseAInspectorReady = loadRoute()
      await window.phaseAInspectorReady
    } catch {
      if (isCurrentRoute(path, version)) status('Could not refresh pending edits from the local helper.', true)
    } finally { refreshing = false }
  }

  async function removeJournalEdit(id) {
    if (comparing) return
    if (recovery.hasUnverifiedDependentPreview(id)) {
      throw Error('A newer live preview changes the same setting. Remove the newer edit first.')
    }
    const path = currentRoute
    const version = activeRouteVersion
    const entries = recovery.buttonEntries(id)
    let result
    const persist = async () => { result = await write({ type: 'removeEdit', id }, path, version) }
    if (entries.length) await rewindButtonSizes(entries, path, version, persist)
    else await persist()
    if (!isCurrentRoute(path, version)) return
    await recovery.removeOperation(id, result.rebased ?? [], () => isCurrentRoute(path, version))
    if (isCurrentRoute(path, version)) reportRecovery()
  }

  function canEdit(node, property) {
    return node.isConnected && !overlayFor(node) && (property === 'button-size'
      ? Boolean(ui.buttonSize.currentSize(node, buttonSizeKey)) : ui.supported(property, node))
  }
  function overlayFor(node) {
    const overlay = node?.closest('[role=menu], [role=dialog], [role=alertdialog], [role=listbox], dialog[open], :popover-open')
    // The canvas panel sits outside the app document and its dialog focus trap.
    return window.localhostInspectorIsCanvasExpanded?.() && overlay?.matches('[role=dialog]')
      ? null : overlay
  }
  function renderActions() {
    const pageActionsUnavailable = busy || loadingRoute
    const writesUnavailable = pageActionsUnavailable || journalRevision === null
    const parent = get('parent')
    parent.hidden = !selection.parent()
    parent.disabled = busy
    const undo = get('undo')
    const compare = get('clear')
    const reset = get('reset')
    undo.disabled = writesUnavailable || comparing || !recovery.hasSaved
    compare.disabled = pageActionsUnavailable || (!comparing && !recovery.hasAttached)
    reset.disabled = writesUnavailable || !recovery.hasSaved
    const pageBusy = pageActionsUnavailable ? 'Wait for the current page to finish updating' : ''
    const saveUnavailable = pageBusy || (journalRevision === null ? 'Reload to reconnect to saved edits' : '')
    const pendingReason = saveUnavailable || (!recovery.hasSaved ? 'No saved edits on this page' : '')
    const undoShortcut = undo.getAttribute('aria-keyshortcuts') === 'Meta+Z' ? '⌘Z' : 'Ctrl+Z'
    ui.setTooltip(undo, pendingReason || (comparing ? 'Show previews to undo an edit' : 'Undo last preview (' + undoShortcut + ')'))
    compare.setAttribute('aria-pressed', String(comparing))
    const compareLabel = comparing ? 'Show previews' : 'Show original'
    compare.setAttribute('aria-label', compareLabel)
    ui.setTooltip(compare, pageBusy || (compare.disabled ? 'No live previews on this page to compare' : compareLabel))
    ui.setTooltip(reset, pendingReason || 'Revert saved edits on this page')
    get('comparison-mode').hidden = !comparing
    editsUI.setDisabled(writesUnavailable || comparing)
  }
  function renderFields({ keepPopup = false } = {}) {
    ui.dismissTooltip()
    if (!keepPopup) ui.closeMenu()
    renderActions()
    const node = selection.current
    const hasSelection = Boolean(node?.isConnected)
    const canvasPaint = isCanvasExpanded?.() && ui.syncCanvasBackground(host, colorCatalog)
    const canvasSection = !hasSelection && ui.canvasBackgroundSection({
      host, colorCatalog, paint: canvasPaint, refresh: () => renderFields({ keepPopup: true }), status,
    })
    get('guidance').hidden = hasSelection || Boolean(canvasSection)
    const name = get('selected-name')
    name.hidden = !hasSelection
    get('parent').parentElement.parentElement.toggleAttribute('data-no-selection', !hasSelection)
    if (hasSelection) {
      const label = node.getAttribute('aria-label') || (node.matches('a, button, h1, h2, h3, label') && node.textContent.trim()) ||
        node.getAttribute('data-slot') || ({ div: 'Container', span: 'Text', tr: 'Row', td: 'Cell' }[node.localName] ?? node.localName)
      name.textContent = label.charAt(0).toUpperCase() + label.slice(1)
    }
    if (node !== renderedSelection) {
      scopeHovered = false
      renderedSelection = node
      fields.replaceChildren()
    }
    if (!hasSelection) {
      ui.updateInspectorFields(fields, canvasSection ? [canvasSection] : [])
      return
    }
    if (overlayFor(node)) {
      ui.updateInspectorFields(fields, [ui.element('p', 'li-empty', 'Editing inside an open overlay is unavailable.')])
      return
    }
    const version = activeRouteVersion
    const sharedPadding = paddingMembers(node)
    try {
      ui.renderInspector(fields, {
        node, style: getComputedStyle(node), disabled: comparing || loadingRoute || journalRevision === null, run, colorCatalog, spacingCatalog,
        paddingCount: sharedPadding.length,
        previewRelated: resolve => selection.previewRelated(resolve && (() =>
          selection.current === node ? resolve() : null)),
        selectRelated: target => {
          if (selection.current !== node || !target?.isConnected || target.ownerDocument !== document) return
          selection.select(target)
          panel.focus({ preventScroll: true })
        },
        hasPaddingPreview: recovery.hasVerticalPaddingPreview(node),
        commitPaddingPair: (axis, requested, options) => commitPaddingPair(node, version, axis, sharedPadding, requested, options),
        pendingColorFor: target => recovery.pendingColorFor(target),
        textStyleCatalog, textStyleUnavailable,
        pendingTextStyles: recovery.pendingTextStyles(),
        pendingTextStyleFor: target => recovery.pendingTextStyleFor(target),
        createTextStyle: (targets, draft) => commitTextStyle(node, version, targets, null, draft),
        buttonSize: !buttonSizeRequiresReload && confirmedButton === node ? ui.buttonSize.currentSize(node, buttonSizeKey) : null,
        commitButtonSize: async size => {
          pendingButtonSize = true
          try { await commitButtonSize(node, version, size) }
          finally { pendingButtonSize = false }
        },
        commitTextStyle: (targets, name) => commitTextStyle(node, version, targets, name),
        commit: async (property, requested, target = node, tokenOptions) => {
          if (selection.current !== node || !node.isConnected || !isCurrentRoute(currentRoute, version) || loadingRoute || journalRevision === null ||
              (target !== node && (!node.contains(target) || !ui.textTargets(node).includes(target)))) {
            throw Error('Selection changed. Earlier saved changes remain available to Undo.')
          }
          await commitEdit(target, property, requested, tokenOptions)
        },
      })
      if (!fields.querySelector('button.li-padding-scope')) {
        scopeHovered = false
        selection.showRelated(false)
      }
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
  async function apply(node, property, requested, isCurrent, { colorToken, pendingColor, spacingToken, textStyleToken, pendingTextStyle } = {}) {
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
    if (textStyleToken && (
      !ui.textStyleProperties.includes(property) || requested !== ui.textStyleReference(textStyleToken.name, property) ||
      textStyleToken.source !== textStyleCatalog?.source || !textStyleCatalog.names.includes(textStyleToken.name) ||
      !ui.supportsTextStyle(node) || !ui.textStyleValues(node, textStyleToken.name)
    )) throw Error('This text style is unavailable for the selected text.')
    if (pendingTextStyle && (
      !ui.textStyleProperties.includes(property) ||
      requested !== ui.textStyleReference(pendingTextStyle.name, property, pendingTextStyle.values[property]) ||
      pendingTextStyle.source !== textStyleCatalog?.source || !ui.supportsTextStyle(node)
    )) throw Error('This text style preview is unavailable for the selected text.')
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
    const entry = { node, property, requested: declared, before: baseline, prior, priorPriority, colorToken, pendingColor, spacingToken, textStyleToken, pendingTextStyle }
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
      if (textStyleToken || pendingTextStyle) return ui.ownsPreviewDeclaration(entry) && ui.textStyleMatches(
        observed, pendingTextStyle?.values[property] ?? ui.textStyleValues(node, textStyleToken.name)?.[property],
      )
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
    if (edit.property === 'button-size') {
      const path = currentRoute
      if (!isCurrent()) return null
      pendingButtonSize = true
      try {
        if (!await ui.buttonSize.setSize(node, edit.target.key, edit.before, edit.requested, path)) return null
        return { node, ...edit, liveTarget: ui.describePreviewTarget(node), path }
      } finally { pendingButtonSize = false }
    }
    const entry = await apply(node, edit.property, edit.requested, isCurrent, edit)
    entry.liveTarget = ui.describePreviewTarget(node)
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
    const pendingNotice = get('pending-status')
    pendingNotice.textContent = error ? message : ''
    pendingNotice.toggleAttribute('data-error', error)
  }
  const send = (message) => window.phaseABridge(message)
  async function write(message, path, version) {
    if (journalRevision === null || !isCurrentRoute(path, version)) throw Error('Reload the page and try again.')
    try {
      const result = await send({ ...message, expectedRevision: journalRevision })
      if (!Number.isSafeInteger(result?.revision)) throw Error('Reload the page with the updated local helper.')
      if (isCurrentRoute(path, version)) {
        journalRevision = result.revision
        if (Array.isArray(result.pending)) pendingRows = result.pending
      }
      return result
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
    evidenceVersion++
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
      const actionView = focusedAction?.closest('#pending-view') ?? panel
      if (focusedAction && !actionView.hidden && !root.activeElement && owner.activeElement === owner.body) {
        const focusTarget = focusedAction.disabled || focusedAction.hidden ? actionView : focusedAction
        focusTarget.focus({ preventScroll: true })
      }
    }
  }
  fields.addEventListener('click', event => {
    if (!busy || !event.target.closest?.('button')) return
    event.preventDefault()
    event.stopPropagation()
  }, true)
  const scopeButton = target => target?.closest?.('button.li-padding-scope')
  for (const [event, active] of [['pointerover', true], ['pointerout', false]]) {
    fields.addEventListener(event, e => {
      if (e.pointerType === 'touch' || !scopeButton(e.target) || scopeButton(e.relatedTarget)) return
      scopeHovered = active
      selection.showRelated(active || Boolean(scopeButton(root.activeElement)))
    })
  }
  for (const event of ['focusin', 'focusout']) {
    fields.addEventListener(event, e => {
      if (!scopeButton(e.target)) return
      selection.showRelated(event === 'focusin' || scopeHovered)
    })
  }
  fields.addEventListener('keydown', event => {
    if (event.key === 'Escape' && scopeButton(event.target)) {
      event.stopPropagation()
      scopeHovered = false
      panel.focus({ preventScroll: true })
      selection.showRelated(false)
    }
  })
  const entry = get('entry')
  const closeInspector = get('close-inspector')
  function toggleInspector(moveFocus = true) {
    const canvas = isCanvasExpanded?.()
    const open = panel.hidden || (canvas && isFloating())
    const floating = !open && canvas && Boolean(selection.current)
    ui.dismissTooltip()
    ui.closeMenu()
    setOpen(open || floating, floating)
    selection.syncOutlines()
    if (moveFocus) (open ? closeInspector : entry).focus({ preventScroll: true })
  }
  entry.onclick = toggleInspector
  closeInspector.onclick = toggleInspector
  if (host.hasAttribute('data-workspace-toolbar')) {
    new MutationObserver(() => renderFields()).observe(host.parentElement, {
      attributes: true, attributeFilter: ['data-canvas-page'],
    })
    host.addEventListener('toggle-workspace-inspector', () => toggleInspector(false))
    host.addEventListener('clear-workspace-selection', event => {
      if (root.querySelector('dialog[open]')) event.preventDefault()
      else if (selection.current || isFloating()) selection.select(null)
    })
  }
  get('parent').onclick = () => {
    const parent = selection.parent()
    if (!parent) return
    selection.select(parent)
    if (!selection.parent()) {
      const focusTarget = host.hasAttribute('data-workspace-toolbar') ? panel : closeInspector
      focusTarget.focus({ preventScroll: true })
    }
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
    const sourceContext = ui.describeSourceContext(node)
    const selected = selection.current
    const evidence = ++evidenceVersion
    const entry = await apply(node, property, requested, isCurrent, tokenOptions)
    entry.liveTarget = target
    if (!isCurrent() || !ui.matchesPreviewTarget(node, target)) {
      discardTemporary(entry)
      throw Error('Selection changed. Earlier saved changes remain available to Undo.')
    }
    let edit, captureEnabled
    try {
      edit = await editRecord(entry, target, { editRoute, sourceContext, tokenOptions })
      const result = await write({ type: 'save', record: edit }, editRoute, version)
      captureEnabled = result.visualEvidence === true
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
      if (captureEnabled) {
        ui.captureEditEvidence?.(node, panel, edit, () => evidence === evidenceVersion && isCurrent() &&
          selection.current === selected && ui.matchesPreviewTarget(node, target) && ui.ownsPreviewDeclaration(entry))
      }
    } else {
      discardTemporary(entry)
      recovery.remember(edit)
      recoveryRequested = true
    }
    reportRecovery()
  }
  function paddingMembers(node) {
    const members = ui.sharedPadding.members(node)
    return members.every(peer => ui.sharedPadding.properties.every(property =>
      canEdit(peer, property) && ui.supportsSpacingVariable(peer, property),
    )) ? members : []
  }

  async function commitPaddingPair(selected, version, axis, sharedMembers, requested, options) {
    const editRoute = currentRoute
    const isCurrent = () => isCurrentRoute(editRoute, version) && selection.current === selected
    if (!isCurrent() || comparing || !selected.isConnected || journalRevision === null) {
      throw Error('Selection changed. Try the edit again.')
    }
    const shared = axis === 'vertical' && sharedMembers.length > 0
    const members = shared ? sharedMembers : [selected]
    const properties = axis === 'vertical' ? ui.sharedPadding.properties : ['padding-left', 'padding-right']
    const sharedPadding = shared ? selected.getAttribute(ui.sharedPadding.attribute) : undefined
    function sameMembers() {
      if (axis !== 'vertical') return true
      const current = paddingMembers(selected)
      return current.length === sharedMembers.length &&
        sharedMembers.every(node => current.includes(node)) &&
        (!shared || selected.getAttribute(ui.sharedPadding.attribute) === sharedPadding)
    }
    if (!sameMembers()) throw Error('The shared rows changed. Try the edit again.')
    if (options?.spacingToken && members.every(node => properties.every(property =>
      node.style.getPropertyValue(property) === requested && ui.spacingVariableMatches(node, property, options.spacingToken.name),
    ))) return
    const entries = []
    const targets = new Map([selected, ...members.filter(peer => peer !== selected)].map(node => [node, {
      target: ui.describePreviewTarget(node), sourceContext: ui.describeSourceContext(node),
    }]))
    const evidence = ++evidenceVersion
    let records, captureEnabled
    try {
      for (const [node, { target }] of targets) {
        for (const property of properties) {
          if (!canEdit(node, property)) throw Error('The selected padding cannot be edited.')
          const entry = await apply(node, property, requested, isCurrent, options)
          entry.liveTarget = target
          entries.push(entry)
        }
      }
      records = await Promise.all(entries.map(async entry => ({
        ...await editRecord(entry, entry.liveTarget, {
          editRoute, sourceContext: targets.get(entry.node).sourceContext, tokenOptions: options,
        }),
        sharedPadding,
      })))
      if (!isCurrent() || !sameMembers() || !entries.every(entry => ui.ownsPreviewDeclaration(entry) &&
          ui.matchesPreviewTarget(entry.node, entry.liveTarget)) ||
          (shared && !ui.sharedPadding.matchesGroup(records))) throw Error('The padding target changed. Try the edit again.')
      const type = shared ? 'saveSharedPadding' : 'savePairedPadding'
      captureEnabled = (await write({ type, records }, editRoute, version)).visualEvidence === true
    } catch (error) {
      for (const entry of entries.reverse()) discardTemporary(entry)
      throw error
    }
    const attached = isCurrent() && sameMembers() && entries.every(entry => ui.ownsPreviewDeclaration(entry) &&
      ui.matchesPreviewTarget(entry.node, entry.liveTarget)) && (!shared || ui.sharedPadding.matchesGroup(records))
    if (!attached) for (const entry of [...entries].reverse()) discardTemporary(entry)
    if (!isCurrentRoute(editRoute, version)) {
      if (currentRoute === editRoute) window.phaseAInspectorReady = loadRoute()
      return
    }
    records.forEach((record, index) => {
      const entry = entries[index]
      if (attached) temporary.delete(entry)
      recovery.remember({ ...record, group: records[0].id }, attached ? entry : undefined)
    })
    if (attached && captureEnabled) {
      ui.captureEditEvidence?.(selected, panel, records[0], () => evidence === evidenceVersion &&
        isCurrent() && selection.current === selected && entries.every(ui.ownsPreviewDeclaration))
    }
    recoveryRequested ||= !attached
    reportRecovery()
  }
  async function editRecord(entry, target, { editRoute, sourceContext, tokenOptions }) {
    if (isCanvasExpanded?.()) host.dispatchEvent(new Event('capture-inspector-edit-state'))
    const capturedState = host.dataset.editFrameState
    delete host.dataset.editFrameState
    const frameState = /^[a-f0-9]{64}$/.test(capturedState) ? capturedState : undefined
    const journalTarget = target.anchor && !scopedPreviewTargets
      ? { tag: target.tag, id: target.id, slot: target.slot, key: target.key }
      : target
    return {
      id: crypto.randomUUID(), route: editRoute, target: await ui.previewTargetForJournal(journalTarget), property: entry.property, before: entry.before,
      requested: entry.requested, observed: entry.observed, ...tokenOptions,
      restore: ui.findPreviewTarget(journalTarget, entry.node) === entry.node ? 'unique' : 'ambiguous',
      viewport: { width: innerWidth, height: innerHeight }, frameState,
      intent: 'feature-template', sourceContext,
    }
  }

  async function commitButtonSize(node, version, requested) {
    const path = currentRoute
    const key = buttonSizeKey
    const isCurrent = () => isCurrentRoute(path, version)
    const before = ui.buttonSize.currentSize(node, key)
    if (buttonSizeRequiresReload || !before || confirmedButton !== node || !isCurrent() || selection.current !== node || comparing || !canEdit(node, 'button-size')) {
      throw Error('The registered Button is no longer available.')
    }
    if (requested === before) return
    if (!await ui.buttonSize.setSize(node, key, before, requested, path)) {
      throw Error('The registered Button did not confirm its new Size.')
    }
    const target = { tag: 'button', id: null, slot: 'button', key }
    const edit = { id: crypto.randomUUID(), route: path, target, property: 'button-size', before, requested, restore: 'session' }
    try {
      if (!isCurrent() || selection.current !== node) throw Error('Selection changed. Choose the Button Size again.')
      await write({ type: 'saveButtonSize', record: edit }, path, version)
    } catch (error) {
      if (isCurrent() && !await ui.buttonSize.setSize(node, key, requested, before, path).catch(() => false)) {
        buttonSizeRequiresReload = true
        throw Error('The edit could not be saved or restored. Reload the page before editing again.', { cause: error })
      }
      throw error
    }
    if (isCurrent()) recovery.remember(edit, { ...edit, node, liveTarget: target, path })
    else if (currentRoute === path) window.phaseAInspectorReady = loadRoute()
    reportRecovery()
  }

  // Run only for attached component previews. CSS-only actions stay synchronous.
  async function rewindButtonSizes(entries, path, version, persist = () => {}) {
    const restored = []
    try {
      for (const entry of entries) {
        if (!isCurrentRoute(path, version)) throw Error('The page changed. Try again on the current page.')
        const key = entry.target.key
        if (ui.buttonSize.currentSize(entry.node, key) !== entry.requested) {
          buttonSizeRequiresReload = true
          throw Error('The registered Button changed. Reload the page before editing it again.')
        }
        if (!await ui.buttonSize.setSize(entry.node, key, entry.requested, entry.before, path)) {
          throw Error('The registered Button did not confirm its restored Size.')
        }
        restored.push(entry)
      }
      await persist()
    } catch (error) {
      if (isCurrentRoute(path, version)) {
        for (const entry of restored.reverse()) {
          await ui.buttonSize.setSize(entry.node, entry.target.key, entry.before, entry.requested, path).catch(() => false)
        }
      }
      throw error
    }
  }

  function pendingTextStyleForDraft(selected, targets, { label, description = '', values }) {
    if (!textStyleCatalog?.canCreate) throw Error('The text style source is unavailable for creation.')
    if (targets.length !== 1 || selected !== targets[0] ||
        ui.textStyleName(selected, textStyleCatalog) || recovery.pendingTextStyleFor(selected)) {
      throw Error('Select one text layer with no applied style.')
    }
    if (typeof label !== 'string' || !/^[a-z][a-z0-9 -]{0,69}$/i.test(label) || label !== label.trim()) {
      throw Object.assign(Error('Use a name starting with a letter. Use letters, numbers, spaces or hyphens.'), { field: 'name' })
    }
    if (typeof description !== 'string' || description.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) {
      throw Object.assign(Error('Keep the description to 240 characters.'), { field: 'description' })
    }
    const current = ui.captureTextStyle(selected)
    if (!current || ui.textStyleProperties.some(property => current[property] !== values?.[property])) {
      throw Error('The selected typography changed. Reopen Create style to capture it again.')
    }
    const name = '--text-' + label.toLowerCase().replace(/ +/g, '-')
    const computed = getComputedStyle(selected)
    if (textStyleCatalog.names.includes(name) || ui.textStyleProperties.some(property =>
      computed.getPropertyValue(name + '-' + property).trim(),
    )) throw Object.assign(Error('That style name is already in use.'), { field: 'name' })
    return { name, label, description, values: current, source: textStyleCatalog.source }
  }

  async function commitTextStyle(selected, version, targets, name, draft) {
    const editRoute = currentRoute
    const isCurrent = () => isCurrentRoute(editRoute, version)
    const currentTargets = ui.textTargets(selected)
    if (!isCurrent() || comparing || journalRevision === null || selection.current !== selected ||
        !targets.length || targets.length !== currentTargets.length || targets.some((node, index) => node !== currentTargets[index])) {
      throw Error('Selection changed. Choose the text style again.')
    }
    if (targets.length * ui.textStyleProperties.length > 50) throw Error('Select up to 10 text elements.')
    const registered = textStyleCatalog?.names.includes(name)
    const pendingTextStyle = draft ? pendingTextStyleForDraft(selected, targets, draft)
      : name !== null && !registered && targets.length === 1 && targets[0] === selected
        ? recovery.pendingTextStyles().find(style => style.name === name && style.source === textStyleCatalog?.source)
        : null
    if (name !== null && !registered && !pendingTextStyle) throw Error('This text style is unavailable.')
    const tokenOptions = registered ? { textStyleToken: { source: textStyleCatalog.source, name } } : undefined
    const updates = targets.flatMap(node => {
      if (!pendingTextStyle && (name === null ? !ui.textStyleName(node, textStyleCatalog) &&
          !recovery.pendingTextStyleFor(node) : !ui.textStyleValues(node, name))) {
        throw Error('This text style is unavailable for the selected text.')
      }
      const computed = getComputedStyle(node)
      const target = ui.describePreviewTarget(node)
      const sourceContext = ui.describeSourceContext(node)
      return ui.textStyleProperties.flatMap(property => {
        const requested = pendingTextStyle ? ui.textStyleReference(pendingTextStyle.name, property, pendingTextStyle.values[property])
          : name === null ? computed.getPropertyValue(property) : ui.textStyleReference(name, property)
        return node.style.getPropertyValue(property) === requested && node.style.getPropertyPriority(property) === ''
          ? [] : [{ node, property, requested, target, sourceContext }]
      })
    })
    if (!updates.length) return
    const entries = []
    const evidence = ++evidenceVersion
    let records, captureEnabled
    try {
      for (const { node, property, requested, target } of updates) {
        if (!isCurrent() || !canEdit(node, property)) throw Error('The selected text cannot be edited.')
        const entry = await apply(node, property, requested, isCurrent, pendingTextStyle ? { pendingTextStyle } : tokenOptions)
        entry.liveTarget = target
        entries.push(entry)
      }
      if (!isCurrent() || updates.some(({ node, target }) => !ui.matchesPreviewTarget(node, target))) {
        throw Error('Selection changed. Choose the text style again.')
      }
      records = await Promise.all(entries.map((entry, index) => {
        const { target, sourceContext } = updates[index]
        const options = pendingTextStyle && index === 0
          ? draft ? { pendingTextStyle } : { pendingTextStyleName: pendingTextStyle.name }
          : tokenOptions
        return editRecord(entry, target, { editRoute, sourceContext, tokenOptions: options })
      }))
      if (pendingTextStyle && (!isCurrent() || selection.current !== selected ||
          entries.some(entry => !ui.ownsPreviewDeclaration(entry)))) {
        throw Error('Selection changed. Choose the text style again.')
      }
      captureEnabled = (await write({ type: 'saveTextStyle', records }, editRoute, version)).visualEvidence === true
    } catch (error) {
      for (const entry of entries.reverse()) discardTemporary(entry)
      if (pendingTextStyle && error.message === 'That style name is already in use.') error.field = 'name'
      throw error
    }
    const current = isCurrent()
    const attached = current && updates.every(({ node, target }) => ui.matchesPreviewTarget(node, target)) &&
      (!pendingTextStyle || entries.every(entry => ui.ownsPreviewDeclaration(entry) &&
        ui.textStyleMatches(getComputedStyle(entry.node).getPropertyValue(entry.property), pendingTextStyle.values[entry.property])))
    if (!attached) {
      for (const entry of [...entries].reverse()) discardTemporary(entry)
    }
    if (!current) {
      if (currentRoute === editRoute) window.phaseAInspectorReady = loadRoute()
      return
    }
    records.forEach((record, index) => {
      const entry = entries[index]
      if (attached) temporary.delete(entry)
      recovery.remember({ ...record, group: records[0].id }, attached ? entry : undefined)
    })
    if (attached && captureEnabled) {
      ui.captureEditEvidence?.(selected, panel, records[0], () => evidence === evidenceVersion &&
        isCurrent() && selection.current === selected && entries.every(ui.ownsPreviewDeclaration))
    }
    recoveryRequested ||= !attached
    reportRecovery()
    return pendingTextStyle
  }

  get('undo').onclick = () => run(async () => {
    const id = recovery.lastSavedId
    if (!id || comparing) return
    const requestedRoute = currentRoute
    const version = activeRouteVersion
    const entries = recovery.buttonEntries(id)
    const persist = () => write({ type: 'undo', id }, requestedRoute, version)
    if (entries.length) await rewindButtonSizes(entries, requestedRoute, version, persist)
    else await persist()
    if (isCurrentRoute(requestedRoute, version)) {
      recovery.forget(id)
      reportRecovery()
    } else if (currentRoute === requestedRoute) {
      window.phaseAInspectorReady = loadRoute()
    }
  })
  get('clear').onclick = () => run(async () => {
    if (!comparing) {
      const path = currentRoute
      const version = activeRouteVersion
      const entries = recovery.buttonEntries()
      if (entries.length) await rewindButtonSizes(entries, path, version)
      if (!isCurrentRoute(path, version)) return
      comparing = true
      recovery.showOriginal()
      syncPending()
    } else {
      comparing = false
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
    get(panel.hidden ? 'pending-order' : 'edits-tab').focus({ preventScroll: true })
    await run(async () => {
      const entries = recovery.buttonEntries()
      const persist = () => write({ type: 'reset', route: requestedRoute }, requestedRoute, version)
      if (entries.length) await rewindButtonSizes(entries, requestedRoute, version, persist)
      else await persist()
      if (currentRoute !== requestedRoute || route() !== requestedRoute) return
      comparing = false
      if (isCurrentRoute(requestedRoute, version)) {
        recovery.clear()
        syncPending()
      } else {
        window.phaseAInspectorReady = loadRoute()
        await window.phaseAInspectorReady
      }
    })
  }
  function reportRecovery() {
    syncPending()
    const notice = get('status')
    if (notice.hasAttribute('data-error')) return
    const message = buttonSizeRequiresReload ? 'Reload the page to clear the previous Button Size preview.' :
      comparing ? '' : recovery.hasConflicts
      ? 'The app changed a previewed style. Your edit is still saved.'
      : recovery.hasUnattached ? 'Some saved previews could not be restored.' :
        recovery.hasSessionPreview ? 'Some previews last only while this page stays open.' : ''
    if (notice.textContent !== message) status(message)
  }
  async function restore(requestedRoute, version, fromOriginal = false) {
    await recovery.restore(() => isCurrentRoute(requestedRoute, version) && !comparing, fromOriginal)
    if (isCurrentRoute(requestedRoute, version)) reportRecovery()
  }
  function validSnapshot(snapshot) {
    return Number.isSafeInteger(snapshot?.revision) && Array.isArray(snapshot.edits) && typeof snapshot.route === 'string'
  }
  function acceptSnapshot(snapshot) {
    buttonSizeKey = typeof snapshot.buttonSizeKey === 'string' ? snapshot.buttonSizeKey : null
    savedRoute = snapshot.route
    scopedPreviewTargets = snapshot.scopedPreviewTargets === true
    if (Array.isArray(snapshot.pending)) pendingRows = snapshot.pending
  }
  async function loadSavedEdits(requestedRoute, version) {
    const snapshot = await send({ type: 'load', route: requestedRoute })
    if (!isCurrentRoute(requestedRoute, version)) return null
    if (!validSnapshot(snapshot)) throw Error('Restart the local helper with the updated Inspector.')
    acceptSnapshot(snapshot)
    recovery.load(snapshot.edits.filter(edit => edit.route === snapshot.route))
    return snapshot.revision
  }
  let currentRoute = route()
  async function loadRoute() {
    const requestedRoute = currentRoute
    const version = ++activeRouteVersion
    loadingRoute = true
    journalRevision = null
    scopedPreviewTargets = false
    colorCatalog = null
    spacingCatalog = null
    textStyleCatalog = null
    textStyleUnavailable = false
    buttonSizeKey = null
    confirmedButton = null
    status('')
    for (const entry of temporary) discardTemporary(entry)
    recovery.clear()
    renderActions()
    try {
      const [revision, catalog, spacing, textStyles] = await Promise.all([
        loadSavedEdits(requestedRoute, version),
        send({ type: 'colorCatalog' }).catch(() => null),
        send({ type: 'spacingCatalog' }).catch(() => null),
        send({ type: 'textStyleCatalog' }).then(catalog => ({ catalog }), () => ({ catalog: null, unavailable: true })),
      ])
      if (revision === null || !isCurrentRoute(requestedRoute, version)) return
      colorCatalog = catalog
      spacingCatalog = spacing
      textStyleCatalog = textStyles.catalog
      textStyleUnavailable = Boolean(textStyles.unavailable)
      await restore(requestedRoute, version)
      if (isCurrentRoute(requestedRoute, version)) journalRevision = revision
    } catch (error) {
      if (isCurrentRoute(requestedRoute, version)) status(error.message, true)
    } finally {
      if (isCurrentRoute(requestedRoute, version)) {
        loadingRoute = false
        syncPending()
        await pickDestination()
        if (isCurrentRoute(requestedRoute, version)) {
          renderSelection()
          queueRecovery()
        }
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
    buttonSizeRequiresReload ||= pendingButtonSize || recovery.hasAttachedButtonSize
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
    const scopeChanged = records.some(record => record.type === 'childList' ||
      [ui.sharedPadding.attribute, 'data-inspector-target', 'hidden'].includes(record.attributeName))
    const selected = selection.current
    if (scopeChanged && !busy && !loadingRoute && selected?.parentElement &&
      (selected.hasAttribute(ui.sharedPadding.attribute) || fields.querySelector('button.li-padding-scope')) &&
      records.some(record => record.target === selected || record.target === selected.parentElement ||
        record.target.parentElement === selected.parentElement)) renderFields({ keepPopup: true })
    const styleChanges = records.filter(record => ['style', 'class', 'data-theme'].includes(record.attributeName))
    const node = selection.current
    if (isCanvasExpanded?.() && colorCatalog && styleChanges.some(record =>
      record.target === document.documentElement || record.target === document.body)) {
      if (fields.querySelector('.li-canvas-section')) renderFields({ keepPopup: true })
      else ui.syncCanvasBackground(host, colorCatalog)
    }
    if ((colorCatalog || spacingCatalog || textStyleCatalog) && !busy && !loadingRoute && node &&
      styleChanges.some(record => record.target.contains(node) || node.contains(record.target))) {
      const targets = [node, ...ui.textTargets(node)]
      if (fields.querySelector('.li-spacing-variable-pill') || targets.some(target => ['background-color', 'color', 'border-color', 'gap', 'font-family'].some(
        property => target.style.getPropertyValue(property).startsWith('var('),
      ))) renderFields({ keepPopup: true })
    }
    if (!recovery.hasSaved) return
    recoveryRequested ||= styleChanges.length !== records.length || recovery.hasTargetClassChange(styleChanges) ||
      (!busy && !loadingRoute && !comparing && recovery.hasStyleConflict(styleChanges))
    queueRecovery()
  }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['id', 'data-slot', 'data-inspector-target', 'role', 'style', 'class', 'data-theme', 'hidden', ui.sharedPadding.attribute],
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
  window.addEventListener('focus', () => void refreshJournal())
  window.addEventListener('resize', refreshResponsiveSpacing)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    refreshResponsiveSpacing()
    if (!isCanvasExpanded?.() || !colorCatalog) return
    if (fields.querySelector('.li-canvas-section')) renderFields({ keepPopup: true })
    else ui.syncCanvasBackground(host, colorCatalog)
  })
  window.addEventListener('popstate', onRouteChange)
  window.addEventListener('hashchange', onRouteChange)
  window.navigation?.addEventListener('currententrychange', onRouteChange)
  window.phaseAInspectorReady = loadRoute()
})()
