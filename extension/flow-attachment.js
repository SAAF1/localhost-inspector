export const flowPath = '/__inspector-flow/'

export function watchFlowFrame() {
  const frame = document.querySelector('#app-preview')
  if (!frame || frame.dataset.inspectorWatching) return
  frame.dataset.inspectorWatching = 'true'
  let sequence = 0
  const attach = () => {
    const current = ++sequence
    chrome.runtime.sendMessage({ type: 'attachFlowFrame' }).then(result => {
      if (sequence === current && result?.ok && result.value) frame.dataset.inspectorDocument = result.value
    }).catch(() => {})
  }
  frame.addEventListener('load', () => {
    delete frame.dataset.inspectorDocument
    attach()
  })
  attach()
}

export function isFlowChild(path) {
  try {
    return window.parent !== window && window.parent === window.top &&
      window.parent.location.pathname === path && window.frameElement === window.parent.document.querySelector('#app-preview') &&
      location.origin === window.parent.location.origin
  } catch { return false }
}

export function dockFlowInspector() {
  const shell = window.parent.document
  window.localhostInspectorDock = shell.querySelector('#localhost-inspector-dock')
  window.localhostInspectorCanOpenOnSelect = () => shell.body.hasAttribute('data-expanded')
}
