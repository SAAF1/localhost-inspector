// Runs in the app document, including when the active mapped frame is replaced.
import { mountVariantEditor } from './variant-editor.mjs'

const shell = parent.document
const frame = window.frameElement
if (shell.body.hasAttribute('data-canvas-editor') && frame === shell.querySelector('#app-preview') && frame.contentDocument === document) {
  const dock = shell.querySelector('#localhost-inspector-dock')
  const startup = window.localhostInspectorStartup
  delete window.localhostInspectorStartup
  const host = await mountVariantEditor(dock, { endpoint: '/__inspector-flow/workspace-inspector', startup,
    expanded: () => shell.body.hasAttribute('data-expanded') })
  if (frame === shell.querySelector('#app-preview') && frame.contentDocument === document && dock.firstElementChild === host) {
    frame.dataset.inspectorDocument = 'canvas'
  }
}
