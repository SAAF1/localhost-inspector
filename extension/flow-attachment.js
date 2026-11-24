export const flowPath = '/__inspector-flow/'

export function watchFlowFrame() {
  // A saved canvas owns its journal in every browser, including paired Chrome.
  if (document.body.hasAttribute('data-canvas-editor')) return
  if (window.localhostInspectorWatchFrame) {
    window.localhostInspectorWatchFrame()
    return
  }
  document.body.dataset.inspectorWatching = 'true'
  let frame
  let sequence = 0

  function attach() {
    const selected = frame
    if (!selected) return
    delete selected.dataset.inspectorDocument
    const current = ++sequence
    chrome.runtime.sendMessage({ type: 'attachFlowFrame' }).then(result => {
      if (current === sequence && selected === frame && result?.ok && result.value) {
        selected.dataset.inspectorDocument = result.value
      }
    }).catch(() => {})
  }

  function connect() {
    const next = document.querySelector('#app-preview')
    if (frame === next) return
    frame?.removeEventListener('load', attach)
    frame = next
    frame?.addEventListener('load', attach)
    attach()
  }

  new MutationObserver(connect).observe(document.querySelector('#viewport'), {
    childList: true, subtree: true, attributes: true, attributeFilter: ['id'],
  })
  window.localhostInspectorWatchFrame = () => {
    if (frame === document.querySelector('#app-preview')) attach()
    else connect()
  }
  connect()
}

export function isFlowChild(path) {
  try {
    return window.parent !== window && window.parent === window.top && !window.parent.document.body.hasAttribute('data-canvas-editor') &&
      window.parent.location.pathname === path && window.frameElement === window.parent.document.querySelector('#app-preview') &&
      location.origin === window.parent.location.origin
  } catch { return false }
}

export function dockFlowInspector() {
  const shell = window.parent.document
  window.localhostInspectorDock = shell.querySelector('#localhost-inspector-dock')
  window.localhostInspectorIsCanvasExpanded = () => shell.body.hasAttribute('data-expanded')
}
