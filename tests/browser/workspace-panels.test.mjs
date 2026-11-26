import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('a long Inbox keeps its position and opens a late activity row from the keyboard', async () => {
  const entries = Array.from({ length: 10_000 }, (_, id) => ({
    id: 'draft-' + id, label: 'Draft ' + id, created: id, respondedAt: null,
  }))
  const h = await createHarness({ canvas: true, dock: true,
    flowActivity: [...entries, { id: 'response', label: 'Reviewed', created: 1, respondedAt: 2 }],
    flowVariants: [{ id: 'draft-500', label: 'Draft 500', route: '/', anchor: 'first' }] })
  try {
    const panel = h.page.getByRole('tabpanel', { name: 'Inbox' })
    const rows = h.page.locator('.activity-row')
    assert.equal(await rows.count(), 0, 'closed workspace creates no activity rows')
    await h.page.locator('#flow-toggle').click()
    await h.open()
    await panel.getByRole('button', { name: 'Draft 9999', exact: true }).waitFor()
    assert.ok(await rows.count() < 30)
    const late = panel.getByRole('button', { name: 'Draft 501', exact: true })
    await panel.evaluate(node => { node.scrollTop = 9498 * 30 })
    await late.waitFor()
    await late.focus()
    await h.page.keyboard.press('Tab')
    const focused = () => panel.evaluate(node => node.getRootNode().activeElement?.textContent)
    assert.equal(await focused(), 'Draft 500')
    const before = await panel.evaluate(node => node.scrollTop)
    await h.page.getByRole('tab', { name: 'Recent' }).click()
    await h.page.getByRole('button', { name: 'Reviewed' }).waitFor()
    await h.page.getByRole('tab', { name: 'Inbox' }).click()
    assert.equal(await panel.evaluate(node => node.scrollTop), before)
    await h.page.getByRole('separator', { name: 'Resize activity' }).press('ArrowDown')
    // A focused button stays reachable even when a manual scroll moves away.
    await late.focus()
    await panel.evaluate(node => { node.scrollTop = 0 })
    await panel.getByRole('button', { name: 'Draft 9998' }).waitFor()
    await h.page.keyboard.press('Tab')
    assert.equal(await focused(), 'Draft 500')
    await h.page.keyboard.press('Enter')
    await h.page.locator('#localhost-inspector-dock[data-canvas-paint-target="frame:draft-500"]').waitFor()
    assert.ok(await rows.count() < 30)
  } finally { await h.close() }
})

test('the workspace Inspector action brings both panels to the advertised state', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    const toggle = h.page.locator('#inspector-toggle')
    const sidebar = h.page.locator('#workspace-sidebar')
    const dock = h.page.locator('#localhost-inspector-dock')
    async function panels(left, right) {
      await sidebar.waitFor({ state: left ? 'visible' : 'hidden' })
      assert.equal(await dock.evaluate(node => node.hasAttribute('data-inspector-open')), right)
      assert.equal(await toggle.getAttribute('aria-expanded'), String(right))
      assert.equal(await toggle.getAttribute('aria-label'), right ? 'Collapse Inspector' : 'Open Inspector')
    }

    await panels(false, false)
    await toggle.click()
    await panels(true, true)
    await toggle.click()
    await panels(false, false)

    await h.app.locator('#target').click({ modifiers: ['Meta'], position: { x: 120, y: 70 } })
    await panels(true, true)
    await toggle.click()
    await panels(false, false)
    await toggle.click()
    await panels(true, true)

    // The Inspector's own close action also collapses the workspace panel.
    await dock.evaluate(node => node.firstElementChild.dispatchEvent(new Event('hide-workspace-inspector')))
    await panels(false, false)
  } finally { await h.close() }
})

test('dragging the visible center of the Activity divider resizes the pane', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.open()
    const split = h.page.getByRole('separator', { name: 'Resize activity' })
    const before = Number(await split.getAttribute('aria-valuenow'))
    const box = await split.boundingBox()
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await h.page.mouse.move(center.x, center.y)
    await h.page.mouse.down()
    await h.page.mouse.move(center.x, center.y + 40, { steps: 6 })
    await h.page.mouse.up()
    const after = Number(await split.getAttribute('aria-valuenow'))
    assert.ok(Math.abs(after - before - 40) <= 1)
    await split.press('ArrowUp')
    assert.equal(Number(await split.getAttribute('aria-valuenow')), after - 8)
  } finally { await h.close() }
})

test('canvas Command-click reserves tab buttons and links even before Inspector attaches', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    for (const attached of [true, false]) {
      if (!attached) {
        await h.page.goto(new URL('/__inspector-flow/', h.page.url()).href)
        await h.page.getByRole('button', { name: 'Connect Inspector' }).click()
        await h.page.getByText(/click the Localhost Inspector extension to connect both panels/).waitFor()
        assert.equal(await h.page.locator('#workspace-sidebar').isVisible(), false)
        assert.equal(await h.page.locator('#localhost-inspector-dock[data-inspector-open]').count(), 0)
      }
      const app = h.page.frameLocator('#app-preview')
      await app.locator('#target').waitFor()
      await app.locator('body').evaluate(body => {
        const nav = document.createElement('nav')
        nav.style.cssText = 'position:fixed;top:0;left:0;z-index:10;background:white'
        nav.innerHTML = '<a href="/tasks" target="_blank">Tasks link</a> <button role="tab">Analytics tab</button>'
        for (const type of ['mousedown', 'click']) {
          nav.addEventListener(type, () => { body.dataset.appHandled = 'yes' })
        }
        body.prepend(nav)
      })
      await h.page.locator('#flow-toggle').click()
      for (const target of [app.getByRole('link', { name: 'Tasks link' }), app.getByRole('tab', { name: 'Analytics tab' })]) {
        await target.click({ modifiers: ['Meta'] })
        assert.equal(await app.locator('body').getAttribute('data-app-handled'), null, 'Inspector attached: ' + attached)
        assert.equal(h.page.context().pages().length, 1)
        if (attached) await h.page.locator('#localhost-inspector-dock[data-inspector-open]').waitFor()
      }
    }
  } finally { await h.close() }
})

test('both panel controls stay reachable after the browser magnifies the canvas', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.page.locator('#flow-toggle').click()
    await h.page.locator('#inspector-toggle').click()
    const client = await h.page.context().newCDPSession(h.page)
    const physicalWidth = locator => locator.evaluate(node => node.getBoundingClientRect().width * visualViewport.scale)
    const controls = ['workspace-sidebar', 'localhost-inspector-dock', 'flow-toggle', 'inspector-toggle']
    const before = await Promise.all(controls.map(id => physicalWidth(h.page.locator('#' + id))))
    const { width, height } = h.page.viewportSize()
    await client.send('Input.synthesizePinchGesture', {
      x: width / 2, y: height / 2, scaleFactor: 1.6, gestureSourceType: 'touch',
    })
    const withinView = async locator => locator.evaluate(node => {
      const r = node.getBoundingClientRect(), v = visualViewport
      return v.scale > 1.4 && r.left >= v.offsetLeft - 1 && r.right <= v.offsetLeft + v.width + 1 &&
        r.top >= v.offsetTop - 1 && r.bottom <= v.offsetTop + v.height + 1
    })
    for (const [index, id] of controls.entries()) {
      const control = h.page.locator('#' + id)
      assert.ok(await withinView(control), id)
      assert.ok(Math.abs(await physicalWidth(control) - before[index]) < 1, id + ' keeps its screen size')
    }
    await h.page.locator('#inspector-toggle').click()
    assert.ok(await withinView(h.page.locator('#inspector-toggle')))
    await h.page.locator('#inspector-toggle').click()
    await h.page.locator('#workspace-sidebar').waitFor()
  } finally { await h.close() }
})
