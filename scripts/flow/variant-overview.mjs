// At deep zoom, thousands of saved frames can fit in a few million screen pixels.
// Paint that region once and let the normal map transform move it between updates.
import { positionOnCanvas } from './render-frames.mjs'

export class VariantOverview {
  constructor(map, update) {
    this.map = map
    this.update = update
    this.images = new Map()
    this.failed = new Set()
    this.loading = new Set()
    this.drawn = new Set()
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'variant-overview'
    this.canvas.setAttribute('aria-hidden', 'true')
  }

  prepare() {
    if (this.requested) return
    this.requested = true
    fetch('./variant-previews/overview.json').then(async response => {
      if (!response.ok) return
      const value = await response.json()
      if (value.version !== 1 || value.slot !== 64 || value.columns !== 16 || value.rows !== 16 ||
          !Array.isArray(value.sheets) || !value.sheets.every(s => /^[a-f0-9]{64}$/.test(s)) || !value.images) return
      this.atlas = value
      this.update()
    }).catch(() => {})
  }

  clear() {
    this.region = null
    this.jobs = null
    this.promoting = false
    this.drawn.clear()
    if (this.canvas.isConnected) {
      this.canvas.remove()
      this.canvas.width = this.canvas.height = 0
    }
    this.images.clear()
  }

  load(sheet) {
    const image = new Image()
    this.loading.add(sheet)
    image.src = './variant-previews/' + this.atlas.sheets[sheet] + '.webp'
    image.decode().then(() => {
      if (image.naturalWidth !== 1024 || image.naturalHeight !== 1024) throw Error('Invalid overview sheet')
      if (!this.region) return
      this.images.set(sheet, image)
      if (this.images.size > 6) this.images.delete(this.images.keys().next().value)
      this.paint(sheet, image)
    }).catch(() => {
      this.failed.add(sheet)
      this.clear()
      this.update()
    }).finally(() => {
      this.loading.delete(sheet)
      this.pump()
    })
  }

  pump() {
    if (!this.jobs) return
    for (const sheet of this.jobs.keys()) {
      if (this.loading.size >= 2) break
      if (!this.loading.has(sheet) && !this.failed.has(sheet)) this.load(sheet)
    }
  }

  paint(sheet, image) {
    const frames = this.jobs?.get(sheet)
    if (!frames) return
    this.jobs.delete(sheet)
    const ctx = this.canvas.getContext('2d')
    const { left, top, sx, sy } = this.region
    for (const frame of frames) {
      const b = frame.bounds
      const slot = this.atlas.images[frame.item.snapshot.small][1]
      ctx.drawImage(image, (slot % 16) * 64, Math.floor(slot / 16) * 64, 64, 64,
        (b.x - left) * sx, (b.y + b.labelHeight - top) * sy, b.width * sx, b.height * sy)
    }
  }

  covers(view, width, height) {
    const r = this.region
    if (!r) return false
    const x = -view.x / view.scale, y = -view.y / view.scale
    return x >= r.left && y >= r.top && x + width / view.scale <= r.right &&
      y + height / view.scale <= r.bottom && view.scale >= r.scale * .7 && view.scale <= r.scale * 1.35
  }

  render(view, width, height, index) {
    if (!this.atlas || !width || !height) return false
    if (!this.promoting && this.covers(view, width, height)) return true
    this.promoting = false
    const s = view.scale
    const w = width * 1.4 / s, h = height * 1.4 / s
    const scale = Math.min(devicePixelRatio, 2, 4096 / Math.max(width * 1.4, height * 1.4))
    const canvas = this.canvas
    const pixelsX = Math.max(1, Math.ceil(width * 1.4 * scale))
    const pixelsY = Math.max(1, Math.ceil(height * 1.4 * scale))
    const sx = pixelsX / w, sy = pixelsY / h
    const left = Math.floor((-view.x - width * .2) / s * sx) / sx
    const top = Math.floor((-view.y - height * .2) / s * sy) / sy
    const prior = this.region
    const scroll = prior && prior.sx === sx && prior.sy === sy && canvas.width === pixelsX &&
      canvas.height === pixelsY && left < prior.right && left + w > prior.left &&
      top < prior.bottom && top + h > prior.top
    const previous = this.drawn
    const frames = index.intersect(left, top, left + w, top + h)
    const jobs = new Map()
    this.drawn = new Set()
    const ordinary = new Set()
    for (const frame of frames) {
      const entry = this.atlas.images[frame.item.snapshot?.small]
      if (!entry || !Number.isInteger(entry[1]) || entry[1] < 0 || entry[1] >= 256 ||
          !this.atlas.sheets[entry[0]] || this.failed.has(entry[0]) || (frame.frame && !frame.frame.canRelease)) {
        ordinary.add(frame)
        continue
      }
      this.drawn.add(frame)
      const b = frame.bounds
      if (scroll && previous.has(frame) && !this.jobs?.has(entry[0]) && b.x >= prior.left &&
          b.y + b.labelHeight >= prior.top && b.x + b.width <= prior.right &&
          b.y + b.labelHeight + b.height <= prior.bottom) continue
      if (!jobs.has(entry[0])) jobs.set(entry[0], [])
      jobs.get(entry[0]).push(frame)
    }
    if (!this.drawn.size) return false
    // Keep live apps, focused surfaces and pictures missing from this atlas
    // on their ordinary path, including a single newly edited frame.
    for (const frame of index.mounted) if (!ordinary.has(frame)) frame.release()
    for (const frame of ordinary) frame.mount()
    // Reuse already-composited pixels on a pan. Align origins to a bitmap
    // pixel so a sequence of pans cannot repeatedly blur the old contents.
    if (scroll) {
      const ctx = canvas.getContext('2d')
      ctx.globalCompositeOperation = 'copy'
      ctx.drawImage(canvas, Math.round((prior.left - left) * sx), Math.round((prior.top - top) * sy))
      ctx.globalCompositeOperation = 'source-over'
    } else {
      canvas.width = pixelsX
      canvas.height = pixelsY
    }
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    positionOnCanvas(canvas, left, top)
    if (!canvas.isConnected) this.map.append(canvas)
    this.region = { left, top, right: left + w, bottom: top + h, sx, sy, scale: s }
    this.jobs = jobs
    const ctx = canvas.getContext('2d')
    for (const [sheet, frames] of jobs) {
      const image = this.images.get(sheet)
      if (image) this.paint(sheet, image)
      else {
        ctx.fillStyle = 'white'
        for (const { bounds: b } of frames) ctx.fillRect((b.x - left) * sx, (b.y + b.labelHeight - top) * sy, b.width * sx, b.height * sy)
      }
    }
    this.pump()
    return true
  }

  uncover(frame) {
    if (!this.region || !this.drawn.delete(frame)) return
    const r = this.region, b = frame.bounds
    // A pending sheet must also leave this frame's live surface uncovered.
    const [sheet, slot] = this.atlas.images[frame.item.snapshot.small]
    const image = this.images.get(sheet)
    if (image) frame.frame.useOverviewPlaceholder(image.src, slot)
    const pending = this.jobs?.get(sheet)
    if (pending?.includes(frame)) pending.splice(pending.indexOf(frame), 1)
    const x = (b.x - r.left) * r.sx, y = (b.y + b.labelHeight - r.top) * r.sy
    this.canvas.getContext('2d').clearRect(Math.floor(x), Math.floor(y), Math.ceil(b.width * r.sx) + 2, Math.ceil(b.height * r.sy) + 2)
  }
}
