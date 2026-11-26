// Selection lives in the variant document, including when its dock is on a sibling frame.
export function connectVariantSelection(receiver, origin) {
  let selected
  let active = false
  let mounting
  let inspector
  const attribute = 'data-localhost-inspector-selected'
  const hoverAttribute = 'data-localhost-inspector-hovered'
  let pointed
  let hovered
  const sheet = new CSSStyleSheet()
  sheet.replaceSync('[' + attribute + '],[' + hoverAttribute + '] { outline: 2px solid #0075d8 !important; outline-offset: -2px !important }')
  // Static previews have no editor to publish a hover target to Layers.
  function setStaticHover(node) {
    if (hovered === node) return
    hovered?.removeAttribute(hoverAttribute)
    hovered = node
    hovered?.setAttribute(hoverAttribute, '')
    const target = hovered || document
    target.dispatchEvent(new Event('workspace-inspector-hover', { bubbles: true, composed: true }))
  }
  function clearPointer() {
    pointed = null
    setStaticHover(null)
  }
  document.addEventListener('pointermove', event => {
    if (!active || inspector || event.pointerType === 'touch') return
    const node = event.composedPath()[0]
    pointed = node.closest?.('svg') || node
    setStaticHover(event.metaKey ? pointed : null)
  }, true)
  function updateCommand(event) {
    if (active && !inspector && event.key === 'Meta') setStaticHover(event.metaKey ? pointed : null)
  }
  document.addEventListener('workspace-inspector-command', event => {
    if (active && !inspector) setStaticHover(event.detail === true ? pointed : null)
  })
  window.addEventListener('keydown', updateCommand, true)
  window.addEventListener('keyup', updateCommand, true)
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) clearPointer() }, true)
  document.addEventListener('pointercancel', clearPointer, true)
  window.addEventListener('blur', clearPointer)
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearPointer() })
  function mark(node) {
    selected?.removeAttribute(attribute)
    selected = node?.closest('svg') || node
    selected?.setAttribute(attribute, '')
    document.dispatchEvent(new Event('canvas-variant-selection'))
    if (inspector) {
      receiver.postMessage({ type: 'variant-selection', details: selected ? { selected: true } : null }, origin)
      return
    }
    const style = selected && getComputedStyle(selected)
    const bounds = selected?.getBoundingClientRect()
    receiver.postMessage({ type: 'variant-selection', details: selected ? {
      name: selected.getAttribute('aria-label') || selected.getAttribute('data-slot') || selected.localName,
      width: Math.round(bounds.width), height: Math.round(bounds.height),
      color: style.color, background: style.backgroundColor,
      font: style.fontSize + ' ' + style.fontFamily,
    } : null }, origin)
  }
  function select(node) {
    const target = node?.closest('svg') || node
    if (inspector && target && !target.dispatchEvent(new Event('select-inspector-variable-use',
      { bubbles: true, composed: true, cancelable: true }))) return
    mark(target)
  }
  // Inspector-side selection (e.g. Select parent or a saved edit) drives Layers too.
  document.addEventListener('workspace-inspector-selection', event => {
    const node = event.composedPath()[0]
    mark(node === document ? null : node)
  }, true)
  async function mount(index) {
    if (!Number.isInteger(index)) return
    let doc
    try { doc = parent.frames[index]?.document } catch { return }
    if (doc?.location.pathname !== '/__inspector-flow/variant-editor.html') return
    const dock = doc.getElementById('variant-dock')
    if (!dock) return
    if (!mounting) {
      mounting = import('./variant-editor.mjs').then(({ mountVariantEditor }) => mountVariantEditor(dock))
      try { inspector = await mounting } catch {
        doc.querySelector('output').textContent = 'Could not open the variant inspector. Reload the preview to retry.'
        return
      }
      clearPointer()
      // Native Inspector outlines now own painting, including hover and multi-selection.
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet)
      if (active) {
        inspector.dispatchEvent(new Event('open-workspace-inspector'))
        if (selected) select(selected)
      } else inspector.dispatchEvent(new Event('hide-workspace-inspector'))
    }
  }
  const observer = new MutationObserver(() => {
    if (selected && !selected.isConnected) select(null)
  })
  function commandClick(event) {
    if (!active || !event.isTrusted || !event.metaKey || event.button !== 0) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === 'click') select(event.composedPath()[0])
  }
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick']) {
    window.addEventListener(type, commandClick, true)
  }
  document.addEventListener('select-canvas-variant-layer', event => {
    if (!active || !(event.target instanceof Element)) return
    select(event.target)
    const rect = event.target.getBoundingClientRect()
    receiver.postMessage({ type: 'focus-variant-layer', x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2 }, origin)
  })
  window.addEventListener('keydown', event => {
    if (active && event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault()
      receiver.postMessage('leave-linked-frame', origin)
    }
  })
  window.addEventListener('message', event => {
    if (event.source !== receiver || event.origin !== origin) return
    if (event.data?.type === 'mount-variant-editor') {
      void mount(event.data.index)
      return
    }
    if (event.data?.type === 'inspect-canvas-variant') {
      if (!active) {
        observer.observe(document.documentElement, { childList: true, subtree: true })
        if (inspector) inspector.dispatchEvent(new Event('open-workspace-inspector'))
        else document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      }
      active = true
      const point = event.data.point
      if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) select(document.elementFromPoint(point.x, point.y))
    } else if (event.data === 'stop-inspecting-variant' && active) {
      active = false
      clearPointer()
      observer.disconnect()
      if (inspector) {
        inspector.dispatchEvent(new Event('clear-workspace-selection', { cancelable: true }))
        inspector.dispatchEvent(new Event('hide-workspace-inspector'))
      }
      select(null)
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet)
    }
  })
}
