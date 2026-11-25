// Reuse section surfaces and mounted frames when authoring updates arrive.
export function mountVariantSections(map, definitions, framesById, mount, selectSection) {
  const groups = new Map()
  for (const item of definitions) {
    if (!framesById.has(item?.anchor)) continue
    const name = item.section || (framesById.get(item.anchor).label || 'Screen') + ' variants'
    const key = JSON.stringify([item.anchor, name])
    if (!groups.has(key)) groups.set(key, { name, items: [] })
    groups.get(key).items.push(item)
  }

  const sections = []
  for (const [key, { name, items }] of groups) {
    if (items.length === 1 && !items[0].section) {
      mount(map, items[0])
      continue
    }
    let section = map.querySelector('[data-section-key=' + CSS.escape('section:' + key) + ']')
    if (!section) {
      section = document.createElement('section')
      section.className = 'variant-section'
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
      map.append(section)
    }
    const surface = section.firstElementChild
    const frames = items.map(item => mount(section, item)).filter(Boolean)
    if (frames.length) sections.push({ surface, frames })
    else section.remove()
  }
  const retained = new Set(sections.map(({ surface }) => surface.parentElement))
  for (const section of map.querySelectorAll('.variant-section')) if (!retained.has(section)) section.remove()
  return () => {
    for (const { surface, frames } of sections) {
      const first = frames[0].bounds, last = frames.at(-1).bounds
      const padding = 40
      // Single-screen anchors omit the original frame's label row. Variant
      // labels still sit above their previews, so leave room for them too.
      const captionHeight = Math.max(52, ...frames.map(frame => frame.captionHeight))
      const top = first.y + first.labelHeight - captionHeight
      Object.assign(surface.style, {
        left: first.x - padding + 'px', top: top - padding + 'px',
        width: last.x + last.width - first.x + 2 * padding + 'px',
        height: first.height + captionHeight + 2 * padding + 'px',
      })
    }
  }
}
