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
