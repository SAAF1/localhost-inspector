// All coordinates are local to the inspected frame, including at canvas zoom.
function regions(hit, draw) {
  const node = hit.node
  const style = node.ownerDocument.defaultView.getComputedStyle(node)
  const rect = node.getBoundingClientRect()
  const px = property => parseFloat(style.getPropertyValue(property)) || 0
  const inner = {
    left: rect.left + px('border-left-width'), top: rect.top + px('border-top-width'),
    right: rect.right - px('border-right-width'), bottom: rect.bottom - px('border-bottom-width'),
  }
  const box = hit.property === 'padding' ? inner : rect
  for (const edge of hit.edges ?? []) {
    if (hit.property === 'gap') {
      const horizontal = edge === 'column'
      const size = px(edge + '-gap')
      if (size <= 0) continue
      const start = horizontal ? 'left' : 'top'
      const end = horizontal ? 'right' : 'bottom'
      const crossStart = horizontal ? 'top' : 'left'
      const crossEnd = horizontal ? 'bottom' : 'right'
      const isGrid = style.display.includes('grid')
      const mainAxis = horizontal === style.flexDirection.startsWith('row')
      if (!isGrid && !mainAxis && style.flexWrap === 'nowrap') continue
      const contentStart = inner[crossStart] + px('padding-' + crossStart)
      const contentEnd = inner[crossEnd] - px('padding-' + crossEnd)
      // Resolved grid tracks include empty tracks and tracks crossed by a
      // spanning item. Child-to-child distances cannot locate those gutters.
      if (isGrid && style.writingMode === 'horizontal-tb') {
        const template = horizontal ? style.gridTemplateColumns : style.gridTemplateRows
        const tracks = template.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/)
        if (tracks.every(track => /^\d+(?:\.\d+)?px$/.test(track))) {
          const sizes = tracks.map(parseFloat)
          const innerStart = inner[start] + px('padding-' + start)
          const innerEnd = inner[end] - px('padding-' + end)
          const free = Math.max(0, innerEnd - innerStart - sizes.reduce((sum, n) => sum + n, 0) - size * (sizes.length - 1))
          const align = horizontal ? style.justifyContent : style.alignContent
          const extra = align === 'space-between' ? free / Math.max(1, sizes.length - 1) :
            align === 'space-around' ? free / sizes.length : align === 'space-evenly' ? free / (sizes.length + 1) : 0
          const offset = align === 'center' ? free / 2 : align.endsWith('end') ? free :
            align === 'space-around' ? extra / 2 : align === 'space-evenly' ? extra : 0
          let cursor = offset
          for (const track of sizes.slice(0, -1)) {
            cursor += track
            const from = horizontal && style.direction === 'rtl' ? innerEnd - cursor - extra / 2 - size : innerStart + cursor + extra / 2
            if (horizontal) draw(from, contentStart, from + size, contentEnd)
            else draw(contentStart, from, contentEnd, from + size)
            cursor += size + extra
          }
          continue
        }
      }
      const children = Array.from(node.children).filter(child => {
        const position = node.ownerDocument.defaultView.getComputedStyle(child).position
        return !['absolute', 'fixed'].includes(position) && child.getClientRects().length
      }).map(child => {
        const bounds = child.getBoundingClientRect()
        const css = node.ownerDocument.defaultView.getComputedStyle(child)
        return { left: bounds.left - parseFloat(css.marginLeft), right: bounds.right + parseFloat(css.marginRight),
          top: bounds.top - parseFloat(css.marginTop), bottom: bounds.bottom + parseFloat(css.marginBottom) }
      }).sort((a, b) => a[start] - b[start])
      for (const [i, before] of children.entries()) {
        for (let j = i + 1; j < children.length; j++) {
          const after = children[j]
          const distance = after[start] - before[end]
          if (!isGrid && style.flexWrap === 'nowrap' && distance >= size - 1) {
            const from = before[end] + Math.max(0, distance - size) / 2
            if (horizontal) draw(from, contentStart, from + size, contentEnd)
            else draw(contentStart, from, contentEnd, from + size)
            break
          }
          if (distance > size + 1) break
          if (Math.abs(distance - size) > 1) continue
          const fullLine = !isGrid && style.flexWrap === 'nowrap'
          const low = fullLine ? contentStart : Math.max(before[crossStart], after[crossStart])
          const high = fullLine ? contentEnd : Math.min(before[crossEnd], after[crossEnd])
          if (horizontal) draw(before.right, low, after.left, high)
          else draw(low, before.bottom, high, after.top)
        }
      }
      continue
    }
    const n = px(hit.property + '-' + edge)
    if (!n) continue
    const inset = hit.property === 'padding' ? n : -n
    if (edge === 'left') draw(Math.min(box.left, box.left + inset), box.top, Math.max(box.left, box.left + inset), box.bottom)
    if (edge === 'right') draw(Math.min(box.right, box.right - inset), box.top, Math.max(box.right, box.right - inset), box.bottom)
    if (edge === 'top') draw(box.left, Math.min(box.top, box.top + inset), box.right, Math.max(box.top, box.top + inset))
    if (edge === 'bottom') draw(box.left, Math.min(box.bottom, box.bottom - inset), box.right, Math.max(box.bottom, box.bottom - inset))
  }
}

export function previewSpacing(doc, hits) {
  const win = doc?.defaultView
  const matches = hits.filter(hit => hit.node?.isConnected && hit.node.ownerDocument === doc)
  if (!win || !matches.length) return
  const host = doc.createElement('div')
  host.id = 'localhost-inspector-spacing-preview'
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'all:initial;position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147483647'
  const root = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = 'i{position:absolute;background:repeating-linear-gradient(135deg,transparent 0 3px,#eb299b66 3px 5px);background-color:#ff45b51c}'
  const layer = doc.createElement('div')
  root.append(style, layer)
  doc.documentElement.append(host)
  let frame
  function paint() {
    frame = null
    const fragment = doc.createDocumentFragment()
    for (const hit of matches) {
      if (!hit.node.isConnected) continue
      let left = 0, top = 0, right = win.innerWidth, bottom = win.innerHeight
      for (let p = hit.node.parentElement; p; p = p.parentElement) {
        const css = win.getComputedStyle(p)
        if (css.overflowX === 'visible' && css.overflowY === 'visible') continue
        const box = p.getBoundingClientRect()
        if (css.overflowX !== 'visible') { left = Math.max(left, box.left); right = Math.min(right, box.right) }
        if (css.overflowY !== 'visible') { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom) }
      }
      regions(hit, (x, y, r, b) => {
        x = Math.max(x, left); y = Math.max(y, top)
        const w = Math.min(r, right) - x, h = Math.min(b, bottom) - y
        if (w <= 0 || h <= 0) return
        const band = doc.createElement('i')
        band.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px'
        fragment.append(band)
      })
    }
    layer.replaceChildren(fragment)
  }
  const schedule = () => { if (frame == null) frame = win.requestAnimationFrame(paint) }
  paint()
  win.addEventListener('scroll', schedule, true)
  win.addEventListener('resize', schedule)
  return () => {
    win.cancelAnimationFrame(frame)
    win.removeEventListener('scroll', schedule, true)
    win.removeEventListener('resize', schedule)
    host.remove()
  }
}
