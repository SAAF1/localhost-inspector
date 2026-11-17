import { renderFrames } from './render-frames.mjs'
import { flowRoute, observeSurfaces } from './page-state.mjs'
import { findControl, matchesCheckpoint, openControl, waitFor } from './replay.mjs'

const map = document.querySelector('#map')
let preview = document.querySelector('#app-preview')
const viewport = document.querySelector('#viewport')
const toggle = document.querySelector('#flow-toggle')
const zoom = document.querySelector('#zoom')
const notice = document.querySelector('#notice')
const dock = document.querySelector('#localhost-inspector-dock')
const data = await fetch('./map.json').then(response => response.json())
if (data.origin !== location.origin) throw Error('This flow map belongs to a different app origin')
const { width, height } = data.viewport
const cards = renderFrames(map, data, activate)
const routeOf = frame => {
  try {
    const address = frame.contentWindow.location
    return address.origin === location.origin ? flowRoute(address) : null
  } catch { return null }
}
const labelHeight = 45
const camera = { x: 34, y: 28, scale: .36 }
let active
let request = 0
let pendingCard
let candidate
let expanded = false
let unmapped = false

function message(text) {
  notice.value = text
  notice.hidden = !text
}

function position() {
  map.style.transform = 'translate(' + camera.x + 'px,' + camera.y + 'px) scale(' + camera.scale + ')'
  zoom.value = Math.round(camera.scale * 100) + '%'
  if (!expanded || !active) return
  const card = cards.get(active)
  preview.style.left = camera.x + card.x * camera.scale + 'px'
  preview.style.top = camera.y + (card.y + labelHeight) * camera.scale + 'px'
  preview.style.transform = 'scale(' + camera.scale + ')'
}

function setActive(id) {
  if (active) {
    cards.get(active).button.classList.remove('active')
    cards.get(active).button.setAttribute('aria-pressed', 'false')
  }
  active = id
  if (id) {
    cards.get(id).button.classList.add('active')
    cards.get(id).button.setAttribute('aria-pressed', 'true')
  }
}

function center(id) {
  const card = cards.get(id)
  camera.x = Math.round((viewport.clientWidth - width * camera.scale) / 2 - card.x * camera.scale)
  camera.y = Math.round((viewport.clientHeight - height * camera.scale) / 2 - card.y * camera.scale)
}

function setPending(card) {
  pendingCard?.removeAttribute('aria-busy')
  pendingCard = card
  pendingCard?.setAttribute('aria-busy', 'true')
}

function currentFrame() {
  const route = routeOf(preview)
  const doc = preview.contentDocument
  if (!route || !doc?.body?.innerText.trim()) return
  const onRoute = data.frames.filter(frame => frame.route === route)
  const surfaces = observeSurfaces(doc)
  const exact = onRoute.filter(frame => frame.steps.length && matchesCheckpoint(doc, frame, surfaces))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return exact.find(frame => frame.id === active) ?? onRoute.find(frame => !frame.steps.length)
  return onRoute.find(frame => !frame.steps.length)
}

function syncLiveFrame(recenter = false) {
  if (!expanded || candidate) return
  const frame = currentFrame()
  if (!frame) {
    if (preview.contentDocument?.readyState !== 'complete') return
    setActive(null)
    preview.style.visibility = 'hidden'
    dock.inert = true
    unmapped = true
    message('The current page is outside this map')
    return
  }
  if (frame.id !== active || recenter) {
    const previous = data.frames.find(item => item.id === active)
    setActive(frame.id)
    if (recenter || previous?.route !== frame.route) center(frame.id)
    position()
  }
  if (unmapped) { unmapped = false; message('') }
  preview.style.visibility = ''
  if (!dock.style.visibility) dock.inert = false
}

function cancelCandidate() {
  request++
  candidate?.remove()
  candidate = null
  setPending(null)
}

async function activate(frame) {
  if (frame.id === active && !preview.style.visibility && routeOf(preview) === frame.route &&
      matchesCheckpoint(preview.contentDocument, frame) &&
      (frame.steps.length || (currentFrame()?.id === frame.id && observeSurfaces(preview.contentDocument).every(surface =>
        surface.role === 'tabpanel' || frame.checkpoint.some(item => item.role === surface.role && item.label === surface.label))))) return

  cancelCandidate()
  const signal = request
  const current = () => signal === request
  setPending(cards.get(frame.id).button)
  message('')
  const next = document.createElement('iframe')
  candidate = next
  next.className = 'flow-candidate'
  next.title = 'Preparing selected app frame'
  next.inert = true
  next.style.width = width + 'px'
  next.style.height = height + 'px'
  next.src = frame.route
  preview.after(next)
  try {
    const doc = await waitFor(() => {
      const loaded = next.contentDocument
      return routeOf(next) === frame.route && loaded?.readyState === 'complete' &&
        loaded?.body?.innerText.trim() && loaded
    }, current)
    for (const step of frame.steps) {
      const control = await waitFor(() => doc === next.contentDocument && findControl(doc, step), current)
      openControl(control)
    }
    await waitFor(() => doc === next.contentDocument && matchesCheckpoint(doc, frame), current)
    if (!current()) return

    const attached = document.body.hasAttribute('data-inspector-watching')
    preview.remove()
    if (attached) {
      dock.inert = true
      dock.style.visibility = 'hidden'
    }
    next.id = 'app-preview'
    next.className = ''
    next.title = 'Active app frame'
    next.inert = false
    preview = next
    candidate = null
    setActive(frame.id)
    position()
    watchLiveFrame(preview)
    if (attached) {
      try { await waitFor(() => next.dataset.inspectorDocument, current) }
      catch {
        if (current()) message('Opened ' + frame.label + '. Inspector could not attach.')
      } finally {
        if (next === preview && next.dataset.inspectorDocument) {
          dock.style.visibility = ''
          dock.inert = false
        }
      }
    }
  } catch {
    if (current()) message('Could not reopen ' + frame.label)
  } finally {
    if (current()) {
      candidate?.remove()
      candidate = null
      setPending(null)
    }
  }
}

toggle.addEventListener('click', () => {
  expanded = !expanded
  document.body.toggleAttribute('data-expanded', expanded)
  toggle.setAttribute('aria-pressed', String(expanded))
  toggle.title = expanded ? 'Back to localhost' : 'Expand flow'
  toggle.setAttribute('aria-label', toggle.title)
  map.hidden = zoom.hidden = !expanded
  if (expanded) {
    preview.style.width = width + 'px'
    preview.style.height = height + 'px'
    syncLiveFrame(true)
  } else {
    cancelCandidate()
    message('')
    preview.removeAttribute('style')
    dock.inert = false
  }
})

function zoomAt(event, x, y) {
  event.preventDefault()
  const next = Math.min(1, Math.max(.12, camera.scale * Math.exp(-event.deltaY * .006)))
  camera.x = x - (x - camera.x) * next / camera.scale
  camera.y = y - (y - camera.y) * next / camera.scale
  camera.scale = next
  position()
}

viewport.addEventListener('wheel', event => {
  if (!expanded) return
  const rect = viewport.getBoundingClientRect()
  if (event.ctrlKey || event.metaKey) {
    zoomAt(event, event.clientX - rect.x, event.clientY - rect.y)
  } else {
    event.preventDefault()
    camera.x -= event.deltaX
    camera.y -= event.deltaY
    position()
  }
}, { passive: false })

function watchLiveFrame(frame) {
  let connected
  function connect() {
    const doc = frame.contentDocument
    if (frame !== preview || !doc || doc === connected) return
    connected = doc
    const update = () => frame.contentWindow.requestAnimationFrame(() => {
      if (frame === preview && doc === frame.contentDocument) syncLiveFrame()
    })
    const keepWorking = event => {
      if (event.isTrusted && frame === preview && candidate) cancelCandidate()
    }
    frame.contentWindow.addEventListener('pointerdown', keepWorking, true)
    frame.contentWindow.addEventListener('keydown', keepWorking, true)
    doc.addEventListener('click', update)
    doc.addEventListener('keyup', update)
    frame.contentWindow.navigation?.addEventListener('currententrychange', update)
    doc.addEventListener('wheel', event => {
      if (!expanded || (!event.ctrlKey && !event.metaKey)) return
      const view = viewport.getBoundingClientRect()
      const app = preview.getBoundingClientRect()
      zoomAt(event, app.x - view.x + event.clientX * camera.scale,
        app.y - view.y + event.clientY * camera.scale)
    }, { passive: false })
    update()
  }
  new MutationObserver(() => {
    if (frame !== preview || !frame.dataset.inspectorDocument || !dock.style.visibility) return
    dock.style.visibility = ''
    dock.inert = false
    message('')
  }).observe(frame, { attributes: true, attributeFilter: ['data-inspector-document'] })
  frame.addEventListener('load', connect)
  if (frame.contentDocument?.readyState === 'complete') connect()
}

watchLiveFrame(preview)

const entry = new URLSearchParams(location.search).get('page')
preview.src = data.frames.some(frame => frame.route === entry) ? entry : '/'
toggle.disabled = false
