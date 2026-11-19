(() => {
  const ui = window.LocalhostInspector
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
