import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { servePreviewAsset } from '../../scripts/flow/workspace-assets.mjs'
import { createHarness } from './harness.mjs'

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
    await h.page.locator('#workspace-sidebar').getByRole('button', { name: 'Fixture', exact: true }).click()
    await centered(h.page.locator('#app-preview'))
    await tree.getByRole('treeitem', { name: 'Draft', exact: true }).press('Enter')
    await h.page.locator('#variant-properties').waitFor()
    await centered(h.page.locator('[data-variant="draft"] iframe'), '#variant-properties')
  } finally { await h.close() }
})
