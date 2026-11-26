import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { createHarness } from './harness.mjs'

const exec = promisify(execFile)
const canvas = (...args) => exec(process.execPath, ['scripts/flow/canvas.mjs', ...args])

test('a saved variant opens from its image at the clicked layer and keeps live work across switches', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'inspector-snapshot-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const app = join(temp, 'app')
  const capture = join(temp, 'capture')
  const saved = join(temp, 'canvas')
  await Promise.all([mkdir(app), mkdir(capture)])
  const markup = `<!doctype html><style>
    #review{position:absolute;left:104px;top:72px;width:120px;height:40px;border-radius:4px;background:#1464e6}
    #review[style*="18px"]{left:300px}
    input{position:absolute;left:104px;top:140px}
  </style><main><h1>Overview</h1><button id="review">Review</button><input aria-label="Draft"></main>`
  const size = { width: 900, height: 600 }
  await writeFile(join(app, 'index.html'), markup)
  await writeFile(join(capture, 'map.json'), JSON.stringify({ origin: 'http://127.0.0.1:5090',
    viewport: size, frames: [{ id: 'original', label: 'Overview', route: '/', heading: 'Overview', steps: [], checkpoint: [] }], connections: [] }))
  await canvas('init', saved, capture)
  const ids = ['draft', 'slow', 'later', 'missing', 'resized']
  await Promise.all(ids.map(id => canvas('add', saved, id, 'original', id, app, '/' + id)))

  const browser = await chromium.launch({ executablePath: process.env.INSPECTOR_BROWSER })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: size })
  page.setDefaultTimeout(7000)
  await page.setContent(markup)
  const cdp = await page.context().newCDPSession(page)
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'webp' })
  await cdp.detach()
  const image = Buffer.from(screenshot.data, 'base64')
  const digest = createHash('sha256').update(image).digest('hex')
  await mkdir(join(saved, 'variant-previews'))
  await writeFile(join(saved, 'variant-previews', digest + '.webp'), image)
  const records = Object.fromEntries(ids.map(id => [id, { route: '/' + id, ...size, small: digest, sharp: digest }]))
  records.missing.small = records.missing.sharp = '0'.repeat(64)
  records.resized.width -= 30
  await writeFile(join(saved, 'variant-previews.json'), JSON.stringify(records))

  const socket = createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const host = spawn(process.execPath, ['scripts/flow/serve.mjs', app, String(port), saved])
  t.after(() => host.kill())
  await Promise.race([once(host.stdout, 'data'), once(host, 'exit').then(([code]) => {
    throw Error('Canvas host failed to start: ' + code)
  })])
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (options) {
      return attach.call(this, this.id === 'localhost-inspector' ? { ...options, mode: 'open' } : options)
    }
    if (!['/draft', '/later'].includes(location.pathname)) return
    document.addEventListener('DOMContentLoaded', () => {
      const screen = document.querySelector('main')
      screen.remove()
      if (location.pathname === '/later') {
        const back = document.createElement('button')
        back.textContent = 'Back to files'
        document.body.append(back)
      }
      document.addEventListener('fixture-render', () => document.body.append(screen), { once: true })
    }, { once: true })
    window.addEventListener('message', ({ data }) => {
      if (data?.type === 'inspect-canvas-variant' && data.point) document.body.dataset.receivedPoint = ''
    })
  })
  const url = 'http://127.0.0.1:' + port + '/__inspector-flow/#context=1&frame=original&page=%2F&view=canvas&variant='
  const card = id => page.locator('[data-variant="' + id + '"]')
  const frame = id => card(id).frameLocator('iframe')
  const cover = id => card(id).getByRole('button', { name: 'Interact with ' + id, exact: true })
  const tree = page.frameLocator('iframe[title="Variant layers"]').getByRole('tree')
  const properties = page.frameLocator('iframe[title="Variant properties"]')
  const radius = () => frame('draft').locator('#review').evaluate(node => getComputedStyle(node).borderRadius)
  const documents = []
  page.on('request', request => {
    if (request.resourceType() === 'document') documents.push(new URL(request.url()).pathname)
  })
  await page.goto(url + 'draft')
  await page.locator('body[data-workspace-ready]').waitFor()
  await card('draft').locator('img').first().evaluate(image => image.decode())
  assert.ok(!documents.includes('/draft') && !documents.includes('/slow'), 'unopened prepared apps stay unloaded')

  // Use the point visible in the snapshot while the real control does not exist yet.
  async function clickPicturedReview(id) {
    const bounds = await cover(id).boundingBox()
    await page.keyboard.down('Meta')
    try { await page.mouse.click(bounds.x + 164 * bounds.width / size.width, bounds.y + 92 * bounds.height / size.height) }
    finally { await page.keyboard.up('Meta') }
    await frame(id).locator('body[data-received-point]').waitFor({ state: 'attached' })
  }
  const finishMount = id => frame(id).locator('body').evaluate(body => {
    delete body.dataset.receivedPoint
    document.dispatchEvent(new Event('fixture-render'))
  })
  await clickPicturedReview('draft')
  await finishMount('draft')
  const review = tree.getByRole('treeitem', { name: 'Review', exact: true })
  await tree.getByRole('treeitem', { name: 'Review', exact: true, selected: true }).waitFor()
  await tree.getByRole('treeitem', { name: 'Overview', exact: true }).last().press('Enter')
  await review.press('Enter')
  const input = properties.getByRole('spinbutton', { name: 'Corner radius', exact: true })
  await input.fill('18')
  await input.press('Enter')
  await properties.getByRole('tab', { name: 'Edits 1', exact: true }).waitFor()
  assert.equal(await radius(), '18px')
  await frame('draft').getByRole('textbox', { name: 'Draft' }).fill('unfinished note')
  await frame('draft').getByRole('textbox', { name: 'Draft' }).press('Escape')
  await cover('draft').waitFor()

  const gate = Promise.withResolvers()
  await page.route('**/slow', async route => { await gate.promise; await route.continue() })
  const pending = page.waitForRequest(request => new URL(request.url()).pathname === '/slow')
  await cover('slow').press('Enter')
  await pending
  try { await cover('draft').press('Enter') } finally { gate.resolve() }
  await tree.getByRole('treeitem', { name: 'draft', selected: true, exact: true }).waitFor()
  assert.equal(await frame('draft').getByRole('textbox', { name: 'Draft' }).inputValue(), 'unfinished note')
  assert.equal(documents.filter(path => path === '/draft').length, 1, 'warm return reuses the document')
  const reopened = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  reopened.setDefaultTimeout(7000)
  try {
    // The host refreshes only the saved step. A fresh visit must serve its new
    // geometry before mounting the app, and hit-test that geometry after restore.
    const deadline = Date.now() + 25000
    let savedSnapshot
    while (true) {
      const map = await (await page.request.get(new URL('./map.json', url).href)).json()
      savedSnapshot = map.variants.find(frame => frame.id === 'draft')?.snapshot
      if (savedSnapshot?.revision === 1) break
      assert.ok(Date.now() < deadline, 'the saved preview was regenerated')
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    const decodeGate = Promise.withResolvers()
    const sharpUrl = '**/variant-previews/' + savedSnapshot.sharp + '.webp'
    await reopened.route(sharpUrl, async route => { await decodeGate.promise; await route.continue() })
    const requested = reopened.waitForRequest(sharpUrl)
    await reopened.goto(url + 'draft', { waitUntil: 'domcontentloaded' })
    const tile = reopened.locator('[data-variant="draft"]')
    const overview = tile.locator('.variant-picture')
    let before
    try {
      await requested
      await overview.evaluate(image => image.decode())
      before = await overview.boundingBox()
      assert.equal(await tile.locator('.variant-detail').count(), 0)
    } finally { decodeGate.resolve() }
    const detail = tile.locator('.variant-detail')
    await detail.waitFor()
    assert.deepEqual(await detail.boundingBox(), before, 'decoded detail occupies the original picture bounds')
    assert.equal(await overview.count(), 1, 'the overview stays underneath')
    const pixels = await detail.evaluate(async image => {
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = 896
      canvas.height = 596
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      return [320, 120].map(x => [...ctx.getImageData(x, 90, 1, 1).data])
    })
    assert.ok(pixels[0][2] > pixels[0][0] + 80 && pixels[1][2] < pixels[1][0] + 30, 'preview shows the moved blue button')
    assert.equal(await tile.locator('iframe').count(), 0)
    const cover = tile.locator(':scope > button')
    const box = await cover.boundingBox()
    await reopened.keyboard.down('Meta')
    try { await reopened.mouse.click(box.x + 360 * box.width / 900, box.y + 92 * box.height / 600) }
    finally { await reopened.keyboard.up('Meta') }
    await reopened.frameLocator('iframe[title="Variant layers"]').getByRole('treeitem',
      { name: 'Review', selected: true, exact: true }).waitFor()
    assert.equal(await tile.frameLocator('iframe').locator('#review').evaluate(n => getComputedStyle(n).left), '300px')
  } finally { await reopened.close() }
  await review.press('Enter')
  await properties.getByRole('tab', { name: 'Edits 1', exact: true }).click()
  await properties.getByRole('button', { name: 'Undo last preview' }).click()
  await properties.getByRole('tab', { name: 'Edits', exact: true }).waitFor()
  assert.equal(await radius(), '4px')

  await page.goto(url + 'later')
  await card('later').locator('img').first().evaluate(image => image.decode())
  await clickPicturedReview('later')
  const back = frame('later').getByRole('button', { name: 'Back to files' })
  await back.click({ modifiers: ['Meta'] })
  await tree.getByRole('treeitem', { name: 'Back to files', exact: true, selected: true }).waitFor()
  await finishMount('later')
  await tree.getByRole('treeitem', { name: 'Review', exact: true }).waitFor()
  assert.equal(await back.getAttribute('data-localhost-inspector-selected'), '', 'the newer selection wins')

  // A missing bitmap and a different captured size both retain usable live previews.
  for (const id of ['missing', 'resized']) {
    await page.goto(url + id)
    await frame(id).getByRole('button', { name: 'Review' }).waitFor()
    await cover(id).press('Enter')
    await tree.getByRole('treeitem', { name: id, selected: true, exact: true }).waitFor()
  }
})

test('windowed saved frames sharpen across rows and return from a distant jump', async t => {
  const snapshot = { width: 1100, height: 1356, small: 'overview', sharp: 'detail' }
  const flowVariants = Array.from({ length: 120 }, (_, index) => ({
    id: 'card-' + index, label: 'Card ' + index, anchor: 'first', route: '/',
    section: 'Screens ' + Math.floor(index / 6), snapshot,
  }))
  const h = await createHarness({ canvas: true, dock: true, flowVariants })
  t.after(h.close)
  const { page } = h
  const image = await page.request.get(new URL('frame-1.png', page.url()).href)
  const body = await image.body()
  await page.route('**/variant-previews/*.webp', route => route.fulfill({ contentType: 'image/png', body }))
  const jump = id => page.evaluate(id => {
    location.hash = new URLSearchParams({ context: '1', frame: 'first', page: '/', view: 'canvas', variant: id })
  }, id)
  await jump('card-0')
  await page.locator('[data-variant="card-0"] .variant-detail').waitFor()
  await page.locator('#zoom-preset').selectOption('0.5', { force: true })
  // Center the gap between rows and columns so four cards are clipped by the viewport.
  const corner = await page.evaluate(() => {
    const box = index => document.querySelector('[data-variant="card-' + index + '"]').getBoundingClientRect()
    return { x: (box(0).right + box(1).left - innerWidth) / 2,
      y: (box(0).bottom + box(3).top - innerHeight) / 2 }
  })
  await page.mouse.move(100, 100)
  await page.mouse.wheel(corner.x, corner.y)
  await page.waitForFunction(() => {
    const visible = [...document.querySelectorAll('.linked-frame[data-variant]')].filter(frame => {
      const r = frame.getBoundingClientRect()
      return r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight
    })
    return visible.length === 4 && visible.every(frame => frame.querySelector('.variant-detail')?.naturalWidth)
  }, null, { timeout: 5000 })
  assert.equal(await page.locator('.linked-frame iframe').count(), 0)
  const pictures = page.locator('.linked-frame[data-variant]')
  assert.ok(await pictures.count() < flowVariants.length)
  await jump('card-119')
  await page.locator('[data-variant="card-119"] .variant-detail').waitFor()
  await page.locator('[data-variant="card-0"]').waitFor({ state: 'detached' })
  await jump('card-0')
  await page.locator('[data-variant="card-0"] .variant-detail').waitFor()
  await page.locator('[data-variant="card-119"]').waitFor({ state: 'detached' })
})

test('a large canvas can open a distant section from Layers with bounded rendered rows', async t => {
  const snapshot = { width: 1100, height: 1356, small: 'overview', sharp: 'detail' }
  const flowVariants = Array.from({ length: 1040 }, (_, i) => ({
    id: 'card-' + i, label: 'Card ' + i, anchor: 'first', route: '/',
    section: 'Group ' + Math.floor(i / 8), snapshot,
  }))
  const h = await createHarness({ canvas: true, dock: true, flowVariants, flowVariantGroupsPerRow: 10 })
  t.after(h.close)
  const { page } = h
  const image = await page.request.get(new URL('frame-1.png', page.url()).href)
  const body = await image.body()
  await page.route('**/variant-previews/*.webp', route => route.fulfill({ contentType: 'image/png', body }))
  await page.locator('#flow-toggle').click()
  await h.open()
  const tree = page.getByRole('tree', { name: 'Layers', exact: true })
  const lastRange = tree.getByRole('treeitem', { name: 'Group 127 – Group 129', exact: true })
  await lastRange.press('ArrowRight')
  const group = tree.getByRole('treeitem', { name: 'Group 129', exact: true })
  await group.press('Enter')
  const section = page.getByRole('region', { name: 'Group 129', exact: true })
  const title = section.locator('.variant-section-surface h2')
  await title.waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const r = document.querySelector('.variant-section[data-selected] .variant-section-surface').getBoundingClientRect()
    return r.right > 0 && r.left < innerWidth
  })
  assert.ok(await tree.getByRole('treeitem').count() < 180)
  const first = page.locator('.variant-section[aria-label="Group 0"] .variant-section-surface')
  await first.waitFor({ state: 'hidden' })
  await page.keyboard.press('Tab')
  await first.waitFor({ state: 'visible' })
  const rect = name => page.locator('.variant-section[aria-label="Group ' + name + '"] .variant-section-surface').boundingBox()
  const [origin, right, below] = await Promise.all([rect(0), rect(1), rect(10)])
  assert.ok(right.x >= origin.x + origin.width && Math.abs(right.y - origin.y) < 1)
  assert.ok(below.y >= origin.y + origin.height && Math.abs(below.x - origin.x) < 1)
})

test('dense Fit paints saved thumbnail pixels, keeps new pictures current and restores keyboard targets', async t => {
  const hash = '1'.repeat(64), sheet = '2'.repeat(64), changed = '3'.repeat(64)
  const snapshot = { width: 1100, height: 1356, small: hash, sharp: hash }
  const flowVariants = Array.from({ length: 1500 }, (_, i) => ({
    id: 'v' + i, label: 'Screen ' + i, anchor: 'first', route: '/', section: 'Group ' + Math.floor(i / 10),
    snapshot: i === 750 ? { ...snapshot, small: changed } : snapshot,
  }))
  const h = await createHarness({ canvas: true, dock: true, flowVariants, flowVariantGroupsPerRow: 12 })
  t.after(h.close)
  const { page } = h
  page.setDefaultTimeout(8000)
  const pixels = await page.evaluate(() => {
    const image = document.createElement('canvas')
    image.width = image.height = 1024
    const ctx = image.getContext('2d')
    ctx.fillStyle = 'rgb(17, 129, 221)'
    ctx.fillRect(64, 0, 64, 64)
    return image.toDataURL().split(',')[1]
  })
  await page.route('**/variant-previews/*.webp', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(pixels, 'base64') }))
  await page.route('**/variant-previews/overview.json', route => route.fulfill({ json: {
    version: 1, columns: 16, rows: 16, slot: 64, sheets: [sheet], images: { [hash]: [0, 1] },
  } }))
  await page.locator('#flow-toggle').click()
  await page.locator('#zoom-preset').selectOption('fit', { force: true })
  const atlas = page.locator('canvas.variant-overview')
  await atlas.waitFor()
  const point = await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas.variant-overview')
    const rect = canvas.getBoundingClientRect(), ctx = canvas.getContext('2d')
    const bitmap = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    for (let y = Math.round(innerHeight / 3); y < innerHeight * .7; y += 3) {
      for (let x = Math.round(innerWidth / 3); x < innerWidth * .7; x += 3) {
        const ix = Math.floor((x - rect.x) * canvas.width / rect.width)
        const iy = Math.floor((y - rect.y) * canvas.height / rect.height)
        const j = 4 * (iy * canvas.width + ix)
        if (bitmap[j] === 17 && bitmap[j + 2] === 221) return { x, y }
      }
    }
  })
  assert.ok(await page.locator('.linked-frame[data-variant]').count() < 5)
  await page.locator('[data-variant="v750"] img.variant-picture').waitFor()
  const { x, y } = await point.jsonValue()
  await page.keyboard.down('Meta')
  try { await page.mouse.click(x, y) } finally { await page.keyboard.up('Meta') }
  // A real cover forwards the cold click even when there was no DOM card here.
  await page.locator('.linked-frame iframe:not([inert])').waitFor()
  await page.locator('#flow-toggle').focus()
  await page.keyboard.press('Tab')
  await atlas.waitFor({ state: 'detached' })
  assert.ok(await page.locator('.linked-frame > button').count() > 100)
})
