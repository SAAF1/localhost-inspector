import { restoreStandardPreview } from './sharp-previews.mjs'

const frameLabelHeight = 45

export const flowHeadingSpace = 80
export const frameGap = 240

// Keep CSS lengths small near the camera. Browsers clamp absolute layout
// positions near 33 million pixels, even when the final screen position is 0.
export function positionOnCanvas(element, x, y) {
  element.style.left = 'calc((' + x + ' - var(--canvas-origin-x, 0)) * 1px)'
  element.style.top = 'calc((' + y + ' - var(--canvas-origin-y, 0)) * 1px)'
}

export function canvasCamera(map) {
  const origin = { x: 0, y: 0 }
  const step = 2 ** 18
  return view => {
    for (const axis of ['x', 'y']) {
      const world = -view[axis] / view.scale
      if (Math.abs(world - origin[axis]) > step) {
        origin[axis] = Math.round(world / step) * step
        map.style.setProperty('--canvas-origin-' + axis, String(origin[axis]))
      }
    }
    const x = view.x + origin.x * view.scale
    const y = view.y + origin.y * view.scale
    map.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + view.scale + ')'
  }
}

export function groupFlowFrames(frames) {
  // Keep hash-router pages distinct and put query variants under their base screen.
  const paths = new Set(frames.map(frame => flowPath(frame.route)))
  function flowPath(route) {
    const url = new URL(route, 'http://localhost')
    return url.pathname + url.hash.split('?')[0]
  }
  const groups = new Map()
  for (const frame of frames) {
    const path = flowPath(frame.route)
    let key = path
    for (let i = 1; i < path.length; i++) {
      if (path[i] === '/' && path[i - 1] !== '#' && paths.has(path.slice(0, i))) {
        key = path.slice(0, i)
        break
      }
    }
    if (!groups.has(key)) groups.set(key, { key, frames: [] })
    groups.get(key).frames.push(frame)
  }
  const labels = new Map()
  for (const group of groups.values()) {
    const base = group.frames.find(frame => frame.route === group.key && !frame.steps.length) ?? group.frames[0]
    group.baseId = base.id
    group.label = base.label || group.key
    labels.set(group.label, (labels.get(group.label) || 0) + 1)
  }
  for (const group of groups.values()) {
    if (labels.get(group.label) > 1) group.label += ' · ' + group.key
  }
  return [...groups.values()]
}

export function renderFrames(map, data, groups, activate, viewOf, previews, switchToDesktop) {
  const cards = new Map()
  const headings = new Map()
  const missingPreview = previews ? 'Couldn’t load preview' : 'Open live preview'
  for (const frame of data.frames) {
    const button = document.createElement('button')
    button.className = 'flow-frame'
    button.type = 'button'
    button.dataset.frame = frame.id
    button.setAttribute('aria-pressed', 'false')
    const text = document.createElement('span')
    text.textContent = frame.label
    const image = new Image(data.viewport.width, data.viewport.height)
    image.alt = ''
    image.loading = 'lazy'
    const unavailable = document.createElement('div')
    unavailable.className = 'flow-preview-unavailable'
    unavailable.textContent = missingPreview
    function updatePreviewState() {
      const hasFile = image.hasAttribute('src')
      const pending = hasFile && !image.complete
      const failed = hasFile && image.complete && !image.naturalWidth
      button.toggleAttribute('data-preview-pending', pending && !card.sharpImage)
      image.hidden = !hasFile || failed
      unavailable.hidden = Boolean(card.sharpImage || (hasFile && !pending && !failed))
      if (!card.hiddenControl) unavailable.textContent = pending ? 'Loading preview…' : missingPreview
    }
    image.addEventListener('load', updatePreviewState)
    image.addEventListener('error', updatePreviewState)
    button.append(text, image, unavailable)
    button.addEventListener('click', () => {
      if (card.hiddenControl) void switchToDesktop(frame.id)
      else void activate(frame)
    })
    const card = { id: frame.id, button, image, unavailable, updatePreviewState, hiddenControl: false,
      labelHeight: frameLabelHeight, desktop: frame.image }
    cards.set(frame.id, card)
    map.append(button)
  }
  for (const group of groups) {
    const first = cards.get(group.frames[0].id)
    if (group.frames.length === 1) {
      first.labelHeight = 0
      first.button.classList.add('single-screen')
      const title = first.button.firstElementChild
      title.textContent = group.label
      title.className = 'flow-heading'
      title.style.top = -flowHeadingSpace + 'px'
      continue
    }
    const heading = document.createElement('h2')
    heading.className = 'flow-heading'
    heading.dataset.outlineFlow = 'flow:' + group.key
    heading.textContent = group.label
    headings.set(group, heading)
    first.button.before(heading)
  }
  const wires = data.connections.flatMap(edge => {
    const from = cards.get(edge.from)
    const to = cards.get(edge.to)
    if (!edge.observed || !from || !to) return []
    const wire = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    wire.classList.add('connections')
    const path = document.createElementNS(wire.namespaceURI, 'path')
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#88928c')
    path.setAttribute('stroke-width', '4')
    wire.append(path)
    map.prepend(wire)
    return [{ from, to, wire, path }]
  })

  function layout(placeExtras) {
    let y = 0
    for (const group of groups) {
      const heading = headings.get(group)
      if (heading) positionOnCanvas(heading, 0, y)
      y += flowHeadingSpace
      let x = 0
      let rowHeight = 0
      for (const frame of group.frames) {
        const card = cards.get(frame.id)
        const { width, height, preset, mode, fixedHeight } = viewOf(card.id)
        const variants = previews?.[card.id]
        const saved = variants?.[preset]
        const hiddenControl = saved?.unavailable === 'hidden-control'
        const cardHeight = hiddenControl ? 176 : height
        Object.assign(card, { x, y, width, height: cardHeight })
        if (card.hiddenControl !== hiddenControl) {
          card.hiddenControl = hiddenControl
          card.unavailable.classList.toggle('compact', hiddenControl)
          if (hiddenControl) {
            const desktopOnly = ['tablet', 'phone'].every(size => variants?.[size]?.unavailable === 'hidden-control')
            const reason = document.createElement('strong')
            reason.textContent = desktopOnly ? 'Desktop only' : 'Hidden at this size'
            const detail = document.createElement('div')
            detail.textContent = 'The app hides this control at smaller sizes.'
            const action = document.createElement('div')
            action.className = 'flow-unavailable-action'
            action.textContent = 'Switch canvas to Desktop'
            card.unavailable.replaceChildren(reason, detail, action)
          } else card.unavailable.textContent = missingPreview
        }
        positionOnCanvas(card.button, x, y)
        card.button.style.width = width + 'px'
        const fittingHug = mode === 'hug' && saved?.height === height
        const file = (fittingHug && saved.hug) || saved?.fixed || (preset === 'desktop' && card.desktop)
        const imageFile = fittingHug && saved.hug ? saved.hugSharp : saved?.sharp
        if (card.sharpFile !== imageFile) restoreStandardPreview(card)
        card.sharpFile = imageFile
        if (file && card.image.getAttribute('src') !== './' + file) card.image.src = './' + file
        else if (!file) card.image.removeAttribute('src')
        card.image.width = width
        card.image.height = fittingHug || mode === 'fixed' ? height : fixedHeight
        card.updatePreviewState()
        card.unavailable.style.height = cardHeight + 'px'
        card.button.style.minHeight = cardHeight + card.labelHeight + 'px'
        const occupied = placeExtras?.(card)
        x += width + frameGap + ((occupied?.slotWidth ?? width) + frameGap) * (occupied?.columns ?? 0)
        rowHeight = Math.max(rowHeight, cardHeight + card.labelHeight + (occupied?.extraHeight ?? 0))
      }
      y += rowHeight + 320
    }
    for (const { from, to, wire, path } of wires) {
      wire.style.display = from.y === to.y ? '' : 'none'
      // Route alternate-state links above the row so they read as branches.
      const start = from.x + from.width / 2
      const distance = to.x + to.width / 2 - start
      positionOnCanvas(wire, start, from.y - 52)
      path.setAttribute('d', 'M 0 48 V 0 H ' + distance + ' V 46 m -13 -13 13 13 13 -13')
    }
  }
  layout()
  return { cards, headings, layout }
}
