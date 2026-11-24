import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { serveWorkspaceAsset } from '../../scripts/flow/workspace-assets.mjs'
import { createHarness } from './harness.mjs'

test('Command-click and Layers inspect the rendered content of a cross-origin canvas variant', async t => {
  const server = createServer(async (request, response) => {
    if (await serveWorkspaceAsset(request.url, response)) return
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html>
      <script type="module" src="/__inspector-flow/preview-wheel.mjs"></script>
      <main style="padding:40px"><h1>Saved draft heading</h1>
      <a href="/destination" target="_blank">Open draft report</a><p>Saved draft body</p>${Array.from({ length: 40 }, (_, i) => '<p>Detail ' + i + '</p>').join('')}</main>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const h = await createHarness({ canvas: true, dock: true, flowVariants: [
    { id: 'draft', label: 'Draft', section: 'Explorations', route: '/', anchor: 'first', origin: 'http://127.0.0.1:' + server.address().port },
  ] })
  try {
    await h.open()
    const page = h.page
    await page.goto(page.url().split('#')[0] + '#context=1&frame=first&page=%2F&view=canvas&variant=draft')
    const wrapper = page.locator('[data-variant="draft"]')
    const app = wrapper.frameLocator('iframe')
    const heading = app.getByRole('heading', { name: 'Saved draft heading' })
    await heading.waitFor()
    const point = await heading.boundingBox()
    const cover = wrapper.getByRole('button', { name: 'Interact with Draft' })
    await cover.waitFor()
    // First click hits the canvas cover rather than the separate app document.
    await page.keyboard.down('Meta')
    try { await page.mouse.click(point.x + point.width / 2, point.y + point.height / 2) }
    finally { await page.keyboard.up('Meta') }
    const tree = page.frameLocator('iframe[title="Variant layers"]').getByRole('tree', { name: 'Layers' })
    await tree.getByRole('treeitem', { name: 'Saved draft heading', exact: true, selected: true }).waitFor({ timeout: 5000 })
    const hoveredLink = tree.locator('[data-hovered][aria-label="Open draft report"]')
    const link = app.getByRole('link', { name: 'Open draft report' })
    await link.hover()
    await page.keyboard.down('Meta')
    try {
      await hoveredLink.waitFor({ timeout: 5000 })
      assert.equal(await hoveredLink.getAttribute('aria-selected'), 'false')
    } finally { await page.keyboard.up('Meta') }
    await hoveredLink.waitFor({ state: 'hidden' })
    await link.click({ modifiers: ['Meta'] })
    await tree.getByRole('treeitem', { name: 'Open draft report', exact: true, selected: true }).waitFor({ timeout: 5000 })
    assert.equal(page.context().pages().length, 1)
    const bodyRow = tree.getByRole('treeitem', { name: 'Saved draft body', exact: true })
    await bodyRow.press('Enter')
    await page.waitForFunction(() => document.querySelector('#zoom').textContent === '50%')
    assert.equal(await bodyRow.getAttribute('aria-selected'), 'true')
    await app.locator('p[data-localhost-inspector-selected]').waitFor()
    const layers = page.frameLocator('iframe[title="Variant layers"]')
    const collapse = layers.getByRole('button', { name: 'Collapse layers' })
    const beforeScroll = await collapse.boundingBox()
    const scrolled = await layers.locator('main').evaluate(list => {
      list.scrollTop = list.scrollHeight
      return list.scrollTop
    })
    assert.ok(scrolled > 0)
    assert.deepEqual(await collapse.boundingBox(), beforeScroll)
    await collapse.click()
    await layers.getByRole('button', { name: 'Expand layers' }).waitFor()
    await tree.getByRole('treeitem', { name: 'Explorations', exact: true }).press('Enter')
    const viewer = page.locator('iframe[title="Variant layers"]')
    await viewer.waitFor({ state: 'hidden', timeout: 5000 })
    const selectedSection = page.getByRole('treeitem', { name: 'Explorations', exact: true, selected: true })
    await selectedSection.waitFor()
    assert.equal(await selectedSection.getAttribute('aria-expanded'), 'false')
    await selectedSection.locator(':scope > .workspace-layer-line .workspace-layer-caret').click()
    await selectedSection.getByRole('treeitem', { name: 'Draft', exact: true }).press('Enter')
    await viewer.waitFor()
    const foldedDraft = tree.getByRole('treeitem', { name: 'Draft', exact: true, selected: true })
    await foldedDraft.waitFor()
    assert.equal(await foldedDraft.getAttribute('aria-expanded'), 'false')
    await app.getByRole('link').press('Escape')
    await viewer.waitFor({ state: 'hidden', timeout: 5000 })
    const title = page.locator('.variant-section-surface button')
    await title.click()
    await page.locator('iframe[title="Variant layers"]').waitFor({ state: 'hidden', timeout: 5000 })
    await page.getByRole('tree', { name: 'Layers' }).waitFor()
    const originalTree = page.getByRole('tree', { name: 'Layers' })
    const section = originalTree.getByRole('treeitem', { name: 'Explorations', exact: true })
    await originalTree.getByRole('treeitem', { name: 'Explorations', exact: true, selected: true }).waitFor()
    await section.getByRole('treeitem', { name: 'Draft', exact: true }).waitFor()
    const original = originalTree.getByRole('treeitem', { name: 'Fixture', exact: true })
    await original.locator(':scope > .workspace-layer-line').click()
    await originalTree.getByRole('treeitem', { name: 'Fixture', selected: true, exact: true }).waitFor()
    assert.equal(await originalTree.getByRole('treeitem', { name: 'Saved draft heading', exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    await original.waitFor()
    await section.waitFor()
    assert.equal(await originalTree.getByRole('treeitem', { selected: true }).count(), 0)
  } finally { await h.close() }
})
