import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('a stale write rolls back its preview and blocks further writes until reload', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select()
    await h.enter('Corner radius', 12); await h.settled()
    await h.app.evaluate(() => { window.__revision++ })
    await h.enter('Corner radius', 18); await h.settled()
    assert.equal(await h.css('border-radius'), '12px')
    assert.deepEqual((await h.journal()).map(edit => edit.requested), ['12px'])
    assert.match(await h.host.locator('#status').innerText(), /Saved previews changed in another tab/)
    assert.equal(await h.field('Corner radius').isDisabled(), true)
    assert.equal(await h.host.locator('#undo').isDisabled(), true)
    assert.equal(await h.host.locator('#reset').isDisabled(), true)
  } finally { await h.close() }
})

test('a pending preview leaves with its route and reconciles when that route returns', async () => {
  const h = await createHarness({ holdSave: 1 })
  try {
    await h.open(); await h.select()
    await h.enter('Corner radius', 18)
    await h.app.waitForFunction(() => typeof window.__releaseSave === 'function')
    assert.equal(await h.css('border-radius'), '18px')

    const go = async path => {
      await h.app.evaluate(path => history.pushState(null, '', path), path)
      await h.app.evaluate(() => window.phaseAInspectorReady)
    }
    await go('/other')
    assert.equal(await h.css('border-radius'), '0px')
    await go('/')
    assert.equal(await h.css('border-radius'), '0px')
    await h.app.evaluate(() => window.__releaseSave())
    await h.app.waitForFunction(() => getComputedStyle(document.getElementById('target')).borderRadius === '18px')
    await h.settled()
    assert.deepEqual((await h.journal()).map(edit => edit.route), ['/'])

    await h.host.locator('#clear').click()
    await h.settled()
    assert.equal(await h.host.locator('#clear').getAttribute('aria-pressed'), 'true')
    await go('/other')
    assert.equal(await h.host.locator('#clear').getAttribute('aria-pressed'), 'false')
    assert.equal(await h.css('border-radius'), '0px')
  } finally { await h.close() }
})

test('hash routes isolate previews and ordinary page anchors preserve them', async () => {
  const h = await createHarness()
  try {
    await h.open()
    const go = async hash => {
      await h.app.evaluate(hash => { location.hash = hash }, hash)
      await h.app.evaluate(() => window.phaseAInspectorReady)
    }
    await h.select()
    await h.enter('Corner radius', 18)
    await h.settled()
    await go('#details')
    assert.equal(await h.css('border-radius'), '18px')

    await go('#/first')
    assert.equal(await h.css('border-radius'), '0px')
    await h.select()
    await h.enter('Corner radius', 12)
    await h.settled()
    await go('#/second')
    assert.equal(await h.css('border-radius'), '0px')
    assert.equal(await h.host.locator('#undo').isDisabled(), true)

    await go('#/first')
    assert.equal(await h.css('border-radius'), '12px')
    await go('#details')
    assert.equal(await h.css('border-radius'), '18px')
    assert.deepEqual((await h.journal()).map(edit => edit.route), ['/', '/#/first'])
  } finally { await h.close() }
})
