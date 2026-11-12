import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('docking gives the mounted app a narrower viewport and preserves Inspector editing', async () => {
  const h = await createHarness({ dock: true })
  try {
    const viewport = () => h.app.evaluate(() => ({
      width: innerWidth,
      wide: matchMedia('(min-width: 1024px)').matches,
    }))
    assert.deepEqual(await viewport(), { width: 1100, wide: true })
    await h.open()
    assert.deepEqual(await viewport(), { width: 860, wide: false })
    const panel = h.host.getByRole('region', { name: 'Design inspector' })
    assert.deepEqual(await panel.boundingBox(), { x: 860, y: 0, width: 240, height: 1400 })

    const outlines = h.app.locator('#localhost-inspector-outlines')
    const target = await h.app.locator('body > #target').boundingBox()
    await h.page.mouse.move(target.x + 5, target.y + 5)
    await h.page.keyboard.down('Meta')
    assert.deepEqual(await outlines.locator('#hover-outline').boundingBox(), target)
    await h.page.mouse.click(target.x + 5, target.y + 5)
    await h.page.keyboard.up('Meta')
    assert.deepEqual(await outlines.locator('#outline').boundingBox(), target)
    await h.enter('Corner radius', 18); await h.settled()
    assert.equal(await h.css('border-radius'), '18px')

    await h.host.getByRole('button', { name: 'Collapse Inspector' }).click()
    assert.deepEqual(await viewport(), { width: 1100, wide: true })
    assert.equal(await h.css('border-radius'), '18px')
    await h.open()
    assert.deepEqual(await outlines.locator('#outline').boundingBox(), target)
    assert.equal((await h.journal())[0].route, '/')

    await h.app.evaluate(() => history.pushState(null, '', '/second?fixture=1'))
    assert.match(h.page.url(), /\/second\?fixture=1$/)
    await h.page.goBack()
    assert.equal(new URL(h.app.url()).pathname, '/')
    assert.equal(new URL(h.page.url()).pathname, '/')
  } finally { await h.close() }
})
