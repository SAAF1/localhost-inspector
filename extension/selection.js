(() => {
  const ui = window.LocalhostInspector
  ui.createSelection = ({ host, panel, get, onSelect, openPanel, inspect, relatedPadding }) => {
    let selected
    let selectedGroup = []
    let textPreview = []
    let hovered
    let menuTarget
    let pointer
    let commandHeld = false
    let selectionObserver
    let outlineFrame = null
    let showRelated = false
    function positionOutline(outline, node, inset = 0) {
      outline.hidden = !node?.isConnected
      if (outline.hidden) return
      const box = node.getBoundingClientRect()
      const geometry = {
        left: box.left + inset, top: box.top + inset,
        width: Math.max(0, box.width - 2 * inset), height: Math.max(0, box.height - 2 * inset),
      }
      for (const [property, pixels] of Object.entries(geometry)) {
        const value = pixels + 'px'
        if (outline.style[property] !== value) outline.style[property] = value
      }
    }
    function syncOutline() {
      positionOutline(get('outline'), panel.hidden ? null : selected)
      const layer = get('related-outlines')
      const peers = selectedGroup.length ? selectedGroup : showRelated && !panel.hidden ? relatedPadding().filter(node => node.isConnected && node !== selected) : []
      while (layer.childElementCount > peers.length) layer.lastElementChild.remove()
      for (const [index, node] of peers.entries()) {
        if (!layer.children[index]) layer.append(ui.element('div', 'li-outline li-outline-related'))
        layer.children[index].classList.toggle('li-outline-related', !selectedGroup.length)
        positionOutline(layer.children[index], node)
      }
    }
    function pointedElement({ x, y }) {
      let node = document.elementFromPoint(x, y)
      if (node === host) return null
      while (node?.shadowRoot) {
        const inner = node.shadowRoot.elementFromPoint(x, y)
        if (!inner || inner === node) break
        node = inner
      }
      if (node instanceof SVGElement) {
        while (node.ownerSVGElement) node = node.ownerSVGElement
        return node
      }
      if (!(node instanceof HTMLElement)) return null
      // Decorative icons often pass pointer events through to their control.
      const icons = node.querySelectorAll(node.matches('button,a,label,[role="button"]') ? 'svg' : ':scope > svg')
      for (let i = icons.length - 1; i >= 0; i--) {
        const icon = icons[i]
        if (icon.ownerSVGElement) continue
        const box = icon.getBoundingClientRect()
        if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue
        const style = getComputedStyle(icon)
        if (style.pointerEvents === 'none' && style.visibility === 'visible') return icon
      }
      return node
    }
    function syncHoverOutline() {
      hovered = !panel.hidden && commandHeld && pointer ? pointedElement(pointer) : null
      const target = menuTarget?.()
      const outline = get('hover-outline')
      outline.toggleAttribute('data-menu-preview', Boolean(target))
      const preview = panel.hidden ? [] : textPreview
      const extras = get('text-hover-outlines')
      while (extras.childElementCount > Math.max(0, preview.length - 1)) extras.lastElementChild.remove()
      for (let i = 1; i < preview.length; i++) {
        if (!extras.children[i - 1]) extras.append(ui.element('div', 'li-outline li-outline-hover'))
        positionOutline(extras.children[i - 1], preview[i])
      }
      const candidate = preview[0] ?? target ?? hovered
      positionOutline(outline, candidate === selected && !panel.hidden ? null : candidate, target ? 2 : 0)
    }
    function syncOutlines() {
      syncOutline()
      syncHoverOutline()
    }
    function select(node, group = []) {
      selectedGroup = group
      textPreview = []
      showRelated = false
      menuTarget = null
      selected = node
      selectionObserver?.disconnect()
      if (node || group.length) {
        selectionObserver = new ResizeObserver(syncOutline)
        for (const item of node ? [node] : group) selectionObserver.observe(item)
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
      return event.isTrusted && event.metaKey && event.button === 0 && !event.composedPath().includes(host)
    }
    function preventPress(event) {
      if (!isSelectionGesture(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('pointerdown', preventPress, true)
    document.addEventListener('mousedown', preventPress, true)
    document.addEventListener('click', event => {
      if (!event.isTrusted || event.composedPath().includes(host)) return
      if (!event.metaKey) {
        if (!panel.hidden) select(null)
        return
      }
      if (!isSelectionGesture(event)) return
      const node = pointedElement({ x: event.clientX, y: event.clientY })
      if (!node) return
      event.preventDefault()
      event.stopImmediatePropagation()
      inspect()
      if (panel.hidden) openPanel()
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
      if (selectedGroup.some(node => !node.isConnected)) select(null)
      if (hovered && !hovered.isConnected) syncHoverOutline()
      if (panel.hidden || !(selected || selectedGroup.length || textPreview.length || (commandHeld && pointer)) || outlineFrame !== null) return
      // A sibling can move the target without resizing it.
      outlineFrame = requestAnimationFrame(() => {
        outlineFrame = null
        syncOutlines()
      })
    }
    return {
      get current() { return selected },
      get group() { return selectedGroup },
      previewText(nodes) {
        textPreview = nodes
        syncHoverOutline()
      },
      selectText(nodes) {
        if (nodes.length === 1) select(nodes[0])
        else select(null, nodes)
      },
      previewRelated(resolve) {
        menuTarget = resolve
        syncHoverOutline()
      },
      showRelated(value) {
        if (value === showRelated) return
        showRelated = value
        syncOutline()
      },
      parent, select, refresh, syncOutline, syncOutlines,
    }
  }
})()
