import { flowRoute } from './page-state.mjs'
import { createWorkspaceActivity } from './workspace-activity.mjs'
import { createVariantPanels } from './variant-panels.mjs'
import { createWorkspaceLayers } from './workspace-layers.mjs'
import { isolateColor } from './color-preview.mjs'
import { previewSpacing } from './spacing-preview.mjs'
import './tokens.js'
import './styles.js'
import './panel-styles.js'
import './icons.js'
import './tooltip.js'
import './dom.js'
import './menu.js'
import './variables-styles.js'
import './variables-typography.js'
import './variables-panel.js'
import './policy.js'
import './authored-styles.js'
import './text-style-values.js'
import './color-bindings.js'
import './solid-color-picker.js'
import './spacing-gap.js'
import './variables-audit.js'

const ui = window.LocalhostInspector

export function connectSidebar({ data, dock, getFrame, selectedRoute, livePage, navigate, warmNavigation, onOpenActivity, focusResult, showConnectionHelp, getOutline, onOpenOutline }) {
  const host = document.querySelector('#workspace-sidebar')
  const root = host.attachShadow({ mode: 'open' })
  const styles = ui.element('style')
  styles.textContent = ui.tokens + ui.styles + ui.panelStyles
  const layout = ui.element('link')
  layout.rel = 'stylesheet'
  layout.href = './sidebar.css'
  const rail = ui.element('nav', 'rail')
  rail.setAttribute('aria-label', 'Workspace')
  const file = ui.action('File', 'workspaceFile')
  const variables = ui.action('Variables', 'variables')
  rail.append(file, variables)
  const pane = ui.element('div', 'pane')
  const header = ui.element('header', 'project')
  const name = ui.element('strong', '', data.projectName || location.host)
  const inspectorToggle = document.querySelector('#inspector-toggle')
  const toolbar = inspectorToggle.parentElement
  const nextControl = inspectorToggle.nextElementSibling
  header.append(name)
  const activity = createWorkspaceActivity(ui, onOpenActivity)
  activity.update(data.activity)
  const files = activity.element
  const split = ui.element('div', 'flow-split')
  split.tabIndex = 0
  split.setAttribute('role', 'separator')
  split.setAttribute('aria-label', 'Resize activity')
  split.setAttribute('aria-orientation', 'horizontal')
  let activityExpanded = true
  let savedHeight = 142
  try { savedHeight = Number(sessionStorage.getItem('inspectorActivityHeight')) || savedHeight } catch {}
  function setActivityExpanded(value) {
    activityExpanded = value
    activity.list.hidden = !value
    files.style.height = value ? savedHeight + 'px' : 'auto'
    split.setAttribute('aria-valuenow', String(value ? savedHeight : files.offsetHeight))
  }
  function resizeActivity(height) {
    savedHeight = Math.round(Math.max(64, Math.min(Math.max(64, pane.clientHeight - 148), height)))
    try { sessionStorage.setItem('inspectorActivityHeight', String(savedHeight)) } catch {}
    setActivityExpanded(true)
  }
  split.onpointerdown = event => {
    split.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  split.onpointermove = event => {
    if (split.hasPointerCapture(event.pointerId)) resizeActivity(event.clientY - files.getBoundingClientRect().top)
  }
  split.onkeydown = event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    resizeActivity(files.offsetHeight + (event.key === 'ArrowDown' ? 8 : -8))
  }
  setActivityExpanded(true)
  files.addEventListener('click', event => {
    if (!activityExpanded && event.target.closest('[role=tab]')) setActivityExpanded(true)
  })
  let fileDetail = false
  let restoreExpanded = true
  let textStyleFormRequest = 0
  const recipeProperties = ['fontFamily', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing']
  function openTextStyleForm(entry, anchor, onBack, onCreated, onDismiss) {
    const inspector = dock.firstElementChild
    if (!inspector || dock.inert) return null
    const id = ++textStyleFormRequest
    const values = Object.fromEntries(ui.textStyleProperties.map((property, index) => [property, entry.value[recipeProperties[index]]]))
    const bounds = anchor.closest('.li-type-row').getBoundingClientRect()
    function result(event) {
      if (typeof event.detail !== 'string') return
      let response
      try { response = JSON.parse(event.detail) } catch { return }
      if (response?.id !== id) return
      inspector.removeEventListener('variables-text-style-form-result', result)
      if (response.action === 'back') onBack?.()
      else {
        if (response.action === 'created') onCreated?.()
        else onDismiss?.()
        if (anchor.isConnected) anchor.focus({ preventScroll: true })
      }
    }
    inspector.addEventListener('variables-text-style-form-result', result)
    const detail = JSON.stringify({ id, values, left: bounds.right + 8, top: bounds.top })
    const opened = !inspector.dispatchEvent(new CustomEvent('open-variables-text-style-form', { detail, cancelable: true }))
    if (opened) return () => {
      inspector.removeEventListener('variables-text-style-form-result', result)
      inspector.dispatchEvent(new Event('close-variables-text-style-form'))
      onDismiss?.()
    }
    inspector.removeEventListener('variables-text-style-form-result', result)
    return null
  }

  let restoreColor
  function colorPreview(entry) {
    restoreColor?.()
    restoreColor = null
    if (!entry) return
    const doc = getFrame().contentDocument
    if (liveScan && liveScan.page.id === livePage()?.id && doc?.body) {
      restoreColor = isolateColor(doc, liveScan.entries, entry.id, ui.colorChannels(entry.value))
    }
  }
  let sourceComponentNames = new Map()
  const layers = createWorkspaceLayers({
    componentFor: node => ui.registeredComponentName(node) ||
      (node.hasAttribute('data-inspector-instance') && sourceComponentNames.get(node.getAttribute('data-inspector-source'))),
    getDocument: () => getFrame().contentDocument,
    selectNode: focusResult,
    getOutline,
    warmNavigation,
    onOpenOutline: openLayerOutline,
  })
  let selectionDocument
  function syncLayerHover(event) {
    if (event.currentTarget !== getFrame().contentDocument) return
    const target = event.composedPath()[0]
    layers.setHovered(target === selectionDocument ? null : target)
  }
  function syncLayerSelection(event) {
    if (event.currentTarget !== getFrame().contentDocument) return
    const selected = event.composedPath()[0]
    const group = ui.readNodeList(event)
    layers.setSelected(selected === selectionDocument ? null : selected, group, true)
    panel.setTextSelection(group.length ? group : selected === selectionDocument ? [] : [selected])
  }
  function watchLayerSelection() {
    const doc = getFrame().contentDocument
    if (doc === selectionDocument) return
    selectionDocument?.removeEventListener('workspace-inspector-hover', syncLayerHover, true)
    selectionDocument?.removeEventListener('workspace-inspector-selection', syncLayerSelection, true)
    selectionDocument = doc
    selectionDocument?.addEventListener('workspace-inspector-hover', syncLayerHover, true)
    selectionDocument?.addEventListener('workspace-inspector-selection', syncLayerSelection, true)
  }
  watchLayerSelection()
  let destination = 'File'
  const pageScope = () => selectedRoute() ?? livePage()?.id
  const panel = ui.createVariablesPanel({
    renderLayers: layers.render,
    onInventoryOpen: () => schedule(true),
    onOpenProject: entry => show('Variables', entry),
    onDetailChange(detail) {
      if (destination !== 'File' || fileDetail === detail) return
      fileDetail = detail
      if (detail) restoreExpanded = activityExpanded
      setActivityExpanded(detail ? false : restoreExpanded)
    },
    currentPageId: () => selectedRoute() ?? livePage()?.id,
    onColorPreview: colorPreview,
    onTextTargets(hits, select = false) {
      const doc = getFrame().contentDocument
      const nodes = [...new Set(hits.map(hit => hit.node))]
      if (nodes.some(node => !node?.isConnected || node.ownerDocument !== doc)) {
        if (select) invalidate()
        else if (doc) ui.dispatchNodeList(doc, 'preview-inspector-text', [])
        return false
      }
      return doc && ui.dispatchNodeList(doc, select ? 'select-inspector-text' : 'preview-inspector-text', nodes)
    },
    onCreateTextStyle: openTextStyleForm,
    onSpacingPreview: hits => previewSpacing(getFrame().contentDocument, hits),
    onPage: async pageId => {
      if (livePage()?.id !== pageId && !await goToPage(pageId)) throw Error('Screen unavailable')
    },
    onReveal: async (occurrence, entry, isCurrent) => {
      const ticket = ++navigation
      const currentRequest = () => isCurrent() && ticket === navigation
      const pageId = occurrence.pageId
      const remembered = frames.get(pageId)
      const current = livePage()
      if (current?.id !== pageId || (remembered && current.frameId !== remembered)) {
        const opened = await goToPage(pageId)
        if (!currentRequest()) return
        if (!opened) return 'This screen could not be opened.'
      }
      const page = livePage()
      const doc = getFrame().contentDocument
      if (!currentRequest()) return
      if (!page || page.id !== pageId || !doc?.body) return 'This screen could not be opened.'
      const scan = ui.scanVariablesPage(doc, page, catalogs)
      const latest = scan.entries.find(item => item.id === entry.id)
      const node = latest && ui.findVariableOccurrence(latest, occurrence)?.node
      if (!node?.isConnected) {
        dirty = true
        captureLive()
        return 'This use changed. Choose a current result.'
      }
      suppressScope++
      try { return focusResult(node) }
      finally { activeScope = pageScope(); suppressScope-- }
    },
  })
  pane.append(header, files, split, panel.element)
  const grip = ui.element('div', 'grip')
  grip.tabIndex = 0
  grip.setAttribute('role', 'separator')
  grip.setAttribute('aria-label', 'Resize workspace sidebar')
  grip.setAttribute('aria-orientation', 'vertical')
  const layerStyles = layout.cloneNode()
  layerStyles.href = './workspace-layers.css'
  root.append(styles, layout, layerStyles, rail, pane, grip)
  ui.bindTooltips(root)

  let open = false
  let navigation = 0
  let catalogs = {}
  let catalogKey = ''
  const scans = new Map()
  const frames = new Map()
  const mapped = new Set(data.frames.map(frame => frame.route))
  let captured
  let observedDoc
  let observer
  let timer
  let idle
  let scheduledDoc
  let scheduledRoute
  let backgroundScan
  let activeScope
  let liveScan
  let liveURL
  let dirty = true
  let inventoryChanged = false
  let suppressScope = 0

  async function goToPage(id) {
    const frameId = frames.get(id) ?? data.frames.find(item => item.route === id && !item.steps.length)?.id
    if (!frameId) return false
    suppressScope++
    try {
      return await navigate(frameId)
    } finally { activeScope = pageScope(); suppressScope-- }
  }

  function publish() {
    inventoryChanged = false
    panel.update(ui.variablesInventory([...scans.values()], catalogs.componentCatalog?.revision), {
      fontDocument: getFrame().contentDocument,
      canCreateTextStyle: catalogs.canCreateTextStyle === true,
    })
    const checked = [...mapped].filter(route => scans.has(route)).length
    const componentsChecked = [...mapped].filter(route => scans.get(route)?.componentCoverage === 'configurable-definitions' &&
      (!catalogs.componentCatalog || (scans.get(route).verifiedComponentRoots && scans.get(route).componentRevision === catalogs.componentCatalog.revision))).length
    const coverage = count => count < mapped.size ? count + ' of ' + mapped.size + ' mapped pages inspected.' : ''
    const skipped = catalogs.componentCatalog?.skippedFiles?.length ?? 0
    const componentMessage = [coverage(componentsChecked), skipped ? skipped + ' source files could not be indexed.' : ''].filter(Boolean).join(' ')
    panel.setCoverage(coverage(checked), componentMessage)
  }

  function observeRoot(root) {
    observer.observe(root, { attributes: true, subtree: true, childList: true, characterData: true })
  }

  function observe(doc) {
    if (doc === observedDoc) return
    observer?.disconnect()
    observedDoc?.removeEventListener('input', invalidate, true)
    observedDoc?.removeEventListener('change', invalidate, true)
    observedDoc?.defaultView?.removeEventListener('resize', invalidate)
    observedDoc?.fonts?.removeEventListener('loadingdone', invalidate)
    observedDoc = doc
    dirty = true
    doc.defaultView.addEventListener('resize', invalidate)
    doc.fonts?.addEventListener('loadingdone', invalidate)
    observer = new MutationObserver(records => {
      if (records.some(record => {
        if (record.target.closest?.('#localhost-inspector-outlines')) return false
        return record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes]
          .some(node => node.id !== 'localhost-inspector-spacing-preview')
      })) invalidate()
    })
    doc.addEventListener('input', invalidate, true)
    doc.addEventListener('change', invalidate, true)
  }

  function captureLive() {
    if (!open) return
    const page = livePage()
    const doc = getFrame().contentDocument
    if (!doc?.body || !page) return
    observe(doc)
    if (!dirty && liveURL === doc.URL && liveScan?.page.frameId === page.frameId) return
    dirty = false
    liveURL = doc.URL
    const scope = pageScope()
    const scopeChanged = !suppressScope && scope !== activeScope
    activeScope = scope
    // A cached page needs lookup evidence, not references to its detached DOM.
    if (liveScan && liveScan.page.id !== page.id) {
      for (const entry of liveScan.entries) for (const use of entry.occurrences) delete use.node
    }
    colorPreview(null)
    observer.disconnect()
    observeRoot(doc.documentElement)
    liveScan = ui.scanVariablesPage(doc, page, catalogs, observeRoot)
    scans.set(page.id, liveScan)
    if (page.frameId) frames.set(page.id, page.frameId)
    else frames.delete(page.id)
    if (!data.projectName) name.textContent = doc.title || location.host
    publish()
    if (scopeChanged && destination === 'File') panel.setScope(scope)
  }

  function invalidate() {
    dirty = true
    schedule()
  }

  function cancelScan() {
    clearTimeout(timer)
    if (idle != null) window.cancelIdleCallback(idle)
    idle = timer = null
  }

  function schedule(demand = false) {
    if (!open) return
    const doc = getFrame().contentDocument
    if (!doc?.body || doc.URL === 'about:blank') return
    const route = flowRoute(doc.location)
    // Keep the first survey of each visited route and changes inside the open
    // app on the original schedule. A replacement for an already-surveyed
    // route can wait until the user stops switching screens.
    const background = panel.showingLayers && scans.has(route) && doc !== observedDoc
    if (!demand && (timer || idle != null) && doc === scheduledDoc && route === scheduledRoute && background === backgroundScan) return
    cancelScan()
    scheduledDoc = doc
    scheduledRoute = route
    backgroundScan = background
    // Let fast navigation settle before measuring an entire app for a hidden
    // inventory. Opening an inventory supersedes the pending background scan.
    timer = setTimeout(() => {
      timer = null
      if (background && window.requestIdleCallback) {
        idle = window.requestIdleCallback(() => {
          idle = null
          captureLive()
        }, { timeout: 750 })
      } else captureLive()
    }, demand ? 0 : background ? 500 : 100)
  }

  function readCatalog(refresh = false) {
    dock.firstElementChild?.dispatchEvent(new CustomEvent('request-variables-catalog', { detail: refresh ? 'refresh' : null }))
  }
  dock.addEventListener('variables-catalog', event => {
    if (event.target !== dock.firstElementChild || typeof event.detail !== 'string' || catalogKey === event.detail) return
    catalogs = JSON.parse(event.detail)
    const names = new Map((catalogs.componentCatalog?.definitions ?? [])
      .map(def => [JSON.stringify([def.source, def.name]), def.name]))
    const namesChanged = names.size !== sourceComponentNames.size || [...names.keys()].some(key => !sourceComponentNames.has(key))
    sourceComponentNames = names
    if (open && namesChanged && !variantPanels.active) panel.refreshLayers()
    catalogKey = event.detail
    invalidate()
  }, true)
  dock.addEventListener('variables-data-changed', () => {
    if (open) readCatalog()
  }, true)

  function show(view, entry) {
    if (destination === 'File' && view !== destination && fileDetail) {
      setActivityExpanded(restoreExpanded)
      fileDetail = false
    }
    destination = view
    files.hidden = view !== 'File'
    split.hidden = files.hidden
    panel.element.hidden = !open
    file.setAttribute('aria-pressed', String(view === 'File'))
    variables.setAttribute('aria-pressed', String(view === 'Variables'))
    if (open && !captured) {
      captured = fetch('./audit.json').then(response => response.ok ? response.json() : null).then(audit => {
        for (const scan of audit?.scans ?? []) {
          if (!scans.has(scan.page.id)) { scans.set(scan.page.id, scan); inventoryChanged = true }
        }
        if (open && inventoryChanged) publish()
      }).catch(() => {}) // Legacy maps collect pages as the designer opens them.
    }
    if (open) {
      activeScope = pageScope()
      if (inventoryChanged) publish()
      panel.setWorkspace(view === 'File', activeScope, entry)
      panel.refreshLayers()
      readCatalog(true)
      schedule(!panel.showingLayers)
    } else {
      layers.render(null)
      panel.clearPreview()
      panel.closePopup?.()
      cancelScan()
    }
  }
  const variantPanels = createVariantPanels(pane, dock, syncDock, { getOutline, onOpenOutline: openLayerOutline })
  async function openLayerOutline(key, expanded, flowMenu) {
    const source = variantPanels.active
    await onOpenOutline(key, expanded)
    const destination = variantPanels.active
    if (!flowMenu || source === destination) return
    if (destination) {
      if (!source) layers.suspendFlowMenu()
      variantPanels.resumeFlowMenu(flowMenu)
    } else layers.resumeFlowMenu(flowMenu)
  }
  file.onclick = () => { variantPanels.leave(); show('File') }
  variables.onclick = () => { variantPanels.leave(); show('Variables') }
  show('File')

  const preferenceKey = data.canvasId ? 'inspectorWorkspaceOpen:' + data.canvasId : 'inspectorWorkspaceOpen'
  function remember(value) {
    try { (data.canvasId ? localStorage : sessionStorage).setItem(preferenceKey, String(value)) } catch {}
  }
  function syncDock() {
    const visible = Boolean(variantPanels.active) || Boolean(dock.firstElementChild) && dock.hasAttribute('data-inspector-open')
    if (open === visible) return
    open = visible
    if (open) header.append(inspectorToggle)
    else toolbar.insertBefore(inspectorToggle, nextControl)
    host.hidden = !open
    document.body.toggleAttribute('data-sidebar-open', open)
    show(destination)
    if (!variantPanels.active && dock.firstElementChild && !dock.inert) remember(open)
  }
  inspectorToggle.addEventListener('click', () => {
    if (variantPanels.active) { variantPanels.leave(); return }
    if (!dock.firstElementChild) {
      restoreOpen = true
      remember(true)
      showConnectionHelp(true)
      return
    }
    const closing = dock.hasAttribute('data-inspector-open')
    remember(!closing)
    dock.firstElementChild?.dispatchEvent(new Event(closing ? 'hide-workspace-inspector' : 'open-workspace-inspector'))
    if (closing && dock.inert) dock.removeAttribute('data-inspector-open')
    syncDock()
    if (closing) inspectorToggle.focus({ preventScroll: true })
  })
  let restoreOpen = false
  try { restoreOpen = (data.canvasId ? localStorage : sessionStorage).getItem(preferenceKey) === 'true' } catch {}
  function onDockChanged() {
    if (restoreOpen && dock.firstElementChild) {
      restoreOpen = false
      showConnectionHelp(false)
      dock.firstElementChild.dispatchEvent(new Event('open-workspace-inspector'))
    }
    syncDock()
  }
  new MutationObserver(onDockChanged).observe(dock, { childList: true, attributes: true,
    attributeFilter: ['data-inspector-open'] })
  onDockChanged()
  function width(value) {
    const max = Math.min(480, Math.max(172, innerWidth - 320))
    const next = Math.min(max, Math.max(172, value))
    document.documentElement.style.setProperty('--workspace-sidebar-width', next + 'px')
    grip.setAttribute('aria-valuemin', '172')
    grip.setAttribute('aria-valuemax', String(max))
    grip.setAttribute('aria-valuenow', String(next))
  }
  width(280)
  grip.onpointerdown = event => {
    grip.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  grip.onpointermove = event => {
    if (grip.hasPointerCapture(event.pointerId)) width(event.clientX)
  }
  grip.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    width(host.offsetWidth + (event.key === 'ArrowRight' ? 8 : -8))
  }
  window.addEventListener('resize', () => width(Number(grip.getAttribute('aria-valuenow'))))

  let outlineRefreshQueued = false
  return {
    updateActivity: activity.update,
    inspectVariant: variantPanels.update,
    leaveVariant: variantPanels.leave,
    setOutlineHover() {
      if (variantPanels.active) variantPanels.setOutlineHover()
      else if (open) layers.syncOutlineHover()
    },
    refreshOutline() {
      if (!open || outlineRefreshQueued) return
      outlineRefreshQueued = true
      queueMicrotask(() => {
        outlineRefreshQueued = false
        if (variantPanels.active) variantPanels.refreshOutline()
        else if (open) panel.refreshLayers()
      })
    },
    changed() {
      watchLayerSelection()
      if (!data.projectName) name.textContent = getFrame().contentDocument?.title || location.host
      if (open) queueMicrotask(() => {
        if (!open) return
        const scope = pageScope()
        if (destination === 'File' && !suppressScope && scope !== activeScope) panel.setScope(scope)
        activeScope = scope
        schedule()
      })
    },
  }
}
