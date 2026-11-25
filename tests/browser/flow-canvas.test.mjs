import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('a saved Canvas edit detaches from a same-URL lookalike and returns to the verified view', async () => {
  const frames = ['A', 'B'].map(label => ({
    id: label, label, route: '/', heading: 'Queue', image: 'frame.png',
    steps: [{ role: 'tab', label, inMain: true }],
    checkpoint: [{ role: 'tabpanel', label }],
  }))
  const h = await createHarness({ canvas: true, dock: true, pendingEdits: true, flowFrames: frames, flowPages: { '/': {
    body: `<main><h1>Queue</h1><button role="tab">A</button><button role="tab">B</button>
      <section role="tabpanel" aria-label="A"><button id="queue-action" style="font-size:20px">Details</button></section>
      </main><script>document.querySelectorAll('[role=tab]').forEach(tab => {
        tab.onclick = () => document.querySelector('[role=tabpanel]').setAttribute('aria-label', tab.textContent)
      })</script>`,
  } } })
  try {
    const toggle = h.page.locator('#flow-toggle')
    await toggle.click()
    await h.open()
    await h.select('#queue-action')
    await h.enter('Font size', 30)
    await h.settled()
    const [saved] = await h.journal()
    assert.match(saved.frameState, /^[a-f0-9]{64}$/)
    await toggle.click()
    await h.app.getByRole('tab', { name: 'B', exact: true }).click()
    await h.app.waitForFunction(() => getComputedStyle(document.querySelector('#queue-action')).fontSize === '20px',
      null, { timeout: 2500 })
    await h.showEdits()
    assert.equal(await h.host.locator('.li-pending-open').count(), 1)
    await h.app.getByRole('tab', { name: 'A', exact: true }).click()
    await h.app.waitForFunction(() => getComputedStyle(document.querySelector('#queue-action')).fontSize === '30px')
    await h.settled()
    await h.host.locator('.li-pending-open').click()
    assert.equal(await h.host.locator('[data-selected]').count(), 1)
  } finally { await h.close() }
})

test('Inspector selects, edits, and undoes on the real page at canvas scale', async () => {
  const h = await createHarness({ dock: true, canvas: true })
  try {
    const toggle = h.page.locator('#flow-toggle')
    const dock = h.page.locator('#localhost-inspector-dock')
    const panelToggle = h.page.locator('#inspector-toggle')
    const initialIcon = await panelToggle.locator('svg').innerHTML()
    const layout = async () => {
      const size = h.page.viewportSize()
      const dockBox = await dock.boundingBox()
      const toolbarBox = await h.page.locator('#workspace-toolbar').boundingBox()
      assert.equal(dockBox.x + dockBox.width, size.width)
      assert.equal(dockBox.y, 0)
      assert.equal(dockBox.height, size.height)
      assert.equal(size.width - toolbarBox.x - toolbarBox.width, dockBox.width ? 0 : 12)
      assert.equal(toolbarBox.y, dockBox.width ? 0 : 12)
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
    const live = h.page.locator('#app-preview')
    const frame = h.page.locator('.flow-frame.active')
    const sidebar = h.page.locator('#workspace-sidebar')
    await live.evaluate(node => { node.dataset.testFrame = 'same' })
    await h.select()
    await sidebar.waitFor()
    assert.ok(await layout() > 0)
    assert.equal(await panelToggle.getAttribute('aria-expanded'), 'true')
    assert.equal(await h.app.evaluate(() => innerWidth), originalWidth)
    const canvas = await h.page.locator('#viewport').boundingBox()
    await h.page.mouse.click(canvas.x + 8, canvas.y + 8)
    assert.equal(await frame.getAttribute('aria-pressed'), 'false')
    assert.equal(await live.evaluate(node => getComputedStyle(node).outlineStyle), 'none')
    assert.equal(await live.getAttribute('data-test-frame'), 'same')
    assert.ok(await sidebar.isVisible())
    assert.ok(await layout() > 0)
    await h.select()
    assert.equal(await frame.getAttribute('aria-pressed'), 'true')
    await h.app.locator('#localhost-inspector-outlines #outline').waitFor({ state: 'visible' })
    await panelToggle.click()
    await h.page.locator('#workspace-sidebar').waitFor({ state: 'hidden' })
    assert.equal(await dock.getAttribute('data-inspector-floating'), null)
    assert.equal(await layout(), 0)
    await panelToggle.click()
    assert.ok(await layout() > 0)
    await panelToggle.click()
    assert.equal(await layout(), 0)
    await h.app.locator('#unsaved').focus()
    await h.page.keyboard.press('Escape')
    await h.page.getByRole('button', { name: 'Open Inspector', exact: true }).waitFor()
    assert.equal(await layout(), 0)
    assert.equal(await frame.getAttribute('aria-pressed'), 'false')
    assert.equal(await live.getAttribute('data-test-frame'), 'same')
    await h.open()
    assert.equal(await panelToggle.getAttribute('aria-expanded'), 'true')
    assert.equal(await panelToggle.locator('svg').innerHTML(), initialIcon)
    assert.ok(await layout() > 0)
    assert.ok((await panelToggle.boundingBox()).x < (await toggle.boundingBox()).x)
    await h.page.mouse.move(80, 60)
    assert.equal(await panelToggle.evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)')
    await h.page.setViewportSize({ width: 1723, height: 996 })
    assert.ok(await layout() > 0)
    await h.page.setViewportSize({ width: 1100, height: 1400 })
    await h.select()
    await h.page.keyboard.press('Escape')
    const outlineElement = h.app.locator('#localhost-inspector-outlines #outline')
    assert.equal(await outlineElement.isVisible(), false)
    await h.select()
    await h.page.mouse.click((await live.boundingBox()).x - 8, 60)
    assert.equal(await outlineElement.isVisible(), false)
    assert.equal(await panelToggle.getAttribute('aria-expanded'), 'true')
    await h.select()
    const target = h.app.locator('body > #target')
    const outline = h.app.locator('#localhost-inspector-outlines #outline')
    assert.deepEqual(await outline.boundingBox(), await target.boundingBox())
    await h.page.keyboard.press('Tab')
    const panel = h.host.locator('#inspector-panel')
    await panel.focus()
    assert.equal(await panel.evaluate(node => getComputedStyle(node).outlineStyle), 'none')
    const parent = h.host.getByRole('button', { name: 'Select parent element' })
    await parent.focus()
    assert.equal(await parent.evaluate(node => getComputedStyle(node).outlineStyle), 'solid')
    await h.enter('Corner radius', 18)
    await h.settled()
    assert.equal(await h.css('border-radius'), '18px')
    await h.previewAction('Undo last preview')
    await h.settled()
    assert.notEqual(await h.css('border-radius'), '18px')

    const appBeforeZoom = await target.boundingBox()
    await h.page.mouse.move((await live.boundingBox()).x - 8, 60)
    await h.page.keyboard.down('Control')
    await h.page.mouse.wheel(0, 30)
    await h.page.keyboard.up('Control')
    await h.page.waitForFunction(() => document.querySelector('#zoom').value !== '36%')
    assert.ok((await target.boundingBox()).width < appBeforeZoom.width)
    assert.equal(await h.app.locator('#unsaved').inputValue(), 'unsaved draft')
    await toggle.click()
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
    assert.ok(await layout() > 0)
    await panelToggle.click()
    assert.equal(await panelToggle.getAttribute('aria-expanded'), 'false')
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
  await viewport.dispatchEvent('wheel', { deltaX: (rect.x - view.x - 75) / 2,
    deltaY: (rect.y - view.y - 75) / 2, bubbles: true, cancelable: true })
  await card.locator('span').click()
}

test('flow navigation lives in Layers and opens the selected screen on the canvas', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    await h.open()
    const sidebar = h.page.locator('#workspace-sidebar')
    await sidebar.getByRole('tab', { name: 'Inbox' }).waitFor()
    assert.equal(await sidebar.locator('.flow-roster').count(), 0)
    await h.page.locator('#flow-toggle').click()
    await sidebar.getByRole('button', { name: 'Show flows' }).click()
    const menu = sidebar.getByRole('group', { name: 'Flows and frames' })
    const headers = menu.locator('.flow-group > summary, .single-flow')
    assert.deepEqual(await headers.allTextContents(), ['Home', 'Details', 'Missing'])
    assert.deepEqual(await h.page.locator('#map .flow-heading').allTextContents(), await headers.allTextContents())
    const detail = menu.getByRole('button', { name: 'Details', exact: true })
    await h.page.locator('body').evaluate(body => { body.dataset.inspectorWatching = 'true' })
    await detail.hover()
    const staged = h.page.locator('iframe.flow-candidate')
    await staged.waitFor({ state: 'attached' })
    await staged.evaluate(frame => { frame.dataset.fromSidebarHover = 'true' })
    await detail.click()
    await h.page.locator('[data-frame="other"][aria-pressed="true"]').waitFor()
    assert.equal(await h.page.locator('#app-preview').getAttribute('data-from-sidebar-hover'), 'true')
    assert.equal(await h.page.locator('#zoom').textContent(), '50%')
    await h.page.frameLocator('#app-preview').getByRole('heading', { name: 'Details' }).waitFor()
    assert.equal(await sidebar.isVisible(), true)
    await h.page.locator('#app-preview').evaluate(frame => { frame.dataset.inspectorDocument = 'details' })
    await h.page.waitForFunction(() => !document.querySelector('#localhost-inspector-dock').inert)
  } finally { await h.close() }
})

test('File detail collapses Activity, remembers its split, and opens the same style in Variables', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.open()
    const sidebar = h.page.locator('#workspace-sidebar')
    const inbox = sidebar.getByRole('tab', { name: 'Inbox', exact: true })
    const list = sidebar.locator('.activity-list')
    const divider = sidebar.getByRole('separator', { name: 'Resize activity' })
    await divider.press('ArrowDown')
    const height = (await sidebar.locator('.activity').boundingBox()).height
    await sidebar.getByRole('button', { name: 'Layers', exact: true }).click()
    await sidebar.getByRole('menuitemradio', { name: 'Text styles' }).click()
    const style = sidebar.locator('button.li-type-body').filter({ hasText: 'Bold' }).first()
    await style.click()
    const back = await sidebar.getByRole('button', { name: 'Back', exact: true }).boundingBox()
    const detail = await sidebar.locator('.li-var-detail').boundingBox()
    assert.ok(back.y + back.height <= detail.y, 'Back sits above the style header')
    assert.equal(await list.isVisible(), false)
    assert.equal(await sidebar.locator('.li-var-category').count(), 0)
    await inbox.click()
    assert.equal((await sidebar.locator('.activity').boundingBox()).height, height)
    await sidebar.getByRole('button', { name: 'Back', exact: true }).click()
    await style.click()
    await sidebar.getByRole('button', { name: 'Open in Variables' }).click()
    await sidebar.locator('.li-type-page').first().waitFor()
    assert.equal(await sidebar.locator('.li-var-category').count(), 0)
    assert.equal(await sidebar.locator('.li-var-detail').innerText().then(text => text.includes('Bold')), true)
    await sidebar.getByRole('button', { name: 'Back', exact: true }).click()
    await sidebar.getByRole('button', { name: 'Typography', exact: true }).waitFor()
    await sidebar.getByRole('button', { name: 'File', exact: true }).click()
    assert.equal(await list.isVisible(), true)
    assert.equal((await sidebar.locator('.activity').boundingBox()).height, height)
  } finally { await h.close() }
})

test('canvas view settings resize the real app and reflow rows without moving the camera', async () => {
  const h = await createHarness({
    canvas: true, dock: true, flowFrames: lifecycleFrames,
    flowPreviews: {
      home: { phone: { fixed: 'home-phone.webp' } },
      other: { phone: { fixed: 'other-phone.webp' } },
    },
    flowPages: { ...flowPages, '/': { body: flowPages['/'].body +
      '<div style="height:1550px"></div><p id="below-fold">Below the fold</p>' } },
  })
  try {
    const toggle = h.page.locator('#flow-toggle')
    const trigger = h.page.getByRole('button', { name: 'Canvas view settings' })
    const preview = h.page.locator('#app-preview')
    const nextRow = h.page.locator('[data-frame="other"]')
    const choose = async name => {
      await trigger.click()
      await h.page.getByRole('menuitemradio', { name }).click()
      await trigger.waitFor()
      await h.page.locator('#frame-view-toggle[aria-disabled="false"]').waitFor()
    }
    assert.equal(await trigger.count(), 0)
    await toggle.click()
    assert.equal((await trigger.boundingBox()).width, 32)
    assert.equal((await trigger.locator('svg').boundingBox()).width, 20)
    await trigger.hover()
    const tooltip = h.page.getByRole('tooltip', { name: 'Canvas view settings' })
    assert.equal(await tooltip.isVisible(), false)
    await tooltip.waitFor({ timeout: 1800 })
    await trigger.press('ArrowDown')
    assert.equal(await tooltip.isVisible(), false)
    assert.equal(await h.page.getByRole('menuitemradio', { name: /Desktop/ }).getAttribute('aria-checked'), 'true')
    await h.page.keyboard.press('Escape')
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true)
    const camera = () => h.page.locator('#map').evaluate(node => node.style.transform)
    const previousCamera = await camera()
    const before = await preview.boundingBox()
    const originalRow = await nextRow.evaluate(node => node.offsetTop)
    await choose(/Phone/)
    assert.equal(await h.app.evaluate(() => innerWidth), 390)
    assert.equal(await nextRow.evaluate(node => node.offsetWidth), 390)
    assert.match(await nextRow.locator('img').getAttribute('src'), /other-phone\.webp$/)
    assert.equal(await h.app.evaluate(() => innerHeight), 844)
    assert.equal(await camera(), previousCamera)
    const phone = await preview.boundingBox()
    assert.deepEqual([phone.x, phone.y], [before.x, before.y])
    const fixedRow = await nextRow.evaluate(node => node.offsetTop)
    await choose('Hug page contents')
    const hug = await preview.boundingBox()
    assert.deepEqual([hug.x, hug.y], [phone.x, phone.y])
    assert.equal(await camera(), previousCamera)
    assert.ok(await h.app.evaluate(() => innerHeight > 1550))
    assert.ok(await nextRow.evaluate((node, y) => node.offsetTop > y, fixedRow))
    await h.select('#below-fold')
    await h.app.locator('#localhost-inspector-outlines #outline').waitFor({ state: 'visible' })
    assert.equal(await h.page.locator('#inspector-toggle').getAttribute('aria-expanded'), 'true')
    await chooseCard(h.page, 'other')
    await h.page.locator('[data-frame="other"][aria-pressed="true"]').waitFor()
    await h.page.locator('[data-frame="home"] img').waitFor({ state: 'visible' })
    assert.equal(await preview.evaluate(node => node.contentWindow.innerWidth), 390)
    await chooseCard(h.page, 'home')
    await h.page.locator('[data-frame="home"][aria-pressed="true"]').waitFor()
    await trigger.click()
    assert.equal(await h.page.getByRole('menuitemradio', { name: /Phone/ }).getAttribute('aria-checked'), 'true')
    assert.equal(await h.page.getByRole('menuitemradio', { name: 'Hug page contents' }).getAttribute('aria-checked'), 'true')
    await h.page.keyboard.press('Escape')
    await choose('Fixed height')
    await choose(/Desktop/)
    assert.equal(await preview.evaluate(node => node.contentWindow.innerHeight), 1356)
    assert.equal(await nextRow.evaluate(node => node.offsetTop), originalRow)
    await toggle.click()
    assert.equal(await trigger.count(), 0)
  } finally { await h.close() }
})

test('Hug extends a single viewport-bound scroll region and restores fixed height', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.page.locator('#flow-toggle').click()
    await h.app.evaluate(() => {
      const scroller = document.createElement('div')
      scroller.id = 'scroller'
      scroller.style.cssText = 'height:calc(100vh - 800px);overflow:auto'
      scroller.innerHTML = '<div style="height:1040px">Nested content</div>'
      const main = document.createElement('main')
      main.append(scroller)
      document.body.append(main)
    })
    const trigger = h.page.getByRole('button', { name: 'Canvas view settings' })
    await trigger.click()
    await h.page.getByRole('menuitemradio', { name: 'Hug page contents' }).click()
    await h.page.locator('#frame-view-toggle[aria-disabled="false"]').waitFor()
    assert.equal(await h.app.locator('#scroller').evaluate(node => node.scrollHeight - node.clientHeight), 0)
    await trigger.click()
    await h.page.getByRole('menuitemradio', { name: 'Fixed height' }).click()
    await h.page.locator('#frame-view-toggle[aria-disabled="false"]').waitFor()
    assert.equal(await h.app.evaluate(() => innerHeight), 1356)
  } finally { await h.close() }
})

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

test('wheel pans over a live frame and Command-wheel scrolls its app content', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    const toggle = h.page.locator('#flow-toggle')
    await toggle.click()
    const map = h.page.locator('#map')
    const scene = () => map.evaluate(node => getComputedStyle(node).transform)
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
    const offset = () => table.evaluate(node => [node.scrollLeft, node.scrollTop])
    const pan = async (dx, dy) => {
      const previous = await scene()
      await table.hover()
      await h.page.mouse.wheel(dx, dy)
      await h.page.waitForFunction(({ previous, dx, dy }) => {
        const before = new DOMMatrix(previous)
        const after = new DOMMatrix(getComputedStyle(document.querySelector('#map')).transform)
        return (dx ? Math.sign(before.e - after.e) === Math.sign(dx) : before.e === after.e) &&
          (dy ? Math.sign(before.f - after.f) === Math.sign(dy) : before.f === after.f) && before.a === after.a
      }, { previous, dx, dy }, { timeout: 3000 })
    }

    const initial = await scene()
    await table.dispatchEvent('wheel', { deltaX: -12, deltaY: 15, bubbles: true, cancelable: true })
    await map.evaluate((node, initial) => {
      const before = new DOMMatrix(initial)
      const after = new DOMMatrix(getComputedStyle(node).transform)
      if (after.e !== before.e + 24 || after.f !== before.f - 30) throw Error('Expected double-distance diagonal pan')
    }, initial)

    await pan(30, 0)
    await pan(0, 24)
    assert.deepEqual(await offset(), [0, 0])
    const shifted = await scene()

    await table.hover()
    await h.page.keyboard.down('Meta')
    await h.page.mouse.wheel(90, 0)
    await h.app.waitForFunction(() => document.querySelector('#scrolling-table').scrollLeft > 0)
    await h.page.mouse.wheel(0, 45)
    await h.app.waitForFunction(() => document.querySelector('#scrolling-table').scrollTop > 0)
    await h.page.keyboard.up('Meta')
    assert.equal(await scene(), shifted)
    const scrolled = await offset()
    await pan(-18, -16)
    assert.deepEqual(await offset(), scrolled)

    await table.hover()
    const zoom = h.page.locator('#zoom')
    const beforePinch = await zoom.textContent()
    await h.page.keyboard.down('Control')
    await h.page.mouse.wheel(0, -30)
    await h.page.keyboard.up('Control')
    await h.page.waitForFunction(previous => document.querySelector('#zoom').value !== previous, beforePinch)
    assert.deepEqual(await offset(), scrolled)

    await toggle.click()
    await table.hover()
    await h.page.mouse.wheel(0, 24)
    await h.app.waitForFunction(previous =>
      document.querySelector('#scrolling-table').scrollTop > previous, scrolled[1])
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

test('only Command-pinch crosses between the live page and its centered canvas frame', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.page.setViewportSize({ width: 1000, height: 740 })
    await h.app.evaluate(() => { document.body.dataset.gestureState = 'preserved' })
    const pinch = (deltaY, metaKey = true) => h.app.locator('body').dispatchEvent('wheel', {
      deltaY, ctrlKey: true, metaKey, cancelable: true,
    })
    const toggle = h.page.locator('#flow-toggle')
    assert.equal(await h.app.evaluate(() => document.body.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 8, ctrlKey: true, bubbles: true, cancelable: true }),
    )), true)
    assert.notEqual(await toggle.getAttribute('aria-pressed'), 'true')
    await pinch(8)
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
    await pinch(6)
    assert.equal(await h.page.locator('#zoom-preset').inputValue(), '0.5')
    const frame = h.page.locator('#app-preview')
    const bounds = await frame.boundingBox()
    const viewport = await h.page.locator('#viewport').boundingBox()
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.x - viewport.width / 2) < 2)
    // Start a separate pinch after the first gesture has settled.
    await new Promise(resolve => setTimeout(resolve, 250))
    await pinch(-35, false)
    assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
    await h.app.locator('body').dispatchEvent('wheel', {
      deltaY: -17, ctrlKey: true, metaKey: true, cancelable: true,
      clientX: bounds.width, clientY: bounds.height,
    })
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
    assert.equal(await h.app.locator('body').getAttribute('data-gesture-state'), 'preserved')
    await pinch(2)
    assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
  } finally { await h.close() }
})

test('sideways wheel momentum waits until rest to prepare the hovered app', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    await h.page.locator('#flow-toggle').click()
    const viewport = h.page.locator('#viewport')
    await viewport.dispatchEvent('wheel', { deltaY: -18, ctrlKey: true, clientX: 200, clientY: 150, cancelable: true })
    const card = h.page.locator('[data-frame="other"]')
    const box = await card.boundingBox()
    await viewport.dispatchEvent('wheel', { deltaX: (box.x - 70) / 2, deltaY: (box.y - 70) / 2, cancelable: true })
    await h.page.mouse.move(150, 140)
    const loadedWhileMoving = await viewport.evaluate(async node => {
      const loads = []
      for (let i = 0; i < 12; i++) {
        node.dispatchEvent(new WheelEvent('wheel', {
          deltaX: 1, clientX: 150, clientY: 140, bubbles: true, cancelable: true,
        }))
        await new Promise(resolve => setTimeout(resolve, 20))
        loads.push(Boolean(node.querySelector('.flow-candidate')))
      }
      return loads.some(Boolean)
    })
    assert.equal(loadedWhileMoving, false)
    await h.page.locator('.flow-candidate').waitFor({ state: 'attached', timeout: 2500 })
  } finally { await h.close() }
})

test('moderate zoom prepares one frame and further zoom and click reuse it', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    await h.page.locator('#flow-toggle').click()
    const viewport = h.page.locator('#viewport')
    const card = h.page.locator('[data-frame="other"] span')
    await viewport.dispatchEvent('wheel', { deltaY: -18, ctrlKey: true, clientX: 200, clientY: 150, cancelable: true })
    const rect = await card.boundingBox()
    await viewport.dispatchEvent('wheel', { deltaX: (rect.x - 90) / 2, deltaY: (rect.y - 110) / 2, cancelable: true })
    await card.hover()
    const staged = h.page.locator('.flow-candidate')
    await staged.waitFor({ state: 'attached' })
    assert.equal(await staged.count(), 1)
    assert.equal(await h.page.locator('[data-frame="home"]').getAttribute('aria-pressed'), 'true')
    await staged.evaluate(node => { node.dataset.prepared = 'yes' })
    const point = await card.boundingBox()
    await viewport.dispatchEvent('wheel', { deltaY: -12, ctrlKey: true, clientX: point.x + 10, clientY: point.y + 5, cancelable: true })
    assert.equal(await staged.getAttribute('data-prepared'), 'yes')
    await card.click()
    const live = h.page.locator('#app-preview')
    assert.equal(await live.getAttribute('data-prepared'), 'yes')
    assert.equal(await h.page.locator('[data-frame="other"]').getAttribute('aria-pressed'), 'true')
    assert.equal(await staged.count(), 0)
  } finally { await h.close() }
})

test('zoomed-in frame finishes finite browser animations without waiting on app timers', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages: {
    ...flowPages,
    '/other?view=details': { body: flowPages['/other?view=details'].body + `
      <style>
        @keyframes enter { from { opacity: 0 } to { opacity: 1 } }
        #entrance { animation: enter 10s both }
      </style>
      <svg id="entrance" role="application" width="400" height="150"><rect width="10" height="20"/></svg>
      <script>
        const bar = document.querySelector('rect');
        window.chartTimer = setInterval(() => {
          bar.setAttribute('width', Number(bar.getAttribute('width')) + 1);
        }, 40);
      </script>` },
  } })
  try {
    await h.page.locator('#flow-toggle').click()
    const viewport = h.page.locator('#viewport')
    const card = h.page.locator('[data-frame="other"]')
    await viewport.dispatchEvent('wheel', { deltaY: -190, ctrlKey: true, clientX: 200, clientY: 150, cancelable: true })
    const rect = await card.boundingBox()
    await viewport.dispatchEvent('wheel', { deltaX: (rect.x - 10) / 2, deltaY: (rect.y - 10) / 2, cancelable: true })
    await h.page.mouse.move(200, 210)
    // Preparation is brief; observe its state at a render frame rather than
    // relying on a locator poll to land between preparation and activation.
    await h.page.waitForFunction(() => document.querySelector('.flow-candidate') &&
      document.querySelector('[data-frame="other"]').getAttribute('aria-pressed') === 'false')
    await h.page.locator('[data-frame="other"].active').waitFor()
    const chart = h.page.frameLocator('#app-preview').locator('svg[role="application"] rect')
    assert.equal(await chart.evaluate(node => getComputedStyle(node.parentElement).opacity), '1')
    assert.equal(await h.page.locator('.flow-candidate').count(), 0)
    const initial = Number(await chart.getAttribute('width'))
    await h.page.waitForFunction(width => Number(document.querySelector('#app-preview').contentDocument.querySelector('#entrance rect').getAttribute('width')) > width, initial)
  } finally { await h.close() }
})

test('overview frames distinguish loading, loaded and unavailable previews', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages,
    flowPreviews: { other: { desktop: { fixed: 'other.webp' } }, missing: { desktop: { fixed: 'missing.webp' } } },
  })
  let release
  try {
    const pending = new Promise(resolve => { release = resolve })
    await h.page.route('**/missing.webp', route => route.abort())
    await h.page.route('**/other.webp', async route => {
      await pending
      await route.continue()
    })
    await h.page.reload()
    await h.page.locator('#flow-toggle').click()
    const card = h.page.locator('[data-frame="other"]')
    await card.getByText('Loading preview…', { exact: true }).waitFor()
    release()
    await card.locator('.flow-preview-unavailable').waitFor({ state: 'hidden' })
    assert.ok(await card.locator('img').evaluate(image => image.naturalWidth > 0))
    const missing = h.page.locator('[data-frame="missing"]')
    await missing.locator('img').evaluate(img => { img.loading = 'eager' })
    await missing.getByText('Couldn’t load preview', { exact: true }).waitFor()
  } finally { release?.(); await h.close() }
})

test('continuous zoom upgrades a nearby image after decode and releases it at overview zoom', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages,
    flowPreviews: { other: { desktop: { fixed: 'other.webp', sharp: 'other-2x.webp' } } },
  })
  try {
    let resume
    const blocked = new Promise(resolve => { resume = resolve })
    let sharpRequested = false
    await h.page.route('**/other-2x.webp', async route => {
      sharpRequested = true
      await blocked
      await route.continue()
    })
    await h.page.locator('#flow-toggle').click()
    const card = h.page.locator('[data-frame="other"]')
    const image = card.locator('img')
    const viewport = h.page.locator('#viewport')
    const wheel = deltaY => viewport.dispatchEvent('wheel', { deltaY, ctrlKey: true,
      clientX: 100, clientY: 130, cancelable: true })
    const requested = h.page.waitForRequest('**/other-2x.webp')
    await wheel(-5)
    // Keep a tiny pinch moving across several paint opportunities.
    await viewport.evaluate(async target => {
      for (let i = 0; i < 8; i++) {
        await new Promise(requestAnimationFrame)
        target.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -.01, cancelable: true }))
      }
    })
    assert.equal(sharpRequested, false)
    await requested
    await wheel(-9)
    assert.match(await image.getAttribute('src'), /\/other\.webp$/)
    const before = await image.boundingBox()
    resume()
    await card.locator('img[src="./other-2x.webp"]').waitFor()
    assert.deepEqual(await image.boundingBox(), before)
    assert.equal(await h.page.locator('#app-preview').count(), 1)
    await wheel(30)
    await card.locator('img[src="./other.webp"]').waitFor()
  } finally { await h.close() }
})

test('Command hover activates a frame at overview zoom and aborts if Command is released', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    await h.page.locator('#flow-toggle').click()
    const viewport = h.page.locator('#viewport')
    const label = h.page.locator('[data-frame="other"] span')
    const box = await label.boundingBox()
    await viewport.dispatchEvent('wheel', { deltaX: (box.x - 90) / 2, deltaY: (box.y - 110) / 2, cancelable: true })
    let release
    const blocked = new Promise(resolve => { release = resolve })
    await h.page.route('**/other?view=details', async route => {
      await blocked
      await route.continue().catch(() => {})
    })
    await label.hover()
    assert.equal(await h.page.locator('.flow-candidate').count(), 0)
    await h.page.keyboard.down('Meta')
    await h.page.locator('.flow-candidate').waitFor({ state: 'attached' })
    await h.page.keyboard.up('Meta')
    await h.page.locator('.flow-candidate').waitFor({ state: 'detached' })
    release()
    assert.equal(await h.page.locator('.flow-frame.active').getAttribute('data-frame'), 'home')
    await h.page.keyboard.down('Meta')
    await label.hover()
    await h.page.locator('[data-frame="other"].active[aria-pressed="false"]').waitFor()
    assert.equal(await h.page.locator('[data-frame="home"]').getAttribute('aria-pressed'), 'true')
    await h.page.keyboard.up('Meta')
    assert.equal(await h.page.locator('#zoom').textContent(), '36%')
    assert.equal(await h.page.locator('#app-preview').count(), 1)
    assert.equal(await h.page.locator('.flow-candidate').count(), 0)
  } finally { await h.close() }
})

test('Command hovering an unselected live frame reveals its layer without selecting it', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    await h.page.locator('#flow-toggle').click()
    await h.open()
    await h.page.keyboard.press('Escape')
    const tree = h.page.getByRole('tree', { name: 'Layers' })
    const selected = tree.locator('[aria-selected="true"]')
    assert.equal(await selected.count(), 0)
    const control = h.app.getByRole('button', { name: 'Open View', exact: true })
    await control.hover()
    await h.page.keyboard.down('Meta')
    const row = tree.getByRole('treeitem', { name: 'Open View', exact: true })
    await row.and(tree.locator('[data-hovered]')).waitFor({ timeout: 2000 })
    assert.equal(await selected.count(), 0)
    await control.click({ modifiers: ['Meta'] })
    await row.and(selected).waitFor()
    await h.page.keyboard.up('Meta')
    await tree.locator('[data-hovered]').waitFor({ state: 'detached' })
    assert.equal(await row.getAttribute('aria-selected'), 'true')
  } finally { await h.close() }
})

test('hovering a saved sidebar state warms its route without running its controls', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    await h.page.locator('#flow-toggle').click()
    await h.open()
    const row = h.page.locator('#workspace-sidebar').getByRole('button', { name: 'View', exact: true })
    await h.page.getByRole('button', { name: 'Show flows' }).click()
    if (!await row.isVisible()) await h.page.locator('.workspace-layer-flow-list summary svg').first().click()
    await row.hover()
    const candidate = h.page.frameLocator('.flow-candidate')
    await candidate.getByRole('button', { name: 'Open View' }).waitFor({ state: 'attached' })
    // The route has finished mounting and the control is available to replay.
    await candidate.locator('body').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await candidate.locator('#view-options').getAttribute('hidden'), '')
    await row.click()
    await h.page.frameLocator('#app-preview').getByRole('menu', { name: 'View' }).waitFor()
  } finally { await h.close() }
})

test('frame switches show loading only after the grace period and clear it on cancellation', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    const toggle = h.page.locator('#flow-toggle')
    const settings = h.page.locator('#frame-view-toggle')
    const fastCard = h.page.locator('[data-frame="other"]')
    const slowCard = h.page.locator('[data-frame="missing"]')
    await toggle.click()
    const start = new Date()
    await h.page.clock.install({ time: start })
    await h.page.clock.pauseAt(new Date(start.valueOf() + 1000))

    await fastCard.dispatchEvent('click')
    const dock = h.page.locator('#localhost-inspector-dock')
    assert.equal(await dock.getAttribute('data-opening-frame'), 'Details')
    assert.equal(await fastCard.locator('img').evaluate(img => getComputedStyle(img).outlineColor), 'rgb(37, 99, 201)')
    assert.equal(await fastCard.getAttribute('aria-busy'), 'true')
    assert.equal(await fastCard.getAttribute('data-loading'), null)
    assert.equal(await settings.getAttribute('aria-disabled'), 'true')
    assert.equal(await settings.getAttribute('data-busy'), null)
    await h.page.frameLocator('.flow-candidate').getByRole('heading', { name: 'Details' }).waitFor({ state: 'attached' })
    await h.page.clock.runFor(100)
    await fastCard.and(h.page.locator('[aria-pressed="true"]')).waitFor()
    await h.page.clock.runFor(160)
    assert.equal(await fastCard.getAttribute('data-loading'), null)

    await slowCard.dispatchEvent('click')
    assert.equal(await dock.getAttribute('data-opening-frame'), 'Missing')
    await fastCard.dispatchEvent('click')
    assert.equal(await slowCard.getAttribute('aria-busy'), null)
    assert.equal(await slowCard.getAttribute('data-opening'), null)
    await slowCard.dispatchEvent('click')
    await h.page.clock.runFor(200)
    assert.equal(await slowCard.getAttribute('data-loading'), null)
    await h.page.clock.runFor(50)
    assert.equal(await slowCard.getAttribute('data-loading'), '')
    assert.equal(await settings.getAttribute('data-busy'), '')
    await toggle.dispatchEvent('click')
    assert.equal(await dock.getAttribute('data-opening-frame'), null)
    assert.equal(await slowCard.getAttribute('data-loading'), null)
    assert.equal(await settings.getAttribute('data-busy'), null)
  } finally { await h.close() }
})

test('canvas and Layers share inspector selection and clearing', async () => {
  const h = await createHarness({
    canvas: true, dock: true, flowFrames: lifecycleFrames,
    flowPages: { ...flowPages, '/': { body: '<main><h1>Home</h1><section><h2 id="layer-target">Layer target</h2><p>Another layer</p></section></main>' } },
  })
  try {
    await h.page.locator('#flow-toggle').click()
    await h.open()
    const tree = h.page.getByRole('tree', { name: 'Layers', exact: true })
    await tree.waitFor()
    const selected = tree.locator('[aria-selected="true"]')
    assert.equal(await tree.getByRole('treeitem', { name: 'Layer target', exact: true }).count(), 0)
    const fold = h.page.getByRole('button', { name: 'Collapse layers', exact: true })
    await fold.click()
    assert.equal(await tree.locator('[aria-expanded=true]').count(), 0)
    assert.ok(await tree.getByRole('treeitem').count() > 0)
    await h.page.getByRole('button', { name: 'Expand layers', exact: true }).click()
    await tree.getByRole('treeitem', { name: 'Layer target', exact: true }).waitFor()
    await fold.click()
    await h.select('#layer-target')
    await selected.filter({ hasText: 'Layer target' }).waitFor()
    const other = tree.getByRole('treeitem', { name: 'Another layer', exact: true })
    await other.press('Enter')
    assert.equal(await other.getAttribute('aria-selected'), 'true')
    assert.equal(await h.host.locator('#selected-name').textContent(), 'P')
    await h.page.keyboard.press('Escape')
    await selected.waitFor({ state: 'detached' })
    await h.app.locator('#localhost-inspector-outlines #outline').waitFor({ state: 'hidden' })
  } finally { await h.close() }
})

test('Layers can hide and restore a parent and show its descendants as selected', async () => {
  const h = await createHarness({
    canvas: true, dock: true, flowFrames: lifecycleFrames,
    flowPages: { '/': { body: '<section aria-label="Actions"><button id="save-action">Save</button></section>' } },
  })
  try {
    await h.open()
    const tree = h.page.getByRole('tree', { name: 'Layers' })
    const parent = tree.getByRole('treeitem', { name: 'Actions', exact: true })
    const child = tree.getByRole('treeitem', { name: 'Save', exact: true })
    await parent.press('Enter')
    assert.equal(await parent.getAttribute('aria-selected'), 'true')
    assert.equal(await child.getAttribute('aria-selected'), 'true')
    await parent.locator(':scope > .workspace-layer-line').hover()
    await parent.getByRole('button', { name: 'Hide Actions', exact: true }).click()
    assert.equal(await h.app.locator('#save-action').isVisible(), false)
    await parent.getByRole('button', { name: 'Show Actions', exact: true }).click()
    assert.equal(await h.app.locator('#save-action').isVisible(), true)
    await child.press('Enter')
    assert.equal(await parent.getAttribute('aria-selected'), 'false')
  } finally { await h.close() }
})

test('a decorative SVG is one independently selectable and hideable layer', async () => {
  const body = `<main><button aria-label="Create"><span>Create</span>
    <svg id="plus" aria-hidden="true" width="20" height="20" style="pointer-events:none" viewBox="0 0 20 20">
      <title>Add icon</title><defs><path id="glyph" d="M0 10h20M10 0v20"/></defs>
      <use href="#glyph" stroke="currentColor"/>
    </svg></button></main>`
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages: { '/': { body } } })
  try {
    await h.open()
    const tree = h.page.getByRole('tree', { name: 'Layers' })
    const svg = h.app.locator('#plus')
    const bounds = await svg.boundingBox()
    await h.page.keyboard.down('Meta')
    await h.page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await h.page.keyboard.up('Meta')
    const layer = tree.getByRole('treeitem', { name: 'Add icon', exact: true })
    await layer.waitFor()
    assert.equal(await layer.getAttribute('aria-selected'), 'true')
    assert.equal(await layer.getAttribute('aria-expanded'), null)
    await layer.locator(':scope > .workspace-layer-line').hover()
    await layer.getByRole('button', { name: 'Hide Add icon' }).click()
    assert.equal(await svg.isVisible(), false)
    assert.equal(await h.app.locator('button span').isVisible(), true)
    await layer.getByRole('button', { name: 'Show Add icon' }).click()
    assert.equal(await svg.isVisible(), true)
    await h.select('button span')
    await layer.press('Enter')
    assert.equal(await layer.getAttribute('aria-selected'), 'true')
    assert.equal(await layer.locator('..').locator('[aria-selected=false]').count(), 1)
  } finally { await h.close() }
})

test('Layers follows rendered wrappers and omits hidden and inspector-only content', async () => {
  const body = `<main>
    <div aria-label="Transparent wrapper" style="display:contents"><p>Promoted text</p></div>
    <div aria-label="Invisible wrapper" style="visibility:hidden"><p style="visibility:visible">Visible override</p></div>
    <div hidden><p>Hidden descendant</p></div><img aria-label="Thumbnail" width="12" height="12">
    <svg aria-label="Brand" width="16" height="16"><title>Alternate name</title><circle r="4"/></svg>
    <svg width="16" height="16" aria-hidden="true"><path d="M0 0L16 16"/></svg>
    <template><p>Template contents</p></template>
    <textarea id="localhost-inspector-text-editor" aria-label="Transient editor"></textarea>
  </main>`
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages: { '/': { body } } })
  try {
    await h.open()
    const tree = h.page.getByRole('tree', { name: 'Layers' })
    await tree.getByRole('treeitem', { name: 'Promoted text' }).waitFor()
    const main = tree.getByRole('treeitem', { name: 'Main', exact: true })
    assert.deepEqual(await main.getByRole('treeitem').evaluateAll(items => items.map(item => item.getAttribute('aria-label'))),
      ['Promoted text', 'Visible override', 'Thumbnail', 'Brand', 'Icon'])
  } finally { await h.close() }
})

test('canvas zoom reaches one percent with presets and pinch, and fit can go below twelve percent', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.open()
    await h.page.locator('#flow-toggle').click()
    const presets = h.page.getByRole('combobox', { name: 'Canvas zoom' })
    const scale = () => h.page.locator('#map').evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).a)
    await presets.selectOption('0.1')
    const viewport = h.page.locator('#viewport')
    const pinch = deltaY => viewport.dispatchEvent('wheel', { deltaY, ctrlKey: true, cancelable: true })
    await pinch(-32)
    assert.ok(await scale() > .20 && await scale() < .22)
    await pinch(32)
    assert.ok(Math.abs(await scale() - .1) < .00001)
    for (const value of ['0.1', '0.05', '0.01']) {
      await presets.selectOption(value)
      assert.ok(Math.abs(await scale() - Number(value)) < .00001)
    }
    await h.page.locator('#viewport').dispatchEvent('wheel', { deltaY: 500, ctrlKey: true, cancelable: true })
    assert.ok(Math.abs(await scale() - .01) < .00001)
    await h.page.setViewportSize({ width: 1000, height: 150 })
    await presets.selectOption('fit')
    assert.ok(await scale() >= .01 && await scale() < .12)
  } finally { await h.close() }
})

test('selecting a Layers flow highlights its screens and preserves disclosure', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages })
  try {
    const page = h.page
    await page.locator('#flow-toggle').click()
    await h.open()
    const tree = page.getByRole('tree', { name: 'Layers', exact: true })
    const flow = tree.locator('[data-outline-key="flow:/"]')
    const screen = flow.locator('[data-outline-key="frame:visible"]')
    const sibling = tree.locator('[data-outline-key="flow:/other"]')
    const heading = page.locator('[data-outline-flow="flow:/"]')
    const line = flow.locator(':scope > .workspace-layer-line')
    const caret = line.locator('.workspace-layer-caret')
    const outline = () => line.evaluate(row => getComputedStyle(row).outlineStyle)
    await flow.press('Enter')
    await heading.and(page.locator('[data-selected]')).waitFor()
    assert.equal(await flow.getAttribute('data-selection'), 'direct')
    assert.equal(await screen.getAttribute('data-selection'), 'inherited')
    assert.equal(await sibling.getAttribute('data-selection'), null)
    assert.equal(await outline(), 'solid')
    await line.locator('.workspace-layer-label').click()
    assert.equal(await outline(), 'none')
    await caret.click()
    assert.equal(await flow.getAttribute('aria-expanded'), 'false')
    await flow.press('Enter')
    assert.equal(await flow.getAttribute('aria-expanded'), 'false')
    assert.equal(await flow.getAttribute('data-selection'), 'direct')
    await page.keyboard.press('Escape')
    assert.equal(await flow.getAttribute('data-selection'), null)
    await page.keyboard.down('Meta')
    try {
      await heading.hover()
      await flow.and(tree.locator('[data-hovered]')).waitFor({ timeout: 2000 })
      assert.equal(await flow.getAttribute('aria-expanded'), 'false')
      assert.equal(await flow.getAttribute('data-selection'), null)
    } finally { await page.keyboard.up('Meta') }
    await flow.and(tree.locator('[data-hovered]')).waitFor({ state: 'detached' })
    await caret.click()
    await flow.press('Enter')
    await screen.press('Enter')
    await screen.and(tree.locator('[data-selection="direct"]')).waitFor()
    assert.equal(await flow.getAttribute('data-selection'), null)
    assert.equal(await heading.getAttribute('data-selected'), null)
    await page.getByRole('button', { name: 'Collapse layers', exact: true }).click()
    const expand = page.getByRole('button', { name: 'Expand layers', exact: true })
    await expand.waitFor()
    assert.equal(await tree.locator('[role="treeitem"]:not([aria-roledescription="flow"])').count(), 0)
    assert.equal(await tree.locator('[aria-roledescription="flow"]').count(), 3)
    await expand.click()
    await screen.waitFor()
  } finally { await h.close() }
})

test('Layers keeps frames and same-named sections under their own flows during selection and deselection', async () => {
  const h = await createHarness({ canvas: true, dock: true, flowFrames: lifecycleFrames, flowPages,
    flowVariants: [
      { id: 'home-draft', label: 'Overview draft', section: 'Alternatives', anchor: 'home', route: '/' },
      { id: 'other-draft', label: 'Detail draft', section: 'Alternatives', anchor: 'other', route: '/other?view=details' },
    ] })
  try {
    const page = h.page
    await page.locator('#flow-toggle').click()
    await h.open()
    const tree = page.getByRole('tree', { name: 'Layers', exact: true })
    const row = (name, selected) => tree.getByRole('treeitem', { name, exact: true, selected })
    const flowWithFrame = label => tree.locator('[aria-level="1"]').filter({
      has: page.getByRole('treeitem', { name: label, exact: true }),
    })
    const originalFrameNames = flow => flow.locator('[aria-level="2"][data-outline-key^="frame:"]').evaluateAll(
      rows => rows.map(item => item.getAttribute('aria-label')))
    const home = flowWithFrame('Overview draft')
    const details = flowWithFrame('Detail draft')
    await row('Overview draft').waitFor()
    assert.deepEqual(await originalFrameNames(home), ['Home', 'View', 'Hidden dialog'])
    assert.deepEqual(await originalFrameNames(details), ['Details'])
    await page.locator('[data-anchor="other"] .variant-section-surface button').press('Enter')
    await details.getByRole('treeitem', { name: 'Alternatives', exact: true, selected: true }).waitFor()
    assert.equal(await home.getByRole('treeitem', { name: 'Alternatives', exact: true, selected: true }).count(), 0)
    await page.keyboard.press('Escape')
    await details.getByRole('treeitem', { name: 'Alternatives', exact: true, selected: false }).waitFor()
    await page.locator('[data-variant="home-draft"] > button').press('Enter')
    const variantTree = page.frameLocator('iframe[title="Variant layers"]').getByRole('tree', { name: 'Layers' })
    await variantTree.getByRole('treeitem', { name: 'Overview draft', exact: true, selected: true }).waitFor()
    await variantTree.getByRole('treeitem', { name: 'Detail draft', exact: true, selected: false }).waitFor()
    const variantLayers = page.frameLocator('iframe[title="Variant layers"]')
    await variantLayers.getByRole('button', { name: 'Collapse layers', exact: true }).click()
    const expand = variantLayers.getByRole('button', { name: 'Expand layers', exact: true })
    await expand.waitFor()
    assert.equal(await variantTree.locator('[role="treeitem"]:not([aria-roledescription="flow"])').count(), 0)
    assert.equal(await variantTree.locator('[aria-roledescription="flow"]').count(), 3)
    await expand.click()
    await variantTree.getByRole('treeitem', { name: 'Overview draft', exact: true, selected: true }).waitFor()
  } finally { await h.close() }
})
