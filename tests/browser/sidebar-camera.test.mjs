import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { servePreviewAsset } from '../../scripts/flow/workspace-assets.mjs'
import { createHarness } from './harness.mjs'

test('distant saved cards and nested section surfaces stay aligned and hittable after camera jumps', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    const samples = await h.page.evaluate(async () => {
      const { canvasCamera } = await import('./render-frames.mjs')
      const { addVariantFrame } = await import('./proposal-view.mjs')
      const { mountVariantSections, sectionBounds } = await import('./variant-sections.mjs')
      const map = document.createElement('div')
      map.style.cssText = 'position:fixed;left:0;top:0;z-index:1000;transform-origin:0 0'
      document.body.append(map)
      const project = canvasCamera(map)
      const variants = ['near', 'far'].map(id => ({ id, label: id, section: 'Both', sectionPath: [id],
        anchor: 'base', route: '/', origin: location.origin }))
      const frames = new Map()
      const layout = mountVariantSections(map, variants, new Map([['base', {}]]), (parent, item) => {
        const frame = addVariantFrame(parent, item, 0)
        const distance = item.id === 'far' ? 50_396_640 : 0
        frame.place({ x: distance, y: distance, width: 320, height: 200, labelHeight: 0 }, 1)
        frames.set(item.id, frame)
        return frame
      })
      layout()
      const outer = map.querySelector('.variant-section-surface')
      const result = []
      for (const id of ['near', 'far', 'near']) {
        const { x, y } = frames.get(id).bounds
        project({ x: 200.25 - x * .81, y: 160.5 - y * .81, scale: .81 })
        const card = map.querySelector('[data-variant="' + id + '"]')
        const box = card.getBoundingClientRect()
        const surface = card.parentElement.firstElementChild
        const local = surface.getBoundingClientRect()
        const whole = outer.getBoundingClientRect()
        result.push({ left: box.left, top: box.top, cardHit: document.elementFromPoint(240, 200)?.closest('.linked-frame') === card,
          sectionHit: document.elementFromPoint(183, 210) === surface, contains: whole.left <= local.left && whole.right >= local.right &&
            whole.top <= local.top && whole.bottom >= local.bottom, modelWidth: sectionBounds.get(outer).right - sectionBounds.get(outer).left })
      }
      map.remove()
      return result
    })
    for (const sample of samples) {
      assert.ok(Math.abs(sample.left - 200.25) < .1 && Math.abs(sample.top - 160.5) < .1, JSON.stringify(sample))
      assert.ok(sample.cardHit && sample.sectionHit && sample.contains && sample.modelWidth > 50_000_000, JSON.stringify(sample))
    }
  } finally { await h.close() }
})

test('sidebar navigation centers frames, sections and elements between both open panels at 50%', async t => {
  const server = createServer((request, response) => {
    if (!servePreviewAsset(request.url, response)) response.end('<h1>Draft preview</h1>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const h = await createHarness({ canvas: true, dock: true, flowPages: {
    '/': { body: '<button id="off-center" style="position:absolute;top:860px;left:600px">Inspect this item</button>' },
  }, flowVariants: [
    { id: 'draft', label: 'Draft', section: 'Candidates', route: '/', anchor: 'first', origin: 'http://127.0.0.1:' + server.address().port },
  ] })
  try {
    await h.page.setViewportSize({ width: 1500, height: 980 })
    await h.page.locator('#flow-toggle').click()
    await h.open()
    const tree = h.page.getByRole('tree', { name: 'Layers' })
    const original = tree.getByRole('treeitem', { name: 'Fixture', exact: true })
    async function centered(target, inspector = '#localhost-inspector-dock') {
      const viewport = await h.page.locator('#viewport').boundingBox()
      const dock = await h.page.locator(inspector).boundingBox()
      const centerX = (viewport.x + dock.x) / 2
      const centerY = viewport.y + viewport.height / 2
      let box
      const isCentered = () => box && Math.abs(box.x + box.width / 2 - centerX) <= 2 &&
        Math.abs(box.y + box.height / 2 - centerY) <= 2
      // Activating an original can replay its route before moving the camera.
      const deadline = Date.now() + 5000
      do {
        await h.page.evaluate(() => new Promise(requestAnimationFrame))
        box = await target.boundingBox()
      } while (!isCentered() && Date.now() < deadline)
      assert.ok(dock.width > 0 && viewport.x > 0, 'both panels take up space')
      assert.equal(await h.page.locator('#zoom').textContent(), '50%')
      assert.ok(isCentered(), 'target centered between the open panels')
    }
    const section = tree.getByRole('treeitem', { name: 'Candidates', exact: true })
    await section.press('Enter')
    await centered(h.page.locator('.variant-section-surface'))
    await original.press('Enter')
    await tree.getByRole('treeitem', { name: 'Fixture', exact: true, selected: true }).waitFor()
    await centered(h.page.locator('#app-preview'))
    if (await original.getAttribute('aria-expanded') === 'false') await original.press('ArrowRight')
    await tree.getByRole('treeitem', { name: 'Inspect this item', exact: true }).press('Enter')
    await centered(h.page.frameLocator('#app-preview').locator('#off-center'))
    await original.press('Enter')
    await centered(h.page.locator('#app-preview'))
    await tree.getByRole('treeitem', { name: 'Draft', exact: true }).press('Enter')
    await h.page.locator('#localhost-inspector-dock[data-frame-properties][data-canvas-paint-target="frame:draft"]').waitFor()
    await centered(h.page.locator('[data-variant="draft"] iframe'))
  } finally { await h.close() }
})
