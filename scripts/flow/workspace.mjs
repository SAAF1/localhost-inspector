import { mountEditionSwitcher } from './edition-switcher.mjs'
import './tooltip.js'
import { prepareWorkspaceInspector } from './inspector-request.mjs'
import { mountVariantSections } from './variant-sections.mjs'
import { addLinkedFrame, addVariantFrame, proposalEntry, resolveProposalFrame, trackContext } from './proposal-view.mjs'
import { connectSidebar } from './workspace-sidebar.mjs'
import { frameGap, flowHeadingSpace, groupFlowFrames, renderFrames } from './render-frames.mjs'
import { flowRoute, observeSurfaces } from './page-state.mjs'
import { matchesCheckpoint, replayFrame, waitFor } from './replay.mjs'
import { contentOverflow, fitFrame, framePresets, sizeFrame } from './frame-view.mjs'
import { createSharpPreviews } from './sharp-previews.mjs'
import { connectCanvasBackground, connectViewControls, followVisibleViewport } from './view-controls.mjs'

followVisibleViewport()

// Workspace controls live outside the Inspector shadow roots.
const theme = new CSSStyleSheet()
theme.replaceSync(window.LocalhostInspector.tokens.replaceAll(':host', ':root'))
document.adoptedStyleSheets.push(theme)

window.LocalhostInspector.bindTooltips(document.querySelector('#workspace-toolbar'), '#frame-view-menu:not([hidden])')

const map = document.querySelector('#map')
let preview = document.querySelector('#app-preview')
const viewport = document.querySelector('#viewport')
const toggle = document.querySelector('#flow-toggle')
const zoom = document.querySelector('#zoom')
const zoomPreset = document.querySelector('#zoom-preset')
const notice = document.querySelector('#notice')
const dock = document.querySelector('#localhost-inspector-dock')
connectCanvasBackground(dock, viewport)
const data = await fetch('./map.json').then(response => response.json())
if (data.origin !== location.origin) throw Error('This flow map belongs to a different app origin')
if (data.authoredBaseline) {
  const { mountSourceCompare } = await import('./authored-compare.mjs')
  mountSourceCompare(data.authoredBaseline, () => preview)
}
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
const groups = groupFlowFrames(data.frames)
const groupByFrame = new Map(groups.flatMap(group => group.frames.map(frame => [frame.id, group])))
let flowFrameId = groups[0]?.frames[0]?.id
let linkedFrame
const variantFrames = new Map()
let layoutVariantSections
let focusedVariant
let outlinesByFlow
let selectedSection
let selectedOriginal
let pendingInspectTarget
let inspectedVariant
let selectedComparison = false
let hoverKey = null
let disclosureRequest
let disclosureVersion = 0
const { cards, layout: layoutFrames } = renderFrames(map, data, groups, activate, viewOf, previewIndex,
  anchor => changeView({ preset: 'desktop', anchor }))
function layout() {
  const extras = linkedFrame ? [linkedFrame, ...variantFrames.values()] : [...variantFrames.values()]
  const columns = new Map()
  for (const extra of extras) {
    extra.column = (columns.get(extra.id) || 0) + 1
    columns.set(extra.id, extra.column)
  }
  layoutFrames(columns)
  for (const extra of extras) extra.place(cards.get(extra.id), extra.column)
  layoutVariantSections?.()
}
const updateSharpPreviews = createSharpPreviews(cards)
const framesById = new Map(data.frames.map(frame => [frame.id, frame]))
const scenarioRoutes = new Set(data.frames.filter(frame =>
  frame.steps.length || frame.checkpoint.some(check => check.role === 'pressed-option')).map(frame => frame.route))
function mappedRoute(route) {
  if (!route || framesByRoute.has(route)) return route
  const address = new URL(route, location.origin)
  address.search = ''
  address.hash = address.hash.split('?')[0]
  return flowRoute(address)
}
const framesByRoute = Map.groupBy(data.frames, frame => frame.route)
const frameStates = new Map(await Promise.all(data.frames.filter(frame => scenarioRoutes.has(frame.route)).map(async frame => {
  const state = new TextEncoder().encode(JSON.stringify(frame.steps.length
    ? [frame.steps, frame.checkpoint] : [frame.route, frame.heading, frame.checkpoint]))
  const bytes = await crypto.subtle.digest('SHA-256', state)
  return [frame.id, Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')]
})))
const routeOf = frame => {
  try {
    const address = frame.contentWindow.location
    return address.origin === location.origin ? flowRoute(address) : null
  } catch { return null }
}
const panSensitivity = 2
const pinchSensitivity = .0225
const minZoom = .01
const presetScales = new Set(Array.from(zoomPreset.options, option => option.value))
const camera = { x: 34, y: 28, scale: .36 }
let active
let sidebar
let request = 0
let pendingCard
let pendingIndicatorTimer
let candidate
let preparation
let warmTimer
let navigationHover
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
  syncView(expanded, resizing || Boolean(pendingCard), resizing || Boolean(pendingCard?.hasAttribute('data-loading')))
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
  const anchor = cards.get(change.anchor ?? id)
  const { x, y } = anchor
  const hiddenControl = previewIndex?.[id]?.[preset]?.unavailable === 'hidden-control'
  try {
    let fitted = hiddenControl ? null : await fitFrame(iframe, frame, wanted, presets[preset], current)
    if (!hiddenControl && !fitted && preset !== device && wanted.mode === 'hug' && current()) {
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
    camera.x += (x - anchor.x) * camera.scale
    camera.y += (y - anchor.y) * camera.scale
    position()
    message('')
    if (!fitted) {
      sizeFrame(iframe, prior)
      iframe.style.visibility = 'hidden'
      setActive(null)
      resizing = false
      const base = hiddenControl && data.frames.find(item => item.route === frame.route && !item.steps.length)
      if (base || !hiddenControl) await activate(base || frame)
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

let gestureIdleTimer
let deferredHover

function schedulePreviewUpdate() {
  if (previewUpdate || gestureIdleTimer) return
  previewUpdate = requestAnimationFrame(() => {
    previewUpdate = null
    if (gestureIdleTimer) return
    updateSharpPreviews(expanded, camera, viewport.clientWidth - dock.offsetWidth, viewport.clientHeight)
  })
}

function position() {
  map.toggleAttribute('data-detail-scale', camera.scale * window.devicePixelRatio >= .6)
  map.style.transform = 'translate(' + camera.x + 'px,' + camera.y + 'px) scale(' + camera.scale + ')'
  const percent = Math.round(camera.scale * 100) + '%'
  if (zoom.value !== percent) zoom.value = percent
  if (zoomPreset.options[0].textContent !== zoom.value) {
    zoomPreset.options[0].textContent = zoom.value
  }
  const preset = presetScales.has(String(camera.scale)) ? String(camera.scale) : 'current'
  if (zoomPreset.value !== preset) zoomPreset.value = preset
  schedulePreviewUpdate()
  if (!expanded || !active) return
  const card = cards.get(active)
  const x = camera.x + card.x * camera.scale
  const y = camera.y + (card.y + card.labelHeight) * camera.scale
  preview.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + camera.scale + ')'
}

function getOutline() {
  if (!expanded) return null
  if (!outlinesByFlow) {
    const byAnchor = new Map()
    for (const frame of variantFrames.values()) {
      if (!byAnchor.has(frame.id)) byAnchor.set(frame.id, [])
      const siblings = byAnchor.get(frame.id)
      const row = { kind: 'frame', label: frame.label, key: 'variant:' + frame.variant, children: [] }
      const section = frame.section
      if (!section) siblings.push(row)
      else {
        let parent = siblings.find(item => item.key === section.dataset.sectionKey)
        if (!parent) {
          parent = { kind: 'section', label: section.getAttribute('aria-label'), key: section.dataset.sectionKey, children: [] }
          siblings.push(parent)
        }
        parent.children.push(row)
      }
    }
    outlinesByFlow = new Map(groups.map(group => {
      const items = group.frames.flatMap(({ id }) => {
        const label = cards.get(id).button.firstElementChild.textContent
        const rows = [{ kind: 'frame', label, key: 'frame:' + id, children: [] }]
        if (linkedFrame?.id === id) rows.push({ kind: 'frame', label: linkedFrame.label, key: 'comparison:' + id, children: [] })
        return rows.concat(byAnchor.get(id) ?? [])
      })
      const keys = new Set(items.flatMap(item => [item.key, ...item.children.map(child => child.key)]))
      return [group.key, { items, keys }]
    }))
  }
  const flowKey = groupByFrame.get(flowFrameId)?.key
  const scope = outlinesByFlow.get(flowKey)
  const liveKey = inspectedVariant ? 'variant:' + inspectedVariant : active ? 'frame:' + active : null
  const sourceKey = scope?.keys.has(liveKey) ? liveKey : null
  const activeKey = inspectedVariant || preview.hasAttribute('data-frame-selected') ? sourceKey : null
  let selectedKey = activeKey
  if (selectedOriginal) selectedKey = 'frame:' + selectedOriginal
  if (selectedComparison && linkedFrame) selectedKey = 'comparison:' + linkedFrame.id
  if (selectedSection) selectedKey = selectedSection.dataset.sectionKey
  return { items: scope?.items ?? [], flowKey, flowFrameId, activeKey, sourceKey, disclosureRequest,
    hoverKey: scope?.keys.has(hoverKey) ? hoverKey : null, selectedKey: scope?.keys.has(selectedKey) ? selectedKey : null }
}

function markSection(section) {
  selectedSection?.removeAttribute('data-selected')
  selectedSection?.querySelector('.variant-section-surface button').setAttribute('aria-pressed', 'false')
  selectedSection = section
  if (section) {
    section.setAttribute('data-selected', '')
    section.querySelector('.variant-section-surface button').setAttribute('aria-pressed', 'true')
  }
}

function selectSection(key) {
  const section = map.querySelector('[data-section-key="' + CSS.escape(key) + '"]')
  if (!section || !clearCanvasSelection()) return
  flowFrameId = section.dataset.anchor
  sidebar?.revealFlowFrame(flowFrameId)
  markSection(section)
  sidebar?.changed()
  sidebar?.refreshOutline()
}

async function onOpenOutline(key, expandedRow) {
  if (!expanded || typeof key !== 'string' || !outlinesByFlow?.get(groupByFrame.get(flowFrameId)?.key)?.keys.has(key)) return
  disclosureRequest = typeof expandedRow === 'boolean' ? { key, expanded: expandedRow, version: ++disclosureVersion } : undefined
  if (key.startsWith('section:')) {
    selectSection(key)
    if (selectedSection?.dataset.sectionKey === key) {
      const surface = selectedSection.querySelector('.variant-section-surface')
      focusSidebarPoint(surface.offsetLeft + surface.offsetWidth / 2, surface.offsetTop + surface.offsetHeight / 2)
    }
    return
  }
  const id = key.slice(key.indexOf(':') + 1)
  if (key === 'variant:' + id || (key === 'comparison:' + id && linkedFrame?.id === id)) {
    const frame = key.startsWith('variant:') ? variantFrames.get(id) : linkedFrame
    if (!frame || !clearCanvasSelection()) return
    frame.open()
    focusSidebarFrame(frame.bounds)
  } else if (key === 'frame:' + id && framesById.has(id)) {
    if (!clearCanvasSelection()) return
    if (cards.get(id).hiddenControl) await changeView({ preset: 'desktop', anchor: id })
    await navigateToFrame(id)
  }
}

document.addEventListener('pointerdown', () => { pendingInspectTarget = null }, true)

function setFrameSelected(selected) {
  if (!selected) pendingInspectTarget = null
  if (selectedOriginal) cards.get(selectedOriginal).button.setAttribute('aria-pressed', 'false')
  selectedOriginal = selected ? active : null
  if (selectedOriginal) {
    flowFrameId = selectedOriginal
    sidebar?.revealFlowFrame(flowFrameId)
    markSection(null)
    selectedComparison = false
    cards.get(selectedOriginal).button.setAttribute('aria-pressed', 'true')
  }
  syncFrameSelected()
}

function syncFrameSelected() {
  const selected = Boolean(active && selectedOriginal === active)
  preview.toggleAttribute('data-frame-selected', selected)
  dock.toggleAttribute('data-canvas-page', expanded && !selected)
  sidebar?.changed()
  sidebar?.refreshOutline()
}

function setActive(id, keepSelection = false) {
  if (active) cards.get(active).button.classList.remove('active')
  active = id
  refreshViewControls()
  if (id) cards.get(id).button.classList.add('active')
  if (keepSelection) syncFrameSelected()
  else setFrameSelected(Boolean(id))
}

function inspectVariant(frame, action, details) {
  if (action === 'focus-layer') {
    const bounds = variantFrames.get(frame.variant)?.bounds
    if (expanded && inspectedVariant === frame.variant && bounds && Number.isFinite(details?.x) && Number.isFinite(details?.y)) {
      focusSidebarPoint(bounds.x + details.x, bounds.y + bounds.labelHeight + details.y)
    }
    return
  }
  if (action !== 'start') {
    if (action === 'stop' && inspectedVariant === frame.variant) inspectedVariant = null
    sidebar.inspectVariant(frame, action, details)
    if (action === 'stop') sidebar.refreshOutline()
    return
  }
  markSection(null)
  selectedComparison = false
  inspectedVariant = frame.variant
  flowFrameId = variantFrames.get(frame.variant).id
  sidebar?.revealFlowFrame(flowFrameId)
  setFrameSelected(false)
  const before = frame.app.getBoundingClientRect()
  const board = viewport.getBoundingClientRect()
  const wasInView = before.left >= board.left && before.right <= board.right - dock.offsetWidth + 1
  sidebar.inspectVariant(frame, action, details)
  const left = viewport.getBoundingClientRect().left
  const width = viewport.clientWidth - document.querySelector('#variant-properties').offsetWidth
  if (width <= 0) return
  // Opening the sidebars changes the usable canvas. Keep the same screen
  // position where possible, and keep a formerly visible frame within view.
  camera.x += board.left - left
  if (wasInView) {
    const ratio = Math.max(minZoom / camera.scale, Math.min(1, Math.max(1, width - 16) / before.width))
    const originalX = before.left - left
    const targetX = Math.max(0, Math.min(originalX, width - before.width * ratio))
    camera.x = targetX - (originalX - camera.x) * ratio
    const centerY = before.top + before.height / 2 - board.top
    camera.y = centerY - (centerY - camera.y) * ratio
    camera.scale *= ratio
  }
  position()
}

function clearCanvasSelection() {
  sidebar?.leaveVariant()
  if (!expanded) return
  const clearSelection = new Event('clear-workspace-selection', { cancelable: true })
  if (dock.firstElementChild?.dispatchEvent(clearSelection) === false) return
  clearHover()
  if (candidate) cancelCandidate()
  markSection(null)
  selectedComparison = false
  setFrameSelected(false)
  return true
}

function center(id, width = viewport.clientWidth) {
  const card = cards.get(id)
  camera.x = Math.round((width - card.width * camera.scale) / 2 - card.x * camera.scale)
  camera.y = Math.round((viewport.clientHeight - card.height * camera.scale) / 2 - card.y * camera.scale)
}

// Sidebar navigation centers on the exposed canvas after the new panels mount.
function focusSidebarPoint(x, y) {
  const view = viewport.getBoundingClientRect()
  const visible = window.visualViewport
  const sidebar = document.querySelector('#workspace-sidebar').getBoundingClientRect()
  const inspector = (document.querySelector('#variant-properties') || dock).getBoundingClientRect()
  const left = Math.max(view.left, visible.offsetLeft, sidebar.right)
  const right = Math.min(view.right, visible.offsetLeft + visible.width, inspector.left)
  const top = Math.max(view.top, visible.offsetTop)
  const bottom = Math.min(view.bottom, visible.offsetTop + visible.height)
  camera.scale = .5
  camera.x = (left + right) / 2 - view.left - x * camera.scale
  camera.y = (top + bottom) / 2 - view.top - y * camera.scale
  position()
}

function focusSidebarFrame(card) {
  focusSidebarPoint(card.x + card.width / 2, card.y + card.labelHeight + card.height / 2)
}

function navigateToFrame(id) {
  const frame = framesById.get(id)
  if (!frame) return false
  if (expanded) focusSidebarFrame(cards.get(id))
  return activate(frame)
}

function focusEditFrame() {
  camera.scale = .9
  center(active, viewport.clientWidth - dock.offsetWidth)
  position()
}

function setPending(card, destination) {
  clearTimeout(pendingIndicatorTimer)
  pendingCard?.removeAttribute('aria-busy')
  pendingCard?.removeAttribute('data-loading')
  pendingCard?.removeAttribute('data-opening')
  sidebar?.indicateDestination(destination?.id)
  if (destination) dock.dataset.openingFrame = destination.label || destination.route
  else delete dock.dataset.openingFrame
  pendingCard = card
  if (card) {
    card.setAttribute('aria-busy', 'true')
    card.toggleAttribute('data-opening', Boolean(destination))
    pendingIndicatorTimer = setTimeout(() => {
      card.setAttribute('data-loading', '')
      refreshViewControls()
    }, 250)
  }
  refreshViewControls()
}

function currentFrame() {
  const route = routeOf(preview)
  const doc = preview.contentDocument
  if (!route || !doc?.body?.innerText.trim()) return
  const onRoute = framesByRoute.get(mappedRoute(route)) ?? []
  if (!onRoute.length && route.includes('?')) {
    return data.frames.find(frame => frame.route === route.split('?')[0] && !frame.steps.length)
  }
  const surfaces = observeSurfaces(doc)
  const exact = onRoute.filter(frame => frame.steps.length && matchesCheckpoint(doc, frame, surfaces))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return exact.find(frame => frame.id === active) ?? onRoute.find(frame => !frame.steps.length)
  return onRoute.find(frame => !frame.steps.length)
}

function verifiedFrameState(frame) {
  const route = mappedRoute(routeOf(frame))
  if (!scenarioRoutes.has(route)) return undefined
  const doc = frame.contentDocument
  if (!doc?.body) return 'unverified'
  const surfaces = observeSurfaces(doc)
  const onRoute = data.frames.filter(item => item.route === route)
  const scenarios = onRoute.filter(item => item.steps.length)
  const matches = scenarios.filter(item => matchesCheckpoint(doc, item, surfaces))
  // An empty checkpoint can only distinguish a scenario by a different heading.
  if (matches.length === 1 && (matches[0].checkpoint.length ||
      (matches[0].heading && onRoute.filter(item => item.heading === matches[0].heading).length === 1))) {
    return frameStates.get(matches[0].id)
  }
  const base = onRoute.filter(item => !item.steps.length && matchesCheckpoint(doc, item, surfaces) &&
    surfaces.every(surface => (surface.role === 'pressed-option' &&
      !onRoute.some(frame => frame.checkpoint.some(check => check.role === 'pressed-option'))) ||
      (surface.role === 'selected-tab' && !item.checkpoint.some(check => check.role === 'selected-tab')) ||
      item.checkpoint.some(check => check.role === surface.role && check.label === surface.label)))
  return !matches.length && base.length === 1 ? frameStates.get(base[0].id) : 'unverified'
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
  showLinkedFrame()
  sizeFrame(preview, viewOf(frame.id))
  if (linkedFrame?.id === frame.id) centerLinkedPair(frame.id)
  else center(frame.id)
  position()
  if (unmapped) { unmapped = false; message('') }
  preview.style.visibility = ''
  if (!dock.hasAttribute('data-attachment-status')) dock.inert = false
}

function cancelCandidate() {
  request++
  candidate?.inspectorStartup?.cancel()
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
  sizeFrame(next, expanded ? presets[view.preset] : { width: preview.clientWidth, height: preview.clientHeight })
  if (document.body.hasAttribute('data-canvas-editor')) {
    next.addEventListener('load', () => {
      if (!current() || next === preview) return
      const doc = next.contentDocument
      if (!doc?.head || doc.URL === 'about:blank') return
      for (const name of ['workspace-editor.mjs', 'variant-editor.mjs', 'inspector-request.mjs', 'component-preview.js', 'variant-runtime.mjs']) {
        const link = doc.createElement('link')
        link.rel = 'modulepreload'
        link.href = '/__inspector-flow/' + name
        doc.head.append(link)
      }
    }, { once: true })
  }
  next.src = frame.route
  preview.after(next)
  async function replay() {
    const doc = await replayFrame(next, frame, current)
    if (view.mode === 'fixed') return view
    const fitted = await fitFrame(next, frame, { preset: view.preset, mode: 'hug' }, presets[view.preset], current)
    if (fitted) return fitted
    sizeFrame(next, presets[view.preset])
    await waitFor(() => doc === next.contentDocument && matchesCheckpoint(doc, frame), current)
    return { ...presets[view.preset], preset: view.preset, mode: 'fixed' }
  }
  let ready
  preparation = { frame, next, current, get ready() { return ready ??= replay() } }
  return preparation
}

// Reuse the same single staged document as canvas hover. Merely moving down
// the Flows list should never activate a screen or start loading every row.
function warmNavigation(id) {
  if (!expanded || pendingCard || resizing) return
  if (navigationHover === id) return
  clearHoverTimers()
  if (navigationHover && preparation?.frame.id === navigationHover) cancelCandidate()
  navigationHover = id
  if (!id || id === active || !framesById.has(id) || cards.get(id).hiddenControl) return
  warmTimer = setTimeout(() => {
    warmTimer = null
    if (!expanded || pendingCard || resizing || navigationHover !== id) return
    // Stage the route only. Replaying buttons or opening dialogs belongs to
    // the click, since an arbitrary app can attach side effects to a control.
    prepare(framesById.get(id))
  }, 100)
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

async function activate(frame, expectedState, hoverOnly = false) {
  if (resizing) return
  if (!hoverOnly) pendingInspectTarget = null
  clearHoverTimers()
  navigationHover = null
  if (!expectedState && frame.id === active && !preview.style.visibility && routeOf(preview) === frame.route &&
      matchesCheckpoint(preview.contentDocument, frame) &&
      (frame.steps.length || (currentFrame()?.id === frame.id && observeSurfaces(preview.contentDocument).every(surface =>
        surface.role === 'tabpanel' || surface.role === 'selected-tab' ||
        frame.checkpoint.some(item => item.role === surface.role && item.label === surface.label))))) {
    if (!hoverOnly) {
      if (candidate) cancelCandidate()
      setFrameSelected(true)
    }
    return true
  }
  if (pendingCard === cards.get(frame.id).button) return
  const viewBeforeActivation = viewOf(frame.id)
  const { next, current, ready } = prepare(frame)
  if (!hoverOnly && document.body.hasAttribute('data-canvas-editor')) next.inspectorStartup ??= prepareWorkspaceInspector()
  setPending(cards.get(frame.id).button, expanded && !hoverOnly ? frame : null)
  message('')
  try {
    const fitted = await ready
    if (!current()) return
    if (expectedState && verifiedFrameState(next) !== expectedState) throw Error('State unavailable')

    const attached = document.body.hasAttribute('data-inspector-watching') || document.body.hasAttribute('data-canvas-editor')
    preview.remove()
    if (attached) {
      dock.inert = true
      dock.dataset.attachmentStatus = 'Connecting Inspector…'
    }
    next.id = 'app-preview'
    next.className = ''
    next.title = 'Active app frame'
    next.inert = false
    preview = next
    if (!expanded) preview.removeAttribute('style')
    candidate = null
    preparation = null
    if (fitted.mode !== viewBeforeActivation.mode || fitted.height !== viewBeforeActivation.height) {
      saveView(frame.id, fitted)
      layout()
    }
    setActive(frame.id, hoverOnly)
    position()
    if (fitted.mode === 'fixed' && viewBeforeActivation.mode === 'hug') message('Opened with fixed height. The page could not expand.')
    watchLiveFrame(preview)
    if (attached) {
      try { await waitFor(() => next.dataset.inspectorDocument, current) }
      catch {
        if (current()) {
          delete dock.dataset.openingFrame
          dock.dataset.attachmentStatus = 'Inspector could not connect to this page.'
          message('Opened ' + frame.label + '. Inspector could not attach.')
        }
      } finally {
        if (next === preview && next.dataset.inspectorDocument) {
          delete dock.dataset.attachmentStatus
          dock.inert = false
        }
      }
    }
    return true
  } catch {
    if (current()) message('Could not reopen ' + frame.label)
  } finally {
    if (current()) {
      candidate?.inspectorStartup?.cancel()
      candidate?.remove()
      candidate = null
      preparation = null
      setPending(null)
    }
  }
}

function toggleView() {
  if (resizing) return
  pendingInspectTarget = null
  expanded = !expanded
  document.body.toggleAttribute('data-expanded', expanded)
  toggle.setAttribute('aria-pressed', String(expanded))
  toggle.setAttribute('aria-label', expanded ? 'Back to localhost' : 'Expand flow')
  map.hidden = zoom.hidden = !expanded
  schedulePreviewUpdate()
  refreshViewControls()
  if (expanded) {
    if (variantFrames.size === 0 && Array.isArray(data.variants) && data.comparison?.role !== 'proposal') {
      layoutVariantSections = mountVariantSections(map, data.variants, framesById, (parent, item) => {
        if (variantFrames.has(item.id)) return
        const frame = addVariantFrame(parent, item, frameGap, inspectVariant)
        if (frame) variantFrames.set(item.id, frame)
        return frame
      }, selectSection)
      outlinesByFlow = null
      layout()
    }
    sizeFrame(preview, viewOf(active))
    syncLiveFrame()
  } else {
    clearHover()
    cancelCandidate()
    message('')
    preview.removeAttribute('style')
    dock.inert = dock.hasAttribute('data-attachment-status')
    dock.removeAttribute('data-canvas-page')
  }
  sidebar?.changed()
  sidebar?.refreshOutline()
}

toggle.addEventListener('click', toggleView)

function setZoom(scale, x, y) {
  const next = Math.min(1, Math.max(minZoom, scale))
  camera.x = x - (x - camera.x) * next / camera.scale
  camera.y = y - (y - camera.y) * next / camera.scale
  camera.scale = next
  position()
}

// Chromium reports trackpad pinches as Ctrl-wheel without a finger count.
let lastTransitionWheel = -Infinity
function consumePinchTail(event) {
  if (performance.now() - lastTransitionWheel >= 220) return false
  lastTransitionWheel = performance.now()
  event.preventDefault()
  return true
}

function zoomAt(event, x, y, card) {
  event.preventDefault()
  if (consumePinchTail(event)) return
  const nextScale = camera.scale * Math.exp(-event.deltaY * pinchSensitivity)
  if (event.metaKey && event.deltaY < 0 && card && !resizing && !pendingCard && (nextScale >= .55 || fillsCanvas(card))) {
    const id = card.dataset.frame
    if (!cards.get(id).hiddenControl) {
      lastTransitionWheel = performance.now()
      if (id === active) toggleView()
      else void activate(framesById.get(id)).then(opened => {
        if (opened && expanded && active === id) toggleView()
      })
      return
    }
  }
  deferGestureWork()
  setZoom(nextScale, x, y)
}

function fitCards(board, width, height) {
  if (!board.length) return
  const left = Math.min(...board.map(card => card.x))
  const top = Math.min(...board.map(card => card.y)) - flowHeadingSpace
  const right = Math.max(...board.map(card => card.x + card.width))
  const bottom = Math.max(...board.map(card => card.y + card.height + card.labelHeight))
  camera.scale = Math.min(1, Math.max(minZoom, Math.min((width - 48) / (right - left), (height - 48) / (bottom - top))))
  camera.x = (width - (left + right) * camera.scale) / 2
  camera.y = (height - (top + bottom) * camera.scale) / 2
  position()
}

zoomPreset.addEventListener('change', () => {
  const width = viewport.clientWidth - dock.offsetWidth
  const height = viewport.clientHeight
  if (zoomPreset.value === 'fit') {
    const board = [...cards.values()]
    if (linkedFrame) board.push(linkedFrame.bounds)
    for (const frame of variantFrames.values()) board.push(frame.bounds)
    fitCards(board, width, height)
    return
  }
  setZoom(Number(zoomPreset.value), width / 2, height / 2)
})

dock.addEventListener('capture-inspector-edit-state', event => {
  if (event.target !== dock.firstElementChild) return
  const state = verifiedFrameState(preview)
  if (state) event.target.dataset.editFrameState = state
}, true)

dock.addEventListener('open-inspector-edit-route', event => {
  if (event.target !== dock.firstElementChild || typeof event.detail !== 'string') return
  let destinationRequest = { path: event.detail }
  if (event.detail.startsWith('{')) {
    try { destinationRequest = JSON.parse(event.detail) }
    catch { return }
  }
  const { path, frameState, editId } = destinationRequest ?? {}
  if (!expanded && !frameState) return
  if (typeof path !== 'string' || !path.startsWith('/')) return
  const address = new URL(path, location.origin)
  if (address.origin !== location.origin) return
  const destination = flowRoute(address)
  const matchingFrames = data.frames.filter(frame => frame.route === destination)
  const stateMatches = frameState ? matchingFrames.filter(frame => frameStates.get(frame.id) === frameState) : []
  const stateFrame = stateMatches.length === 1 ? stateMatches[0] : null
  const alreadyOnPage = routeOf(preview) === destination
  if (frameState && (!stateFrame || (alreadyOnPage && verifiedFrameState(preview) === frameState))) return
  if (!frameState && active && alreadyOnPage) {
    event.preventDefault()
    clearHover()
    if (candidate) cancelCandidate()
    focusEditFrame()
    return
  }
  const frame = stateFrame ?? matchingFrames.find(frame => !frame.steps.length) ??
    (matchingFrames.length === 1 ? matchingFrames[0] : null)
  if (!frame) {
    toggle.click()
    return
  }
  event.preventDefault()
  const notifyUnavailable = reason => {
    if (editId && event.target === dock.firstElementChild) {
      event.target.dispatchEvent(new CustomEvent('inspector-edit-route-unavailable', { detail: { id: editId, reason } }))
    }
  }
  const variants = previewIndex?.[frame.id]
  if (expanded && variants?.[device]?.unavailable === 'hidden-control' && variants.desktop?.fixed) {
    notifyUnavailable('hidden-control')
    return
  }
  void activate(frame, frameState).then(opened => {
    if (!opened) notifyUnavailable('unavailable')
    if (opened && active === frame.id && expanded) focusEditFrame()
  })
}, true)

// Keep preview decoding, hit testing and speculative frame loads off the
// gesture path. Apply the camera transform immediately, then refine at rest.
function deferGestureWork() {
  if (!gestureIdleTimer) {
    clearHoverTimers()
    inspectHover = null
  }
  clearTimeout(gestureIdleTimer)
  deferredHover = null
  gestureIdleTimer = setTimeout(() => {
    gestureIdleTimer = null
    schedulePreviewUpdate()
    if (expanded && deferredHover && viewport.matches(':hover')) {
      warmAt(deferredHover.x, deferredHover.y, deferredHover.inspect)
    }
    deferredHover = null
  }, 140)
}

function panByWheel(event) {
  event.preventDefault()
  if (!gestureIdleTimer) clearHover()
  deferGestureWork()
  camera.x -= event.deltaX * panSensitivity
  camera.y -= event.deltaY * panSensitivity
  position()
}

viewport.addEventListener('wheel', event => {
  if (!expanded || event.target.closest('#workspace-toolbar, #localhost-inspector-dock')) return
  if (event.ctrlKey) {
    const rect = viewport.getBoundingClientRect()
    zoomAt(event, event.clientX - rect.x, event.clientY - rect.y, event.target.closest('.flow-frame'))
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

function hoverTargetKey(node) {
  if (node === preview) return active ? 'frame:' + active : null
  const frame = node?.closest('.flow-frame, .linked-frame, .variant-section-surface')
  if (!frame) return null
  if (frame.dataset.frame) return 'frame:' + frame.dataset.frame
  if (frame.dataset.variant) return 'variant:' + frame.dataset.variant
  if (frame.classList.contains('linked-frame')) return linkedFrame ? 'comparison:' + linkedFrame.id : null
  return frame.parentElement.dataset.sectionKey
}

function setHoverKey(key) {
  if (hoverKey === key) return
  hoverKey = key
  sidebar?.setOutlineHover()
}

function warmAt(x, y, inspect = false) {
  if (gestureIdleTimer) {
    deferredHover = { x, y, inspect }
    return
  }
  const target = document.elementFromPoint(x, y)
  setHoverKey(expanded && inspect ? hoverTargetKey(target) : null)
  const card = target?.closest('.flow-frame')
  if (pendingCard || resizing) return
  // A single original document owns the user's live element selection.
  // Keep that document mounted while merely pointing at a different frame.
  if (inspectedVariant || selectedSection || selectedComparison ||
      preview.contentDocument?.querySelector('#localhost-inspector-outlines #outline:not([hidden])')) {
    clearHover()
    return
  }
  if (!expanded || !card || cards.get(card.dataset.frame)?.hiddenControl ||
      (!inspect && camera.scale < .5) || card.dataset.frame === active) {
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
      prepare(frame)
    }, 60)
  }
  clearTimeout(activateTimer)
  if (fillsCanvas(card)) {
    activateTimer = setTimeout(() => {
      if (stillOver() && fillsCanvas(card)) void activate(frame, undefined, true)
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
      if (inspectHover === card && card.matches(':hover') && warm.current() && !pendingCard) void activate(frame, undefined, true)
    } catch {
      if (preparation === warm && !pendingCard) cancelCandidate()
    }
  }, 60)
}

function updateInspectModifier(event) {
  if (!event.isTrusted || event.key !== 'Meta') return
  if (!event.metaKey) {
    setHoverKey(null)
    if (inspectHover) clearHover()
  } else if (pointer === preview) {
    // The live document reports the exact hovered element. Its key listener
    // can run before this one, so avoid replacing it with its enclosing frame.
    hoverKey = expanded && active ? 'frame:' + active : null
  } else if (pointer) {
    warmAt(pointer.x, pointer.y, true)
  }
}

viewport.addEventListener('click', event => {
  if (event.isTrusted && !event.composedPath().some(node => node.matches?.('.flow-frame, .linked-frame, .variant-section-surface, #workspace-toolbar, #localhost-inspector-dock, #variant-properties'))) {
    clearCanvasSelection()
  }
})
window.addEventListener('keydown', event => {
  updateInspectModifier(event)
  if (event.isTrusted && !event.defaultPrevented && event.key === 'Escape') clearCanvasSelection()
})
window.addEventListener('keyup', updateInspectModifier)
window.addEventListener('blur', () => {
  setHoverKey(null)
  if (inspectHover) clearHover()
})

viewport.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse') return
  const card = event.target.closest('.flow-frame')
  pointer = { x: event.clientX, y: event.clientY }
  setHoverKey(expanded && event.metaKey ? hoverTargetKey(event.target) : null)
  if (gestureIdleTimer || (event.metaKey && card && card !== inspectHover && card.dataset.frame !== active)) {
    warmAt(event.clientX, event.clientY, event.metaKey)
  }
})
viewport.addEventListener('pointerleave', () => {
  pointer = null
  setHoverKey(null)
})
viewport.addEventListener('pointerdown', event => {
  if (event.isTrusted && hoverTargetKey(event.target)) disclosureRequest = undefined
}, true)
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

function comparisonContext() {
  const frame = currentFrame()
  return { frame, route: routeOf(preview), expanded, variant: focusedVariant?.id === frame?.id ? focusedVariant?.variant : undefined }
}

let stopContextTracking
function watchLiveFrame(frame) {
  let connected
  function deliverPendingPick() {
    const target = pendingInspectTarget
    if (frame !== preview || !target?.isConnected || target.ownerDocument !== frame.contentDocument) return
    pendingInspectTarget = null
    target.dispatchEvent(new Event('select-inspector-variable-use', { bubbles: true, composed: true, cancelable: true }))
  }
  function connect() {
    const doc = frame.contentDocument
    if (frame !== preview || !doc || doc === connected) return
    connected = doc
    dock.removeAttribute('data-connecting-selection')
    doc.addEventListener('workspace-inspector-selection', event => {
      if (frame === preview && dock.hasAttribute('data-attachment-status')) {
        dock.toggleAttribute('data-connecting-selection', event.composedPath()[0] !== doc)
      }
    })
    pendingInspectTarget = null
    doc.addEventListener('workspace-inspector-listening', deliverPendingPick, { once: true })
    if (document.body.hasAttribute('data-canvas-editor') && doc.URL !== 'about:blank') {
      delete frame.dataset.inspectorDocument
      const startup = frame.inspectorStartup ?? prepareWorkspaceInspector()
      delete frame.inspectorStartup
      startup.loadRoute(doc.location)
      doc.defaultView.localhostInspectorStartup = startup
      const bootstrap = doc.createElement('script')
      bootstrap.type = 'module'
      bootstrap.src = '/__inspector-flow/workspace-editor.mjs'
      bootstrap.onerror = () => { if (frame === preview && doc === frame.contentDocument) message('Could not load Inspector. Reload this canvas to try again.') }
      doc.head.append(bootstrap)
    }
    stopContextTracking?.()
    stopContextTracking = trackContext(frame, comparisonContext)
    sidebar?.changed()
    frame.contentWindow.navigation?.addEventListener('currententrychange', () => {
      if (preview === frame) { pendingInspectTarget = null; sidebar?.changed() }
    })
    const appWindow = frame.contentWindow
    appWindow.addEventListener('pointermove', event => {
      if (frame !== preview || !expanded || event.pointerType === 'touch') return
      pointer = frame
      hoverKey = event.metaKey && active ? 'frame:' + active : null
    }, true)
    appWindow.addEventListener('pointerout', event => {
      if (frame === preview && !event.relatedTarget) { pointer = null; setHoverKey(null) }
    }, true)
    function lockAppClick(event) {
      if (!event.isTrusted || frame !== preview) return
      if (event.target?.id === 'localhost-inspector-text-editor' || event.type === 'dblclick' && frame.dataset.inspectorDocument) return
      if (event.type === 'pointerdown') {
        pendingInspectTarget = null
        disclosureRequest = undefined
        sidebar?.leaveVariant()
        if (candidate) cancelCandidate()
      }
      if (expanded && event.type === 'click' && event.button === 0) setFrameSelected(true)
      const wantsInspector = document.body.hasAttribute('data-canvas-editor') ||
        document.body.hasAttribute('data-inspector-watching') || new URLSearchParams(location.search).get('editor') === 'extension'
      if (!expanded && !(event.metaKey && event.button === 0 && wantsInspector)) return
      // Reserve Command-click even before the extension attaches to a new frame.
      // Only the mounted Inspector should receive the trusted selection gesture.
      if (event.metaKey && event.button === 0 && doc.getElementById('localhost-inspector-outlines')) {
        event.preventDefault()
        return
      }
      if (event.metaKey && event.button === 0 && event.type === 'click' &&
          wantsInspector) {
        // Keep the exact node. A re-render or navigation must never redirect a pick.
        pendingInspectTarget = window.LocalhostInspector.pointedElement(doc, { x: event.clientX, y: event.clientY })
      }
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu']) {
      appWindow.addEventListener(type, lockAppClick, true)
    }
    function lockAppKey(event) {
      if (!event.isTrusted || frame !== preview) return
      if (event.target?.id === 'localhost-inspector-text-editor') return
      if (event.type === 'keydown' && candidate && event.key !== 'Meta') cancelCandidate()
      updateInspectModifier(event)
      if (!expanded || event.key === 'Tab' || event.key === 'Meta') return
      if (event.type === 'keydown' && event.key === 'Escape') clearCanvasSelection()
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    appWindow.addEventListener('keydown', lockAppKey, true)
    appWindow.addEventListener('keyup', lockAppKey, true)
    appWindow.addEventListener('beforeinput', lockAppKey, true)
    appWindow.addEventListener('wheel', event => {
      if (frame !== preview) return
      if (!expanded) {
        if (!event.ctrlKey || event.target.closest?.('#localhost-inspector') || consumePinchTail(event)) return
        if (!event.metaKey || event.deltaY <= 0 || resizing || !currentFrame()) return
        event.preventDefault()
        event.stopImmediatePropagation()
        lastTransitionWheel = performance.now()
        camera.scale = .5
        toggleView()
        if (active) {
          center(active, viewport.clientWidth - dock.offsetWidth)
          position()
        }
        return
      }
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
        app.y - view.y + event.clientY * camera.scale, active && cards.get(active).button)
    }, { capture: true, passive: false })
    if (expanded && !active) syncLiveFrame()
  }
  new MutationObserver(() => {
    if (frame !== preview || !frame.dataset.inspectorDocument) return
    dock.removeAttribute('data-connecting-selection')
    if (!candidate) delete dock.dataset.openingFrame
    if (dock.hasAttribute('data-attachment-status')) {
      delete dock.dataset.attachmentStatus
      dock.inert = false
      message('')
    }
    deliverPendingPick()
  }).observe(frame, { attributes: true, attributeFilter: ['data-inspector-document'] })
  frame.addEventListener('load', connect)
  if (frame.contentDocument && frame.contentDocument.readyState !== 'loading') connect()
}

function auditPage() {
  const route = routeOf(preview)
  if (!route) return null
  const base = data.frames.find(item => item.route === route && !item.steps.length)
  const current = currentFrame()
  return { id: route, label: base?.label || preview.contentDocument.title || route, frameId: current?.id }
}

const inspectorHelp = 'Open this workspace in Chrome and click the Localhost Inspector extension to connect both panels.'
sidebar = connectSidebar({
  showConnectionHelp(show) {
    if (show && !document.body.hasAttribute('data-canvas-editor')) message(inspectorHelp)
    else if (notice.value === inspectorHelp) message('')
  },
  data, groups, dock, getOutline, onOpenOutline, warmNavigation, getFrame: () => preview, livePage: auditPage,
  selectedRoute: () => expanded && !preview.hasAttribute('data-frame-selected') ? null : routeOf(preview),
  navigate: navigateToFrame,
  focusResult: node => {
    pendingInspectTarget = null
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    if (expanded && active) {
      setFrameSelected(true)
      const card = cards.get(active)
      const box = node.getBoundingClientRect()
      focusSidebarPoint(card.x + box.left + box.width / 2, card.y + card.labelHeight + box.top + box.height / 2)
    }
    return !node.dispatchEvent(new Event('select-inspector-variable-use', { bubbles: true, composed: true, cancelable: true }))
  },
})
watchLiveFrame(preview)
const previewBounds = new ResizeObserver(schedulePreviewUpdate)
previewBounds.observe(viewport)
previewBounds.observe(dock)

let comparison = data.comparison
function centerLinkedPair(id) {
  const card = cards.get(id)
  const width = viewport.clientWidth - dock.offsetWidth
  const pairWidth = card.width * 2 + frameGap
  camera.scale = Math.max(minZoom, Math.min(camera.scale, (width - 48) / pairWidth))
  center(id, width)
  camera.x -= (card.width + frameGap) * camera.scale / 2
}
function showLinkedFrame() {
  if (!expanded || !comparison || linkedFrame) return
  const saved = comparison.context
  const frame = saved?.frame ? resolveProposalFrame(data.frames, saved.frame, saved.page, location.origin) : currentFrame()
  if (!frame) return
  linkedFrame = addLinkedFrame(map, comparison, frame, saved?.page || routeOf(preview) || frame.route, frameGap, selected => {
    if (selected) {
      clearCanvasSelection()
      flowFrameId = frame.id
      sidebar?.revealFlowFrame(flowFrameId)
    }
    selectedComparison = selected
    sidebar?.changed()
    sidebar?.refreshOutline()
  })
  outlinesByFlow = null
  sidebar?.refreshOutline()
  layout()
}
function updateComparison(next) {
  if (comparison?.otherOrigin === next?.otherOrigin && comparison?.role === next?.role &&
      comparison?.context?.frame === next?.context?.frame && comparison?.context?.page === next?.context?.page) return
  linkedFrame?.remove()
  linkedFrame = null
  outlinesByFlow = null
  selectedComparison = false
  sidebar?.refreshOutline()
  comparison = next
  layout()
  showLinkedFrame()
  if (linkedFrame && linkedFrame.id === active) {
    centerLinkedPair(active)
    position()
  }
}
if (data.proposalEvents && comparison?.role !== 'proposal') {
  const { watchProposalLink } = await import('./proposal-link.mjs')
  watchProposalLink(updateComparison, origins => {
    const current = new Map(origins.map(frame => [frame.id, frame]))
    for (const item of data.variants ?? []) {
      const saved = current.get(item.id)
      if (!saved) continue
      item.hasEdits = saved.hasEdits === true
      if (saved.origin && saved.origin !== item.origin) {
        item.origin = saved.origin
        variantFrames.get(item.id)?.setPreviewOrigin(saved.origin)
      }
    }
  })
}
const entry = new URLSearchParams(location.search).get('page')
async function openContext(link, variantId) {
  if (link.unavailable) {
    message('This comparison page is outside the flow map.')
    return
  }
  const opened = await activate(link.frame)
  if (!opened) return
  if (link.expanded !== expanded) toggleView()
  focusedVariant = expanded ? variantFrames.get(variantId) : null
  if (expanded && variantId === '*' && !focusedVariant) {
    const siblings = [...variantFrames.values()].filter(frame => frame.id === active)
    if (siblings.length) {
      focusedVariant = { id: active, variant: '*' }
      fitCards(siblings.map(frame => frame.bounds), viewport.clientWidth - dock.offsetWidth, viewport.clientHeight)
    }
    return
  }
  if (!focusedVariant || focusedVariant.id !== active) return
  const card = focusedVariant.bounds
  const width = viewport.clientWidth - dock.offsetWidth
  camera.scale = Math.max(minZoom, Math.min(1, (width - 80) / card.width,
    (viewport.clientHeight - 100) / (card.height + flowHeadingSpace)))
  camera.x = width / 2 - (card.x + card.width / 2) * camera.scale
  camera.y = viewport.clientHeight / 2 - (card.y + card.labelHeight + card.height / 2) * camera.scale
  position()
}
function requestedVariant() {
  return new URLSearchParams(location.hash.slice(1)).get('variant')
}
const comparisonEntry = proposalEntry(data, location.search)
if (comparisonEntry) await openContext(comparisonEntry, requestedVariant())
else preview.src = data.frames.some(frame => frame.route === entry) ? entry : '/'
window.addEventListener('hashchange', () => {
  const link = proposalEntry(data, location.search)
  if (link) void openContext(link, requestedVariant())
})
mountEditionSwitcher(document.querySelector('#workspace-toolbar'),data.designVersions,comparisonContext)
document.body.setAttribute('data-workspace-ready', '')
toggle.disabled = false
