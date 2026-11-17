export function renderFrames(map, data, activate) {
  const { width, height } = data.viewport
  const cards = new Map()
  const rows = new Map()
  for (const frame of data.frames) {
    const page = frame.route.split('?')[0]
    if (!rows.has(page)) rows.set(page, [])
    rows.get(page).push(frame)
  }
  let row = 0
  for (const frames of rows.values()) {
    for (const [column, frame] of frames.entries()) {
      const x = column * (width + 210)
      const y = row * (height + 174)
      const button = document.createElement('button')
      button.className = 'flow-frame'
      button.type = 'button'
      button.dataset.frame = frame.id
      button.setAttribute('aria-pressed', 'false')
      Object.assign(button.style, { left: x + 'px', top: y + 'px', width: width + 'px' })
      const text = document.createElement('span')
      text.textContent = frame.label
      const image = new Image(width, height)
      image.alt = ''
      image.loading = 'lazy'
      image.src = './' + frame.image
      button.append(text, image)
      button.addEventListener('click', () => void activate(frame))
      cards.set(frame.id, { x, y, button })
      map.append(button)
    }
    row++
  }
  for (const edge of data.connections.filter(edge => edge.observed)) {
    const from = cards.get(edge.from)
    const to = cards.get(edge.to)
    if (!from || !to || from.y !== to.y) continue
    const wire = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    wire.classList.add('connections')
    // Alternatives branch from the base page. Route the connector above the
    // cards so it cannot read as a transition from an adjacent alternative.
    wire.style.left = from.x + width / 2 + 'px'
    wire.style.top = from.y - 52 + 'px'
    const distance = to.x - from.x
    const path = document.createElementNS(wire.namespaceURI, 'path')
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#88928c')
    path.setAttribute('stroke-width', '4')
    path.setAttribute('d', 'M 0 48 V 0 H ' + distance + ' V 46 m -13 -13 13 13 13 -13')
    wire.append(path)
    map.prepend(wire)
  }
  return cards
}
