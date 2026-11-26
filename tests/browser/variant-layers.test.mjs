import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { serveWorkspaceAsset } from '../../scripts/flow/workspace-assets.mjs'
import { createHarness } from './harness.mjs'

test('Command-click and Layers inspect the rendered content of a cross-origin canvas variant', async t => {
  const server = createServer(async (request, response) => {
    if (request.url.endsWith('/variant-inspector')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, value: {
        componentCatalog: { definitions: [{ source: 'draft.jsx', name: 'DraftLink', markers: ['draft-link'], fields: [] }] },
      } }))
      return
    }
    if (await serveWorkspaceAsset(request.url, response)) return
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html>
      <script type="module" src="/__inspector-flow/preview-wheel.mjs"></script>
      <main style="padding:40px"><h1>Saved draft heading</h1>
      <a data-slot="draft-link" href="/destination" target="_blank">Open draft report</a><p>Saved draft body</p>${Array.from({ length: 40 }, (_, i) => '<p>Detail ' + i + '</p>').join('')}</main>`)
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
    const hoveredLink = tree.locator('[data-hovered][aria-label="DraftLink"]')
    const link = app.getByRole('link', { name: 'Open draft report' })
    await link.hover()
    await page.keyboard.down('Meta')
    try {
      await hoveredLink.waitFor({ timeout: 5000 })
      assert.equal(await hoveredLink.getAttribute('aria-selected'), 'false')
    } finally { await page.keyboard.up('Meta') }
    await hoveredLink.waitFor({ state: 'hidden' })
    await link.click({ modifiers: ['Meta'] })
    await tree.getByRole('treeitem', { name: 'DraftLink', exact: true, selected: true }).waitFor({ timeout: 5000 })
    assert.equal(page.context().pages().length, 1)
    const bodyRow = tree.getByRole('treeitem', { name: 'Saved draft body', exact: true })
    await bodyRow.press('Enter')
    await page.waitForFunction(() => document.querySelector('#zoom').textContent === '50%')
    assert.equal(await bodyRow.getAttribute('aria-selected'), 'true')
    await app.locator('p[data-localhost-inspector-selected]').waitFor()
    const layers = page.frameLocator('iframe[title="Variant layers"]')
    await layers.getByRole('button', { name: 'Layers', exact: true }).click()
    await layers.getByRole('menuitemradio', { name: 'Components' }).click()
    await layers.getByText('DraftLink', { exact: true }).waitFor()
    await layers.getByRole('button', { name: 'Components', exact: true }).click()
    await layers.getByRole('menuitemradio', { name: 'Layers' }).click()
    const collapse = layers.getByRole('button', { name: 'Collapse layers' })
    const beforeScroll = await collapse.boundingBox()
    const scrolled = await layers.locator('.li-variables-layers').evaluate(list => {
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

test('the outside flow menu previews a folded frame and restores the deep variant selection across iframe boundaries', async t => {
  const server = createServer(async (request, response) => {
    if (await serveWorkspaceAsset(request.url, response)) return
    response.writeHead(200, { 'content-type': 'text/html' }).end('<script type="module" src="/__inspector-flow/preview-wheel.mjs"></script><main style="padding:32px">' +
      '<div>'.repeat(7) + '<h1>Selected amount</h1>' + '</div>'.repeat(7) + '</main>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const flowFrames = Array.from({ length: 16 }, (_, i) => [
    { id: 'base-' + i, label: 'Flow ' + i, route: '/group-' + i },
    { id: 'child-' + i, label: 'Screen ' + i, route: '/group-' + i + '/screen' },
  ]).flat().map(frame => ({ ...frame, steps: [], checkpoint: [], image: 'frame-1.png' }))
  const h = await createHarness({ canvas: true, dock: true, flowFrames, flowVariants: [
    { id: 'draft', label: 'Draft', section: 'Explorations', route: '/group-0', anchor: 'base-0', origin: 'http://127.0.0.1:' + server.address().port },
  ] })
  try {
    const page = h.page
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await h.open()
    await page.goto(page.url().split('#')[0] + '#context=1&frame=base-0&page=%2Fgroup-0&view=canvas&variant=draft')
    const wrapper = page.locator('[data-variant="draft"]')
    const target = wrapper.frameLocator('iframe').getByRole('heading', { name: 'Selected amount' })
    await wrapper.getByRole('button', { name: 'Interact with Draft' }).waitFor()
    const targetBounds = await target.boundingBox()
    await page.keyboard.down('Meta')
    try { await page.mouse.click(targetBounds.x + 4, targetBounds.y + targetBounds.height / 2) }
    finally { await page.keyboard.up('Meta') }
    const viewer = page.locator('iframe[title="Variant layers"]')
    const layers = viewer.contentFrame()
    const selected = layers.getByRole('treeitem', { name: 'Selected amount', selected: true, exact: true })
    await selected.waitFor()
    const ellipsis = layers.getByRole('button', { name: 'Expand skipped ancestors' })
    await ellipsis.click()
    await layers.getByRole('button', { name: 'Collapse skipped ancestors' }).click()
    const pane = layers.locator('.li-variables-layers')
    const section = layers.locator('[aria-roledescription="flow"][aria-label="Flow 13"]')
    await section.locator(':scope > .workspace-layer-line .workspace-layer-caret').click()
    await pane.evaluate(node => { node.scrollTop = 0 })
    const trigger = layers.getByRole('button', { name: 'Show flows' })
    const clip = await viewer.boundingBox()
    const menu = layers.getByRole('group', { name: 'Flows and frames' })
    const screen = menu.getByRole('button', { name: 'Screen 13', exact: true })
    const open = async () => {
      await trigger.hover()
      await menu.waitFor()
      await menu.getByRole('heading', { name: 'Flows', exact: true }).waitFor()
      assert.equal(await menu.locator('[data-group] small').count(), 0)
      assert.equal(await menu.getByRole('button', { name: /Explorations/ }).locator('small').textContent(), '1')
      assert.equal(await pane.evaluate(node => getComputedStyle(node).scrollbarWidth), 'none')
      const bounds = await menu.boundingBox()
      assert.ok(Math.abs(bounds.x - clip.x - clip.width - 4) < 1)
      await page.mouse.move(bounds.x + 6, bounds.y + 12, { steps: 12 })
      await menu.locator('[data-key="flow:/group-0"]').hover()
      assert.equal(await pane.evaluate(node => node.scrollTop), 0)
      if (!await screen.isVisible()) await menu.locator('summary[data-flow="/group-13"] svg').click()
      // Opening a flow also previews its heading. Start the frame jump offscreen.
      await pane.evaluate(node => { node.scrollTop = 0 })
      await screen.hover()
      assert.equal(await section.getAttribute('aria-expanded'), 'true')
      assert.ok(await pane.evaluate(node => node.scrollTop > 0))
      const hovered = layers.locator('[data-outline-key="frame:child-13"][data-hovered] > .workspace-layer-line')
      await hovered.waitFor()
      assert.ok(await hovered.evaluate(row => {
        const view = row.closest('.li-variables-layers')
        const bounds = view.getBoundingClientRect()
        const box = row.getBoundingClientRect()
        const centered = Math.abs(bounds.y + bounds.height / 2 - box.y - box.height / 2) < 2
        return centered || Math.abs(view.scrollTop - (view.scrollHeight - view.clientHeight)) < 1
      }))
      assert.equal(await selected.count(), 1)
    }
    await open()
    await page.mouse.move(clip.x + clip.width + 245, clip.y + 50)
    await menu.waitFor({ state: 'hidden' })
    assert.equal(await pane.evaluate(node => node.scrollTop), 0)
    assert.equal(await section.getAttribute('aria-expanded'), 'false')
    await open()
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })
    assert.equal(await pane.evaluate(node => node.scrollTop), 0)
    assert.equal(await selected.count(), 1)
    // Re-enter from outside the trigger after dismissing it by keyboard.
    await page.mouse.move(clip.x + 30, clip.y + 15)
    await open()
    const previousMenuScroll = await menu.locator('.workspace-layer-flow-list').evaluate(node => node.scrollTop)
    await screen.click()
    await viewer.waitFor({ state: 'hidden' })
    const destination = page.getByRole('treeitem', { name: 'Screen 13', selected: true, exact: true })
    await destination.waitFor()
    assert.equal(await destination.getAttribute('data-selection'), 'direct')
    const hostMenu = page.getByRole('group', { name: 'Flows and frames' })
    await hostMenu.waitFor({ timeout: 4000 })
    assert.equal(await hostMenu.locator('.workspace-layer-flow-list').evaluate(node => node.scrollTop), previousMenuScroll)
    const nextScreen = hostMenu.getByRole('button', { name: 'Screen 14', exact: true })
    if (!await nextScreen.isVisible()) await hostMenu.locator('summary[data-flow="/group-14"] svg').click()
    await nextScreen.click()
    const nextDestination = page.getByRole('treeitem', { name: 'Screen 14', selected: true, exact: true })
    await nextDestination.waitFor()
    await hostMenu.waitFor({ timeout: 4000 })
    const hostPane = page.locator('.li-variables-layers')
    const committedScroll = await hostPane.evaluate(node => node.scrollTop)
    await hostMenu.getByRole('button', { name: 'Screen 0', exact: true }).hover()
    const screenZero = page.locator('[data-outline-key="frame:child-0"][data-hovered]')
    await screenZero.waitFor()
    await page.keyboard.press('Escape')
    await hostMenu.waitFor({ state: 'hidden' })
    assert.equal(await hostPane.evaluate(node => node.scrollTop), committedScroll)
    assert.equal(await nextDestination.getAttribute('data-selection'), 'direct')
    await page.getByRole('button', { name: 'Show flows' }).hover()
    assert.equal(await hostMenu.getByRole('button', { name: 'Draft', exact: true }).count(), 0)
    await hostMenu.getByRole('button', { name: /Explorations/ }).click()
    const sectionRow = page.getByRole('treeitem', { name: 'Explorations', selected: true, exact: true })
    await sectionRow.waitFor()
    assert.equal(await sectionRow.getAttribute('aria-expanded'), 'true')
    await sectionRow.getByRole('treeitem', { name: 'Draft', exact: true }).waitFor()
  } finally { await h.close() }
})

test('a canvas section wraps its mockups and discloses later rows without remounting them', async () => {
  const flowVariants = Array.from({ length: 5 }, (_, i) => ({
    id: 'step-' + i, label: 'Step ' + i, section: 'Review', sectionPath: i === 4 ? ['Components', 'Button'] : [], route: '/', anchor: 'first', origin: 'http://127.0.0.1:1',
  }))
  const h = await createHarness({ canvas: true, dock: true, flowVariants })
  try {
    await h.open()
    const page = h.page
    await page.goto(page.url().split('#')[0] + '#context=1&frame=first&page=%2F&view=canvas&variant=*')
    const section = page.locator('.variant-section[aria-label="Review"]')
    const frames = section.locator('[data-variant]')
    const last = frames.last()
    await last.waitFor()
    const positions = await frames.evaluateAll(items => items.map(el => [el.offsetLeft, el.offsetTop]))
    assert.equal(positions[0][1], positions[2][1])
    assert.equal(positions[0][0], positions[3][0])
    assert.ok(positions[3][1] > positions[2][1])
    await section.locator('.variant-section[aria-label="Components"] > .variant-section[aria-label="Button"] [data-variant="step-4"]').waitFor()
    const surface = section.locator(':scope > .variant-section-surface')
    const height = await surface.evaluate(el => el.offsetHeight)
    const iframe = await last.locator('iframe').elementHandle()
    await section.getByRole('button', { name: 'Collapse Review rows' }).press('Enter')
    assert.equal(await frames.locator('visible=true').count(), 3)
    assert.ok(await surface.evaluate(el => el.offsetHeight) < height)
    await section.getByRole('button', { name: 'Expand Review rows' }).press('Enter')
    assert.equal(await frames.locator('visible=true').count(), 5)
    assert.equal(await last.locator('iframe').evaluate((node, original) => node === original, iframe), true)
  } finally { await h.close() }
})
