import { forwardPreviewWheel } from './preview-wheel.mjs'
import { resolveProposalFrame } from './proposal-view.mjs'
import { replayFrame } from './replay.mjs'

const app = document.querySelector('#app-preview')
const status = document.querySelector('output')
try {
  const map = await fetch('./map.json', { headers: { 'X-Inspector-Preview-Origins': 'on-demand' } }).then(response => response.json())
  const params = new URLSearchParams(location.hash.slice(1))
  const page = params.get('page')
  const frame = resolveProposalFrame(map.frames, params.get('frame'), page, location.origin)
  if (map.origin !== location.origin || !frame || !map.comparison) throw Error('Unknown linked screen')
  function leave(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    parent.postMessage('leave-linked-frame', map.comparison.otherOrigin)
  }
  window.addEventListener('keydown', leave)
  app.addEventListener('load', () => {
    const document = app.contentDocument
    if (!document) return
    document.addEventListener('keydown', leave)
    forwardPreviewWheel(document.defaultView, parent, map.comparison.otherOrigin)
    // Command-click belongs to the canvas even while this app accepts ordinary clicks.
    function reserveCanvasClick(event) {
      if (!event.isTrusted || !event.metaKey || event.button !== 0) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick']) {
      document.defaultView.addEventListener(type, reserveCanvasClick, true)
    }
  })
  app.src = page || frame.route
  await replayFrame(app, { ...frame, route: app.getAttribute('src') }, () => app.isConnected)
  status.hidden = true
} catch {
  app.hidden = true
  status.textContent = 'Could not open this linked screen.'
}
