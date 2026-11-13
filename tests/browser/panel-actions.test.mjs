import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

const target = { tag: 'div', id: 'target', slot: null, text: 'One Two' }
function savedEdit(id, route, requested, restore = 'unique') {
  return { id, route, target, property: 'font-size', before: '12px', requested, restore }
}

test('panel chrome keeps selection guidance and page actions truthful', async () => {
  const h = await createHarness({ dock: true })
  try {
    const parent = h.host.getByRole('button', { name: 'Select parent element' })
    const collapse = h.host.getByRole('button', { name: 'Collapse Inspector' })
    const undo = h.host.getByRole('button', { name: 'Undo last preview' })
    const compare = h.host.getByRole('button', { name: 'Show original' })
    const reset = h.host.getByRole('button', { name: 'Revert all previews' })
    const guidance = h.host.locator('#guidance')
    await h.open()
    assert.equal(await parent.isVisible(), false)
    assert.equal(await guidance.isVisible(), true)
    assert.equal(await undo.isDisabled(), true)
    assert.equal(await compare.isDisabled(), true)
    assert.equal(await reset.isDisabled(), true)
    assert.equal(await h.host.locator('#status').innerText(), '')
    await h.select('#target > span:first-child')
    assert.equal(await guidance.isVisible(), false)
    assert.equal(await parent.isVisible(), true)
    const targetBox = await h.app.locator('body > #target').boundingBox()
    await parent.click()
    const outlines = h.app.locator('#localhost-inspector-outlines')
    assert.deepEqual(await outlines.locator('#outline').boundingBox(), targetBox)

    await h.enter('Corner radius', 18); await h.settled()
    await h.app.locator('body > #target').click({ position: { x: 5, y: 5 } })
    assert.equal(await guidance.isVisible(), true)
    assert.equal(await undo.isEnabled(), true)
    await compare.click(); await h.settled()
    const preview = h.host.getByRole('button', { name: 'Show previews' })
    assert.equal(await preview.getAttribute('aria-pressed'), 'true')
    await preview.hover()
    assert.equal(await preview.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(229, 244, 255)')
    assert.equal(await h.host.getByText('Original view').isVisible(), true)
    assert.equal(await undo.isDisabled(), true)
    assert.equal(await reset.isEnabled(), true)
    assert.equal(await h.css('border-radius'), '0px')
    await preview.click(); await h.settled()
    assert.equal(await h.css('border-radius'), '18px')
    await collapse.click()
    const entry = h.host.getByRole('button', { name: 'Open Inspector' })
    assert.equal(await entry.evaluate(el => el === el.getRootNode().activeElement), true)
  } finally { await h.close() }
})

test('Revert all asks first and clears the current page including unrestored previews', async () => {
  const h = await createHarness({
    dock: true,
    journal: [savedEdit('a', '/', '18px'), savedEdit('unrestored', '/', '16px', 'ambiguous'), savedEdit('b', '/other', '20px')],
  })
  try {
    await h.open()
    const trigger = h.host.getByRole('button', { name: 'Revert all previews' })
    const dialog = h.host.getByRole('dialog', { name: 'Revert all previews?' })
    const cancel = dialog.getByRole('button', { name: 'Cancel' })
    await trigger.click()
    assert.equal(await cancel.evaluate(el => el === el.getRootNode().activeElement), true)
    assert.equal(await h.css('font-size'), '18px')
    assert.equal((await h.journal()).some(edit => edit.undone), false)
    await cancel.click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await trigger.evaluate(el => el === el.getRootNode().activeElement), true)
    await trigger.click()
    await h.page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await trigger.evaluate(el => el === el.getRootNode().activeElement), true)
    assert.equal((await h.journal()).some(edit => edit.undone), false)
    await trigger.click()
    await dialog.getByRole('button', { name: 'Revert all', exact: true }).click()
    await h.host.locator('#reset:disabled').waitFor()
    await h.settled()
    assert.equal(await h.css('font-size'), '12px')
    assert.equal(await h.host.locator('#status').innerText(), '')
    assert.deepEqual((await h.journal()).filter(edit => edit.undone).map(edit => edit.id), ['a', 'unrestored'])
    assert.equal(await trigger.isDisabled(), true)
  } finally { await h.close() }
})

test('stale and pending Revert all stay bound to the page where they started', async () => {
  for (const returnToStart of [false, true]) {
    const h = await createHarness({
      holdReset: true,
      journal: [savedEdit('a', '/', '18px'), savedEdit('b', '/other', '20px')],
    })
    const go = async path => {
      await h.app.evaluate(path => {
        history.pushState(null, '', path)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, path)
      await h.app.evaluate(() => window.phaseAInspectorReady)
    }
    try {
      await h.open()
      const trigger = h.host.getByRole('button', { name: 'Revert all previews' })
      const dialog = h.host.getByRole('dialog', { name: 'Revert all previews?' })
      await trigger.click()
      await go('/other')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal((await h.journal()).some(edit => edit.undone), false)
      await go('/')
      await trigger.click()
      await dialog.getByRole('button', { name: 'Revert all', exact: true }).click()
      await h.app.waitForFunction(() => typeof window.__releaseReset === 'function')
      await go('/other')
      assert.equal(await h.css('font-size'), '20px')
      if (returnToStart) {
        await go('/')
        assert.equal(await h.css('font-size'), '18px', 'The revisit loaded its pre-revert preview')
      }
      await h.app.evaluate(() => window.__releaseReset())
      await h.settled()
      assert.equal(await h.css('font-size'), returnToStart ? '12px' : '20px')
      assert.deepEqual((await h.journal()).filter(edit => edit.undone).map(edit => edit.id), ['a'])
    } finally { await h.close() }
  }
})
