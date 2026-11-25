// Wheel events end at the embedded document. Forward canvas gestures in screen
// pixels; Command-scroll remains available to scroll inside the app.
export function forwardPreviewWheel(frameWindow, receiver, origin) {
  frameWindow.addEventListener('wheel', event => {
    if (event.metaKey && !event.ctrlKey) return
    event.preventDefault()
    event.stopImmediatePropagation()
    receiver.postMessage({
      type: 'canvas-preview-wheel', deltaX: event.deltaX, deltaY: event.deltaY,
      clientX: event.clientX, clientY: event.clientY, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
    }, origin)
  }, { capture: true, passive: false })
}

// A direct app preview opts in only when its local canvas identifies itself.
if (window.parent !== window) {
  function connect(event) {
    if (event.data !== 'connect-canvas-wheel' || event.source !== window.parent) return
    if (!/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(event.origin)) return
    window.removeEventListener('message', connect)
    forwardPreviewWheel(window, window.parent, event.origin)
    void import('./variant-inspection.mjs').then(({ connectVariantSelection }) => {
      connectVariantSelection(window.parent, event.origin)
      window.parent.postMessage('variant-inspection-ready', event.origin)
    })
  }
  window.addEventListener('message', connect)
}

// Cross-origin comparison confirms the source server and starting revision.
// No editing code is attached to this read-only Original frame.
if (parent !== window && window.name === 'inspector-source-original') {
  window.addEventListener('message', async event => {
    if (event.source !== parent || event.data?.type !== 'inspector-original-basis' ||
        !/^http:\/\/127\.0\.0\.1:\d+$/.test(event.origin)) return
    let basis
    try {
      const result = await fetch('/__inspector-flow/authored-original-basis', {cache:'no-store'})
      if (result.ok) ({ basis } = await result.json())
    } finally {
      parent.postMessage({type:'inspector-original-ready', basis, requestId:event.data.requestId}, event.origin)
    }
  })
}
