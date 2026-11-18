import { frameLabelHeight, renderFrames } from './render-frames.mjs'
import { flowRoute, observeSurfaces } from './page-state.mjs'
import { findControl, matchesCheckpoint, openControl, waitFor } from './replay.mjs'
import { contentOverflow, fitFrame, framePresets, sizeFrame } from './frame-view.mjs'
import { createSharpPreviews } from './sharp-previews.mjs'
import { connectViewControls } from './view-controls.mjs'

const map = document.querySelector('#map')
let preview = document.querySelector('#app-preview')
const viewport = document.querySelector('#viewport')
const toggle = document.querySelector('#flow-toggle')
const zoom = document.querySelector('#zoom')
const notice = document.querySelector('#notice')
const dock = document.querySelector('#localhost-inspector-dock')
const data = await fetch('./map.json').then(response => response.json())
if (data.origin !== location.origin) throw Error('This flow map belongs to a different app origin')
const presets = framePresets(data.viewport)
let device = 'desktop'
const heights = new Map()
const viewOf = (id, preset = device) => {
  const size = presets[preset]
  const height = heights.get(preset + ':' + id)
  return { ...size, preset, fixedHeight: size.height, height: height ?? size.height, mode: height ? 'hug' : 'fixed' }
}
const saveView = (id, view) => {
  const key = view.preset + ':' + id
  if (view.mode === 'hug') heights.set(key, view.height)
  else heights.delete(key)
}
const previewIndex = await fetch('./previews.json').then(response => response.ok ? response.json() : null).catch(() => null)
const { cards, layout } = renderFrames(map, data, activate, viewOf, previewIndex)
const updateSharpPreviews = createSharpPreviews(cards)
const framesById = new Map(data.frames.map(frame => [frame.id, frame]))
const routeOf = frame => {
  try {
    const address = frame.contentWindow.location
    return address.origin === location.origin ? flowRoute(address) : null
  } catch { return null }
}
const camera = { x: 34, y: 28, scale: .36 }
let active
let request = 0
let pendingCard
let candidate
let preparation
let warmTimer
let activateTimer
let hoverCard
let inspectHover
let pointer
let expanded = false
let unmapped = false
let resizing = false
let previewUpdate
const syncView = connectViewControls({ apply: changeView, read: readView, presets })

function refreshViewControls() {
  syncView(expanded, resizing || Boolean(pendingCard))
}

function readView() {
  if (!expanded) return null
  if (!active) return { preset: device }
  const view = viewOf(active)
  return { ...view, canHug: view.mode === 'hug' || contentOverflow(preview.contentDocument) > 0 }
}

async function changeView(change) {
  if (!expanded || pendingCard || resizing) return
  const preset = change.preset ?? device
  if (!active) {
    device = preset
    layout()
    position()
    return
  }
  const id = active
  const frame = framesById.get(id)
  const iframe = preview
  const prior = viewOf(id)
  const wanted = { preset, mode: change.mode ?? viewOf(id, preset).mode }
  if (preset === device && wanted.mode === prior.mode) return
  clearHover()
  cancelCandidate()
  resizing = true
  refreshViewControls()
  const current = () => preview === iframe && expanded && active === id
  const { x, y } = cards.get(id)
  try {
    let fitted = await fitFrame(iframe, frame, wanted, presets[preset], current)
    if (!fitted && preset !== device && wanted.mode === 'hug' && current()) {
      fitted = await fitFrame(iframe, frame, { preset, mode: 'fixed' }, presets[preset], current)
    }
    if (!current()) return
    if (!fitted && preset === device) {
      sizeFrame(iframe, prior)
      message('This page could not expand to fit its contents.')
      return
    }
    device = preset
    if (fitted) saveView(id, fitted)
    layout()
    camera.x += (x - cards.get(id).x) * camera.scale
    camera.y += (y - cards.get(id).y) * camera.scale
    position()
    message('')
    if (!fitted) {
      sizeFrame(iframe, prior)
      iframe.style.visibility = 'hidden'
      setActive(null)
      resizing = false
      await activate(frame)
    }
  } finally {
    resizing = false
    refreshViewControls()
  }
}

function message(text) {
  notice.value = text
  notice.hidden = !text
}

function schedulePreviewUpdate() {
  if (previewUpdate) return
  previewUpdate = requestAnimationFrame(() => {
    previewUpdate = null
    updateSharpPreviews(expanded, camera, viewport.clientWidth - dock.offsetWidth, viewport.clientHeight)
  })
}

function position() {
  map.style.transform = 'translate(' + camera.x + 'px,' + camera.y + 'px) scale(' + camera.scale + ')'
  zoom.value = Math.round(camera.scale * 100) + '%'
  schedulePreviewUpdate()
  if (!expanded || !active) return
  const card = cards.get(active)
  preview.style.left = camera.x + card.x * camera.scale + 'px'
  preview.style.top = camera.y + (card.y + frameLabelHeight) * camera.scale + 'px'
  preview.style.transform = 'scale(' + camera.scale + ')'
}

function setFrameSelected(selected) {
  if (active) cards.get(active).button.setAttribute('aria-pressed', String(selected))
  preview.toggleAttribute('data-frame-selected', Boolean(active && selected))
}

function setActive(id) {
  setFrameSelected(false)
  if (active) cards.get(active).button.classList.remove('active')
  active = id
  refreshViewControls()
  if (id) cards.get(id).button.classList.add('active')
  setFrameSelected(Boolean(id))
}

function clearCanvasSelection() {
  if (!expanded) return
  const clearSelection = new Event('clear-workspace-selection', { cancelable: true })
  if (dock.firstElementChild?.dispatchEvent(clearSelection) === false) return
  clearHover()
  if (candidate) cancelCandidate()
  setFrameSelected(false)
}

function center(id) {
  const card = cards.get(id)
  camera.x = Math.round((viewport.clientWidth - card.width * camera.scale) / 2 - card.x * camera.scale)
  camera.y = Math.round((viewport.clientHeight - card.height * camera.scale) / 2 - card.y * camera.scale)
}

function setPending(card) {
  pendingCard?.removeAttribute('aria-busy')
  pendingCard = card
  pendingCard?.setAttribute('aria-busy', 'true')
  refreshViewControls()
}

function currentFrame() {
  const route = routeOf(preview)
  const doc = preview.contentDocument
  if (!route || !doc?.body?.innerText.trim()) return
  const onRoute = data.frames.filter(frame => frame.route === route)
  if (!onRoute.length && route.includes('?')) {
    return data.frames.find(frame => frame.route === route.split('?')[0] && !frame.steps.length)
  }
  const surfaces = observeSurfaces(doc)
  const exact = onRoute.filter(frame => frame.steps.length && matchesCheckpoint(doc, frame, surfaces))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return exact.find(frame => frame.id === active) ?? onRoute.find(frame => !frame.steps.length)
  return onRoute.find(frame => !frame.steps.length)
}

function syncLiveFrame() {
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
  setActive(frame.id)
  sizeFrame(preview, viewOf(frame.id))
  center(frame.id)
  position()
  if (unmapped) { unmapped = false; message('') }
  preview.style.visibility = ''
  if (!dock.style.visibility) dock.inert = false
}

function cancelCandidate() {
  request++
  candidate?.remove()
  candidate = null
  preparation = null
  setPending(null)
}

function prepare(frame) {
  if (preparation?.frame.id === frame.id) return preparation
  cancelCandidate()
  const signal = request
  const current = () => signal === request
  const next = document.createElement('iframe')
  candidate = next
  next.className = 'flow-candidate'
  next.title = 'Preparing selected app frame'
  next.inert = true
  const view = viewOf(frame.id)
  sizeFrame(next, presets[view.preset])
  next.src = frame.route
  preview.after(next)
  const ready = (async () => {
    const doc = await waitFor(() => {
      const loaded = next.contentDocument
      return routeOf(next) === frame.route && loaded && loaded.readyState !== 'loading' &&
        loaded?.body?.innerText.trim() && loaded
    }, current)
    for (const step of frame.steps) {
      const control = await waitFor(() => doc === next.contentDocument && findControl(doc, step), current)
      openControl(control)
    }
    await waitFor(() => doc === next.contentDocument && matchesCheckpoint(doc, frame), current)
    // Finish finite browser animations while the frame is still hidden.
    for (const animation of doc.getAnimations()) {
      if (animation.playState === 'running' && animation.playbackRate > 0 &&
          Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish()
    }
    if (view.mode === 'fixed') return view
    const fitted = await fitFrame(next, frame, { preset: view.preset, mode: 'hug' }, presets[view.preset], current)
    if (fitted) return fitted
    sizeFrame(next, presets[view.preset])
    await waitFor(() => doc === next.contentDocument && matchesCheckpoint(doc, frame), current)
    return { ...presets[view.preset], preset: view.preset, mode: 'fixed' }
  })()
  preparation = { frame, next, current, ready }
  return preparation
}

function clearHoverTimers() {
  clearTimeout(warmTimer)
  clearTimeout(activateTimer)
  warmTimer = null
}

function clearHover() {
  clearHoverTimers()
  hoverCard = inspectHover = null
  if (candidate && !pendingCard) cancelCandidate()
}

async function activate(frame) {
  if (resizing) return
  clearHoverTimers()
  if (frame.id === active && !preview.style.visibility && routeOf(preview) === frame.route &&
      matchesCheckpoint(preview.contentDocument, frame) &&
      (frame.steps.length || (currentFrame()?.id === frame.id && observeSurfaces(preview.contentDocument).every(surface =>
        surface.role === 'tabpanel' || frame.checkpoint.some(item => item.role === surface.role && item.label === surface.label))))) {
    setFrameSelected(true)
    return
  }
  if (pendingCard === cards.get(frame.id).button) return
  const viewBeforeActivation = viewOf(frame.id)
  const { next, current, ready } = prepare(frame)
  setPending(cards.get(frame.id).button)
  message('')
  try {
    const fitted = await ready
    if (!current()) return

    const attached = document.body.hasAttribute('data-inspector-watching')
    preview.remove()
    if (attached) {
      dock.inert = true
      if (!dock.hasAttribute('data-inspector-floating')) dock.style.visibility = 'hidden'
    }
    next.id = 'app-preview'
    next.className = ''
    next.title = 'Active app frame'
    next.inert = false
    preview = next
    candidate = null
    preparation = null
    saveView(frame.id, fitted)
    layout()
    setActive(frame.id)
    position()
    if (fitted.mode === 'fixed' && viewBeforeActivation.mode === 'hug') message('Opened with fixed height. The page could not expand.')
    watchLiveFrame(preview)
    if (attached) {
      try { await waitFor(() => next.dataset.inspectorDocument, current) }
      catch {
        if (current()) {
          dock.style.visibility = 'hidden'
          message('Opened ' + frame.label + '. Inspector could not attach.')
        }
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
      preparation = null
      setPending(null)
    }
  }
}

toggle.addEventListener('click', () => {
  if (resizing) return
  expanded = !expanded
  document.body.toggleAttribute('data-expanded', expanded)
  toggle.setAttribute('aria-pressed', String(expanded))
  toggle.title = expanded ? 'Back to localhost' : 'Expand flow'
  toggle.setAttribute('aria-label', toggle.title)
  map.hidden = zoom.hidden = !expanded
  schedulePreviewUpdate()
  refreshViewControls()
  if (expanded) {
    sizeFrame(preview, viewOf(active))
    syncLiveFrame()
  } else {
    clearHover()
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

function panByWheel(event) {
  event.preventDefault()
  camera.x -= event.deltaX
  camera.y -= event.deltaY
  position()
}

viewport.addEventListener('wheel', event => {
  if (!expanded || event.target.closest('#workspace-toolbar, #localhost-inspector-dock')) return
  if (event.ctrlKey) {
    const rect = viewport.getBoundingClientRect()
    zoomAt(event, event.clientX - rect.x, event.clientY - rect.y)
  } else {
    panByWheel(event)
  }
  warmAt(event.clientX, event.clientY, event.metaKey)
}, { passive: false })

function fillsCanvas(card) {
  const bounds = card.getBoundingClientRect()
  const board = viewport.getBoundingClientRect()
  const right = board.right - dock.offsetWidth
  const width = Math.max(0, Math.min(bounds.right, right) - Math.max(bounds.left, board.left))
  const height = Math.max(0, Math.min(bounds.bottom, board.bottom) - Math.max(bounds.top, board.top))
  return width * height >= .75 * (right - board.left) * board.height
}

function warmAt(x, y, inspect = false) {
  const card = document.elementFromPoint(x, y)?.closest('.flow-frame')
  if (pendingCard || resizing) return
  if (!expanded || !card || (!inspect && camera.scale < .5) || card.dataset.frame === active) {
    clearHover()
    return
  }
  if (hoverCard !== card) {
    clearHover()
    hoverCard = card
  }
  const frame = framesById.get(card.dataset.frame)
  if (inspect) {
    inspectAfterHover(card, frame)
    return
  }
  if (inspectHover) clearHoverTimers()
  inspectHover = null
  const stillOver = () => expanded && hoverCard === card && !pendingCard && !resizing &&
    document.elementFromPoint(x, y)?.closest('.flow-frame') === card
  if (!warmTimer && preparation?.frame !== frame) {
    warmTimer = setTimeout(() => {
      warmTimer = null
      if (!expanded || hoverCard !== card || pendingCard || resizing) return
      const warm = prepare(frame)
      void warm.ready.catch(() => {
        if (preparation === warm && !pendingCard) cancelCandidate()
      })
    }, 60)
  }
  clearTimeout(activateTimer)
  if (fillsCanvas(card)) {
    activateTimer = setTimeout(() => {
      if (stillOver() && fillsCanvas(card)) void activate(frame)
    }, 140)
  }
}

function inspectAfterHover(card, frame) {
  if (inspectHover === card) return
  clearHoverTimers()
  inspectHover = card
  warmTimer = setTimeout(async () => {
    warmTimer = null
    if (inspectHover !== card || !card.matches(':hover') || pendingCard || resizing) return
    const warm = prepare(frame)
    try {
      await warm.ready
      if (inspectHover === card && card.matches(':hover') && warm.current() && !pendingCard) void activate(frame)
    } catch {
      if (preparation === warm && !pendingCard) cancelCandidate()
    }
  }, 60)
}

function updateInspectModifier(event) {
  if (!event.isTrusted || event.key !== 'Meta') return
  if (!event.metaKey) {
    if (inspectHover) clearHover()
  } else if (pointer) {
    warmAt(pointer.x, pointer.y, true)
  }
}

viewport.addEventListener('click', event => {
  if (event.isTrusted && !event.target.closest('.flow-frame, #workspace-toolbar, #localhost-inspector-dock')) {
    clearCanvasSelection()
  }
})
window.addEventListener('keydown', event => {
  updateInspectModifier(event)
  if (event.isTrusted && !event.defaultPrevented && event.key === 'Escape') clearCanvasSelection()
})
window.addEventListener('keyup', updateInspectModifier)
window.addEventListener('blur', () => {
  if (inspectHover) clearHover()
})

viewport.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse') return
  const card = event.target.closest('.flow-frame')
  pointer = card ? { x: event.clientX, y: event.clientY } : null
  if (event.metaKey && card && card !== inspectHover && card.dataset.frame !== active) {
    warmAt(event.clientX, event.clientY, true)
  }
})
map.addEventListener('pointerover', event => {
  const card = event.target.closest('.flow-frame')
  if (card && !card.contains(event.relatedTarget) && event.pointerType === 'mouse') {
    warmAt(event.clientX, event.clientY, event.metaKey)
  }
})

map.addEventListener('pointerout', event => {
  const card = event.target.closest('.flow-frame')
  if (card && !card.contains(event.relatedTarget)) {
    pointer = null
    clearHover()
  }
})

function watchLiveFrame(frame) {
  let connected
  function connect() {
    const doc = frame.contentDocument
    if (frame !== preview || !doc || doc === connected) return
    connected = doc
    const appWindow = frame.contentWindow
    function lockAppClick(event) {
      if (!event.isTrusted || frame !== preview) return
      if (event.type === 'pointerdown' && candidate) cancelCandidate()
      if (expanded && event.type === 'click' && event.button === 0) setFrameSelected(true)
      if (!expanded || (event.metaKey && event.button === 0)) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu']) {
      appWindow.addEventListener(type, lockAppClick, true)
    }
    function lockAppKey(event) {
      if (!event.isTrusted || frame !== preview) return
      if (event.type === 'keydown' && candidate && event.key !== 'Meta') cancelCandidate()
      updateInspectModifier(event)
      if (!expanded || event.key === 'Tab') return
      if (event.type === 'keydown' && event.key === 'Escape') clearCanvasSelection()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    appWindow.addEventListener('keydown', lockAppKey, true)
    appWindow.addEventListener('keyup', lockAppKey, true)
    appWindow.addEventListener('beforeinput', lockAppKey, true)
    appWindow.addEventListener('wheel', event => {
      if (!expanded || frame !== preview) return
      if (event.metaKey && !event.ctrlKey) {
        clearHover()
        return
      }
      event.stopImmediatePropagation()
      if (!event.ctrlKey) {
        clearHover()
        panByWheel(event)
        return
      }
      const view = viewport.getBoundingClientRect()
      const app = preview.getBoundingClientRect()
      clearHover()
      zoomAt(event, app.x - view.x + event.clientX * camera.scale,
        app.y - view.y + event.clientY * camera.scale)
    }, { capture: true, passive: false })
    if (expanded && !active) syncLiveFrame()
  }
  new MutationObserver(() => {
    if (frame !== preview || !frame.dataset.inspectorDocument || !dock.style.visibility) return
    dock.style.visibility = ''
    dock.inert = false
    message('')
  }).observe(frame, { attributes: true, attributeFilter: ['data-inspector-document'] })
  frame.addEventListener('load', connect)
  if (frame.contentDocument && frame.contentDocument.readyState !== 'loading') connect()
}

watchLiveFrame(preview)
const previewBounds = new ResizeObserver(schedulePreviewUpdate)
previewBounds.observe(viewport)
previewBounds.observe(dock)

const entry = new URLSearchParams(location.search).get('page')
preview.src = data.frames.some(frame => frame.route === entry) ? entry : '/'
toggle.disabled = false
