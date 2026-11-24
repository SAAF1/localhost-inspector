import { requestInspector } from './inspector-request.mjs'
import { componentPreviewRequest, previewButtonSize } from './component-preview.js'

// The app and dock are sibling documents on this variant's isolated origin.
// The extension's normal UI and recovery code run in the app's own realm.
export async function mountVariantEditor(dock, { endpoint = '/__inspector-flow/variant-inspector', expanded = () => true, startup } = {}) {
  window.localhostInspectorDock = dock
  window.localhostInspectorIsCanvasExpanded = expanded
  window.localhostInspectorFontURL = '/__inspector-flow/inter-latin.woff2'
  window.phaseABridge = async message => {
    if (message.type === 'inspectComponent' || message.type === 'previewComponentSlot') {
      return componentPreviewRequest(message, location.origin)
    }
    if (message.type === 'previewButtonSize') {
      return previewButtonSize(message.key, message.before, message.requested, message.route, location.origin)
    }
    if (startup && Number.isSafeInteger(message.expectedRevision)) return startup.write(message)
    const pending = startup?.take(message)
    if (pending) {
      const result = await pending
      if (result) return result.value
    }
    return requestInspector(endpoint, message)
  }
  await import('./variant-runtime.mjs')
  await window.phaseAInspectorReady
  return dock.firstElementChild
}
