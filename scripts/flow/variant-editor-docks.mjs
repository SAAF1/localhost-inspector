// Retain a mounted dock with its live app. Switching frames must preserve edits,
// active operations and the Inspector's DOM references.
export function createVariantEditorDocks(originalDock) {
  const docks = new Map()
  function connect(frame) {
    const dock = docks.get(frame)
    if (!dock?.contentWindow) return
    for (let i = 0; i < window.frames.length; i++) {
      if (window.frames[i] !== dock.contentWindow) continue
      frame.app.contentWindow.postMessage({ type: 'mount-variant-editor', index: i }, frame.origin)
      return
    }
  }
  function prepare(frame) {
    let dock = docks.get(frame)
    if (!dock) {
      dock = document.createElement('iframe')
      dock.title = frame.label + ' properties'
      dock.hidden = true
      dock.src = new URL('/__inspector-flow/variant-editor.html', frame.origin).href
      dock.addEventListener('load', () => connect(frame))
      docks.set(frame, dock)
      originalDock.after(dock)
    }
    connect(frame)
    return dock
  }
  return {
    connect, prepare,
    show(frame) {
      const dock = prepare(frame)
      dock.id = 'variant-properties'
      dock.title = 'Variant properties'
      dock.hidden = false
    },
    hide(frame) {
      const dock = docks.get(frame)
      if (dock) {
        dock.removeAttribute('id')
        dock.title = frame.label + ' properties'
        dock.hidden = true
      }
    },
    dispose(frame) {
      docks.get(frame)?.remove()
      docks.delete(frame)
    },
  }
}
