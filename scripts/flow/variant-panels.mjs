import { createVariantEditorDocks } from './variant-editor-docks.mjs'
// The Layers viewer shares the preview's origin. The canvas selects its source
// frame, but never reads a foreign document or sends edits to the original.
export function createVariantPanels(pane, dock, changed, { getOutline, onOpenOutline }) {
  const layers = document.createElement('iframe')
  layers.title = 'Variant layers'
  layers.className = 'variant-layers'
  const details = document.createElement('aside')
  details.id = 'variant-properties'
  details.setAttribute('aria-label', 'Variant properties')
  const editors = createVariantEditorDocks(dock)
  let active
  let layersReady = false
  function connect() {
    if (!active || !layersReady || !layers.contentWindow) return
    for (let index = 0; index < window.frames.length; index++) {
      if (window.frames[index] === active.app.contentWindow) {
        layers.contentWindow.postMessage({ type: 'variant-layers-source', index, outline: getOutline?.() }, active.origin)
        break
      }
    }
  }
  function syncCommand(event) {
    if (active && layersReady && event.key === 'Meta') {
      layers.contentWindow?.postMessage({ type: 'variant-command', held: event.metaKey }, active.origin)
    }
  }
  window.addEventListener('keydown', syncCommand, true)
  window.addEventListener('keyup', syncCommand, true)
  layers.addEventListener('load', () => {
    layersReady = true
    connect()
  })
  window.addEventListener('message', event => {
    if (!active || event.origin !== active.origin || event.source !== layers.contentWindow) return
    if (event.data === 'leave-variant-layers') active.stop()
    else if (event.data?.type === 'open-outline-item' && typeof event.data.key === 'string') {
      onOpenOutline?.(event.data.key, typeof event.data.expanded === 'boolean' ? event.data.expanded : undefined)
    }
  })
  function properties(node) {
    const title = document.createElement('h2')
    title.textContent = active.label
    details.replaceChildren(title)
    if (!node || typeof node.name !== 'string') return
    const fields = document.createElement('dl')
    for (const [label, value] of [['Layer', node.name], ['Width', node.width], ['Height', node.height],
      ['Text color', node.color], ['Background', node.background], ['Font', node.font]]) {
      if (typeof value !== 'string' && !Number.isFinite(value)) continue
      const term = document.createElement('dt')
      const description = document.createElement('dd')
      term.textContent = label
      description.textContent = String(value).slice(0, 250)
      fields.append(term, description)
    }
    details.append(fields)
  }
  return {
    get active() { return active },
    leave() { active?.stop() },
    refreshOutline: connect,
    setOutlineHover() {
      if (active && layersReady) layers.contentWindow?.postMessage({ type: 'variant-outline-hover', key: getOutline?.()?.hoverKey }, active.origin)
    },
    update(frame, action, node) {
      if (action === 'start') {
        if (active !== frame) active?.stop()
        active = frame
        layersReady = false
        layers.src = new URL('/__inspector-flow/variant-layers.html', frame.origin).href
        pane.append(layers)
        if (frame.editable) editors.show(frame)
        else dock.after(details)
        dock.setAttribute('data-variant-inspection', '')
        pane.setAttribute('data-variant-inspection', '')
        if (!frame.editable) properties(null)
        changed()
      } else if (frame === active && action === 'stop') {
        active = null
        layersReady = false
        layers.remove()
        details.remove()
        editors.hide(frame)
        dock.removeAttribute('data-variant-inspection')
        pane.removeAttribute('data-variant-inspection')
        changed()
      } else if (action === 'dispose') editors.dispose(frame)
      else if (action === 'restore') editors.prepare(frame)
      else if (action === 'ready') editors.connect(frame)
      else if (frame === active && action === 'reload') {
        if (!frame.editable) properties(null)
        connect()
      } else if (frame === active && action === 'selection' && !frame.editable) properties(node)
    },
  }
}
