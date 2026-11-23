(() => {
  const ui = window.LocalhostInspector
  const ids = new WeakMap()
  const nodes = new Map()
  const cleanup = new FinalizationRegistry(id => nodes.delete(id))
  const excluded = 'input,textarea,select,script,style,svg,[contenteditable]:not([contenteditable="false"]),#localhost-inspector,#localhost-inspector-dock'
  function editable(text) {
    const parent = text?.parentElement
    if (text?.nodeType !== Node.TEXT_NODE || !parent?.isConnected || parent.closest(excluded) ||
        text.length > 16000 || getComputedStyle(parent).visibility !== 'visible') return false
    if (!text.data.trim()) return text.length === 0 && ids.has(text)
    const range = document.createRange()
    range.selectNodeContents(text)
    return Array.from(range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)
  }
  function singleLabel(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    let found
    while (walker.nextNode()) {
      const text = walker.currentNode
      if (!editable(text) || text.parentElement.closest('[aria-hidden="true"],[hidden]')) continue
      if (found) return null
      found = text
    }
    return found
  }
  function targetFor(text) {
    let mount = ids.get(text)
    if (!mount) {
      mount = crypto.randomUUID()
      ids.set(text, mount)
      nodes.set(mount, new WeakRef(text))
      cleanup.register(text, mount)
    }
    return { kind: 'text', mount, field: 'text', definition: 'Rendered text', tag: text.parentElement.localName,
      key: mount, slot: 'Text', id: null }
  }
  function bind(canStart, commit) {
    let active
    document.addEventListener('dblclick', event => {
      if (!event.isTrusted || event.button !== 0 || !canStart() || event.target.closest?.(excluded)) return
      const caret = document.caretRangeFromPoint(event.clientX, event.clientY)
      const text = caret?.startContainer
      if (!editable(text) || !event.target.contains(text)) return
      const range = document.createRange()
      range.selectNodeContents(text)
      if (![...range.getClientRects()].some(r => r.left <= event.clientX && event.clientX <= r.right &&
          r.top <= event.clientY && event.clientY <= r.bottom)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      active?.blur()
      const editor = document.createElement('textarea')
      editor.id = 'localhost-inspector-text-editor'
      editor.setAttribute('aria-label', 'Edit text')
      editor.maxLength = 16000
      const before = text.data
      const url = location.href
      editor.value = before
      const rect = range.getBoundingClientRect()
      const style = getComputedStyle(text.parentElement)
      Object.assign(editor.style, { all: 'initial', position: 'fixed', zIndex: '2147483647', boxSizing: 'border-box',
        left: rect.left + 'px', top: rect.top + 'px', width: Math.max(rect.width + 2, 24) + 'px',
        height: Math.max(rect.height + 2, parseFloat(style.lineHeight) || 0) + 'px', resize: 'none',
        font: style.font, color: 'CanvasText', letterSpacing: style.letterSpacing, background: 'Canvas',
        outline: '1px solid Highlight', caretColor: 'auto', overflow: 'auto' })
      const listeners = new AbortController()
      active = editor
      const finish = save => {
        if (active !== editor) return
        active = null
        listeners.abort()
        editor.remove()
        if (save && location.href === url && editor.value !== before) commit(text, before, editor.value)
      }
      const finishOnMove = event => { if (event.target !== editor) finish(true) }
      window.addEventListener('resize', finishOnMove, { signal: listeners.signal })
      document.addEventListener('scroll', finishOnMove, { capture: true, signal: listeners.signal })
      editor.onblur = () => finish(true)
      editor.onkeydown = e => {
        e.stopPropagation()
        if (e.isComposing) return
        if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault()
          finish(e.key === 'Enter')
        }
      }
      document.body.append(editor)
      editor.focus({ preventScroll: true })
      editor.setSelectionRange(caret.startOffset, caret.startOffset)
    }, true)
  }
  ui.textEditing = { singleLabel, targetFor, bind, resolve: id => nodes.get(id)?.deref() }
})();
(() => {
  const ui = window.LocalhostInspector
  ui.sourceComponentRequest = (node, request) => {
    if (!node?.isConnected) return null
    let result = null
    const read = event => {
      if (event.target === node && typeof event.detail === 'string') result = JSON.parse(event.detail)
    }
    node.addEventListener('localhost-inspector-component-result', read)
    try {
      node.dispatchEvent(new CustomEvent('localhost-inspector-component-props', { bubbles: true,
        detail: JSON.stringify({ ...request, id: node.getAttribute('data-inspector-instance'),
          source: node.getAttribute('data-inspector-source') }) }))
    } finally { node.removeEventListener('localhost-inspector-component-result', read) }
    return result
  }
  const sourceMount = 'data-inspector-instance'
  const registeredMount = 'data-inspector-component'
  const liveNode = target => {
    if (target.kind === 'text') {
      const text = ui.textEditing.resolve(target.mount)
      return text?.isConnected ? text.parentElement : null
    }
    const marker = target.kind === 'source' ? sourceMount : registeredMount
    const hits = document.querySelectorAll('[' + marker + '="' + CSS.escape(target.mount) + '"]')
    const source = target.kind === 'source' ? 'data-inspector-source' : 'data-inspector-component-definition'
    return hits.length === 1 && hits[0].getAttribute(source) === target.definition ? hits[0] : null
  }
  function state(field, kind) {
    return kind === 'source' ? { value: field.value, overridden: Boolean(field.overridden) } :
      { value: field.value, visible: field.visible }
  }
  const equal = (a, b) => Boolean(a && b && a.value === b.value && a.visible === b.visible && a.overridden === b.overridden)
  async function read(target, route) {
    const node = liveNode(target)
    if (!node) return null
    if (target.kind === 'text') return { value: ui.textEditing.resolve(target.mount).data, visible: true }
    const instance = target.kind === 'source' ? ui.sourceComponentRequest(node, { type: 'inspect' }) : await ui.inspectComponent(node, route)
    const field = (target.kind === 'source' ? instance?.properties : instance?.slots)?.find(item => item.id === target.field)
    return field && !field.unavailableReason ? state(field, target.kind) : null
  }
  async function change(target, route, before, desired) {
    const node = liveNode(target)
    if (!node || !equal(await read(target, route), before)) throw Error('The component changed. Select it again before editing.')
    if (target.kind === 'text') {
      const text = ui.textEditing.resolve(target.mount)
      if (!text?.isConnected || text.data !== before.value) throw Error('The app updated this text.')
      text.data = desired.value
      return { value: text.data, visible: true }
    }
    const applied = target.kind === 'source'
      ? ui.sourceComponentRequest(node, { type: 'preview', key: target.field, before: before.value,
        requested: desired.value, reset: desired.overridden === false })
      : (await window.phaseABridge({ type: 'previewComponentSlot', id: target.mount, slotId: target.field,
        route, before, requested: desired }))?.status === 'applied'
    if (!applied) throw Error('The component did not confirm its property change.')
    const after = await read(target, route)
    if (!after) throw Error('The component was replaced while updating.')
    return after
  }
  // Older runtimes exposed override ownership before these previews had a journal.
  // Only inspect finite fields on roots which positively confirm that ownership.
  function activeOverrides() {
    const result = []
    for (const node of document.querySelectorAll('[' + sourceMount + ']')) {
      const info = ui.sourceComponentRequest(node, { type: 'inspect' })
      for (const field of info?.properties ?? []) if (field.overridden && field.options?.length) {
        result.push({ target: { kind: 'source', mount: info.id, definition: info.source, field: field.id },
          state: state(field, 'source') })
      }
    }
    return result
  }
  ui.componentEdits = { liveNode, state, read, change, equal, activeOverrides }
  // Use the closest registered component when a label or icon was clicked.
  // Mount IDs expire on remount and must never become durable edit targets.
  ui.inspectComponent = async (node, route) => {
    const root = node?.closest('[data-inspector-component]')
    if (!root?.isConnected) return null
    const id = root.getAttribute('data-inspector-component')
    const result = await window.phaseABridge({ type: 'inspectComponent', route, id })
    return root.isConnected && root.getAttribute('data-inspector-component') === id && result?.id === id ? result : null
  }
})()
