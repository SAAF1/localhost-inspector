import './inventory-ui.mjs'
import { requestInspector } from './inspector-request.mjs'
import { isolateColor } from './color-preview.mjs'
import { previewSpacing } from './spacing-preview.mjs'
import { createWorkspaceLayers } from './workspace-layers.mjs'

const ui = window.LocalhostInspector
const root = document.querySelector('#layers').attachShadow({ mode: 'open' })
const css = document.createElement('style')
css.textContent = ui.tokens + ui.styles + ui.panelStyles +
  ':host{display:flex;flex-direction:column;background:var(--li-surface)}'
root.append(css)
for (const file of ['sidebar.css', 'workspace-layers.css']) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = './' + file
  root.append(link)
}
let doc
let outline
const parentOrigin = document.referrer ? new URL(document.referrer).origin : null
const namesBySlot = new Map()
const namesBySource = new Map()
const layers = createWorkspaceLayers({
  getDocument: () => doc,
  getOutline: () => outline,
  onFlowPopover(bounds) {
    if (!parentOrigin) return
    const panel = root.host
    if (bounds && !panel.style.width) panel.style.width = panel.offsetWidth + 'px'
    if (!bounds) panel.style.removeProperty('width')
    parent.postMessage({ type: 'variant-flow-popover', bounds }, parentOrigin)
  },
  onOpenOutline(key, expanded, flowMenu) {
    if (parentOrigin) parent.postMessage({ type: 'open-outline-item', key, expanded, flowMenu }, parentOrigin)
  },
  componentFor: node => ui.registeredComponentName(node) || node.getAttribute('data-inspector-component-name') ||
    (node.hasAttribute('data-inspector-instance') ? namesBySource.get(node.getAttribute('data-inspector-source')) : namesBySlot.get(node.getAttribute('data-slot'))),
  selectNode(node) {
    // Stop at the app viewport; scrolling its canvas ancestor moves unrelated frames.
    node.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' })
    node.dispatchEvent(new Event('select-canvas-variant-layer', { bubbles: true }))
  },
})
let scan
const catalogRequest = requestInspector('./variant-inspector', { type: 'variablesCatalog' }).catch(() => ({}))
catalogRequest.then(catalogs => {
  for (const definition of catalogs.componentCatalog?.definitions ?? []) {
    namesBySource.set(JSON.stringify([definition.source, definition.name]), definition.name)
    for (const marker of definition.markers ?? []) namesBySlot.set(marker, definition.name)
  }
  panel.refreshLayers()
})
let timer
let restoreColor
const pageId = location.origin
function reveal(node) {
  if (!node?.isConnected || node.ownerDocument !== doc) return 'This use is no longer on the screen.'
  node.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' })
  node.dispatchEvent(new Event('select-canvas-variant-layer', { bubbles: true }))
}
const panel = ui.createVariablesPanel({
  renderLayers: layers.render,
  currentPageId: () => pageId,
  onInventoryOpen: refreshInventory,
  onReveal: hit => reveal(hit.node),
  onColorPreview(entry) {
    restoreColor?.()
    restoreColor = entry && scan ? isolateColor(doc, scan.entries, entry.id, ui.colorChannels(entry.value)) : null
  },
  onSpacingPreview: hits => doc && previewSpacing(doc, hits),
  onTextTargets(hits, select) {
    const nodes = hits.map(hit => hit.node).filter(node => node?.isConnected && node.ownerDocument === doc)
    return doc && ui.dispatchNodeList(doc, select ? 'select-inspector-text' : 'preview-inspector-text', nodes)
  },
})
root.append(panel.element)
ui.bindTooltips(root)
panel.setWorkspace(true, pageId)
async function refreshInventory() {
  const current = doc
  if (!current || panel.showingLayers) return
  panel.element.setAttribute('aria-busy', 'true')
  const catalogs = await catalogRequest
  if (current !== doc || panel.showingLayers) return
  restoreColor?.()
  restoreColor = null
  scan = ui.scanVariablesPage(doc, { id: pageId, label: doc.title }, catalogs, undefined, true)
  panel.update(ui.variablesInventory([scan], catalogs.componentCatalog?.revision), { fontDocument: doc, pageId })
  panel.element.setAttribute('aria-busy', 'false')
}
function invalidate() {
  if (panel.showingLayers) return
  clearTimeout(timer)
  timer = setTimeout(refreshInventory, 100)
}
const observer = new MutationObserver(records => {
  if (records.some(record => {
    if (record.target.closest?.('#localhost-inspector-outlines')) return false
    return record.type !== 'childList' || [...record.addedNodes, ...record.removedNodes]
      .some(node => node.id !== 'localhost-inspector-spacing-preview')
  })) invalidate()
})
window.addEventListener('pagehide', () => {
  clearTimeout(timer)
  observer.disconnect()
  panel.clearPreview()
})
function hover(event) {
  const node = event.composedPath()[0]
  layers.setHovered(node === doc || (outline && !outline.sourceKey) ? null : node)
}
function sync(event) { layers.setSelected(doc.querySelector('[data-localhost-inspector-selected]'), [], Boolean(event)) }
function syncCommand(event) {
  if (event.key === 'Meta') doc?.dispatchEvent(new CustomEvent('workspace-inspector-command', { detail: event.metaKey }))
}
window.addEventListener('keydown', syncCommand, true)
window.addEventListener('keyup', syncCommand, true)
window.addEventListener('blur', () => doc?.dispatchEvent(new CustomEvent('workspace-inspector-command', { detail: false })))
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && doc && !event.defaultPrevented) {
    event.preventDefault()
    if (parentOrigin) parent.postMessage('leave-variant-layers', parentOrigin)
  }
})
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== parentOrigin) return
  if (event.data?.type === 'dismiss-flow-popover') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    return
  }
  if (event.data?.type === 'variant-outline-hover') {
    if (outline) {
      outline.hoverKey = event.data.key
      outline.pathKeys = event.data.pathKeys
    }
    layers.syncOutlineHover()
    return
  }
  if (event.data?.type === 'variant-command') {
    doc?.dispatchEvent(new CustomEvent('workspace-inspector-command', { detail: event.data.held === true }))
    return
  }
  if (event.data?.type !== 'variant-layers-source' || !Number.isInteger(event.data.index)) return
  // Cross-origin parents can identify the sibling by index. Browser same-origin
  // checks still govern access to the actual app document.
  let next
  try { next = parent.frames[event.data.index]?.document } catch { /* The preview may still be navigating. */ }
  if (next === document || next?.location.origin !== location.origin || !next.body) next = null
  outline = event.data.reuse && outline
    ? { ...event.data.outline, items: outline.items, flows: outline.flows } : event.data.outline
  if (doc !== next) {
    doc?.removeEventListener('canvas-variant-selection', sync)
    doc?.removeEventListener('workspace-inspector-hover', hover, true)
    observer.disconnect()
    doc?.removeEventListener('input', invalidate, true)
    doc = next
    if (doc) {
      observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'data-state', 'hidden'] })
      doc.addEventListener('input', invalidate, true)
      invalidate()
    }
    layers.setHovered(null)
    doc?.addEventListener('canvas-variant-selection', sync)
    doc?.addEventListener('workspace-inspector-hover', hover, true)
  }
  panel.refreshLayers()
  if (doc) sync()
  if (event.data.flowMenu) layers.resumeFlowMenu(event.data.flowMenu)
})
