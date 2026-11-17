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
      assert.equal(dockBox.x - toggleBox.x - toggleBox.width, 12)
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
