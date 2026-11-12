import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('holding Command previews the pointed element without changing selection', async () => {
  const h = await createHarness()
  try {
    const preview = h.host.locator('#hover-outline')
    const selection = h.host.locator('#outline')
    const target = await h.page.locator('body > #target').boundingBox()
    const other = await h.page.locator('#other').boundingBox()
    await h.page.mouse.move(target.x + 5, target.y + 5)
    await h.page.keyboard.down('Meta')
    assert.equal(await preview.isVisible(), false, 'Closed Inspector leaves the page alone')
    await h.page.keyboard.up('Meta')

    await h.open()
    await h.page.mouse.move(target.x + 5, target.y + 5)
    assert.equal(await preview.isVisible(), false)
    await h.page.keyboard.down('Meta')
    assert.deepEqual(await preview.boundingBox(), target, 'Command previews beneath a stationary pointer')
    assert.equal(await selection.isVisible(), false)
    assert.equal(await h.host.locator('#guidance strong').innerText(), 'Command-click an element')

    await h.page.mouse.click(target.x + 5, target.y + 5)
    assert.equal(await preview.isVisible(), false, 'The selected element only has its selection outline')
    assert.deepEqual(await selection.boundingBox(), target)
    await h.page.mouse.move(other.x + 5, other.y + 5)
    assert.deepEqual(await preview.boundingBox(), other)
    assert.deepEqual(await selection.boundingBox(), target, 'Hover does not replace the committed selection')
    await h.host.getByRole('button', { name: 'Select parent element' }).hover()
    assert.equal(await preview.isVisible(), false, 'Inspector controls are excluded')

    await h.page.mouse.move(other.x + 5, other.y + 5)
    await h.page.keyboard.up('Meta')
    assert.equal(await preview.isVisible(), false)
    assert.deepEqual(await selection.boundingBox(), target, 'Releasing Command leaves selection visible')
  } finally { await h.close() }
})

test('font failure leaves a visible, usable inspector with an explicit fallback state', async () => {
  const h = await createHarness({ fontFailure: true })
  try {
    assert.equal(await h.host.getAttribute('data-font-state'), 'fallback')
    assert.equal(await h.host.getByRole('button', { name: 'Open Inspector', exact: true }).isVisible(), true)
    await h.open(); await h.select('#target > span:first-child')
    await h.enter('Font size', 18); await h.settled()
    assert.equal(await h.css('font-size', '#target > span:first-child'), '18px')
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
  const target = { tag: 'div', id: 'target', slot: null, text: 'One Two' }
  const journal = [
    { id: 'restored-font', route: '/', target, property: 'font-size', before: '12px', requested: '18px', restore: 'unique' },
    { id: 'blocked-width', route: '/', target, property: 'width', before: '240px', requested: '300px', restore: 'unique' },
  ]
  const h = await createHarness({ journal, restoreFailure: true })
  try {
    await h.open()
    assert.equal(await h.css('font-size'), '18px')
    assert.equal(await h.host.getByRole('button', { name: 'Undo last preview', exact: true }).isEnabled(), true)
    await h.host.getByRole('button', { name: 'Undo last preview', exact: true }).click(); await h.settled()
    assert.equal(await h.css('font-size'), '18px', 'Undo first retires the newer saved edit that could not attach')
    assert.equal((await h.journal())[1].undone, true)
    await h.host.getByRole('button', { name: 'Undo last preview', exact: true }).click(); await h.settled()
    assert.equal(await h.css('font-size'), '12px')
    assert.equal((await h.journal())[0].undone, true)
  } finally { await h.close() }
})

test('partial paired writes remain undoable and never spill into a changed selection', async () => {
  for (const interrupted of [false, true]) {
    const h = await createHarness(interrupted ? { holdSave: 1 } : { failSave: 2 })
    try {
      await h.open(); await h.select()
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
      await h.host.getByRole('button', { name: 'Undo last preview', exact: true }).click(); await h.settled()
      assert.equal(await h.css('padding-left'), '16px')
    } finally { await h.close() }
  }
})
