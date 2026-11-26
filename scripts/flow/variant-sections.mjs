// Reuse section surfaces and mounted frames when authoring updates arrive.
export const sectionColumns = 3

export function mountVariantSections(map, definitions, framesById, mount, selectSection, relayout) {
  const groups = new Map()
  for (const item of definitions) {
    if (!framesById.has(item?.anchor)) continue
    const name = item.section || (framesById.get(item.anchor).label || 'Screen') + ' variants'
    const key = JSON.stringify([item.anchor, name])
    if (!groups.has(key)) groups.set(key, { name, items: [] })
    groups.get(key).items.push(item)
  }

  const sections = []
  function mountGroup(parent, path, items, depth) {
    const name = path.at(-1)
    const key = JSON.stringify([items[0].anchor, ...path])
    let section = parent.querySelector(':scope > [data-section-key=' + CSS.escape('section:' + key) + ']')
    if (!section) {
      section = document.createElement('section')
      section.className = 'variant-section'
      section.dataset.fill = depth % 2 ? 'inset' : 'base'
      section.setAttribute('aria-label', name)
      section.dataset.sectionKey = 'section:' + key
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
    for (const [child, entries] of branches) {
      if (child) frames.push(...mountGroup(section, [...path, child], entries, depth + 1))
      else frames.push(...entries.map(item => mount(section, item)).filter(Boolean))
    }
    if (frames.length) sections.push({ surface, frames })
    else section.remove()
    return frames
  }
  for (const { name, items } of groups.values()) {
    if (items.length === 1 && !items[0].section) mount(map, items[0])
    else mountGroup(map, [name], items, 0)
  }
  const retained = new Set(sections.map(({ surface }) => surface.parentElement))
  for (const section of map.querySelectorAll('.variant-section')) if (!retained.has(section)) section.remove()
  return () => {
    for (const { surface, frames } of sections) {
      const visible = frames.filter(frame => !frame.hidden)
      surface.hidden = !visible.length
      if (surface.hidden) continue
      const first = visible[0].bounds
      const right = Math.max(...visible.map(({ bounds }) => bounds.x + bounds.width))
      const bottom = Math.max(...visible.map(frame => frame.bounds.y + frame.bounds.labelHeight + frame.bounds.height + frame.reviewHeight))
      const padding = 40
      // Single-screen anchors omit the original frame's label row. Variant
      // labels still sit above their previews, so leave room for them too.
      const captionHeight = Math.max(52, ...visible.map(frame => frame.captionHeight))
      let top = Math.min(...visible.map(({ bounds }) => bounds.y + bounds.labelHeight)) - captionHeight
      let left = first.x
      let xMax = right
      let yMax = bottom
      for (const child of surface.parentElement.querySelectorAll(':scope > .variant-section > .variant-section-surface')) {
        if (child.hidden) continue
        top = Math.min(top, child.offsetTop - 60)
        left = Math.min(left, child.offsetLeft)
        xMax = Math.max(xMax, child.offsetLeft + child.offsetWidth)
        yMax = Math.max(yMax, child.offsetTop + child.offsetHeight)
      }
      Object.assign(surface.style, {
        left: left - padding + 'px', top: top - padding + 'px',
        width: xMax - left + 2 * padding + 'px',
        height: yMax - top + 2 * padding + 'px',
      })
    }
  }
}
