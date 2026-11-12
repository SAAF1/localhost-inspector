import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('Inspector tooltips wait about one second and dismiss when hover or focus leaves', async () => {
  for (const dock of [false, true]) {
    const h = await createHarness({ dock })
    try {
      await h.page.setViewportSize({ width: 1100, height: 370 })
      await h.page.clock.install()
      const launcher = h.host.getByRole('button', { name: 'Open Inspector' })
      const tooltip = h.host.locator('#inspector-tooltip')
      assert.equal(await launcher.getAttribute('title'), null)
      await launcher.hover()
      await h.page.clock.runFor(750)
      assert.equal(await tooltip.isVisible(), false)
      await h.page.clock.runFor(300)
      assert.equal(await tooltip.innerText(), 'Open Inspector')
      const rect = await tooltip.boundingBox()
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 1100)
      assert.ok(rect.y >= 0 && rect.y + rect.height <= 370)
      await h.page.keyboard.press('Escape')
      assert.equal(await tooltip.isVisible(), false)

      await h.open(); await h.select()
      await h.page.keyboard.press('Tab')
      const parent = h.host.getByRole('button', { name: 'Select parent element' })
      assert.equal(await parent.evaluate(node => node === node.getRootNode().activeElement), true)
      await h.page.clock.runFor(1100)
      assert.match(await tooltip.innerText(), /Select parent element .*Shift\+Enter/)
      assert.equal(await parent.getAttribute('aria-describedby'), 'inspector-tooltip')
      await h.host.locator('.li-properties').evaluate(node => { node.scrollTop = 100 })
      await tooltip.waitFor({ state: 'hidden' })
      assert.equal(await parent.getAttribute('aria-describedby'), null)

      const presets = h.host.getByRole('button', { name: 'Font size presets' })
      await presets.hover()
      await h.page.mouse.move(5, 5)
      await h.page.clock.runFor(1100)
      assert.equal(await tooltip.isVisible(), false)
    } finally { await h.close() }
  }
})

test('opening an Inspector menu or confirmation cancels a pending tooltip', async () => {
  const target = { tag: 'div', id: 'target', slot: null, text: 'One Two' }
  const h = await createHarness({
    dock: true,
    journal: [{ id: 'saved', route: '/', target, property: 'font-size', before: '12px', requested: '18px', restore: 'unique' }],
  })
  try {
    await h.page.clock.install()
    await h.open(); await h.select()
    const tooltip = h.host.locator('#inspector-tooltip')
    const presets = h.host.getByRole('button', { name: 'Font size presets' })
    await presets.hover()
    await h.page.clock.runFor(350)
    await presets.click()
    await h.page.clock.runFor(1100)
    assert.equal(await h.host.getByRole('menu', { name: 'Font size presets' }).isVisible(), true)
    assert.equal(await tooltip.isVisible(), false)
    await h.page.keyboard.press('Escape')

    const reset = h.host.getByRole('button', { name: 'Revert all previews' })
    await reset.hover()
    await h.page.clock.runFor(350)
    await reset.click()
    await h.page.clock.runFor(1100)
    assert.equal(await h.host.getByRole('dialog', { name: 'Revert all previews?' }).isVisible(), true)
    assert.equal(await tooltip.isVisible(), false)
    await h.page.keyboard.press('Escape')
    assert.equal((await h.journal())[0].undone, undefined)
  } finally { await h.close() }
})
