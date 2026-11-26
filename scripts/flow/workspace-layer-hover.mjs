// Hover opens only the branches needed to show the pointed-at layer. Keeping
// these overrides separate leaves the user's disclosure choices intact.
export function createLayerHover({ getMount, getOutline, paint, revealLabel }) {
  let target = null
  let path = new Set()
  let temporary = new Set()
  let records = new Map()
  let savedScroll
  let marked
  let hoverDoc

  function clear() {
    marked?.removeAttribute('data-hovered')
    marked = null
    target = null
    hoverDoc = null
    path.clear()
    temporary.clear()
    savedScroll = null
  }

  function update(value) {
    const outline = getOutline?.()
    const next = value || outline?.hoverKey || null
    const mount = getMount()
    if (!mount || target === next) return
    marked?.removeAttribute('data-hovered')
    marked = null
    if (!target && next) savedScroll = [mount.scrollLeft, mount.scrollTop]
    target = next
    hoverDoc = next?.ownerDocument
    path = new Set()
    if (hoverDoc) {
      for (let parent = next.parentElement; parent && parent !== hoverDoc.body; parent = parent.parentElement) {
        path.add(parent)
      }
    }
    const key = hoverDoc ? outline?.sourceKey || outline?.hoverKey || outline?.activeKey : next
    if (key) {
      if (hoverDoc) path.add(key)
      for (const item of outline?.items || []) {
        if (item.children?.some(child => child.key === key)) path.add(item.key)
      }
    }
    // Pointer movement between visible siblings only updates the two row styles.
    if ((next && !records.has(next)) || [...temporary].some(item => !path.has(item))) paint()
    const row = records.get(next)
    if (row) {
      marked = row.item
      marked.setAttribute('data-hovered', '')
      revealLabel(row.text)
    } else if (!next && savedScroll) {
      mount.scrollTo({ left: savedScroll[0], top: savedScroll[1], behavior: 'instant' })
      savedScroll = null
    }
  }

  return {
    update, clear,
    syncOutlineHover() {
      const outline = getOutline?.()
      if (hoverDoc && outline?.hoverKey && outline.hoverKey === (outline.sourceKey || outline.activeKey)) return
      update(null)
    },
    resetRows() { records = new Map(); temporary = new Set() },
    setRows(rows) {
      records = new Map(rows.map(row => [row.node, row]))
      marked = records.get(target)?.item
      marked?.setAttribute('data-hovered', '')
    },
    expand(key, expanded) {
      if (expanded || !path.has(key)) return expanded
      temporary.add(key)
      return true
    },
    get hasTemporaryBranches() { return temporary.size > 0 },
    get document() { return hoverDoc },
  }
}

export function revealLayerLabel(mount, label, center = false) {
  // Scroll only the Layers viewport. Focusing a treeitem or scrolling its full
  // width can move the canvas or leave the text out of sight in a deep tree.
  if (!label || !mount.clientWidth || !mount.clientHeight) return
  const viewport = mount.getBoundingClientRect()
  const box = label.getBoundingClientRect()
  // Native browser magnification inverse-scales the panels. Convert both
  // rectangles to local scroll units before comparing with client dimensions.
  const scaleX = viewport.width / mount.offsetWidth
  const scaleY = viewport.height / mount.offsetHeight
  if (!scaleX || !scaleY) return
  const left = (box.left - viewport.left) / scaleX - mount.clientLeft
  const top = (box.top - viewport.top) / scaleY - mount.clientTop
  const right = left + Math.min(box.width / scaleX, mount.clientWidth - 8)
  const bottom = top + box.height / scaleY
  const dx = left < 4 ? left - 4 : Math.max(0, right - mount.clientWidth + 4)
  const dy = center ? (top + bottom - mount.clientHeight) / 2 : top < 4 ? top - 4 : Math.max(0, bottom - mount.clientHeight + 4)
  mount.scrollBy({ left: dx, top: dy, behavior: 'instant' })
}
