import { positionOnCanvas } from './render-frames.mjs'

export const sectionColumns = 3
export const sectionBounds = new WeakMap()

// A single unusually wide or tall section can itself exceed CSS layout
// limits. Only draw the part around the camera, retaining the full model box.
function sectionExtent(style, side, size, axis, start, end) {
  if (end - start <= 2 ** 23) {
    style[size] = end - start + 'px'
    return
  }
  const local = value => 'clamp(-8388608, ' + value + ' - var(--canvas-origin-' + axis + ', 0), 8388608)'
  style[side] = 'calc(' + local(start) + ' * 1px)'
  style[size] = 'calc((' + local(end) + ' - ' + local(start) + ') * 1px)'
}

export function mountVariantSections(map, definitions, framesById, mount, selectSection, relayout) {
  const groups = new Map()
  for (const item of definitions) {
    if (!framesById.has(item?.anchor)) continue
    const name = item.section || (framesById.get(item.anchor).label || 'Screen') + ' variants'
    const key = JSON.stringify([item.anchor, name])
    if (!groups.has(key)) groups.set(key, { name, items: [] })
    groups.get(key).items.push(item)
  }

  const existing = new Map(Array.from(map.querySelectorAll('.variant-section'), section => [section.dataset.sectionKey, section]))
  const sections = []
  function mountGroup(parent, path, items, depth) {
    const name = path.at(-1)
    const key = 'section:' + JSON.stringify([items[0].anchor, ...path])
    let section = existing.get(key)
    existing.delete(key)
    if (!section) {
      section = document.createElement('section')
      section.className = 'variant-section'
      section.dataset.fill = depth % 2 ? 'inset' : 'base'
      section.setAttribute('aria-label', name)
      section.dataset.sectionKey = key
      section.dataset.anchor = items[0].anchor
      const surface = document.createElement('div')
      surface.className = 'variant-section-surface'
      const heading = document.createElement('h2')
      const title = document.createElement('button')
      title.type = 'button'
      title.textContent = name
      title.setAttribute('aria-pressed', 'false')
      heading.append(title)
      surface.addEventListener('click', () => selectSection?.(section.dataset.sectionKey))
      surface.append(heading)
      section.append(surface)
      parent.append(section)
    }
    const surface = section.firstElementChild
    const branches = Map.groupBy(items, item => item.sectionPath?.[depth])
    const canFold = items.length > sectionColumns || branches.size > 1
    let toggle = surface.querySelector('.section-disclosure')
    if (canFold && !toggle) {
      toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'section-disclosure'
      const sync = () => {
        const collapsed = section.hasAttribute('data-collapsed')
        toggle.setAttribute('aria-expanded', String(!collapsed))
        toggle.setAttribute('aria-label', (collapsed ? 'Expand ' : 'Collapse ') + name + ' rows')
        toggle.textContent = collapsed ? '▸' : '▾'
      }
      toggle.onclick = event => {
        event.stopPropagation()
        section.toggleAttribute('data-collapsed')
        sync()
        relayout()
      }
      sync()
      surface.firstElementChild.append(toggle)
    } else if (!canFold) {
      toggle?.remove()
      section.removeAttribute('data-collapsed')
    }
    const frames = []
    const children = []
    for (const [child, entries] of branches) {
      if (child) {
        const group = mountGroup(section, [...path, child], entries, depth + 1)
        if (group) children.push(group)
      } else {
        for (const item of entries) {
          const frame = mount(section, item)
          if (frame) frames.push(frame)
        }
      }
    }
    if (!frames.length && !children.length) {
      section.remove()
      return
    }
    const group = { surface, frames, children }
    sections.push(group)
    return group
  }
  for (const { name, items } of groups.values()) {
    if (items.length === 1 && !items[0].section) mount(map, items[0])
    else mountGroup(map, [name], items, 0)
  }
  for (const section of existing.values()) section.remove()
  // The groups stay in document order for Layers and keyboard navigation.
  // Only draw section chrome near the camera on a large board.
  map.toggleAttribute('data-window-sections', sections.length >= 100)
  let covered
  function updateVisibility(view, width, height) {
    if (sections.length < 100 || width <= 0 || height <= 0) return
    const w = width / view.scale, h = height / view.scale
    const left = -view.x / view.scale, top = -view.y / view.scale
    const right = left + w, bottom = top + h
    if (covered && left >= covered.left && top >= covered.top &&
        right <= covered.right && bottom <= covered.bottom && w >= covered.width / 2) return
    // Keep another viewport ready for panning, fast pinches and clipped rows.
    covered = { left: left - w / 2, top: top - h / 2, right: right + w / 2, bottom: bottom + h / 2, width: w }
    for (const group of sections) {
      const b = group.bounds
      const visible = Boolean(b && b.right >= left - w && b.left <= right + w &&
        b.bottom >= top - h && b.top - 60 <= bottom + h)
      if (group.inView === visible) continue
      group.inView = visible
      group.surface.toggleAttribute('data-in-view', visible)
    }
  }
  function layout() {
    covered = undefined
    // Children come first. Read each caption and review once, then write all
    // surfaces together so a section never forces layout to measure its neighbor.
    for (const group of sections) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
      let frameTop = Infinity, captionHeight = 52
      for (const frame of group.frames) {
        if (frame.hidden) continue
        const bounds = frame.bounds
        const y = bounds.y + bounds.labelHeight
        left = Math.min(left, bounds.x)
        right = Math.max(right, bounds.x + bounds.width)
        frameTop = Math.min(frameTop, y)
        captionHeight = Math.max(captionHeight, frame.captionHeight)
        bottom = Math.max(bottom, y + bounds.height + frame.reviewHeight)
      }
      for (const child of group.children) {
        if (!child.bounds) continue
        frameTop = Math.min(frameTop, child.frameTop)
        captionHeight = Math.max(captionHeight, child.captionHeight)
        left = Math.min(left, child.bounds.left)
        top = Math.min(top, child.bounds.top - 60)
        right = Math.max(right, child.bounds.right)
        bottom = Math.max(bottom, child.bounds.bottom)
      }
      group.frameTop = frameTop
      group.captionHeight = captionHeight
      const padding = 40
      group.bounds = left === Infinity ? null : {
        left: left - padding, top: Math.min(top, frameTop - captionHeight) - padding,
        right: right + padding, bottom: bottom + padding,
      }
    }
    for (const { surface, bounds } of sections) {
      sectionBounds.set(surface, bounds)
      surface.hidden = !bounds
      if (!bounds) continue
      positionOnCanvas(surface, bounds.left, bounds.top)
      sectionExtent(surface.style, 'left', 'width', 'x', bounds.left, bounds.right)
      sectionExtent(surface.style, 'top', 'height', 'y', bounds.top, bounds.bottom)
    }
  }
  return Object.assign(layout, { updateVisibility })
}
