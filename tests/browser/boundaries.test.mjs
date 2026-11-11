import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('font failure leaves a visible, usable inspector with an explicit fallback state', async () => {
  const h = await createHarness({ fontFailure: true })
  try {
    assert.equal(await h.host.getAttribute('data-font-state'), 'fallback')
    assert.equal(await h.host.getByRole('button', { name: 'Inspector', exact: true }).isVisible(), true)
    await h.open(); await h.select()
    await h.enter('Font size', 18); await h.settled()
    assert.equal(await h.css('font-size'), '18px')
    assert.equal((await h.journal()).length, 1)
  } finally { await h.close() }
})

test('reverse flex directions align to the physical edge selected in the matrix', async () => {
  const h = await createHarness()
  try {
    await h.open()
    for (const direction of ['row-reverse', 'column-reverse']) {
      await h.page.locator('body > #target').evaluate((node, value) => { node.style.flexDirection = value; node.style.justifyContent = 'flex-start' }, direction)
      await h.select()
      await h.host.getByRole('button', { name: 'Distribute start, align center', exact: true }).click()
      await h.settled()
      const edge = await h.page.locator('body > #target').evaluate((node, vertical) => {
        const axis = vertical ? 'top' : 'left'
        return Math.min(...Array.from(node.children, child => child.getBoundingClientRect()[axis])) - node.getBoundingClientRect()[axis]
      }, direction.startsWith('column'))
      assert.equal(edge, 17, 'Children reach the selected start edge after padding and border')
    }
  } finally { await h.close() }
})

test('partial restoration leaves successfully restored edits available to Undo', async () => {
  const target = { tag: 'div', id: 'target', slot: null, text: 'OneTwo' }
  const journal = [
    { id: 'restored-font', route: '/', target, property: 'font-size', before: '12px', requested: '18px', restore: 'unique' },
    { id: 'blocked-width', route: '/', target, property: 'width', before: '240px', requested: '300px', restore: 'unique' },
  ]
  const h = await createHarness({ journal, restoreFailure: true })
  try {
    await h.open()
    assert.equal(await h.css('font-size'), '18px')
    assert.equal(await h.host.getByRole('button', { name: 'Undo', exact: true }).isEnabled(), true)
    await h.host.getByRole('button', { name: 'Undo', exact: true }).click(); await h.settled()
    assert.equal(await h.css('font-size'), '12px')
    assert.equal((await h.journal())[0].undone, true)
  } finally { await h.close() }
})

test('partial paired writes remain undoable and never spill into a changed selection', async () => {
  for (const interrupted of [false, true]) {
    const h = await createHarness(interrupted ? { holdSave: 1 } : { failSave: 2 })
    try {
      await h.open(); await h.select()
      await h.host.getByRole('button', { name: 'Collapse individual padding' }).click()
      await h.enter('Horizontal padding', 30)
      if (interrupted) {
        await h.page.waitForFunction(() => typeof window.__releaseSave === 'function')
        await h.select('#other')
        await h.page.evaluate(() => window.__releaseSave())
      }
      await h.settled()
      assert.equal(await h.css('padding-left'), '30px')
      assert.equal(await h.css('padding-right'), '16px')
      assert.equal((await h.journal()).length, 1)
      assert.match(await h.host.locator('#status').innerText(), /First change saved/)
      assert.equal(await h.page.locator('body > #other').evaluate(node => node.style.paddingLeft), '')
      await h.host.getByRole('button', { name: 'Undo', exact: true }).click(); await h.settled()
      assert.equal(await h.css('padding-left'), '16px')
    } finally { await h.close() }
  }
})
