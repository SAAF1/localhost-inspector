import { restoreStandardPreview } from './sharp-previews.mjs'

export const frameLabelHeight = 45

export function renderFrames(map, data, activate, viewOf, previews) {
  const cards = new Map()
  const rows = new Map()
  for (const frame of data.frames) {
    const page = frame.route.split('?')[0]
    if (!rows.has(page)) rows.set(page, [])
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
    unavailable.textContent = previews ? 'Preview unavailable at this size' : 'Open live preview'
    image.addEventListener('error', () => {
      image.hidden = true
      if (image.isConnected) unavailable.hidden = false
    })
    button.append(text, image, unavailable)
    button.addEventListener('click', () => void activate(frame))
    const card = { id: frame.id, button, image, unavailable, labelHeight: frameLabelHeight, desktop: frame.image }
    rows.get(page).push(card)
    cards.set(frame.id, card)
    map.append(button)
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

  function layout() {
    let y = 0
    for (const row of rows.values()) {
      let x = 0
      let rowHeight = 0
      for (const card of row) {
        const { width, height, preset, mode, fixedHeight } = viewOf(card.id)
        Object.assign(card, { x, y, width, height })
        Object.assign(card.button.style, { left: x + 'px', top: y + 'px', width: width + 'px' })
        const saved = previews?.[card.id]?.[preset]
        const fittingHug = mode === 'hug' && saved?.height === height
        const file = (fittingHug && saved.hug) || saved?.fixed || (preset === 'desktop' && card.desktop)
        const imageFile = fittingHug && saved.hug ? saved.hugSharp : saved?.sharp
        if (card.sharpFile !== imageFile) restoreStandardPreview(card)
        card.sharpFile = imageFile
        if (file && card.image.getAttribute('src') !== './' + file) card.image.src = './' + file
        else if (!file) card.image.removeAttribute('src')
        card.image.hidden = !file
        card.image.width = width
        card.image.height = fittingHug || mode === 'fixed' ? height : fixedHeight
        card.unavailable.hidden = Boolean(file)
        card.unavailable.style.height = height + 'px'
        card.button.style.minHeight = height + frameLabelHeight + 'px'
        x += width + 210
        rowHeight = Math.max(rowHeight, height)
      }
      y += rowHeight + 174
    }
    for (const { from, to, wire, path } of wires) {
      wire.style.display = from.y === to.y ? '' : 'none'
      // Route alternate-state links above the row so they read as branches.
      const start = from.x + from.width / 2
      const distance = to.x + to.width / 2 - start
      wire.style.left = start + 'px'
      wire.style.top = from.y - 52 + 'px'
      path.setAttribute('d', 'M 0 48 V 0 H ' + distance + ' V 46 m -13 -13 13 13 13 -13')
    }
  }
  layout()
  return { cards, layout }
}
