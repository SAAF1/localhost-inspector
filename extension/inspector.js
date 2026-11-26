(() => {
  if (!window.phaseABridge) return
  const dock = window.localhostInspectorDock
  // The extension and the built-in editor can request the same document.
  // Keep the mounted editor, along with its selection, when it already owns this dock.
  if (dock && !document.dispatchEvent(new Event('check-workspace-inspector', { cancelable: true }))) return
  const ui = window.LocalhostInspector
  const { host, root, panel, setOpen, get } = ui.createPanel()
  if (dock) document.addEventListener('check-workspace-inspector', event => {
    if (dock.firstElementChild === host && host.isConnected) event.preventDefault()
  })
  const isCanvasExpanded = window.localhostInspectorIsCanvasExpanded
  const selection = ui.createSelection({
    host, panel, get,
    relatedPadding: () => paddingOutlineMembers,
    onHover(node) {
      if (host.isConnected && host.hasAttribute('data-workspace-toolbar')) {
        (node || document).dispatchEvent(new Event('workspace-inspector-hover', { bubbles: true, composed: true }))
      }
    },
    onSelect: () => {
      if (!host.isConnected) return
      renderSelection()
      if (host.hasAttribute('data-workspace-toolbar')) {
        const target = selection.current?.isConnected ? selection.current : document
        ui.dispatchNodeList(target, 'workspace-inspector-selection', selection.group)
      }
    },
    inspect: () => editsUI.showDesign(),
    openPanel: () => setOpen(true),
  })
  let discovered
  let componentRead = 0
  let hasOlderComponentOverrides = false
  let currentComponent
  let catalogRequest
  async function getCatalog(refresh) {
    if (!refresh && discovered && !catalogRequest) return discovered
    catalogRequest ??= send({ type: 'variablesCatalog' }).then(result => {
      discovered = result
      return result
    }).catch(() => discovered).finally(() => { catalogRequest = null })
    return catalogRequest
  }
  async function inspectSelectedComponent(node, route) {
    const request = ++componentRead
    currentComponent = null
    const contract = node && ui.preparedPreview.contract(node)
    if (!contract?.input && !node?.matches('[data-inspector-instance],[data-inspector-component]')) return
    let component
    if (node.hasAttribute('data-inspector-component')) {
      const registered = await ui.inspectComponent(node, route)
      if (registered) component = { ...registered, properties: [
        ...registered.properties, ...registered.slots.map(slot => ({ ...slot, registeredSlot: true })),
      ] }
    }
    if (!component && node.hasAttribute('data-inspector-instance')) {
      const live = ui.sourceComponentRequest(node, { type: 'inspect' })
      if (live?.source === node.getAttribute('data-inspector-source') && live.id === node.getAttribute('data-inspector-instance')) {
        component = { ...live, sourcePreview: true }
      }
    }
    if (contract?.input) {
      const { field, options } = contract.input
      const value = node.getAttribute('data-li-choice')
      component = { ...(component ?? { name: contract.site }), prepared: contract,
        properties: [...(component?.properties ?? []).filter(p => p.id !== field),
          { id: field, options, value, prepared: true, unavailableReason: ui.preparedPreview.shows(node, contract.input, value) ? null : 'Unavailable in this state' }] }
    }
    if (!component) return
    if (request !== componentRead || node !== selection.current || !node.isConnected || route !== currentRoute) return
    currentComponent = component
    renderFields({ keepPopup: true })
  }
  async function previewComponentProperty(node, component, property, next, reset = false) {
    const path = currentRoute
    const version = activeRouteVersion
    if (selection.current !== node || !node.isConnected || comparing || !isCurrentRoute(path, version)) {
      throw Error('Select the component again before changing its preview.')
    }
    if (property.prepared) {
      if (property.value === next || !property.options.includes(next)) return
      await commitPrepared(node, component.prepared, 'component-' + property.id, next, undefined, property.id)
      await inspectSelectedComponent(node, path)
      return
    }
    const kind = component.sourcePreview ? 'source' : 'slot'
    if (kind === 'slot' && !property.registeredSlot) throw Error('The slot is no longer available.')
    const target = { kind, mount: component.id, field: property.id, tag: node.localName, id: null,
      slot: component.name, key: component.id,
      definition: node.getAttribute(kind === 'source' ? 'data-inspector-source' : 'data-inspector-component-definition') }
    if (ui.componentEdits.liveNode(target) !== node) throw Error('Select the component again.')
    const beforeState = ui.componentEdits.state(property, kind)
    if (!reset && beforeState.value === next && (kind === 'source' || beforeState.visible === (next !== null))) return
    const afterState = await ui.componentEdits.change(target, path, beforeState, kind === 'source'
      ? { value: next, ...(reset ? { overridden: false } : {}) } : { value: next, visible: next !== null })
    await saveInstanceChange(path, version, target, beforeState, afterState, component.name)
    if (selection.current === node && isCurrentRoute(path, version)) {
      if (node.isConnected) await inspectSelectedComponent(node, path)
      else if (component.sourcePreview) {
        const replacement = document.querySelector('[data-inspector-instance="' + CSS.escape(component.id) + '"]')
        if (replacement?.getAttribute('data-inspector-source') === component.source) selection.select(replacement)
      }
    }
  }
  async function saveInstanceChange(path, version, target, beforeState, afterState, name) {
    const edit = { id: crypto.randomUUID(), route: path, target, property: target.kind === 'text' ? 'text' : 'component-' + target.field,
      before: String(beforeState.value ?? 'None'), requested: String(afterState.value ?? 'None'), restore: 'session',
      beforeState, afterState, component: { name, prop: target.field } }
    edit.observed = edit.requested
    try {
      if (!isCurrentRoute(path, version)) throw Error('The page changed while editing the component.')
      await write({ type: 'saveComponentProperty', record: edit }, path, version)
    } catch (error) {
      if (ui.componentEdits.liveNode(target)) await ui.componentEdits.change(target, path, afterState, beforeState)
      throw error
    }
    const mounted = ui.componentEdits.liveNode(target)
    if (isCurrentRoute(path, version)) recovery.remember(edit, mounted ? { ...edit, node: mounted, liveTarget: target, path } : undefined)
    reportRecovery()
  }
  function editText(text, before, next) {
    const path = currentRoute, version = activeRouteVersion
    return run(async () => {
      if (comparing || !text.isConnected || text.data !== before || overlayFor(text.parentElement)) throw Error('Select the text again.')
      const target = ui.textEditing.targetFor(text)
      const original = { value: before, visible: true }
      const updated = await ui.componentEdits.change(target, path, original, { value: next, visible: true })
      await saveInstanceChange(path, version, target, original, updated, 'Text')
    })
  }
  ui.textEditing.bind(() => !busy && !comparing && !loadingRoute && journalRevision !== null &&
    (isCanvasExpanded?.() || !panel.hidden), editText)
  function renderSelection() {
    void inspectSelectedComponent(selection.current, currentRoute).catch(() => {})
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
  const { apply, remove, temporary, discardTemporary } = ui.createStylePreview(() => ({
    colorCatalog, spacingCatalog, textStyleCatalog,
  }))
  const recovery = ui.createPreviewRecovery({
    apply: applyRestored, remove, canEdit, readFrameState, projectTextStyles: () => textStyleDefinitions,
    removeButtonSize: entry => changeSessionEntry(entry, false),
  })
  const fields = get('fields')
  let renderedSelection
  let scopeHovered = false
  let paddingOutlineMembers = []
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
  let fontFamilies = []
  let textStyleCatalog = null
  let textStyleDefinitions = []
  let textStyleUnavailable = false
  let buttonSizeKey = null
  let confirmedButton = null
  let pendingButtonSize = false
  let buttonSizeRequiresReload = false
  let pendingRows = []
  let savedRoute
  let scopedPreviewTargets = false
  let landmarkPreviewTargets = false
  let sectionPreviewTargets = false
  let preparedPreviews = false
  let authoredUse = false
  get('authored-edit-scope').addEventListener('change', () => renderFields())
  let scopeSelection
  let comparingSource = false
  const authored = ui.authoredUsePreview
  const sourceRows = () => pendingRows.filter(edit => edit.executor === 'authored-source')
  const sourceOwns = (node, property) => {
    const use = authoredUse && authored.binding(node)
    return use && sourceRows().some(edit => edit.authoredBinding.id === use.id && Object.hasOwn(edit.authoredValues, property))
  }
  const removeSourceFirst = 'Remove the candidate source edit before previewing this setting.'
  let templatePreviews = false
  let templateSourcePreviews = false
  let templatePaddingPreviews = false
  let previewVisibility = false
  let projectWideRevert = false
  let refreshing = false
  let editNavigation = 0
  const editDestinationKey = 'localhost-inspector.pending-destination'
  const editsUI = ui.createPendingEdits({
    host, root, panel, get,
    observe: id => recovery.observeOperation(id, comparing),
    openEdit: goToEdit,
    removeEdit: id => run(() => removeJournalEdit(id)),
    setPreviewVisibility: (id, hidden) => run(() => toggleSavedPreview(id, hidden)),
    refresh: refreshJournal,
    highlight: id => {
      const observation = id && recovery.observeOperation(id, comparing)
      const node = observation?.state === 'applied' ? observation.node : null
      selection.previewRelated(node ? () => node.isConnected ? node : null : null)
    },
  })

  function syncPending() {
    editsUI.update(pendingRows, previewVisibility)
    if (host.hasAttribute('data-workspace-toolbar')) host.dispatchEvent(new Event('variables-data-changed', { bubbles: true }))
  }

  async function goToEdit(edit) {
    const navigation = ++editNavigation
    status('')
    if (edit.executor === 'authored-source' || recovery.hasPreparedOperation(edit.id) || edit.template || edit.route === savedRoute) {
      if (await selectEditTarget(edit.id, navigation)) {
        if (panel.hidden) setOpen(true)
        if (isCanvasExpanded?.()) openEditRoute(route())
        selection.syncOutlines()
        return true
      }
      if (navigation !== editNavigation) return false
    }
    if (edit.route === savedRoute) {
      if (edit.frameState && isCanvasExpanded && rememberEditDestination(edit)) {
        if (!openEditRoute(route(), edit.frameState, edit.id)) return true
        sessionStorage.removeItem(editDestinationKey)
      }
      if (isCanvasExpanded?.()) openEditRoute(route())
      if (recovery.hasPreparedOperation(edit.id)) {
        status(comparing || edit.previewHidden
          ? 'This preview is hidden.' : 'This saved preview is unavailable in the current view.', false, true)
        return false
      }
      const wrongState = edit.frameState && edit.frameState !== readFrameState()
      status(wrongState ? 'Open the original Canvas view to locate this saved edit.' :
        missingEditMessage(edit), true)
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
    if (openEditRoute(edit.route, edit.frameState, edit.id)) {
      if (edit.frameState) {
        sessionStorage.removeItem(editDestinationKey)
        status('Open the original Canvas view to locate this saved edit.', true)
        return false
      }
      location.assign(address.href)
    }
    return true
  }

  function missingEditMessage(edit) {
    return edit?.sessionOnly ? 'The original element is no longer available. This preview applies only to that element.' :
      'Couldn’t locate the element for this edit.'
  }

  function rememberEditDestination({ id, route, frameState }) {
    try {
      sessionStorage.setItem(editDestinationKey, JSON.stringify({ id, route, frameState }))
      return true
    } catch { return false }
  }

  function readFrameState() {
    host.dispatchEvent(new Event('capture-inspector-edit-state'))
    const state = host.dataset.editFrameState
    delete host.dataset.editFrameState
    return state
  }

  function openEditRoute(path, frameState, editId) {
    const detail = frameState ? JSON.stringify({ path, frameState, editId }) : path
    return host.dispatchEvent(new CustomEvent('open-inspector-edit-route', { cancelable: true, detail }))
  }

  host.addEventListener('inspector-edit-route-unavailable', event => {
    let destination
    try { destination = JSON.parse(sessionStorage.getItem(editDestinationKey)) }
    catch { return }
    if (destination?.id !== event.detail?.id) return
    sessionStorage.removeItem(editDestinationKey)
    status(event.detail.reason === 'hidden-control'
      ? 'This view opens on Desktop. Switch Canvas to Desktop to see the saved edit.'
      : 'Couldn’t reopen the original view. Your edit is still saved.', true)
  })

  async function selectEditTarget(id, navigation) {
    const path = currentRoute
    const version = activeRouteVersion
    const isCurrent = () => navigation === editNavigation && isCurrentRoute(path, version)
    const observation = await recovery.locateSavedEdit(id, isCurrent, comparing)
    if (!isCurrent()) return false
    const { node, state } = observation
    if (state === 'stale') {
      status(sourceRows().some(edit => edit.id === id) ? 'Candidate source changed. Review the source before changing this edit.' :
        recovery.hasPreparedOperation(id) ? sourceConflictNotice : 'The saved style source changed. Review the edit before reapplying.', true)
      return true
    }
    if (!node) return false
    node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
    selection.select(node)
    if (state === 'failed') {
      const baseline = recovery.changedBaseline(id, node)
      status(baseline ? 'The app now uses ' + baseline.value + ' for ' + baseline.label + '. Your edit is still saved.' :
        'Found the element. The saved preview couldn’t be applied here.', true)
    } else if (state === 'superseded') status('A newer edit is previewing on this setting.', false, true)
    else if (state === 'hidden') status(comparing ? 'Showing the original app.' : 'This preview is hidden.', false, true)
    else if (state === 'unobservable') status('This saved preview is unavailable in the current view.', false, true)
    return true
  }

  async function pickDestination() {
    let destination
    try { destination = JSON.parse(sessionStorage.getItem(editDestinationKey)) }
    catch { return }
    if (destination?.route !== savedRoute) return
    sessionStorage.removeItem(editDestinationKey)
    if (!pendingRows.some(edit => edit.id === destination.id)) return
    if (panel.hidden) setOpen(true)
    editsUI.showEdits()
    const navigation = ++editNavigation
    if (await selectEditTarget(destination.id, navigation)) editsUI.markSelected(destination.id)
    else if (navigation === editNavigation && destination.route === savedRoute) {
      if (recovery.hasPreparedOperation(destination.id))
        status('This saved preview is unavailable in the current view.', false, true)
      else status('Opened the page. ' + missingEditMessage(pendingRows.find(edit => edit.id === destination.id)), true)
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
      if (busy || !isCurrentRoute(path, version) || journalRevision !== startedRevision) return
      if (!validSnapshot(snapshot)) throw Error('Invalid journal snapshot')
      const sourceStateChanged = sourceRows().some(edit =>
        snapshot.pending?.find(candidate => candidate.id === edit.id)?.sourceState !== edit.sourceState)
      if (snapshot.revision === journalRevision && !sourceStateChanged) return
      if (startedRevision !== null && recovery.matchesSnapshot(snapshot.edits.filter(edit => edit.route === snapshot.route || edit.template || edit.prepared || edit.executor === 'authored-source'))) {
        const changes = new Map()
        for (const edit of snapshot.edits) {
          const id = edit.group ?? edit.id
          if (recovery.hasOperation(id) && recovery.isPreviewHidden(id) !== Boolean(edit.previewHidden)) {
            changes.set(id, Boolean(edit.previewHidden))
          }
        }
        const accept = () => {
          if (!isCurrentRoute(path, version)) return
          acceptSnapshot(snapshot)
          journalRevision = snapshot.revision
        }
        if (changes.size) {
          await run(() => applyPreviewVisibility(changes, path, version, accept))
        } else {
          accept()
          syncPending()
        }
        return
      }
      const savedIds = new Set(snapshot.edits.map(edit => edit.id))
      const retired = recovery.componentEntries().filter(entry => entry.target.mount && !savedIds.has(entry.id))
      if (retired.length) await rewindComponentEntries(retired, path, version)
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

  async function applyPreviewVisibility(changes, path, version, persist) {
    const local = [...changes.keys()].some(id => recovery.hasOperation(id))
    const buttons = local && !comparing ? recovery.componentEntries() : []
    if (buttons.length) await rewindComponentEntries(buttons, path, version, persist)
    else await persist()
    const current = () => isCurrentRoute(path, version)
    if (!current()) return
    if (local) await recovery.setPreviewHidden(changes, current, comparing)
    if (current()) reportRecovery()
  }

  async function toggleSavedPreview(id, hidden) {
    if (comparing || !previewVisibility) return
    const path = currentRoute
    const version = activeRouteVersion
    await applyPreviewVisibility(new Map([[id, hidden]]), path, version,
      () => write({ type: 'setPreviewVisibility', id, hidden }, path, version))
  }

  async function removeJournalEdit(id) {
    if (comparing) return
    const sourceEdit = sourceRows().find(edit => edit.id === id)
    if (sourceEdit) return undoAuthoredUse(sourceEdit, 'removeEdit')
    if (recovery.hasUnverifiedDependentPreview(id)) {
      throw Error('A newer live preview changes the same setting. Remove the newer edit first.')
    }
    const path = currentRoute
    const version = activeRouteVersion
    const entries = recovery.componentEntries(id)
    let result
    const persist = async () => { result = await write({ type: 'removeEdit', id }, path, version) }
    if (entries.length) await rewindComponentEntries(entries, path, version, persist)
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
    // The workspace panel sits outside the app document and its dialog focus trap.
    return isCanvasExpanded && overlay?.matches('[role=dialog]')
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
    const hasSourceEdit = sourceRows().length > 0
    compare.disabled = pageActionsUnavailable ||
      (!comparing && (hasSourceEdit ? window.parent === window : !recovery.hasAttached))
    const hasPendingEdits = pendingRows.length > 0 || recovery.hasSaved || hasOlderComponentOverrides
    reset.disabled = writesUnavailable || !hasPendingEdits || !projectWideRevert || hasSourceEdit
    const pageBusy = pageActionsUnavailable ? 'Wait for the current page to finish updating' : ''
    const saveUnavailable = pageBusy || (journalRevision === null ? 'Reload to reconnect to saved edits' : '')
    const pendingReason = saveUnavailable || (!recovery.hasSaved ? 'No saved edits on this page' : '')
    const undoShortcut = undo.getAttribute('aria-keyshortcuts') === 'Meta+Z' ? '⌘Z' : 'Ctrl+Z'
    ui.setTooltip(undo, pendingReason || (comparing ? 'Show previews to undo an edit' : 'Undo last preview (' + undoShortcut + ')'))
    compare.setAttribute('aria-pressed', String(comparing))
    const compareLabel = comparing ? 'Show previews' : 'Show original'
    compare.setAttribute('aria-label', compareLabel)
    ui.setTooltip(compare, pageBusy || (compare.disabled
      ? hasSourceEdit ? 'Open this candidate in Canvas to compare source' : 'No live previews on this page to compare'
      : compareLabel))
    ui.setTooltip(reset, saveUnavailable || (hasSourceEdit ? 'Remove candidate source edits individually before reverting all' : !hasPendingEdits ? 'No saved edits in this app' :
      projectWideRevert ? 'Revert saved edits on all pages' : 'Restart the local helper with the updated Inspector to revert all edits'))
    get('comparison-mode').hidden = !comparing
    editsUI.setDisabled(writesUnavailable || comparing)
  }
  function renderFields({ keepPopup = false } = {}) {
    ui.dismissTooltip()
    if (!keepPopup) ui.closeMenu()
    renderActions()
    const node = selection.current
    const hasSelection = Boolean(node?.isConnected)
    const contract = hasSelection && ui.preparedPreview.contract(node)
    const shared = contract ? [...(contract.styles ?? (contract.style ? [contract.style] : [])), ...(contract.input ? [contract.input.field] : [])] : []
    const scope = get('prepared-scope')
    const use = authoredUse && hasSelection ? authored.binding(node) : null
    const editScope = get('authored-edit-scope')
    if (scopeSelection !== node) {
      editScope.value = 'shared'
      scopeSelection = node
    }
    editScope.hidden = !authoredUse || !hasSelection
    const preparedStylesUnavailable = document.querySelector('meta[name="inspector-prepared-styles"][content="unavailable"]')
    scope.hidden = !shared.length && editScope.hidden && !(hasSelection && preparedStylesUnavailable)
    const actions = (use?.actions ?? (use ? [use.family] : [])).filter(action => authored.eligible(node, action))
    let origin
    try { origin = JSON.parse(node?.getAttribute('data-li-source-use')) } catch { /* Unmarked source. */ }
    const authoredLabel = actions.map(action => action === 'paint' ? 'text color' : 'fixed spacing').join(', ')
    scope.textContent = [authoredUse && hasSelection && (authoredLabel
      ? 'Shared candidate source · ' + authoredLabel : 'Shared candidate source unavailable for text color and fixed spacing'),
      authoredUse && !shared.length && origin?.file && 'Selected source · ' + origin.file + ' · ' + origin.owner,
      shared.length && contract.surface && 'Selected envelope and its direct painted surface',
      shared.length && 'Shared source controls · ' + shared.join(', '),
      authoredUse && hasSelection && (editScope.value === 'selected'
        ? (node.hasAttribute('data-li-record-scope') && node.getAttribute('data-inspector-target') ? 'One record · source handoff available for corner radius' : 'Selected occurrence preview · separate from source handoff')
        : contract && contract.file + ' · ' + document.querySelectorAll('[data-li-revision="' + contract.revision + '"]').length + ' mounted'),
      hasSelection && preparedStylesUnavailable && 'Shared stylesheet controls are unavailable in this preview.',
    ].filter(Boolean).join(' · ')
    const canvasPaint = isCanvasExpanded?.() && ui.syncCanvasBackground(host, colorCatalog)
    const groupCount = selection.group.length
    const canvasSection = !groupCount && !hasSelection && ui.canvasBackgroundSection({
      host, colorCatalog, paint: canvasPaint, refresh: () => renderFields({ keepPopup: true }), status,
    })
    get('guidance').hidden = Boolean(groupCount) || hasSelection || Boolean(canvasSection)
    const name = get('selected-name')
    name.hidden = !hasSelection && !groupCount
    if (groupCount) name.textContent = groupCount + (selection.group.every(item => ui.textTargets(item).length) ? ' text layers' : ' layers')
    get('parent').parentElement.parentElement.toggleAttribute('data-no-selection', !hasSelection && !groupCount)
    if (hasSelection) {
      const label = ui.inspectedLabel(node) ||
        node.getAttribute('data-slot') || ({ div: 'Container', span: 'Text', tr: 'Row', td: 'Cell' }[node.localName] ?? node.localName)
      name.textContent = label.charAt(0).toUpperCase() + label.slice(1)
    }
    if (node !== renderedSelection) {
      scopeHovered = false
      renderedSelection = node
      paddingOutlineMembers = []
      fields.replaceChildren()
    }
    const version = activeRouteVersion
    const roots = hasSelection ? [node] : [...selection.group]
    const stillSelected = () => selection.current === node && isCurrentRoute(currentRoute, version) &&
      (hasSelection || (roots.length === selection.group.length && roots.every((item, i) => item === selection.group[i])))
    const palette = {
      disabled: comparing || loadingRoute || journalRevision === null, run,
      locate: targets => {
        if (!stillSelected() || !targets.every(target => target.isConnected && roots.some(root => root.contains(target)))) return
        if (targets.length === 1) selection.select(targets[0])
        else selection.select(null, targets)
      },
      changePaints: async (paints, value) => {
        const path = currentRoute
        const valid = () => stillSelected() && value && !comparing && !loadingRoute && journalRevision !== null &&
          paints.every(({ node, property }) => canEdit(node, property) && roots.some(root => root.contains(node)))
        if (!valid()) throw Error('Selection changed.')
        if (paints.some(({ node, property }) => sourceOwns(node, property))) throw Error(removeSourceFirst)
        if (paints.length === 1) {
          await commitEdit(paints[0].node, paints[0].property, value, undefined, true)
          return
        }
        await ui.commitSelectionPaints(paints, value, {
          valid, apply, discardTemporary, editRecord: (entry, target) => editRecord(entry, target, { editRoute: path }),
          persist: records => write({ type: 'saveSelectionPaint', records }, path, version),
          remember: (record, entry) => { temporary.delete(entry); recovery.remember(record, entry) },
        })
        if (isCurrentRoute(path, version)) reportRecovery()
      },
    }
    if (!hasSelection) {
      const section = groupCount ? ui.selectionColors(roots, palette) : canvasSection
      ui.updateInspectorFields(fields, section ? [section] : [])
      return
    }
    if (overlayFor(node)) {
      ui.updateInspectorFields(fields, [ui.element('p', 'li-empty', 'Editing inside an open overlay is unavailable.')])
      return
    }
    const verticalPadding = paddingScope(node, 'vertical')
    paddingOutlineMembers = verticalPadding.members
    try {
      ui.renderInspector(fields, {
        palette, component: currentComponent, previewComponentProperty, editText, node, style: getComputedStyle(node), disabled: comparing || loadingRoute || journalRevision === null, run, colorCatalog, spacingCatalog,
        paddingCount: verticalPadding.members.length > 1 ? verticalPadding.members.length : 0,
        paddingTemplate: verticalPadding.template,
        previewRelated: resolve => selection.previewRelated(resolve && (() =>
          selection.current === node ? resolve() : null)),
        selectRelated: target => {
          if (selection.current !== node || !target?.isConnected || target.ownerDocument !== document) return
          selection.select(target)
          panel.focus({ preventScroll: true })
        },
        hasPaddingPreview: recovery.hasVerticalPaddingPreview(node),
        commitPaddingPair: (axis, requested, options) => commitPaddingPair(node, version, axis, axis === 'vertical' ? verticalPadding : paddingScope(node, axis), requested, options),
        detachLocalPaddingPair: async (axis, value) => {
          // Older helpers and shared/template sides keep their existing per-property scope.
          if (!templatePaddingPreviews || ui.templatePreview.of(node)) return false
          const scope = paddingScope(node, axis)
          if (scope.members.length || scope.blocked) return false
          await commitPaddingPair(node, version, axis, scope, value)
          return true
        },
        pendingColorFor: target => recovery.pendingColorFor(target),
        textStyleCatalog, textStyleUnavailable, fontFamilies, refreshTypography: renderFields,
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
  async function applyRestored(node, edit, isCurrent) {
    if (edit.target.mount) {
      if (!isCurrent()) return null
      await changeSessionEntry(edit, true)
      const live = ui.componentEdits.liveNode(edit.target)
      return live ? { ...edit, node: live, liveTarget: edit.target, path: currentRoute } : null
    }
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
  const sourceConflictNotice = 'The prepared source changed. Review the saved edit before reapplying.'
  function status(message, error = false, savedEdit = false) {
    const notice = get('status')
    notice.textContent = message
    notice.toggleAttribute('data-error', error)
    const pendingNotice = get('pending-status')
    pendingNotice.textContent = error || savedEdit || message === sourceConflictNotice ? message : ''
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
      if (error.code === 'WRITE_REJECTED' || error.code === 'AUTHORED_SOURCE_REJECTED' || error.code === 'AUTHORED_SOURCE_CONFLICT') throw error
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
      if (currentComponent && selection.current?.isConnected) await inspectSelectedComponent(selection.current, currentRoute).catch(() => {})
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
    const open = panel.hidden
    ui.dismissTooltip()
    ui.closeMenu()
    setOpen(open)
    selection.syncOutlines()
    if (moveFocus) (open ? closeInspector : entry).focus({ preventScroll: true })
  }
  entry.onclick = toggleInspector
  closeInspector.onclick = toggleInspector
  if (host.hasAttribute('data-workspace-toolbar')) {
    new MutationObserver(() => renderFields()).observe(host.parentElement, {
      attributes: true, attributeFilter: ['data-canvas-page'],
    })
    host.addEventListener('request-variables-catalog', async event => {
      if (loadingRoute) return
      const catalog = await getCatalog(event.detail === 'refresh')
      const available = catalog ?? { textStyleCatalog, colorCatalog, spacingCatalog }
      const detail = JSON.stringify({
        ...available,
        canCreateTextStyle: textStyleCatalog?.canCreateDefinition === true && journalRevision !== null,
        pendingTextStyles: recovery.pendingTextStyles(),
        textStyleDefinitions,
      })
      host.dispatchEvent(new CustomEvent('variables-catalog', { detail, bubbles: true }))
    })
    const closeVariablesForm = ui.connectWorkspaceTextStyle({
      host, root,
      canCreate: () => textStyleCatalog?.canCreateDefinition === true && journalRevision !== null && !loadingRoute,
      save: ({ label, description, values }) => run(async () => {
        const path = currentRoute
        const version = activeRouteVersion
        if (!textStyleCatalog?.canCreateDefinition) throw Error('The text style source is unavailable for creation.')
        const definition = {
          name: '--text-' + label.toLowerCase().replace(/ +/g, '-'),
          label, description, values, source: textStyleCatalog.source,
        }
        const result = await write({ type: 'saveTextStyleDefinition', definition }, path, version)
        if (!result.definition) throw Error('Could not confirm the saved text style.')
        if (isCurrentRoute(path, version)) {
          textStyleDefinitions = [...textStyleDefinitions, result.definition]
          syncPending()
        }
      }, { background: true, keepPopup: true, rethrow: true }),
    })
    document.addEventListener('preview-inspector-text', event => selection.previewText(ui.readNodeList(event)))
    document.addEventListener('select-inspector-text', event => {
      const nodes = ui.readNodeList(event)
      if (!host.isConnected || busy || !nodes.length) return
      event.preventDefault()
      editsUI.showDesign()
      setOpen(true)
      selection.selectText(nodes)
    })
    document.addEventListener('select-inspector-variable-use', event => {
      const node = event.composedPath()[0]
      if (!host.isConnected || !(node instanceof HTMLElement || node instanceof SVGSVGElement) || !node.isConnected || busy) return
      event.preventDefault()
      editsUI.showDesign()
      setOpen(true)
      selection.select(node)
    })
    function setWorkspaceOpen(open) {
      ui.dismissTooltip()
      ui.closeMenu()
      setOpen(open)
      selection.syncOutlines()
    }
    host.addEventListener('open-workspace-inspector', () => setWorkspaceOpen(true))
    host.addEventListener('hide-workspace-inspector', () => { closeVariablesForm(); setWorkspaceOpen(false) })
    host.addEventListener('clear-workspace-selection', event => {
      if (root.querySelector('dialog[open]')) event.preventDefault()
      else if (selection.current || selection.group.length) selection.select(null)
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
  async function commitPrepared(node, contract, property, requested, tokenOptions, field) {
    const path = currentRoute
    const version = activeRouteVersion
    if (!preparedPreviews) throw Error('Restart the local helper with prepared preview support.')
    const properties = Array.isArray(property) ? property : [property]
    const current = () =>
      node.isConnected &&
      selection.current === node &&
      isCurrentRoute(path, version) &&
      ui.preparedPreview.contract(node)?.revision === contract.revision
    const read = (key) => ui.preparedPreview.read(node, { property: key, prepared: { field } })
    if (!current() || (field && !ui.preparedPreview.shows(node, contract.input, read(property))))
      throw Error('The prepared part changed. Select it again before editing.')
    const records = properties.map((key) => ({
      id: crypto.randomUUID(),
      route: path,
      property: key,
      before: read(key),
      requested,
      ...tokenOptions,
      target: { tag: node.localName, key: null, slot: node.getAttribute('data-slot'), id: node.id || null },
      intent: 'feature-template',
      restore: 'unique',
      prepared: {
        site: contract.site,
        file: contract.file,
        revision: contract.revision,
        ...(field ? { field } : {}),
      },
      sourceContext: ui.describeSourceContext(node),
      viewport: { width: innerWidth, height: innerHeight },
    }))
    const untouchedPadding = properties.every(key => key.startsWith('padding-'))
      ? ['padding-top','padding-right','padding-bottom','padding-left'].filter(key=>!properties.includes(key)).map(key=>[key,read(key)])
      : []
    function verified(edit) {
      edit.observed = ui.preparedPreview.read(node, edit)
      const members = document.querySelectorAll('[data-li-revision="'+contract.revision+'"]')
      return members.length > 0 && Array.from(members).every(member => {
        const active = ui.preparedPreview.contract(member)
        return active?.revision === contract.revision &&
          (field || active.style === edit.property || active.styles?.includes(edit.property)) &&
          ui.preparedPreview.showsEffect(member, edit, active)
      })
    }
    try {
      recovery.projectPrepared(records)
      if (!(await ui.waitForPreview(current, () => records.every(verified) && untouchedPadding.every(([key,before])=>read(key)===before))))
        throw Error('The prepared edit did not reach the selected part in its current state.')
      const pair = records.length === 2
      await write(
        pair ? { type: 'savePairedPadding', records } : { type: 'save', record: records[0] },
        path,
        version,
      )
      if (isCurrentRoute(path, version))
        for (const edit of records) recovery.remember(pair ? { ...edit, group: records[0].id } : edit)
    } finally {
      recovery.projectPrepared()
    }
    reportRecovery()
  }
  async function planContinuity(request, path, version) {
    const planned = recovery.hasPrepared ? await send({ type: 'planAuthoredUse', ...request, expectedRevision: journalRevision }) : {}
    if (!isCurrentRoute(path, version)) throw Error('Selection changed. Reopen the saved edit before continuing.')
    const preparedTransitions = planned.preparedTransitions ?? []
    return { preparedTransitions, projection: recovery.stagePrepared(preparedTransitions) }
  }

  async function rejectSource(id, path, version, revision) {
    try {
      if (isCurrentRoute(path, version)) await write({ type: 'rejectAuthoredUse', id }, path, version)
      else await send({ type: 'rejectAuthoredUse', id, expectedRevision: revision })
    } catch {
      if (currentRoute === path) window.phaseAInspectorReady = loadRoute()
      throw Error('The source change could not be confirmed or restored. Reopen the candidate and check Edits.')
    }
  }
  async function commitAuthoredUse(node, use, property, values, tokenOptions) {
    const path = currentRoute
    const version = activeRouteVersion
    const current = () => isCurrentRoute(path, version)
    const nodes = authored.members(use)
    if (nodes.some(member => !authored.eligible(member, use.family)))
      throw Error(use.family === 'paint' ? 'Shared text color needs directly rendered text on every visible member.'
        : 'Shared fixed spacing needs horizontal flex rows with measurable children.')
    const authoredBefore = authored.read(node, use.family)
    const observed = use.family === 'paint' ? authored.expectedPaint(node, values.color) : values[property]
    if (!nodes.includes(node) || !observed || nodes.some(member => authored.binding(member).revision !== use.revision))
      throw Error('The authored use changed. Select it again before editing.')
    if (values.color?.startsWith('var(') && (!tokenOptions?.colorToken ||
        values.color !== ui.colorVariableValue(tokenOptions.colorToken.name) ||
        tokenOptions.colorToken.source !== colorCatalog?.source || !colorCatalog.names.includes(tokenOptions.colorToken.name))) {
      throw Error('This source color variable is unavailable.')
    }
    if (nodes.some(member => {
      const prepared = ui.preparedPreview.contract(member)
      return Object.keys(values).some(key => recovery.ownsLiveProperty(member, key) || member.style.getPropertyPriority(key) ||
        ((prepared?.style === key || prepared?.styles?.includes(key)) && ui.preparedPreview.authored(member, key)))
    })) throw Error('A preview already controls this property. Remove it before editing candidate source.')
    const protectedPeers = authored.protectPeers(node, use, nodes)
    const id = crypto.randomUUID()
    const record = {
      id, route: path, property, before: authoredBefore[property], requested: values[property],
      observed, authoredBefore, intent: 'feature-template',
      ...(tokenOptions?.colorToken ? { colorToken: tokenOptions.colorToken } : {}),
      target: { tag: node.localName, key: null, slot: node.getAttribute('data-slot'), id: node.id || null },
    }
    const { preparedTransitions, projection } = await planContinuity({ binding: use, values }, path, version)
    let staged, accepted
    try {
      staged = await write({ type: 'saveAuthoredUse', record, binding: use, values, preparedTransitions }, path, version)
      if (!staged.edit) return
      let effect, preparedEvidence
      if (!await ui.waitForPreview(current, () => {
        effect = authored.observation(staged.edit.authoredBinding, staged.edit.authoredValues, nodes.length)
        preparedEvidence = projection.evidence()
        return effect && preparedEvidence && protectedPeers.unchanged()
      })) throw Error('The source change did not preserve every visible member and earlier shared edit.')
      accepted = await write({
        type: 'verifyAuthoredUse', id, observed: effect.values, preparedEvidence,
        evidence: { ...effect.evidence, protectedPeers: protectedPeers.count },
      }, path, version)
    } catch (error) {
      if (staged?.edit) await rejectSource(id, path, version, staged.revision)
      throw error
    } finally { projection.finish(Boolean(accepted) && current()) }
    if (current()) {
      recovery.remember(accepted.edit ?? pendingRows.find(edit => edit.id === id))
      if (selection.current === node && !node.isConnected) {
        const replacements = authored.members(staged.edit.authoredBinding)
        selection.select(replacements.length === 1 ? replacements[0] : null)
      }
      reportRecovery()
    }
  }

  async function undoAuthoredUse(edit, type) {
    const path = currentRoute
    const version = activeRouteVersion
    const current = () => isCurrentRoute(path, version)
    const use = edit.authoredBinding
    const count = authored.members(use).length
    const { preparedTransitions, projection } = await planContinuity({ id: edit.id }, path, version)
    let staged, accepted
    try {
      staged = await write({ type, id: edit.id, preparedTransitions }, path, version)
      const restored = () => {
        const members = authored.members(use)
        return members.length >= count && members.every(node => {
          const actual = authored.read(node, use.family)
          return Object.entries(edit.authoredBefore).every(([property, value]) => actual[property] === value)
        })
      }
      if (staged.edit?.sourceState === 'undoing') {
        let preparedEvidence
        if (!count || !await ui.waitForPreview(current, () => {
          preparedEvidence = projection.evidence()
          return restored() && preparedEvidence
        })) throw Error('Undo could not preserve the earlier shared edit and restore the source effect.')
        accepted = await write({ type: 'verifyAuthoredUse', id: edit.id,
          observed: authored.read(authored.members(use)[0], use.family), preparedEvidence }, path, version)
      } else {
        accepted = staged
        if (count && !await ui.waitForPreview(current, restored))
          status('The source edit was removed, but the previous visible effect could not be confirmed.', true)
      }
    } catch (error) {
      if (staged?.edit?.sourceState === 'undoing') await rejectSource(edit.id, path, version, staged.revision)
      throw error
    } finally { projection.finish(Boolean(accepted) && current()) }
    if (current()) {
      recovery.forget(edit.id)
      reportRecovery()
    }
  }

  async function commitEdit(node, property, requested, tokenOptions, selectionOnly = false) {
    if (comparing || !canEdit(node, property)) {
      if (tokenOptions) throw Error('The selected property cannot be edited.')
      return
    }
    const prepared = ui.preparedPreview.contract(node)
    const qualifiedPrepared = (prepared?.style === property || prepared?.styles?.includes(property)) && !tokenOptions?.pendingColor
    const family = property === 'color' ? 'paint' : ['gap', 'justify-content'].includes(property) ? 'spacing' : null
    const panelProperty = ['background-color', 'border-radius', 'font-size', 'height'].includes(property)
    if (authoredUse && panelProperty) {
      selectionOnly ||= get('authored-edit-scope').value === 'selected'
      if (!selectionOnly && !qualifiedPrepared)
        throw Error('Shared source is unavailable for this control. Selected element only previews one occurrence.')
    }
    if (authoredUse && family) {
      selectionOnly ||= get('authored-edit-scope').value === 'selected'
      const marker = authored.binding(node)
      if (!selectionOnly) {
        const use = marker && (marker.actions ?? [marker.family]).includes(family) && { ...marker, family }
        const values = use && authored.intent(node, use, property, requested)
        if (values) return commitAuthoredUse(node, use, property, values, tokenOptions)
        if (!qualifiedPrepared)
          throw Error('Shared source is unavailable for this change. Choose Selected element only to preview one occurrence.')
      }
      if (sourceOwns(node, property)) throw Error(removeSourceFirst)
    }
    if (qualifiedPrepared && !selectionOnly)
      return commitPrepared(node, prepared, property, requested, tokenOptions)
    const editRoute = currentRoute
    const version = activeRouteVersion
    const isCurrent = () => isCurrentRoute(editRoute, version)
    const target = ui.describePreviewTarget(node)
    let recordScope
    if (authoredUse && selectionOnly && property === 'border-radius' && (qualifiedPrepared || node.hasAttribute('data-li-record-scope'))) {
      try { recordScope = JSON.parse(node.getAttribute('data-li-record-scope')) } catch { /* Unverified source. */ }
      if (!recordScope || !target.key || recordScope.key !== target.key || ui.findPreviewTarget(target, node) !== node)
        throw Error('Cannot identify one unique record for this corner radius. No change was saved.')
    }
    const marker = !selectionOnly && templatePreviews && !tokenOptions?.pendingColor ? ui.templatePreview.of(node) : undefined
    const source = marker ? recovery.templateSource(node, property) : undefined
    const template = source !== null && (source === undefined || templateSourcePreviews) ? marker : undefined
    const sourceContext = ui.describeSourceContext(node)
    const selected = selection.current
    const evidence = ++evidenceVersion
    const entry = await apply(node, property, requested, isCurrent, tokenOptions)
    entry.liveTarget = target
    const sameTarget = () => ui.matchesPreviewTarget(node, target) && (!template ||
      (ui.templatePreview.of(node) === template && recovery.templateSource(node, property, entry) === source))
    if (!isCurrent() || !sameTarget()) {
      discardTemporary(entry)
      throw Error('Selection changed. Earlier saved changes remain available to Undo.')
    }
    let edit, captureEnabled
    try {
      const templateSourceFingerprint = template ? await ui.templateSourceFingerprint(source) : undefined
      edit = await editRecord(entry, target, { editRoute, sourceContext, tokenOptions, template, templateSourceFingerprint })
      if (selectionOnly) edit.intent = 'selected occurrence only'
      if (recordScope) {
        if (ui.findPreviewTarget(target, node) !== node) throw Error('The record is no longer unique.')
        edit.recordScope = recordScope
        edit.restore = 'unique'
      }
      if (!isCurrent() || !sameTarget()) throw Error('Selection changed. Try the edit again.')
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
    if (sameTarget()) {
      temporary.delete(entry)
      recovery.remember(edit, entry)
      if (captureEnabled) {
        ui.captureEditEvidence?.(node, panel, edit, () => evidence === evidenceVersion && isCurrent() &&
          selection.current === selected && sameTarget() && ui.ownsPreviewDeclaration(entry))
      }
    } else {
      discardTemporary(entry)
      recovery.remember(edit)
      recoveryRequested = true
    }
    if (template) await restore(editRoute, version)
    reportRecovery()
    if (marker && !template && sameTarget()) status('Preview applies to the selected element. Shared CSS scope could not be verified.')
  }
  const paddingProperties = axis => axis === 'vertical' ? ui.sharedPadding.properties : ['padding-left', 'padding-right']

  function paddingScope(node, axis, pending) {
    const template = templatePaddingPreviews ? ui.templatePreview.of(node) : undefined
    const properties = paddingProperties(axis)
    const supports = peer => properties.every(property => canEdit(peer, property) && ui.supportsSpacingVariable(peer, property))
    if (template) {
      const candidates = ui.templatePreview.nodes({ template, target: { tag: node.localName, slot: node.getAttribute('data-slot') } })
      const style = getComputedStyle(node)
      const baseline = properties.map(property => pending?.get(node)?.get(property)?.before ?? style.getPropertyValue(property))
      const sourceOf = (peer, property) => recovery.templateSource(peer, property, pending?.get(peer)?.get(property))
      const sources = properties.map(property => sourceOf(node, property))
      let blocked = sources.includes(null) || (!templateSourcePreviews && sources.some(source => typeof source === 'string'))
      const members = blocked ? [] : candidates.filter(peer => {
        const owners = peer === node ? sources : properties.map(property => sourceOf(peer, property))
        const matches = sources.filter((source, index) => source === owners[index]).length
        // A record sharing just one side would receive a different source
        // change from the two-side preview.
        if (owners.includes(null) || matches === 1) {
          blocked = true
          return false
        }
        if (!matches) return false
        const peerStyle = getComputedStyle(peer)
        if (!supports(peer) || !properties.every((property, index) =>
          (pending?.get(peer)?.get(property)?.before ?? peerStyle.getPropertyValue(property)) === baseline[index])) {
          blocked = true
          return false
        }
        return true
      })
      return { template, candidates, members: blocked ? [] : members, sources, blocked: blocked || !members.includes(node) }
    }
    const members = axis === 'vertical' ? ui.sharedPadding.members(node) : []
    return { members: members.every(supports) ? members : [] }
  }

  async function commitPaddingPair(selected, version, axis, scope, requested, options) {
    const editRoute = currentRoute
    const isCurrent = () => isCurrentRoute(editRoute, version) && selection.current === selected
    if (!isCurrent() || comparing || !selected.isConnected || journalRevision === null) {
      throw Error('Selection changed. Try the edit again.')
    }
    const contract=ui.preparedPreview.contract(selected)
    if(contract && paddingProperties(axis).every(key=>contract.styles?.includes(key) && canEdit(selected,key)))
      return commitPrepared(selected,contract,paddingProperties(axis),requested,options)
    const { template, members: sharedMembers } = scope
    const shared = !template && axis === 'vertical' && sharedMembers.length > 0
    const members = template || shared ? sharedMembers : [selected]
    const properties = paddingProperties(axis)
    const sharedPadding = shared ? selected.getAttribute(ui.sharedPadding.attribute) : undefined
    const sameSet = (left, right) => {
      if (left.length !== right.length) return false
      const current = new Set(left)
      return right.every(node => current.has(node))
    }
    const pending = new Map()
    function sameMembers() {
      if (template) {
        const current = paddingScope(selected, axis, pending)
        return current.template === template && !current.blocked &&
          sameSet(current.candidates, scope.candidates) && sameSet(current.members, members) &&
          scope.sources.every((source, index) => source === current.sources[index])
      }
      if (axis !== 'vertical') return true
      const current = paddingScope(selected, axis)
      return !current.template && sameSet(current.members, sharedMembers) &&
        (!shared || selected.getAttribute(ui.sharedPadding.attribute) === sharedPadding)
    }
    if (scope.blocked) throw Error('These padding sides do not share one verified scope. Edit the sides separately.')
    if (!sameMembers()) throw Error('The shared rows changed. Try the edit again.')
    if (options?.spacingToken && members.every(node => properties.every(property =>
      node.style.getPropertyValue(property) === requested && ui.spacingVariableMatches(node, property, options.spacingToken.name),
    ))) return
    const entries = []
    const targets = new Map([selected, ...members.filter(peer => peer !== selected)].map(node => [node, {
      target: ui.describePreviewTarget(node),
      sourceContext: !template || node === selected ? ui.describeSourceContext(node) : undefined,
    }]))
    const evidence = ++evidenceVersion
    let records, captureEnabled
    try {
      for (const [node, { target }] of targets) {
        const sides = new Map()
        if (template) pending.set(node, sides)
        for (const property of properties) {
          if (!canEdit(node, property)) throw Error('The selected padding cannot be edited.')
          const entry = await apply(node, property, requested, isCurrent, options)
          entry.liveTarget = target
          entries.push(entry)
          if (template) sides.set(property, entry)
          if (template && entry.before !== entries[properties.indexOf(property)].before) {
            throw Error('The shared padding changed. Try the edit again.')
          }
        }
      }
      const journalEntries = template ? entries.slice(0, properties.length) : entries
      records = await Promise.all(journalEntries.map(async entry => ({
        ...await editRecord(entry, entry.liveTarget, {
          editRoute, sourceContext: targets.get(entry.node).sourceContext, tokenOptions: options, template,
          templateSourceFingerprint: template
            ? await ui.templateSourceFingerprint(scope.sources[properties.indexOf(entry.property)]) : undefined,
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
    if (attached) for (const entry of entries) temporary.delete(entry)
    records.forEach((record, index) => {
      const peers = template && attached ? entries.slice(2).filter(entry => entry.property === record.property) : []
      recovery.remember({ ...record, group: records[0].id }, attached ? entries[index] : undefined, peers)
    })
    if (attached && captureEnabled) {
      ui.captureEditEvidence?.(selected, panel, records[0], () => evidence === evidenceVersion &&
        isCurrent() && selection.current === selected && entries.every(ui.ownsPreviewDeclaration))
    }
    recoveryRequested ||= !attached
    reportRecovery()
  }
  async function editRecord(entry, target, { editRoute, sourceContext, tokenOptions, template, templateSourceFingerprint }) {
    const capturedState = template ? undefined : readFrameState()
    const frameState = capturedState && /^[a-f0-9]{64}$/.test(capturedState) ? capturedState : undefined
    if (target.anchor?.kind === 'section' && !sectionPreviewTargets) target = ui.describePreviewTarget(entry.node, false)
    const journalTarget = target.anchor && (!scopedPreviewTargets ||
      (target.anchor.kind === 'landmark' && !landmarkPreviewTargets))
      ? { tag: target.tag, id: target.id, slot: target.slot, key: target.key }
      : target
    return {
      id: crypto.randomUUID(), route: editRoute, target: await ui.previewTargetForJournal(journalTarget), property: entry.property, before: entry.before,
      requested: entry.requested, observed: entry.observed, ...tokenOptions,
      restore: template || (capturedState !== 'unverified' && ui.findPreviewTarget(journalTarget, entry.node) === entry.node) ? 'unique' : 'ambiguous',
      viewport: { width: innerWidth, height: innerHeight }, frameState, ...(template ? { template } : {}),
      ...(templateSourceFingerprint ? { templateSourceFingerprint } : {}),
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

  async function changeSessionEntry(entry, forward) {
    if (entry.target.mount) {
      if (!ui.componentEdits.liveNode(entry.target)) return true // Unmount discards the instance override.
      const before = forward ? entry.beforeState : entry.afterState
      const after = forward ? entry.afterState : entry.beforeState
      const actual = await ui.componentEdits.change(entry.target, route(), before, after)
      if (!ui.componentEdits.equal(actual, after)) throw Error('The component baseline changed. Select it again.')
      return true
    }
    return ui.buttonSize.setSize(entry.node, entry.target.key, forward ? entry.before : entry.requested,
      forward ? entry.requested : entry.before, entry.path)
  }

  // Run only for attached component previews. CSS-only actions stay synchronous.
  async function rewindComponentEntries(entries, path, version, persist = () => {}) {
    const restored = []
    try {
      for (const entry of entries) {
        if (!isCurrentRoute(path, version)) throw Error('The page changed. Try again on the current page.')
        if (!await changeSessionEntry(entry, false)) throw Error('The component could not restore its original value.')
        restored.push(entry)
      }
      await persist()
    } catch (error) {
      if (isCurrentRoute(path, version)) {
        for (const entry of restored.reverse()) {
          await changeSessionEntry(entry, true).catch(() => false)
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
    const sourceEdit = sourceRows().find(edit => edit.id === id)
    if (sourceEdit) return undoAuthoredUse(sourceEdit, 'undo')
    const requestedRoute = currentRoute
    const version = activeRouteVersion
    const entries = recovery.componentEntries(id)
    const persist = () => write({ type: 'undo', id }, requestedRoute, version)
    if (entries.length) await rewindComponentEntries(entries, requestedRoute, version, persist)
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
      if (sourceRows().length) {
        await authored.compare(true)
        comparingSource = true
        comparing = true
        syncPending()
        return
      }
      const entries = recovery.componentEntries()
      if (entries.length) await rewindComponentEntries(entries, path, version)
      if (!isCurrentRoute(path, version)) return
      comparing = true
      recovery.showOriginal()
      syncPending()
    } else {
      if (comparingSource) {
        await authored.compare(false)
        comparingSource = false
        comparing = false
        syncPending()
        return
      }
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
      const entries = recovery.componentEntries().filter(entry => !entry.target.mount)
      const persist = async () => {
        const reset = []
        try {
          // A shared component can stay mounted when its original route closes.
          // Read the journal across routes only for this project-wide action.
          const snapshot = await send({ type: 'load', route: requestedRoute, forComponentReset: true })
          if (snapshot?.revision !== journalRevision) throw Error('Saved edits changed. Try Revert all again.')
          for (const entry of [...(snapshot.componentEdits ?? snapshot.edits.filter(edit => edit.target.mount))].reverse()) {
            if (entry.previewHidden || !ui.componentEdits.liveNode(entry.target)) continue
            const actual = await ui.componentEdits.read(entry.target, requestedRoute)
            if (!ui.componentEdits.equal(actual, entry.afterState)) continue
            const original = await ui.componentEdits.change(entry.target, requestedRoute, actual, entry.beforeState)
            reset.push({ target: entry.target, original, state: actual })
          }
          for (const { target, state } of ui.componentEdits.activeOverrides()) {
            const original = await ui.componentEdits.change(target, requestedRoute, state, { overridden: false })
            reset.push({ target, original, state })
          }
          await write({ type: 'resetAll' }, requestedRoute, version)
          hasOlderComponentOverrides = false
        } catch (error) {
          for (const { target, original, state } of reset.reverse()) {
            await ui.componentEdits.change(target, requestedRoute, original, state)
          }
          throw error
        }
      }
      if (entries.length) await rewindComponentEntries(entries, requestedRoute, version, persist)
      else await persist()
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
    const states = comparing ? [] : recovery.recoveryStates()
    const message = buttonSizeRequiresReload ? 'Reload the page to clear the previous Button Size preview.' :
      comparing ? '' : states.includes('authored-stale') ? 'Candidate source changed. Review the source before changing the saved edit.' :
      states.includes('prepared-stale') ? sourceConflictNotice :
      states.includes('stale') ? 'A saved style source changed. Review the edit before reapplying.' :
      recovery.hasConflicts ? 'The app changed a previewed style. Your edit is still saved.' :
      states.includes('failed') || states.includes('unobservable')
      ? 'Some saved previews could not be restored.'
      : recovery.hasSessionPreview ? 'Some previews last only while this page stays open.' : ''
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
    textStyleDefinitions = Array.isArray(snapshot.textStyleDefinitions) ? snapshot.textStyleDefinitions : []
    buttonSizeKey = typeof snapshot.buttonSizeKey === 'string' ? snapshot.buttonSizeKey : null
    savedRoute = snapshot.route
    scopedPreviewTargets = snapshot.scopedPreviewTargets === true
    landmarkPreviewTargets = snapshot.landmarkPreviewTargets === true
    sectionPreviewTargets = snapshot.sectionPreviewTargets === true
    preparedPreviews = snapshot.preparedPreviews === true
    authoredUse = snapshot.authoredUse === true
    templatePreviews = snapshot.templatePreviews === true
    templateSourcePreviews = snapshot.templateSourcePreviews === true
    templatePaddingPreviews = snapshot.templatePaddingPreviews === true
    previewVisibility = snapshot.previewVisibility === true
    projectWideRevert = snapshot.projectWideRevert === true
    if (Array.isArray(snapshot.pending)) pendingRows = snapshot.pending
  }
  async function loadSavedEdits(requestedRoute, version) {
    const snapshot = await send({ type: 'load', route: requestedRoute })
    if (!isCurrentRoute(requestedRoute, version)) return null
    if (!validSnapshot(snapshot)) throw Error('Restart the local helper with the updated Inspector.')
    acceptSnapshot(snapshot)
    hasOlderComponentOverrides = ui.componentEdits.activeOverrides().some(({ target }) => {
      const firstEdit = snapshot.edits.find(edit => edit.target.mount === target.mount && edit.target.field === target.field)
      return !firstEdit || firstEdit.beforeState.overridden
    })
    recovery.load(snapshot.edits.filter(edit => edit.route === snapshot.route || edit.template || edit.prepared || edit.executor === 'authored-source'), snapshot.route)
    return snapshot.revision
  }
  let currentRoute = route()
  async function loadRoute() {
    const requestedRoute = currentRoute
    const version = ++activeRouteVersion
    loadingRoute = true
    journalRevision = null
    scopedPreviewTargets = false
    landmarkPreviewTargets = false
    sectionPreviewTargets = false
    preparedPreviews = false
    authoredUse = false
    templatePreviews = false
    templateSourcePreviews = false
    templatePaddingPreviews = false
    previewVisibility = false
    projectWideRevert = false
    colorCatalog = null
    spacingCatalog = null
    fontFamilies = []
    textStyleCatalog = null
    textStyleDefinitions = []
    textStyleUnavailable = false
    buttonSizeKey = null
    confirmedButton = null
    status('')
    for (const entry of temporary) discardTemporary(entry)
    recovery.clear()
    renderActions()
    try {
      const [revision, catalog, spacing, textStyles, families] = await Promise.all([
        loadSavedEdits(requestedRoute, version),
        send({ type: 'colorCatalog' }).catch(() => null),
        send({ type: 'spacingCatalog' }).catch(() => null),
        send({ type: 'textStyleCatalog' }).then(catalog => ({ catalog }), () => ({ catalog: null, unavailable: true })),
        send({ type: 'fontFamilyCatalog' }).catch(() => []),
      ])
      if (revision === null || !isCurrentRoute(requestedRoute, version)) return
      fontFamilies = Array.isArray(families) ? families : []
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
    if (comparingSource) {
      comparingSource = false
      void authored.compare(false).catch(() => {})
    }
    recoveryRequested = false
    window.phaseAInspectorReady = loadRoute()
    selection.select(null)
  }
  const observedAttributes = new Set(['id', 'data-slot', 'data-inspector-target', 'role', 'style', 'class', 'data-theme', 'hidden',
    'fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'opacity', 'visibility', 'data-localhost-inspector-layer-hidden', 'aria-hidden', 'aria-labelledby', 'aria-label', 'aria-selected', 'open', 'data-state',
    ui.sharedPadding.attribute, ui.templatePreview.attribute, authored.attribute])
  new MutationObserver(mutations => {
    const records = mutations.filter(record => record.type !== 'attributes' ||
      observedAttributes.has(record.attributeName) || ui.isPreviewContextAttribute(record.attributeName))
    if (!records.length) return
    onRouteChange()
    selection.refresh()
    const selected = selection.current
    if (!busy && !loadingRoute && selected?.parentElement) {
      const template = templatePaddingPreviews && ui.templatePreview.of(selected)
      const marker = ui.templatePreview.attribute
      const matchesTemplate = node => ui.templatePreview.of(node) === template
      const templateChanged = template && records.some(record => {
        if (record.type === 'attributes') return matchesTemplate(record.target) || paddingOutlineMembers.includes(record.target)
        if (record.type !== 'childList') return false
        const selector = '[' + marker + '="' + CSS.escape(template) + '"]'
        return [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && (node.matches(selector) || node.querySelector(selector)))
      })
      const legacyChanged = (selected.hasAttribute(ui.sharedPadding.attribute) || fields.querySelector('button.li-padding-scope')) &&
        records.some(record => (record.type === 'childList' ||
          [ui.sharedPadding.attribute, marker, 'data-inspector-target', 'hidden'].includes(record.attributeName)) &&
          (record.target === selected || record.target === selected.parentElement ||
            record.target.parentElement === selected.parentElement))
      const selectionPaintChanged = records.some(record => selected.contains(record.target) ||
        (record.type === 'attributes' && record.target.contains(selected)))
      if (templateChanged || legacyChanged || selectionPaintChanged) renderFields({ keepPopup: true })
    }
    const styleChanges = records.filter(record => ['style', 'class', 'data-theme'].includes(record.attributeName))
    const node = selection.current
    if (node && records.some(record => record.target === node &&
      (record.type === 'childList' || ['class', 'data-slot', 'data-inspector-component'].includes(record.attributeName)))) {
      void inspectSelectedComponent(node, currentRoute).catch(() => {})
    }
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
    if (!recovery.hasRecords) return
    if (!busy && !loadingRoute && sourceRows().length && records.some(record =>
      (record.type === 'childList' && document.body.contains(record.target) && !host.contains(record.target)) || record.attributeName === authored.attribute)) reportRecovery()
    recoveryRequested ||= styleChanges.length !== records.length || recovery.hasTargetClassChange(styleChanges) ||
      ((recovery.hasScopedEdits || recovery.hasTemplateEdits) && styleChanges.some(record => record.attributeName === 'class')) ||
      (!busy && !loadingRoute && !comparing && recovery.hasStyleConflict(styleChanges))
    queueRecovery()
  }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
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
  window.addEventListener('resize', () => {
    refreshResponsiveSpacing()
    if (recovery.hasPrepared && !busy && !loadingRoute) syncPending()
  })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    refreshResponsiveSpacing()
    if (!isCanvasExpanded?.() || !colorCatalog) return
    if (fields.querySelector('.li-canvas-section')) renderFields({ keepPopup: true })
    else ui.syncCanvasBackground(host, colorCatalog)
  })
  window.addEventListener('popstate', onRouteChange)
  window.addEventListener('hashchange', onRouteChange)
  window.navigation?.addEventListener('currententrychange', onRouteChange)
  document.addEventListener('li-prepared-revisions', () => {
    if (!loadingRoute && host.isConnected && recovery.hasRecords) reportRecovery()
  })
  window.phaseAInspectorReady = loadRoute()
  // Selection can display the live node while saved edits and tokens load.
  // Mutation controls continue to follow loadRoute's existing readiness gate.
  if (dock) document.dispatchEvent(new Event('workspace-inspector-listening'))
})()
