import { observePage } from './page-state.mjs'

const map = document.querySelector('#map')
const preview = document.querySelector('#app-preview')
const viewport = document.querySelector('#viewport')
const toggle = document.querySelector('#flow-toggle')
const zoom = document.querySelector('#zoom')
const notice = document.querySelector('#notice')
const dock = document.querySelector('#localhost-inspector-dock')
const data = await fetch('./map.json').then(response => response.json())
if (data.origin !== location.origin) throw Error('This flow map belongs to a different app origin')
const { width, height } = data.viewport
const cards = new Map()
const routePath = path => path.replace(/\/$/, '') || '/'
const currentRoute = () => {
  try {
    return preview.contentWindow.location.origin === location.origin
      ? routePath(preview.contentWindow.location.pathname) : null
  } catch { return null }
}
const labelHeight = 45
const camera = { x: 34, y: 28, scale: .36 }
let active
let activeFrame
let request = 0
let pendingCard
let expanded = false

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

function render() {
  const rows = new Map()
  for (const frame of data.frames) {
    if (!rows.has(frame.route)) rows.set(frame.route, [])
    rows.get(frame.route).push(frame)
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
    if (!from || !to) continue
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
}

function setActive(id, frame) {
  if (active) {
    cards.get(active).button.classList.remove('active')
    cards.get(active).button.setAttribute('aria-pressed', 'false')
  }
  active = id
  activeFrame = frame
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

function waitFor(read, signal) {
  return new Promise((resolve, reject) => {
    const end = performance.now() + 4500
    function check() {
      if (signal !== request || performance.now() >= end) return reject(Error('State unavailable'))
      try {
        const result = read()
        if (result) return resolve(result)
      } catch (error) { return reject(error) }
      setTimeout(check, 25)
    }
    check()
  })
}

function findControl(doc, step) {
  const root = step.inMain ? doc.querySelector('main, [role="main"]') : doc
  const controls = root?.querySelectorAll(step.role === 'tab' ? '[role="tab"]' : 'button') ?? []
  const candidates = [...controls].filter(node => !node.disabled && !node.closest('th, [hidden], [inert]') &&
    node.getClientRects().length && (!step.popup || node.hasAttribute('aria-haspopup')) &&
    (node.getAttribute('role') || 'button') === step.role &&
    (node.getAttribute('aria-label') || node.innerText || node.title || '').trim().replace(/\s+/g, ' ') === step.label)
  return candidates.length === 1 ? candidates[0] : null
}

function openControl(control) {
  const view = control.ownerDocument.defaultView
  const events = { bubbles: true, cancelable: true, composed: true, button: 0, view }
  // Some tabs and popovers open on press rather than click.
  control.dispatchEvent(new view.PointerEvent('pointerdown', { ...events, pointerType: 'mouse', isPrimary: true, buttons: 1 }))
  control.dispatchEvent(new view.MouseEvent('mousedown', { ...events, buttons: 1 }))
  control.click()
}

function setPending(card) {
  pendingCard?.removeAttribute('aria-busy')
  pendingCard = card
  pendingCard?.setAttribute('aria-busy', 'true')
}

function matchesCheckpoint(doc, frame) {
  const { surfaces } = observePage(doc)
  return frame.checkpoint.every(check => surfaces.some(item => item.role === check.role && item.label === check.label))
}

async function activate(frame) {
  if (frame.id === active && !preview.style.visibility && frame.route === currentRoute() &&
      matchesCheckpoint(preview.contentDocument, frame)) return
  const signal = ++request
  setPending(cards.get(frame.id).button)
  message('')
  const previous = preview.contentDocument
  // A single forward step from an already open base page can keep its document.
  const reuse = previous && activeFrame && !activeFrame.steps.length && frame.steps.length === 1 &&
    currentRoute() === frame.route && findControl(previous, frame.steps[0]) &&
    !observePage(previous).surfaces.some(item => item.role !== 'tabpanel')
  setActive(null)
  // Keep layout active so viewport sizes and checkpoints remain observable.
  preview.style.visibility = 'hidden'
  dock.inert = true
  if (!reuse) preview.src = frame.route
  try {
    const doc = reuse ? previous : await waitFor(() => {
      const next = preview.contentDocument
      return next && next !== previous && currentRoute() === frame.route &&
        next.readyState !== 'loading' && next.body?.innerText.trim() && next
    }, signal)
    for (const step of frame.steps) {
      const control = await waitFor(() => doc === preview.contentDocument && findControl(doc, step), signal)
      openControl(control)
    }
    await waitFor(() => {
      if (doc !== preview.contentDocument ||
          (preview.dataset.inspectorWatching && !preview.dataset.inspectorDocument)) return false
      return matchesCheckpoint(doc, frame)
    }, signal)
    setActive(frame.id, frame)
    position()
    preview.style.visibility = ''
    dock.inert = false
    message('')
  } catch {
    if (signal === request) message('Could not reopen ' + frame.label)
  } finally {
    if (signal === request) setPending(null)
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
    const frame = data.frames.find(item => item.id === active && item.route === currentRoute()) ??
      data.frames.find(item => item.route === currentRoute() && !item.steps.length)
    if (frame) {
      setActive(frame.id, frame)
      center(frame.id)
    } else {
      setActive(null)
      preview.style.visibility = 'hidden'
      message('The current page is outside this map')
    }
    preview.style.width = width + 'px'
    preview.style.height = height + 'px'
    position()
  } else {
    request++
    setPending(null)
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

preview.addEventListener('load', () => {
  if (!preview.contentDocument) return
  preview.contentDocument.addEventListener('wheel', event => {
    if (!expanded || (!event.ctrlKey && !event.metaKey)) return
    const view = viewport.getBoundingClientRect()
    const app = preview.getBoundingClientRect()
    zoomAt(event, app.x - view.x + event.clientX * camera.scale,
      app.y - view.y + event.clientY * camera.scale)
  }, { passive: false })
})

render()
const entry = new URLSearchParams(location.search).get('page')
preview.src = data.frames.some(frame => frame.route === entry) ? entry : '/'
toggle.disabled = false
