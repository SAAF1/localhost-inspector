(() => {
  const ui = window.LocalhostInspector
  ui.createSelection = ({ host, panel, get, onSelect }) => {
    let selected
    let hovered
    let pointer
    let commandHeld = false
    let selectionObserver
    let outlineFrame = null
    function positionOutline(outline, node) {
      outline.hidden = panel.hidden || !node?.isConnected
      if (outline.hidden) return
      const box = node.getBoundingClientRect()
      for (const property of ['left', 'top', 'width', 'height']) {
        const value = box[property] + 'px'
        if (outline.style[property] !== value) outline.style[property] = value
      }
    }
    function syncOutline() {
      positionOutline(get('outline'), selected)
    }
    function pointedElement() {
      const { x, y } = pointer
      let node = document.elementFromPoint(x, y)
      if (node === host) return null
      while (node?.shadowRoot) {
        const inner = node.shadowRoot.elementFromPoint(x, y)
        if (!inner || inner === node) break
        node = inner
      }
      while (node && !(node instanceof HTMLElement)) node = node.parentElement || node.getRootNode().host
      return node
    }
    function syncHoverOutline() {
      hovered = !panel.hidden && commandHeld && pointer ? pointedElement() : null
      positionOutline(get('hover-outline'), hovered === selected ? null : hovered)
    }
    function syncOutlines() {
      syncOutline()
      syncHoverOutline()
    }
    function select(node) {
      selected = node
      selectionObserver?.disconnect()
      if (node) {
        selectionObserver = new ResizeObserver(syncOutline)
        selectionObserver.observe(node)
      }
      onSelect()
      syncOutlines()
    }
    window.addEventListener('scroll', syncOutlines, true)
    window.addEventListener('resize', syncOutlines)
    document.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return
      pointer = { x: event.clientX, y: event.clientY }
      commandHeld = event.metaKey
      syncHoverOutline()
    }, true)
    function clearPointer() {
      pointer = null
      commandHeld = false
      syncHoverOutline()
    }
    document.addEventListener('pointerout', event => { if (!event.relatedTarget) clearPointer() }, true)
    document.addEventListener('pointercancel', clearPointer, true)
    function updateCommand(event) {
      if (event.key !== 'Meta') return
      commandHeld = event.metaKey
      syncHoverOutline()
    }
    window.addEventListener('keydown', updateCommand, true)
    window.addEventListener('keyup', updateCommand, true)
    window.addEventListener('blur', clearPointer)
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearPointer() })
    const panelWindow = host.ownerDocument.defaultView
    if (panelWindow !== window) {
      function watchPanelWindow() {
        const listeners = new AbortController()
        const options = { capture: true, signal: listeners.signal }
        panelWindow.addEventListener('keydown', updateCommand, options)
        panelWindow.addEventListener('keyup', updateCommand, options)
        panelWindow.addEventListener('blur', clearPointer, options)
        window.addEventListener('pagehide', () => listeners.abort(), { once: true })
      }
      watchPanelWindow()
      window.addEventListener('pageshow', event => {
        if (!event.persisted) return
        watchPanelWindow()
        syncOutlines()
      })
    }
    function isSelectionGesture(event) {
      return event.isTrusted && !panel.hidden && event.metaKey && event.button === 0 && !event.composedPath().includes(host)
    }
    function preventPress(event) {
      if (!isSelectionGesture(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('pointerdown', preventPress, true)
    document.addEventListener('mousedown', preventPress, true)
    document.addEventListener('click', event => {
      if (!event.isTrusted || event.composedPath().includes(host) || panel.hidden) return
      if (!event.metaKey) { select(null); return }
      if (!isSelectionGesture(event)) return
      const node = event.composedPath().find(target => target instanceof HTMLElement)
      if (!node) return
      event.preventDefault()
      event.stopImmediatePropagation()
      select(node)
      panel.focus({ preventScroll: true })
    }, true)
    function parent() {
      if (!selected?.isConnected) return null
      const node = selected.parentElement ?? selected.getRootNode().host
      return node instanceof HTMLElement ? node : null
    }
    function refresh() {
      if (selected && !selected.isConnected) select(null)
      if (hovered && !hovered.isConnected) syncHoverOutline()
      if (panel.hidden || !(selected || (commandHeld && pointer)) || outlineFrame !== null) return
      // A sibling can move the target without resizing it.
      outlineFrame = requestAnimationFrame(() => {
        outlineFrame = null
        syncOutlines()
      })
    }
    return {
      get current() { return selected },
      parent, select, refresh, syncOutline, syncOutlines,
    }
  }
})()
