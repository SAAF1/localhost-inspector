import './tokens.js'
import './styles.js'
import './icons.js'
import './dom.js'
import './tooltip.js'
import { createWorkspaceLayers } from './workspace-layers.mjs'

const ui = window.LocalhostInspector
const root = document.querySelector('#layers').attachShadow({ mode: 'open' })
const css = document.createElement('style')
css.textContent = ui.tokens + ui.styles +
  ':host{display:flex;flex-direction:column;background:var(--li-surface)}header{flex:none;display:flex;align-items:center;justify-content:space-between;padding:8px 12px 8px 16px;font-weight:600}main{overflow:auto;overscroll-behavior:contain;flex:1;min-height:0}'
const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = './workspace-layers.css'
const main = document.createElement('main')
const header = ui.element('header', '', 'Layers')
root.append(css, link, header, main)
let doc
let outline
const parentOrigin = document.referrer ? new URL(document.referrer).origin : null
const layers = createWorkspaceLayers({
  getDocument: () => doc,
  getOutline: () => outline,
  onOpenOutline(key, expanded) {
    if (parentOrigin) parent.postMessage({ type: 'open-outline-item', key, expanded }, parentOrigin)
  },
  componentFor: node => node.getAttribute('data-inspector-component-name') || undefined,
  selectNode(node) {
    // Stop at the app viewport; scrolling its canvas ancestor moves unrelated frames.
    node.scrollIntoView({ block: 'nearest', inline: 'nearest', container: 'nearest' })
    node.dispatchEvent(new Event('select-canvas-variant-layer', { bubbles: true }))
  },
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
  if (event.data?.type === 'variant-outline-hover') {
    if (outline) outline.hoverKey = event.data.key
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
  outline = event.data.outline
  if (doc !== next) {
    doc?.removeEventListener('canvas-variant-selection', sync)
    doc?.removeEventListener('workspace-inspector-hover', hover, true)
    doc = next
    layers.setHovered(null)
    doc?.addEventListener('canvas-variant-selection', sync)
    doc?.addEventListener('workspace-inspector-hover', hover, true)
  }
  layers.render(main, header)
  if (doc) sync()
})
