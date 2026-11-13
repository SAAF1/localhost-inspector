(() => {
  if (!window.phaseABridge) return
  const ui = window.LocalhostInspector
  const { host, root, panel, setOpen, get } = ui.createPanel()
  const selection = ui.createSelection({ host, panel, get, onSelect: renderSelection })
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
  let busy = false
  let loadingRoute = true
  let comparing = false
  let recoveryScheduled = false
  let recoveryRequested = false
  let activeRouteVersion = 0
  let journalRevision = null
  let colorCatalog = null
  let spacingCatalog = null
  let textStyleCatalog = null
  let textStyleUnavailable = false
  let buttonSizeKey = null
  let confirmedButton = null
  let pendingButtonSize = false
  let buttonSizeRequiresReload = false

  function canEdit(node, property) {
    return node.isConnected && !overlayFor(node) && (property === 'button-size'
      ? Boolean(ui.buttonSize.currentSize(node, buttonSizeKey)) : ui.supported(property, node))
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
    const compareLabel = comparing ? 'Show previews' : 'Show original'
    compare.setAttribute('aria-label', compareLabel)
    ui.setTooltip(compare, compareLabel)
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
    entry.liveTarget = target
    if (!isCurrent() || !ui.matchesPreviewTarget(node, target)) {
      discardTemporary(entry)
      throw Error('Selection changed. Earlier saved changes remain available to Undo.')
    }
    let edit
    try {
      edit = await editRecord(entry, target, editRoute, tokenOptions)
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
  async function editRecord(entry, target, editRoute, tokenOptions) {
    return {
      id: crypto.randomUUID(), route: editRoute, target: await ui.previewTargetForJournal(target), property: entry.property, before: entry.before,
      requested: entry.requested, observed: entry.observed, ...tokenOptions,
      restore: ui.findPreviewTarget(target, entry.node) === entry.node ? 'unique' : 'ambiguous',
      viewport: { width: innerWidth, height: innerHeight },
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
      return ui.textStyleProperties.flatMap(property => {
        const requested = pendingTextStyle ? ui.textStyleReference(pendingTextStyle.name, property, pendingTextStyle.values[property])
          : name === null ? computed.getPropertyValue(property) : ui.textStyleReference(name, property)
        return node.style.getPropertyValue(property) === requested && node.style.getPropertyPriority(property) === ''
          ? [] : [{ node, property, requested, target: ui.describePreviewTarget(node) }]
      })
    })
    if (!updates.length) return
    const entries = []
    let records
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
      records = await Promise.all(entries.map((entry, index) => editRecord(entry, updates[index].target, editRoute,
        pendingTextStyle && index === 0 ? (draft ? { pendingTextStyle } : { pendingTextStyleName: pendingTextStyle.name }) : tokenOptions)))
      if (pendingTextStyle && (!isCurrent() || selection.current !== selected ||
          entries.some(entry => !ui.ownsPreviewDeclaration(entry)))) {
        throw Error('Selection changed. Choose the text style again.')
      }
      await write({ type: 'saveTextStyle', records }, editRoute, version)
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
    closeInspector.focus({ preventScroll: true })
    await run(async () => {
      const entries = recovery.buttonEntries()
      const persist = () => write({ type: 'reset', route: requestedRoute }, requestedRoute, version)
      if (entries.length) await rewindButtonSizes(entries, requestedRoute, version, persist)
      else await persist()
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
    const message = buttonSizeRequiresReload ? 'Reload the page to clear the previous Button Size preview.' :
      comparing ? '' : recovery.hasConflicts
      ? 'The app changed a previewed style. Your edit is still saved.'
      : recovery.hasUnattached ? 'Some saved previews could not be restored.' : ''
    if (notice.textContent !== message) status(message)
  }
  async function restore(requestedRoute, version, fromOriginal = false) {
    await recovery.restore(() => isCurrentRoute(requestedRoute, version) && !comparing, fromOriginal)
    if (isCurrentRoute(requestedRoute, version)) reportRecovery()
  }
  async function loadSavedEdits(requestedRoute, version) {
    const snapshot = await send({ type: 'load', route: requestedRoute })
    if (!isCurrentRoute(requestedRoute, version)) return null
    if (!Number.isSafeInteger(snapshot?.revision) || !Array.isArray(snapshot.edits) || typeof snapshot.route !== 'string') {
      throw Error('Restart the local helper with the updated Inspector.')
    }
    buttonSizeKey = typeof snapshot.buttonSizeKey === 'string' ? snapshot.buttonSizeKey : null
    recovery.load(snapshot.edits.filter(edit => edit.route === snapshot.route))
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
        renderSelection()
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
    const styleChanges = records.filter(record => ['style', 'class', 'data-theme'].includes(record.attributeName))
    const node = selection.current
    if ((colorCatalog || spacingCatalog || textStyleCatalog) && !busy && !loadingRoute && node &&
      styleChanges.some(record => record.target.contains(node) || node.contains(record.target))) {
      const targets = [node, ...ui.textTargets(node)]
      if (fields.querySelector('.li-spacing-variable-pill') || targets.some(target => ['background-color', 'color', 'border-color', 'gap', 'font-family'].some(
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
