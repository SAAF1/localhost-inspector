import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('Inspector selects, edits, and undoes on the real page at canvas scale', async () => {
  const h = await createHarness({ dock: true, canvas: true })
  try {
    const toggle = h.page.locator('#flow-toggle')
    const dock = h.page.locator('#localhost-inspector-dock')
    const layout = async () => {
      const size = h.page.viewportSize()
      const dockBox = await dock.boundingBox()
      const toggleBox = await toggle.boundingBox()
      assert.equal(dockBox.x + dockBox.width, size.width)
      assert.equal(dockBox.y, 0)
      assert.equal(dockBox.height, size.height)
      assert.equal(dockBox.x - toggleBox.x - toggleBox.width, dockBox.width ? 12 : 50)
      assert.equal(toggleBox.y, 12)
      return dockBox.width
    }
    assert.equal(await layout(), 0)
    const originalWidth = await h.app.evaluate(() => innerWidth)
    await h.app.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'unsaved'
      document.querySelector('[role=dialog]').append(input)
    })
    await h.app.locator('#unsaved').fill('unsaved draft')
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
    assert.equal(await h.app.evaluate(() => innerWidth), originalWidth)
    await h.open()
    assert.ok(await layout() > 0)
    await h.page.setViewportSize({ width: 1723, height: 996 })
    assert.ok(await layout() > 0)
    await h.page.setViewportSize({ width: 1100, height: 1400 })
    await h.select()
    await h.page.keyboard.press('Escape')
    const outlineElement = h.app.locator('#localhost-inspector-outlines #outline')
    assert.equal(await outlineElement.isVisible(), false)
    await h.select()
    await h.page.mouse.click(80, 60)
    assert.equal(await outlineElement.isVisible(), false)
    await h.select()
    const target = h.app.locator('body > #target')
    const outline = h.app.locator('#localhost-inspector-outlines #outline')
    assert.deepEqual(await outline.boundingBox(), await target.boundingBox())
    await h.enter('Corner radius', 18)
    await h.settled()
    assert.equal(await h.css('border-radius'), '18px')
    const undo = h.host.getByRole('button', { name: 'Undo last preview' })
    await undo.click()
    await h.settled()
    assert.notEqual(await h.css('border-radius'), '18px')

    const appBeforeZoom = await target.boundingBox()
    await h.page.mouse.move(80, 60)
    await h.page.keyboard.down('Control')
    await h.page.mouse.wheel(0, 30)
    await h.page.keyboard.up('Control')
    await h.page.waitForFunction(() => document.querySelector('#zoom').value !== '36%')
    assert.ok((await target.boundingBox()).width < appBeforeZoom.width)
    assert.equal(await h.app.locator('#unsaved').inputValue(), 'unsaved draft')
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
    assert.ok(await layout() > 0)
    await h.host.getByRole('button', { name: 'Collapse Inspector' }).click()
    assert.equal(await layout(), 0)
    assert.equal(await h.app.locator('#unsaved').inputValue(), 'unsaved draft')
  } finally { await h.close() }
})

const lifecycleFrames = [
  { id: 'home', route: '/', label: 'Home', heading: 'Home', steps: [], checkpoint: [] },
  { id: 'other', route: '/other?view=details', label: 'Details', heading: 'Details', steps: [], checkpoint: [] },
  { id: 'missing', route: '/missing', label: 'Missing', heading: 'A saved page', steps: [], checkpoint: [] },
  { id: 'visible', route: '/', label: 'View',
    steps: [{ role: 'button', label: 'Open View' }],
    checkpoint: [{ role: 'menu', label: 'View' }] },
  { id: 'hidden', route: '/', label: 'Hidden dialog',
    steps: [{ role: 'button', label: 'Show hidden dialog' }],
    checkpoint: [{ role: 'dialog', label: 'Hidden dialog' }] },
].map((frame, index) => ({ ...frame, image: 'frame-' + (index + 1) + '.png' }))

const flowPages = {
  '/': { body: [
    '<h1>Home</h1><input aria-label="Draft">',
    '<button onclick="document.getElementById(\'view-options\').hidden=false">Open View</button>',
    '<div role="menu" id="view-options" aria-label="View" hidden><button role="menuitem" onclick="const options=this.parentNode; setTimeout(() => options.hidden=true, 100)">Close View</button></div>',
    '<button onclick="history.pushState({},\'\',\'/other?view=details\'); document.querySelector(\'h1\').textContent=\'Details\'">Go to Details</button>',
    '<button onclick="document.getElementById(\'hidden-dialog\').hidden=false">Show hidden dialog</button>',
    '<div id="hidden-dialog" role="dialog" hidden style="visibility:hidden">Hidden dialog</div>',
  ].join('') },
  '/other?view=details': { body: '<h1>Details</h1><input aria-label="Draft">' },
  '/missing': { status: 404, body: '<h1>Not found</h1>' },
}

async function chooseCard(page, id) {
  const card = page.locator('[data-frame="' + id + '"]')
  const viewport = page.locator('#viewport')
  const rect = await card.boundingBox()
  const view = await viewport.boundingBox()
  await viewport.dispatchEvent('wheel', { deltaX: rect.x - view.x - 75,
    deltaY: rect.y - view.y - 75, bubbles: true, cancelable: true })
  await card.locator('span').click()
}

test('canvas blocks in-app navigation and keeps the last working document during cancelled activation', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    const toggle = h.page.locator('#flow-toggle')
    const app = h.page.frameLocator('#app-preview')
    const navigate = app.getByRole('button', { name: 'Go to Details' })
    await toggle.click()
    await navigate.click()
    assert.equal(await app.locator('h1').innerText(), 'Home')
    assert.equal(await h.page.locator('[data-frame="home"]').getAttribute('aria-pressed'), 'true')
    await toggle.click()
    await navigate.click()
    assert.equal(await app.locator('h1').innerText(), 'Details')
    await app.getByRole('textbox', { name: 'Draft' }).fill('keep this draft')
    await toggle.click()
    await h.page.locator('[data-frame="other"][aria-pressed="true"]').waitFor()

    await h.page.route('**/missing', async route => {
      await new Promise(resolve => setTimeout(resolve, 180))
      await route.continue().catch(() => {})
    })
    await chooseCard(h.page, 'missing')
    await h.page.locator('[data-frame="missing"][aria-busy="true"]').waitFor()
    await toggle.click()
    assert.equal(await app.getByRole('textbox', { name: 'Draft' }).inputValue(), 'keep this draft')
    assert.equal(await app.locator('h1').innerText(), 'Details')
    assert.equal(await h.page.locator('.flow-candidate').count(), 0)
  } finally { await h.close() }
})

test('a failed or visually hidden replay retains the current app and reports the failed frame', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    const app = h.page.frameLocator('#app-preview')
    await app.getByRole('textbox', { name: 'Draft' }).fill('work in progress')
    await h.page.locator('#flow-toggle').click()
    await chooseCard(h.page, 'hidden')
    await h.page.locator('#notice').filter({ hasText: 'Could not reopen Hidden dialog' }).waitFor({ timeout: 6500 })
    assert.equal(await app.getByRole('textbox', { name: 'Draft' }).inputValue(), 'work in progress')
    assert.equal(await h.page.locator('.flow-candidate').count(), 0)
    assert.equal(await h.page.locator('[data-frame="home"]').getAttribute('aria-pressed'), 'true')
  } finally { await h.close() }
})

test('horizontal wheel pans over the live frame and still scrolls an app table', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.page.locator('#flow-toggle').click()
    const map = h.page.locator('#map')
    const scene = () => map.evaluate(node => getComputedStyle(node).transform)
    const initial = await scene()
    await h.app.locator('#target').hover()
    await h.page.mouse.wheel(90, 5)
    await h.page.waitForFunction(previous =>
      getComputedStyle(document.querySelector('#map')).transform !== previous, initial)
    const shifted = await scene()
    assert.ok(await h.page.locator('[aria-pressed="true"].flow-frame').count())

    await h.app.evaluate(() => {
      const scroll = document.createElement('div')
      scroll.id = 'scrolling-table'
      scroll.style.cssText = 'width:220px;height:90px;overflow:auto'
      const cell = document.createElement('div')
      cell.style.cssText = 'width:900px;height:200px'
      cell.textContent = 'Table content'
      scroll.append(cell)
      document.body.prepend(scroll)
    })
    const table = h.app.locator('#scrolling-table')
    await table.hover()
    await h.page.mouse.wheel(90, 0)
    await h.app.waitForFunction(() => document.querySelector('#scrolling-table').scrollLeft > 0)
    assert.equal(await scene(), shifted)
    await h.page.mouse.wheel(0, 45)
    await h.app.waitForFunction(() => document.querySelector('#scrolling-table').scrollTop > 0)
    assert.equal(await scene(), shifted)
  } finally { await h.close() }
})


test('inspect mode blocks menu activation and saved states still replay', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    const toggle = h.page.locator('#flow-toggle')
    await toggle.click()
    const button = h.app.getByRole('button', { name: 'Open View' })
    await button.click()
    await button.press('Enter')
    assert.equal(await h.app.getByRole('menu').count(), 0)
    await chooseCard(h.page, 'visible')
    await h.page.locator('[data-frame="visible"][aria-pressed="true"]').waitFor()
    const app = h.page.frameLocator('#app-preview')
    const menu = app.getByRole('menu', { name: 'View' })
    await menu.waitFor()
    await menu.getByRole('menuitem', { name: 'Close View' }).click()
    assert.ok(await menu.isVisible())
    await toggle.click()
    await menu.getByRole('menuitem', { name: 'Close View' }).click()
    await menu.waitFor({ state: 'hidden' })
  } finally { await h.close() }
})

test('close-zoom hover prepares one frame and click reuses it', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    await h.page.locator('#flow-toggle').click()
    const viewport = h.page.locator('#viewport')
    const card = h.page.locator('[data-frame="other"] span')
    await viewport.dispatchEvent('wheel', { deltaY: -130, ctrlKey: true, clientX: 200, clientY: 150, cancelable: true })
    const rect = await card.boundingBox()
    await viewport.dispatchEvent('wheel', { deltaX: rect.x - 90, deltaY: rect.y - 110, cancelable: true })
    await card.hover()
    const staged = h.page.locator('.flow-candidate')
    await staged.waitFor({ state: 'attached' })
    assert.equal(await staged.count(), 1)
    assert.equal(await h.page.locator('[data-frame="home"]').getAttribute('aria-pressed'), 'true')
    await staged.evaluate(node => { node.dataset.prepared = 'yes' })
    await card.click()
    const live = h.page.locator('#app-preview')
    assert.equal(await live.getAttribute('data-prepared'), 'yes')
    assert.equal(await h.page.locator('[data-frame="other"]').getAttribute('aria-pressed'), 'true')
    assert.equal(await staged.count(), 0)
  } finally { await h.close() }
})
