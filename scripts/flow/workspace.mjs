import { VariantOverview } from './variant-overview.mjs'
import './tooltip.js'
import { VariantWindow, WindowedVariant } from './variant-window.mjs'
import { prepareWorkspaceInspector } from './inspector-request.mjs'
import { mountVariantSections, sectionBounds, sectionColumns } from './variant-sections.mjs'
import { addLinkedFrame, addVariantFrame, localPreviewUrl, proposalEntry, resolveProposalFrame, trackContext } from './proposal-view.mjs'
import { connectSidebar } from './workspace-sidebar.mjs'
import { canvasCamera, frameGap, flowHeadingSpace, groupFlowFrames, renderFrames } from './render-frames.mjs'
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
const projectCamera = canvasCamera(map)
let preview = document.querySelector('#app-preview')
const viewport = document.querySelector('#viewport')
const toggle = document.querySelector('#flow-toggle')
const zoom = document.querySelector('#zoom')
const zoomPreset = document.querySelector('#zoom-preset')
const notice = document.querySelector('#notice')
const dock = document.querySelector('#localhost-inspector-dock')
const background = connectCanvasBackground(dock, viewport)
const data = await fetch('./map.json', { headers: { 'X-Inspector-Preview-Origins': 'on-demand' } }).then(response => response.json())
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
const groups = groupFlowFrames(data.frames)
const groupByFrame = new Map(groups.flatMap(group => group.frames.map(frame => [frame.id, group])))
let flowFrameId = groups[0]?.frames[0]?.id
let linkedFrame
const variantFrames = new Map()
const variantWindow = new VariantWindow()
variantWindow.overview = new VariantOverview(map, schedulePreviewUpdate)
let layoutVariantSections
let focusedVariant
let outlinesByFlow
let selectedSection
let selectedFrameSurface
let selectedFlow
let selectedOriginal
let pendingInspectTarget
let inspectedVariant
let selectedComparison = false
let hoverKey = null
let disclosureRequest
let disclosureVersion = 0
const { cards, headings, layout: layoutFrames } = renderFrames(map, data, groups, activate, viewOf, previewIndex,
  anchor => changeView({ preset: 'desktop', anchor }))
function layout() {
  const extras = linkedFrame ? [linkedFrame, ...variantFrames.values()] : [...variantFrames.values()]
  const byAnchor = Map.groupBy(extras, frame => frame.id)
  layoutFrames(card => {
    const members = byAnchor.get(card.id) ?? []
    const roots = new Map()
    const groups = Map.groupBy(members, frame => {
      const section = frame.section
      if (!section) return frame
      if (!roots.has(section)) roots.set(section, section.closest('#map > .variant-section') ?? section)
      return roots.get(section)
    })
    const slotWidth = members.reduce((widest, frame) => Math.max(widest, frame.customWidth ?? 0), card.width)
    const perRow = Number.isSafeInteger(data.variantGroupsPerRow) && data.variantGroupsPerRow > 0
      ? data.variantGroupsPerRow : Infinity
    let columns = 0
    let widestRow = 0
    let groupsInRow = 0
    let rowTop = 0
    let extraHeight = 0
    for (const frames of groups.values()) {
      if (groupsInRow === perRow) {
        rowTop = extraHeight + card.height + frameGap
        groupsInRow = columns = 0
      }
      groupsInRow++
      let width = 1
      let row = 0
      let noteOffset = 0
      const firstRows = new Map()
      for (const [section, members] of Map.groupBy(frames, frame => frame.section)) {
        const size = Math.min(members.length, sectionColumns)
        width = Math.max(width, size)
        const ancestors = []
        for (let group = section; group; group = group.parentElement.closest('.variant-section')) {
          if (!firstRows.has(group)) firstRows.set(group, row)
          ancestors.push(group)
        }
        let visibleRows = 0
        let rowNoteHeight = 0
        members.forEach((frame, index) => {
          if (index && index % size === 0) { noteOffset += rowNoteHeight; rowNoteHeight = 0 }
          const localRow = Math.floor(index / size)
          const hidden = ancestors.some(group => group.hasAttribute('data-collapsed') && row + localRow > firstRows.get(group))
          const offset = rowTop + (row + localRow) * (card.height + frameGap) + noteOffset
          frame.place(card, columns + 1 + index % size, offset, hidden, slotWidth)
          if (!hidden) {
            visibleRows = localRow + 1
            rowNoteHeight = Math.max(rowNoteHeight, (frame.reviewHeight ?? 0) + Math.max(0, frame.bounds.height - card.height))
            extraHeight = Math.max(extraHeight, offset + rowNoteHeight)
          }
        })
        noteOffset += rowNoteHeight
        row += visibleRows
      }
      columns += width
      widestRow = Math.max(widestRow, columns)
    }
    return { columns: widestRow, extraHeight, slotWidth }
  })
  layoutVariantSections?.()
  variantWindow.rebuild(variantFrames.values())
  if (variantFrames.size >= 512) variantWindow.overview.prepare()
  schedulePreviewUpdate()
}
const updateSharpPreviews = createSharpPreviews(cards)
const framesById = new Map(data.frames.map(frame => [frame.id, frame]))
const scenarioRoutes = new Set(data.frames.filter(frame => frame.steps.length).map(frame => frame.route))
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
let wheelFrame
let lastWheelKind
let lastWheelX = 0
let lastWheelY = 0
let packetStart = 0
let packetDuration = 0
let packetFrom
let displayInterval = 16.67
let packetInterval
let measuringRefresh = false

// Measure the active display when a gesture starts. No sampling loop runs at rest.
function sampleDisplayRefresh() {
  if (measuringRefresh) return
  measuringRefresh = true
  requestAnimationFrame(first => requestAnimationFrame(second => {
    const elapsed = second - first
    if (elapsed >= 4 && elapsed <= 25) displayInterval = elapsed
    measuringRefresh = false
  }))
}
const displayedCamera = { ...camera }

let lastPictureUpdate = -Infinity
let pictureViewportWidth = 0
let pictureViewportHeight = 0
function schedulePreviewUpdate() {
  if (previewUpdate || (gestureIdleTimer && performance.now() - lastPictureUpdate < 50)) return
  previewUpdate = requestAnimationFrame(() => {
    previewUpdate = null
    lastPictureUpdate = performance.now()
    // Reading layout during a gesture can synchronize the entire transformed board.
    if (!gestureIdleTimer || !pictureViewportWidth) {
      pictureViewportWidth = viewport.clientWidth - dock.offsetWidth
      pictureViewportHeight = viewport.clientHeight
      updateSharpPreviews(expanded, camera, pictureViewportWidth, pictureViewportHeight)
    }
    updateVariantPictures(pictureViewportWidth, pictureViewportHeight)
  })
}

// Spend spare decode capacity on nearby cards so a short pan can reveal sharp text immediately.
let previousPictureView
function updateVariantPictures(width, height) {
  const view = displayedCamera
  layoutVariantSections?.updateVisibility(view, width, height)
  const prior = previousPictureView
  const dt = lastPictureUpdate - (prior?.time ?? 0)
  const moving = gestureIdleTimer && prior && dt >= 16 && dt <= 180
  const panning = moving && prior.scale === view.scale
  // Project the last measured camera displacement by 160 ms. Limit the reach so
  // a fling or a navigation jump cannot start a board-wide decode.
  const leadX = panning ? Math.max(-width, Math.min(width, (view.x - prior.x) * 160 / dt)) : 0
  const leadY = panning ? Math.max(-height, Math.min(height, (view.y - prior.y) * 160 / dt)) : 0
  // While zooming out, the viewport expands in canvas coordinates. Prepare
  // the edges it is about to reveal before the next picture update.
  let lookahead = 0
  if (moving && view.scale < prior.scale) {
    // Limit the forecast to 100 ms, two measured intervals, and the remaining
    // expansion before minimum zoom. Viewport width is proportional to 1 / scale.
    const intervalsToMinZoom = (view.scale / minZoom - 1) / (1 - view.scale / prior.scale)
    lookahead = Math.min(2, 100 / dt, intervalsToMinZoom)
  }
  previousPictureView = { ...view, time: lastPictureUpdate }
  const detailCandidates = []
  const overviewCandidates = []
  let started = false
  let deferred = false
  for (const frame of variantWindow.pictures(view, width, height, expanded, prior, lookahead)) {
    if ((!frame.hasPicture && !frame.needsLivePreview) || !frame.bounds) continue
    const b = frame.bounds
    const left = view.x + b.x * view.scale
    const top = view.y + (b.y + b.labelHeight) * view.scale
    const w = Math.max(0, Math.min(width, left + b.width * view.scale) - Math.max(0, left))
    const h = Math.max(0, Math.min(height, top + b.height * view.scale) - Math.max(0, top))
    const right = left + b.width * view.scale
    const bottom = top + b.height * view.scale
    const dx = Math.max(0, -right, left - width)
    const dy = Math.max(0, -bottom, top - height)
    const readable = expanded && b.width * view.scale * devicePixelRatio > 320 && !frame.hidden
    if (frame.needsLivePreview) {
      if (readable && w > 0 && h > 0) frame.showLivePreview()
      continue
    }
    const projectedX = Math.max(0, -right - leadX, left + leadX - width)
    const projectedY = Math.max(0, -bottom - leadY, top + leadY - height)
    const ahead = Boolean(leadX || leadY) && projectedX < 64 && projectedY < 64
    const area = w * h
    if (readable && ((dx < width && dy < height) || (projectedX < width && projectedY < height))) {
      frame.warmOverview()
    } else if (expanded && !frame.hidden && b.width * view.scale >= 64 && frame.canWarmOverview) {
      // Near overview zoom, prepare a row beyond the current and predicted edges.
      // At Fit the browser handles the many very small cards through native lazy loading.
      const marginX = Math.min(width / 3, b.width * view.scale * 2)
      const marginY = Math.min(height / 3, b.height * view.scale)
      if ((dx < marginX && dy < marginY) || (projectedX < marginX && projectedY < marginY)) {
        overviewCandidates.push({ frame, area, distance: Math.min(dx + dy, projectedX + projectedY) })
      }
    }
    if (readable && ((dx < 180 && dy < 180) || ahead)) {
      // Visible pixels take precedence, followed by predicted arrivals and then neighbors.
      const tier = area > 0 ? 2 : ahead ? 1 : 0
      // A sliver of a desktop card at reading zoom needs the same pixel density as its center.
      const visibleAtReadingSize = area > 0 && (view.scale >= 0.5 || b.width * view.scale >= 480)
      detailCandidates.push({ frame, tier, area, distance: dx + dy, ahead, visibleAtReadingSize, bytes: b.width * b.height * 16 })
    } else frame.useSharpPicture(false)
  }
  overviewCandidates.sort((a, b) => b.area - a.area || a.distance - b.distance)
  for (const { frame } of overviewCandidates.slice(0, 8)) frame.warmOverview()
  detailCandidates.sort((a, b) => b.tier - a.tier || b.area - a.area || a.distance - b.distance)
  const detailBudget = 48 * 1024 * 1024
  let remaining = detailBudget
  // Reading-size visible cards own their detail until they leave view. Spend the
  // rest of the usual working set on neighbors, with one predicted arrival when full.
  let predictedAllowance = Boolean(leadX || leadY)
  for (const { frame, bytes, area, distance, ahead, visibleAtReadingSize } of detailCandidates) {
    if (bytes > remaining && !visibleAtReadingSize) {
      if (area > 0 || !ahead || !predictedAllowance || bytes > detailBudget) {
        frame.useSharpPicture(false)
        continue
      }
      predictedAllowance = false
    }
    remaining = Math.max(0, remaining - bytes)
    if (frame.hasDetail) continue
    if (distance > 64 && gestureIdleTimer && !ahead) continue
    if (started) { deferred = true; continue }
    started = frame.useSharpPicture(true, area > 0) === true
  }
  if (deferred && !gestureIdleTimer) schedulePreviewUpdate()
}

function position() {
  if (wheelFrame) cancelAnimationFrame(wheelFrame)
  wheelFrame = null
  lastWheelKind = null
  drawCamera(camera)
}

function updateMapLayer(scale) {
  // Promoting the entire map during a pinch can stall presentation. Reuse its
  // current layer through reversals, but release it when zoomed far out.
  const density = scale * window.devicePixelRatio
  if (!gestureIdleTimer || density < .25) map.toggleAttribute('data-detail-scale', density >= .6)
}

function drawCamera(view) {
  Object.assign(displayedCamera, view)
  updateMapLayer(view.scale)
  projectCamera(view)
  if (expanded && active) {
    const card = cards.get(active)
    const x = view.x + card.x * view.scale
    const y = view.y + (card.y + card.labelHeight) * view.scale
    preview.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + view.scale + ')'
  }
  const percent = Math.round(view.scale * 100) + '%'
  if (zoom.value !== percent) {
    zoom.value = percent
    zoomPreset.options[0].textContent = percent
  }
  const preset = presetScales.has(String(view.scale)) ? String(view.scale) : 'current'
  if (zoomPreset.value !== preset) zoomPreset.value = preset
  schedulePreviewUpdate()
}

function getOutline() {
  if (!expanded) return null
  if (!outlinesByFlow) {
    const byAnchor = new Map()
    const childrenBySection = new Map()
    for (const frame of variantFrames.values()) {
      if (!byAnchor.has(frame.id)) byAnchor.set(frame.id, [])
      const siblings = byAnchor.get(frame.id)
      const row = { kind: 'frame', label: frame.label, key: 'variant:' + frame.variant, children: [] }
      let section = frame.section
      const ancestors = []
      while (section && !childrenBySection.has(section)) {
        ancestors.push(section)
        section = section.parentElement.closest('.variant-section')
      }
      let children = childrenBySection.get(section) ?? siblings
      for (const ancestor of ancestors.reverse()) {
        const parent = { kind: 'section', label: ancestor.getAttribute('aria-label'), key: ancestor.dataset.sectionKey, children: [] }
        children.push(parent)
        children = parent.children
        childrenBySection.set(ancestor, children)
      }
      children.push(row)
    }
    outlinesByFlow = new Map(groups.map(group => {
      const items = group.frames.flatMap(({ id }) => {
        const label = cards.get(id).button.firstElementChild.textContent
        const variants = byAnchor.get(id) ?? []
        const rows = [{ kind: 'frame', label, key: 'frame:' + id, children: [],
          variantCount: variants.filter(item => item.kind === 'frame').length }]
        if (linkedFrame?.id === id) rows.push({ kind: 'frame', label: linkedFrame.label, key: 'comparison:' + id, children: [] })
        return rows.concat(variants)
      })
      const keys = new Map()
      function collect(item, parent) {
        keys.set(item.key, parent)
        for (const child of item.children) collect(child, item.key)
      }
      for (const item of items) collect(item, null)
      return [group.key, { key: group.key, label: group.label, items, keys }]
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
  if (selectedFrameSurface) selectedKey = 'variant:' + selectedFrameSurface.variant
  if (selectedSection) selectedKey = selectedSection.dataset.sectionKey
  if (selectedFlow) selectedKey = 'flow:' + selectedFlow.key
  const isFlowKey = key => groups.length > 1 && key?.startsWith('flow:') && outlinesByFlow.has(key.slice(5))
  const large = (scope?.keys.size ?? 0) > 1000
  const pathKeys = new Set()
  if (large) {
    for (let key of [sourceKey, selectedKey, hoverKey]) {
      while (key && !pathKeys.has(key)) { pathKeys.add(key); key = scope.keys.get(key) }
    }
  }
  return { large, pathKeys: [...pathKeys], items: scope?.items ?? [], flows: [...outlinesByFlow.values()].map(({ key, label, items }) => ({ key, label, items })), flowKey, flowFrameId, activeKey, sourceKey, disclosureRequest,
    hoverKey: scope?.keys.has(hoverKey) || isFlowKey(hoverKey) ? hoverKey : null,
    selectedKey: scope?.keys.has(selectedKey) || isFlowKey(selectedKey) ? selectedKey : null }
}

function revealSectionRow(frame) {
  for (let section = frame.section; frame.hidden && section; section = section.parentElement.closest('.variant-section')) {
    if (section.hasAttribute('data-collapsed')) section.querySelector('.section-disclosure')?.click()
  }
}

function markFlow(group) {
  headings.get(selectedFlow)?.removeAttribute('data-selected')
  selectedFlow = group
  headings.get(group)?.setAttribute('data-selected', '')
}

const sectionPaints = new WeakMap()
function sectionPaint(section) {
  if (sectionPaints.has(section)) return sectionPaints.get(section)
  const surface = section.firstElementChild
  const paint = { element: surface, key: section.dataset.sectionKey, kind: 'Section', color: () => getComputedStyle(surface).backgroundColor,
    get bounds() { return sectionBounds.get(surface) },
    render(color) { surface.style.backgroundColor = color ?? '' } }
  sectionPaints.set(section, paint)
  return paint
}

function markSection(section) {
  selectedFrameSurface?.markSurface(false)
  selectedFrameSurface = null
  background.select(section && sectionPaint(section))
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
  markSection(section)
  sidebar?.changed()
  sidebar?.refreshOutline()
}

async function onOpenOutline(key, expandedRow) {
  if (!expanded || typeof key !== 'string') return
  if (key.startsWith('flow:')) {
    const group = groups.length > 1 && groups.find(group => group.key === key.slice(5))
    if (!group || !clearCanvasSelection()) return
    flowFrameId = group.frames[0].id
    markFlow(group)
    sidebar?.changed()
    sidebar?.refreshOutline()
    const heading = headings.get(group) ?? cards.get(flowFrameId).button.firstElementChild
    const first = cards.get(flowFrameId)
    focusSidebarPoint(first.x + heading.offsetWidth / 2, first.y - flowHeadingSpace + heading.offsetHeight / 2)
    return
  }
  if (!outlinesByFlow) getOutline()
  if (!outlinesByFlow || ![...outlinesByFlow.values()].some(flow => flow.keys.has(key))) return
  disclosureRequest = typeof expandedRow === 'boolean' ? { key, expanded: expandedRow, version: ++disclosureVersion } : undefined
  if (key.startsWith('section:')) {
    selectSection(key)
    if (selectedSection?.dataset.sectionKey === key) {
      const surface = selectedSection.querySelector('.variant-section-surface')
      const bounds = sectionBounds.get(surface)
      if (bounds) focusSidebarPoint((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2)
    }
    return
  }
  const id = key.slice(key.indexOf(':') + 1)
  if (key === 'variant:' + id || (key === 'comparison:' + id && linkedFrame?.id === id)) {
    const frame = key.startsWith('variant:') ? variantFrames.get(id) : linkedFrame
    if (!frame || !clearCanvasSelection()) return
    revealSectionRow(frame)
    frame.open()
    focusSidebarFrame(frame.bounds)
  } else if (key === 'frame:' + id && framesById.has(id)) {
    if (!clearCanvasSelection(id)) return
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
    markFlow(null)
    flowFrameId = selectedOriginal
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
  if (action === 'surface') {
    if (!clearCanvasSelection()) return
    selectedFrameSurface = variantFrames.get(frame.variant)
    flowFrameId = selectedFrameSurface.id
    selectedFrameSurface.markSurface(true)
    background.select(selectedFrameSurface.paintSurface)
    sidebar?.refreshOutline()
    return
  }
  if (action === 'focus-layer') {
    const bounds = variantFrames.get(frame.variant)?.bounds
    if (expanded && inspectedVariant === frame.variant && bounds && Number.isFinite(details?.x) && Number.isFinite(details?.y)) {
      focusSidebarPoint(bounds.x + details.x, bounds.y + bounds.labelHeight + details.y)
    }
    return
  }
  if (action === 'selection' && inspectedVariant === frame.variant) {
    dock.toggleAttribute('data-frame-properties', !details)
    background.select(details ? null : variantFrames.get(frame.variant)?.paintSurface)
  }
  if (action !== 'start') {
    if (action === 'stop' && inspectedVariant === frame.variant) {
      inspectedVariant = null
      dock.removeAttribute('data-frame-properties')
      background.select(null)
    }
    sidebar.inspectVariant(frame, action, details)
    if (action === 'stop') sidebar.refreshOutline()
    return
  }
  markSection(null)
  markFlow(null)
  selectedComparison = false
  inspectedVariant = frame.variant
  flowFrameId = variantFrames.get(frame.variant).id
  setFrameSelected(false)
  const before = frame.app.getBoundingClientRect()
  const board = viewport.getBoundingClientRect()
  const wasInView = before.left >= board.left && before.right <= board.right - dock.offsetWidth + 1
  sidebar.inspectVariant(frame, action, details)
  if (dock.firstElementChild) {
    dock.firstElementChild.dispatchEvent(new Event('clear-workspace-selection', { cancelable: true }))
    dock.firstElementChild.dispatchEvent(new Event('open-workspace-inspector'))
    background.select(variantFrames.get(frame.variant).paintSurface)
    dock.setAttribute('data-frame-properties', '')
  }
  const left = viewport.getBoundingClientRect().left
  const width = viewport.clientWidth - (document.querySelector('#variant-properties').offsetWidth || dock.offsetWidth)
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

function clearCanvasSelection(destinationId) {
  sidebar?.leaveVariant()
  if (!expanded) return
  const clearSelection = new Event('clear-workspace-selection', { cancelable: true })
  if (dock.firstElementChild?.dispatchEvent(clearSelection) === false) return
  const reuse = destinationId && preparation?.frame.id === destinationId
  clearHoverTimers()
  hoverCard = inspectHover = null
  if (candidate && !reuse) cancelCandidate()
  markSection(null)
  markFlow(null)
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
    surfaces.every(surface => (surface.role === 'selected-tab' && !item.checkpoint.some(check => check.role === 'selected-tab')) ||
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

function refreshVariants() {
  if (!expanded || data.comparison?.role === 'proposal') return
  const definitions = data.variants ?? []
  const windowPictures = definitions.length >= 100
  const savedSurfaces = background.savedSurfaceKeys()
  const createFrame = (parent, item) => addVariantFrame(parent, item, frameGap, inspectVariant, layout)
  const ids = new Set(definitions.map(item => item.id))
  for (const [id, frame] of variantFrames) {
    if (!ids.has(id)) {
      if (inspectedVariant === id) sidebar?.leaveVariant()
      if (selectedFrameSurface === frame) markSection(null)
      frame.remove()
      variantFrames.delete(id)
    }
  }
  layoutVariantSections = mountVariantSections(map, definitions, framesById, (parent, item) => {
    const existing = variantFrames.get(item.id)
    if (existing) {
      existing.updateSnapshot(item)
      existing.placeIn(parent)
      return existing
    }
    // Authored notes and wrapped titles contribute measured height to the layout.
    // Keep those, live-only apps and persisted custom geometry on their existing path.
    const lazy = windowPictures && item.id && item.snapshot && item.label && localPreviewUrl(item.route, item.deferredOrigin ? location.origin : item.origin) &&
      !item.note && !item.reviewNote && item.label.length * 32 < item.snapshot.width &&
      !savedSurfaces.has('frame:' + item.id)
    const frame = lazy ? new WindowedVariant(parent, item, frameGap, createFrame, variantWindow.mounted, variantWindow.overview)
      : createFrame(parent, item)
    if (frame) {
      variantFrames.set(item.id, frame)
      if (!lazy) background.restore(frame.paintSurface)
    }
    return frame
  }, selectSection, layout)
  if (selectedSection && !selectedSection.isConnected) markSection(null)
  if (savedSurfaces.size) {
    for (const section of map.querySelectorAll('.variant-section')) {
      if (savedSurfaces.has(section.dataset.sectionKey)) background.restore(sectionPaint(section))
    }
  }
  outlinesByFlow = null
  layout()
  sidebar?.refreshOutline()
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
    if (!layoutVariantSections) refreshVariants()
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

function zoomCamera(scale, x, y) {
  const next = Math.min(1, Math.max(minZoom, scale))
  camera.x = x - (x - camera.x) * next / camera.scale
  camera.y = y - (y - camera.y) * next / camera.scale
  camera.scale = next
}

// Spread a packet across the shorter of its observed cadence and one 60 Hz frame.
function drawWheelFrame() {
  wheelFrame = null
  const elapsed = performance.now() - packetStart
  const share = Math.min(1, .25 + .75 * elapsed / packetDuration)
  if (share >= 1) {
    drawCamera(camera)
    return
  }
  drawCamera({
    x: packetFrom.x + (camera.x - packetFrom.x) * share,
    y: packetFrom.y + (camera.y - packetFrom.y) * share,
    scale: packetFrom.scale + (camera.scale - packetFrom.scale) * share,
  })
  wheelFrame = requestAnimationFrame(drawWheelFrame)
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
  if (event.metaKey && event.deltaY < 0 && card && !resizing && !pendingCard &&
      (camera.scale * Math.exp(-event.deltaY * pinchSensitivity) >= .55 || fillsCanvas(card))) {
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
  applyWheelMotion(event, x, y)
}

function applyWheelMotion(event, x, y) {
  const kind = event.ctrlKey ? 'pinch' : 'pan'
  const dx = event.ctrlKey ? 0 : event.deltaX
  const dy = event.deltaY
  if (!dx && !dy) return
  const now = performance.now()
  const sameGesture = gestureIdleTimer && lastWheelKind === kind
  const continuing = sameGesture && lastWheelX * dx + lastWheelY * dy > 0
  const scaleFactor = event.ctrlKey ? Math.exp(-dy * pinchSensitivity) : 1
  const panX = -dx * panSensitivity
  const panY = -dy * panSensitivity
  if (wheelFrame && !continuing) {
    // Keep the full input distance when it already moves the visible camera
    // in the requested direction. Discard pending motion that would oppose it.
    const progress = event.ctrlKey
      ? -dy * (camera.scale * scaleFactor - displayedCamera.scale)
      : panX * (camera.x + panX - displayedCamera.x) + panY * (camera.y + panY - displayedCamera.y)
    if (!sameGesture || progress <= 0) Object.assign(camera, displayedCamera)
  }
  deferGestureWork()
  if (event.ctrlKey) {
    zoomCamera(camera.scale * scaleFactor, x, y)
  } else {
    camera.x += panX
    camera.y += panY
  }
  const interval = now - packetStart
  if (!continuing) packetInterval = null
  else if (interval > 1) packetInterval = packetInterval ? .7 * packetInterval + .3 * interval : interval
  packetStart = now
  // A sparse input stream leaves unused refreshes between packets. Start each
  // step immediately and use those refreshes to finish it. At display cadence,
  // each new wheel sample already supplies the next screen position.
  if (continuing && interval > 1 && packetInterval > displayInterval * 1.4) {
    if (wheelFrame) cancelAnimationFrame(wheelFrame)
    packetFrom = { ...displayedCamera }
    packetDuration = Math.min(16, packetInterval)
    drawWheelFrame()
  } else {
    if (!sameGesture) sampleDisplayRefresh()
    position()
  }
  lastWheelKind = kind
  lastWheelX = dx
  lastWheelY = dy
}

function fitCards(board, width, height) {
  if (!board.length) return
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const card of board) {
    left = Math.min(left, card.x)
    top = Math.min(top, card.y - flowHeadingSpace)
    right = Math.max(right, card.x + card.width)
    bottom = Math.max(bottom, card.y + card.height + card.labelHeight)
  }
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
    for (const frame of variantFrames.values()) if (!frame.hidden) board.push(frame.bounds)
    fitCards(board, width, height)
    return
  }
  zoomCamera(Number(zoomPreset.value), width / 2, height / 2)
  position()
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
// Native Tab traversal and browser Find include offscreen section controls.
window.addEventListener('keydown', event => {
  if (event.key === 'Tab' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f')) {
    map.toggleAttribute('data-read-all-sections', true)
    if (variantWindow.overview.region) updateVariantPictures(pictureViewportWidth, pictureViewportHeight)
  }
}, true)
function deferGestureWork() {
  if (!gestureIdleTimer) {
    map.removeAttribute('data-read-all-sections')
    clearHoverTimers()
    inspectHover = null
  }
  clearTimeout(gestureIdleTimer)
  deferredHover = null
  gestureIdleTimer = setTimeout(() => {
    gestureIdleTimer = null
    updateMapLayer(displayedCamera.scale)
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
  applyWheelMotion(event)
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
  const flow = node?.closest('[data-outline-flow]')
  if (flow) return flow.dataset.outlineFlow
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
  if (inspectedVariant || selectedFlow || selectedSection || selectedFrameSurface || selectedComparison ||
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

// Promote only the pointed tiny picture before normal input handling. A click
// without a preceding move (touch or a stationary mouse after zoom) works too.
function overviewFrameAt(event) {
  const overview = variantWindow.overview
  if (!overview.region || event.target.closest('.linked-frame, .flow-frame, button, iframe')) return
  const rect = viewport.getBoundingClientRect()
  const view = displayedCamera
  const x = (event.clientX - rect.left - view.x) / view.scale
  const y = (event.clientY - rect.top - view.y) / view.scale
  for (const frame of variantWindow.intersect(x, y, x, y)) {
    if (!overview.drawn.has(frame)) continue
    const b = frame.bounds
    if (y < b.y + b.labelHeight - 52 || y > b.y + b.labelHeight + b.height) continue
    return frame
  }
}
viewport.addEventListener('click', event => {
  const frame = overviewFrameAt(event)
  if (!frame) return
  frame.mount()
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.linked-frame button')
  if (target) {
    event.stopImmediatePropagation()
    target.dispatchEvent(new MouseEvent('click', event))
  }
}, true)

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
  const tiny = expanded && event.metaKey && !gestureIdleTimer && overviewFrameAt(event)
  setHoverKey(tiny ? 'variant:' + tiny.variant : expanded && event.metaKey ? hoverTargetKey(event.target) : null)
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
    if (frame !== preview || !expanded || !target?.isConnected || target.ownerDocument !== frame.contentDocument) return
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
      if (!expanded) return
      // Reserve Command-click even before the extension attaches to a new frame.
      // Only the mounted Inspector should receive the trusted selection gesture.
      if (event.metaKey && event.button === 0 && doc.getElementById('localhost-inspector-outlines')) {
        event.preventDefault()
        return
      }
      if (event.metaKey && event.button === 0 && event.type === 'click' &&
          (document.body.hasAttribute('data-canvas-editor') || document.body.hasAttribute('data-inspector-watching'))) {
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
      clearHover()
      const card = cards.get(active)
      if (card) {
        // The wheel point is already local to the scaled app. Use the same
        // card origin as drawCamera(), including any movement still pending.
        zoomAt(event, displayedCamera.x + (card.x + event.clientX) * displayedCamera.scale,
          displayedCamera.y + (card.y + card.labelHeight + event.clientY) * displayedCamera.scale, card.button)
      } else {
        const view = viewport.getBoundingClientRect()
        const app = preview.getBoundingClientRect()
        zoomAt(event, app.x - view.x + event.clientX * displayedCamera.scale,
          app.y - view.y + event.clientY * displayedCamera.scale)
      }
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
  data, dock, getOutline, onOpenOutline, warmNavigation,
  onOpenActivity(id) {
    if (!expanded) toggleView()
    if (variantFrames.has(id)) void onOpenOutline('variant:' + id)
    else message('This variant is unavailable on the canvas.')
  }, getFrame: () => preview, livePage: auditPage,
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
  watchProposalLink(updateComparison, event => {
    const origins = Array.isArray(event) ? event : event.variants
    const restarted = event.session && event.session !== data.previewOriginSession
    if (event.session) data.previewOriginSession = event.session
    const current = new Map(origins.map(frame => [frame.id, frame]))
    for (const item of data.variants ?? []) {
      const saved = current.get(item.id)
      if (!saved) continue
      item.hasEdits = saved.hasEdits === true
      if ((saved.origin && saved.origin !== item.origin) || (restarted && saved.deferredOrigin)) {
        item.deferredOrigin = saved.deferredOrigin
        item.origin = saved.origin
        variantFrames.get(item.id)?.setPreviewOrigin(saved.origin)
      }
    }
  }, ({ activity, variants }) => {
    data.activity = activity
    sidebar.updateActivity(activity)
    const changed = JSON.stringify(data.variants ?? []) !== JSON.stringify(variants)
    if (!changed) return
    data.variants = variants
    layoutVariantSections = undefined
    refreshVariants()
  }, data.previewOrigins === 'on-demand', data.activityVersion)
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
  if (expanded && (variantId === '*' || variantId?.endsWith('~*')) && !focusedVariant) {
    const prefix = variantId.slice(0, -1)
    const siblings = [...variantFrames.values()].filter(frame =>
      frame.id === active && !frame.hidden && frame.variant.startsWith(prefix))
    if (siblings.length) {
      focusedVariant = { id: active, variant: variantId }
      fitCards(siblings.map(frame => frame.bounds), viewport.clientWidth - dock.offsetWidth, viewport.clientHeight)
    }
    return
  }
  if (!focusedVariant || focusedVariant.id !== active) return
  revealSectionRow(focusedVariant)
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
document.body.setAttribute('data-workspace-ready', '')
toggle.disabled = false
