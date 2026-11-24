import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

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
    await panels(false, true)
    await toggle.click()
    await panels(false, false)
    await toggle.click()
    await panels(true, true)

    // A newly attached host can be closed while the sidebar remains visible.
    // Trigger the action before the sidebar's dock observer finishes recovery.
    await dock.evaluate(node => {
      node.firstElementChild.dispatchEvent(new Event('hide-workspace-inspector'))
      if (node.hasAttribute('data-inspector-open')) throw Error('The fixture must start with a closed dock')
      const sidebar = document.querySelector('#workspace-sidebar')
      sidebar.shadowRoot.querySelector('#inspector-toggle').click()
    })
    await panels(true, true)
  } finally { await h.close() }
})

test('dragging the visible center of the Flows divider resizes the pane', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.open()
    const split = h.page.getByRole('separator', { name: 'Resize Flows' })
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
