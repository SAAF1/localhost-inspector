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

export function connectSidebar({ data, groups, dock, getFrame, selectedRoute, livePage, navigate, focusResult }) {
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
  const files = ui.element('section', 'files')
  files.append(ui.element('h2', '', 'Flows'))
  const flowButtons = new Map()
  function screenButton(frame, label, className) {
    const button = ui.element('button', className, label)
    button.type = 'button'
    button.onclick = () => void navigate(frame.id)
    flowButtons.set(frame.id, button)
    return button
  }
  for (const group of groups) {
    if (group.frames.length === 1) {
      files.append(screenButton(group.frames[0], group.label, 'flow-group single-flow'))
      continue
    }
    const section = ui.sidebarDisclosure(group.label, 'flow-group')
    for (const frame of group.frames) {
      const button = screenButton(frame, frame.label || frame.route, 'flow-screen')
      button.prepend(ui.icon('frame'))
      section.append(button)
    }
    files.append(section)
  }

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
  const panel = ui.createVariablesPanel({
    currentPageId: () => selectedRoute() ?? livePage()?.id,
    onColorPreview: colorPreview,
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
      finally { activeScope = selectedRoute(); suppressScope-- }
    },
  })
  pane.append(header, files, panel.element)
  const grip = ui.element('div', 'grip')
  grip.tabIndex = 0
  grip.setAttribute('role', 'separator')
  grip.setAttribute('aria-label', 'Resize workspace sidebar')
  grip.setAttribute('aria-orientation', 'vertical')
  root.append(styles, layout, rail, pane, grip)
  ui.bindTooltips(root)

  let destination = 'File'
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
    } finally { activeScope = selectedRoute(); suppressScope-- }
  }

  function publish() {
    inventoryChanged = false
    panel.update(ui.variablesInventory([...scans.values()]), {
      fontDocument: getFrame().contentDocument,
      canCreateTextStyle: catalogs.canCreateTextStyle === true,
    })
    const checked = [...mapped].filter(route => scans.has(route)).length
    panel.setCoverage(checked < mapped.size ? checked + ' of ' + mapped.size + ' mapped pages inspected.' : '')
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
    if (!open || destination !== 'Variables') return
    const page = livePage()
    const doc = getFrame().contentDocument
    if (!doc?.body || !page) return
    observe(doc)
    if (!dirty && liveURL === doc.URL && liveScan?.page.frameId === page.frameId) return
    dirty = false
    liveURL = doc.URL
    const scope = selectedRoute()
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
    if (scopeChanged) panel.setScope(scope)
  }

  function invalidate() {
    dirty = true
    schedule()
  }

  function schedule() {
    if (!open || destination !== 'Variables' || timer) return
    // Paint the panel and any captured inventory before measuring the live app.
    timer = setTimeout(() => {
      timer = null
      captureLive()
    }, 100)
  }

  function readCatalog() {
    dock.firstElementChild?.dispatchEvent(new Event('request-variables-catalog'))
  }
  dock.addEventListener('variables-catalog', event => {
    if (event.target !== dock.firstElementChild || typeof event.detail !== 'string' || catalogKey === event.detail) return
    catalogs = JSON.parse(event.detail)
    catalogKey = event.detail
    invalidate()
  }, true)
  dock.addEventListener('variables-data-changed', () => {
    if (open && destination === 'Variables') readCatalog()
  }, true)

  function show(view) {
    destination = view
    if (open && view === 'File') updateFileList()
    files.hidden = view !== 'File'
    panel.element.hidden = view !== 'Variables'
    file.setAttribute('aria-pressed', String(view === 'File'))
    variables.setAttribute('aria-pressed', String(view === 'Variables'))
    if (open && !captured) {
      captured = fetch('./audit.json').then(response => response.ok ? response.json() : null).then(audit => {
        for (const scan of audit?.scans ?? []) {
          if (!scans.has(scan.page.id)) { scans.set(scan.page.id, scan); inventoryChanged = true }
        }
        if (open && destination === 'Variables' && inventoryChanged) publish()
      }).catch(() => {}) // Legacy maps collect pages as the designer opens them.
    }
    if (open && view === 'Variables') {
      activeScope = selectedRoute()
      if (inventoryChanged) publish()
      panel.setScope(activeScope)
      readCatalog()
      schedule()
    } else {
      panel.clearPreview()
      panel.closePopup?.()
      clearTimeout(timer)
      timer = null
    }
  }
  file.onclick = () => show('File')
  variables.onclick = () => show('Variables')
  show('File')

  inspectorToggle.addEventListener('click', () => {
    open = !open
    if (open) header.append(inspectorToggle)
    else toolbar.insertBefore(inspectorToggle, nextControl)
    host.hidden = !open
    document.body.toggleAttribute('data-sidebar-open', open)
    dock.firstElementChild?.dispatchEvent(new Event(open ? 'open-workspace-inspector' : 'hide-workspace-inspector'))
    show(destination)
    if (!open) inspectorToggle.focus({ preventScroll: true })
  })
  function syncDock() {
    if (open && dock.firstElementChild && !dock.inert && !dock.hasAttribute('data-inspector-open')) {
      dock.firstElementChild.dispatchEvent(new Event('open-workspace-inspector'))
    }
  }
  new MutationObserver(syncDock).observe(dock, { childList: true, attributes: true,
    attributeFilter: ['data-inspector-open', 'inert'] })
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

  function updateFileList() {
    const page = livePage()
    if (!data.projectName) name.textContent = getFrame().contentDocument?.title || location.host
    for (const [id, button] of flowButtons) {
      button.setAttribute('aria-current', String(id === page?.frameId))
    }
  }

  return {
    changed() {
      if (open && destination === 'File') updateFileList()
      if (open && destination === 'Variables') queueMicrotask(() => {
        if (!open || destination !== 'Variables') return
        const scope = selectedRoute()
        if (!suppressScope && scope !== activeScope) panel.setScope(scope)
        activeScope = scope
        schedule()
      })
    },
  }
}
