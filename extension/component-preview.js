// Runs in the selected document's app world via chrome.scripting. Keep this
// function self-contained and pass only the mounted component's public data.
export async function componentPreviewRequest(request, origin) {
  const route = location.pathname + location.search + (/^#!?\//.test(location.hash) ? location.hash : '')
  if (location.origin !== origin || route !== request.route) return null
  const nodes = document.querySelectorAll('[data-inspector-component="' + CSS.escape(request.id) + '"]')
  if (nodes.length !== 1) return null
  const component = nodes[0][Symbol.for('localhost-inspector.component.v1')]
  if (!component) return null
  if (request.type === 'inspectComponent') return component.inspect()
  if (request.type === 'previewComponentSlot') return component.preview(request.slotId, request.before, request.requested)
  return null
}

export async function previewButtonSize(key, before, requested, route, origin) {
  // Fixed operation in the app world. No source path, extension data or general
  // command dispatcher is exposed to the app.
  const getRoute = () => location.pathname + location.search + (/^#!?\//.test(location.hash) ? location.hash : '')
  if (location.origin !== origin || getRoute() !== route) return false
  const registration = window.localhostInspectorButtonSize
  const selector = '[data-inspector-target="' + CSS.escape(key) + '"]'
  const node = document.querySelector(selector)
  const ownsNode = () => node?.isConnected && node === registration?.node && node.localName === 'button' &&
    node.getAttribute('data-slot') === 'button' && node.getAttribute('data-inspector-target') === key &&
    window.localhostInspectorButtonSize === registration
  const valid = () => ownsNode() && getRoute() === route
  const size = () => node.getAttribute('data-inspector-button-size')
  const unique = () => document.querySelectorAll(selector).length === 1
  if (!valid() || !unique() || typeof registration.setSize !== 'function' || size() !== before) return false
  if (before === requested) return true
  // React must acknowledge through the selected Button's committed DOM.
  registration.setSize(requested)
  const waitForSize = async value => {
    const deadline = performance.now() + 450
    while (valid() && size() !== value && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 16))
    }
    return valid() && size() === value
  }
  if (await waitForSize(requested) && unique()) return true
  if (ownsNode() && (size() === before || size() === requested)) {
    registration.setSize(before)
    await waitForSize(before)
  }
  return false
}
