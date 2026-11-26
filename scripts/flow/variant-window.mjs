// Saved pictures can leave the document. A running app, keyboard focus, or a
// selected frame surface remains mounted until its normal lifecycle ends.
export class WindowedVariant {
  constructor(parent, item, gap, create, mounted, overview) {
    this.parent = parent
    this.item = item
    this.id = item.anchor
    this.variant = item.id
    this.label = item.label
    this.gap = gap
    this.create = create
    this.mounted = mounted
    this.overview = overview
    this.frame = null
    this.hidden = false
  }

  mount() {
    if (!this.frame) {
      this.frame = this.create(this.parent, this.item)
      this.overview?.uncover(this)
      this.mounted.add(this)
      if (this.placement) this.frame.place(...this.placement)
    }
    return this.frame
  }

  release() {
    if (this.frame?.canRelease) this.remove()
  }

  remove() {
    this.frame?.remove()
    this.frame = null
    this.mounted.delete(this)
  }

  get section() { return this.parent.classList.contains('variant-section') ? this.parent : null }
  get customWidth() { return this.frame?.customWidth }
  get reviewHeight() { return this.frame?.reviewHeight ?? 0 }
  get captionHeight() { return 52 }
  get paintSurface() { return this.mount().paintSurface }
  open(event) { this.mount().open(event) }
  markSurface(selected) { this.frame?.markSurface(selected) }

  place(card, column, offset, hidden, slotWidth) {
    this.placement = [card, column, offset, hidden, slotWidth]
    this.hidden = hidden
    if (this.frame) this.frame.place(...this.placement)
    this.bounds = this.frame?.bounds ?? {
      x: card.x + card.width + this.gap + (slotWidth + this.gap) * (column - 1),
      y: card.y + offset, width: card.width, height: card.height, labelHeight: card.labelHeight,
    }
  }

  placeIn(parent) {
    this.parent = parent
    this.frame?.placeIn(parent)
  }

  updateSnapshot(item) {
    this.item = item
    this.frame?.updateSnapshot(item)
  }

  setPreviewOrigin(origin) {
    this.item.origin = origin
    this.frame?.setPreviewOrigin(origin)
  }
}

// Positions are in canvas coordinates. Rebuild on layout changes, then look up
// just the intersecting cells on camera moves. A desktop frame spans a few cells.
export class VariantWindow {
  mounted = new Set()
  cells = new Map()
  eager = []

  rebuild(frames) {
    this.overview?.clear()
    this.maxWidth = 0
    this.cells.clear()
    this.eager = []
    for (const frame of frames) {
      if (!(frame instanceof WindowedVariant)) {
        this.eager.push(frame)
        continue
      }
      if (frame.hidden) continue
      const { x, y, width, height, labelHeight } = frame.bounds
      this.maxWidth = Math.max(this.maxWidth, width)
      this.cellsIn(x, y - 52, x + width, y + height + labelHeight, key => {
        let bucket = this.cells.get(key)
        if (!bucket) this.cells.set(key, bucket = [])
        bucket.push(frame)
      })
    }
  }

  cellsIn(left, top, right, bottom, visit) {
    const size = 2048
    for (let x = Math.floor(left / size); x <= Math.floor(right / size); x++) {
      for (let y = Math.floor(top / size); y <= Math.floor(bottom / size); y++) visit(x + ',' + y)
    }
  }

  intersect(left, top, right, bottom) {
    const frames = new Set()
    this.cellsIn(left, top, right, bottom, key => {
      for (const frame of this.cells.get(key) ?? []) {
        const b = frame.bounds
        if (b.x <= right && b.x + b.width >= left && b.y - 52 <= bottom &&
            b.y + b.labelHeight + b.height >= top) frames.add(frame)
      }
    })
    return frames
  }

  pictures(view, width, height, expanded, prior, lookahead) {
    if (!this.cells.size && !this.mounted.size) return this.eager
    const overview = this.overview
    const pixelWidth = this.maxWidth * view.scale * (globalThis.devicePixelRatio || 1)
    if (expanded && overview && this.cells.size >= 256 && pixelWidth <= (overview.region ? 80 : 64) &&
        !overview.map.hasAttribute('data-read-all-sections') && overview.render(view, width, height, this)) {
      return this.eager.concat(Array.from(this.mounted, handle => handle.frame))
    }
    let wanted = new Set()
    if (expanded) {
      const marginX = Math.min(1800, width / view.scale)
      const marginY = Math.min(1200, height / view.scale)
      let left = -view.x / view.scale
      let top = -view.y / view.scale
      let right = (width - view.x) / view.scale
      let bottom = (height - view.y) / view.scale
      if (lookahead > 0) {
        const maxX = (right - left) * 0.35
        const maxY = (bottom - top) * 0.35
        left -= Math.min(maxX, Math.max(0, -prior.x / prior.scale - left) * lookahead)
        top -= Math.min(maxY, Math.max(0, -prior.y / prior.scale - top) * lookahead)
        right += Math.min(maxX, Math.max(0, right - (width - prior.x) / prior.scale) * lookahead)
        bottom += Math.min(maxY, Math.max(0, bottom - (height - prior.y) / prior.scale) * lookahead)
      }
      left -= marginX
      top -= marginY
      right += marginX
      bottom += marginY
      wanted = this.intersect(left, top, right, bottom)
    }
    for (const frame of this.mounted) if (!wanted.has(frame)) frame.release()
    // The enlarged overview remains under incoming cards during a pinch.
    // Give a big change in detail several paints without delaying a small
    // close-up or keyboard traversal.
    const promoteInBatches = overview?.canvas.isConnected && wanted.size > 64 &&
      !overview.map.hasAttribute('data-read-all-sections')
    const deadline = promoteInBatches ? performance.now() + 3 : Infinity
    let pending = false
    for (const frame of wanted) {
      if (frame.frame) continue
      if (promoteInBatches && performance.now() >= deadline) { pending = true; break }
      frame.mount()
    }
    if (pending) {
      overview.promoting = true
      overview.update()
    } else if (overview?.canvas.isConnected) overview.clear()
    return this.eager.concat(Array.from(this.mounted, handle => handle.frame))
  }
}
