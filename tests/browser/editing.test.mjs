import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('numeric edits, journal, Undo and Before/After preserve the original style', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select()
    const heights = await h.host.locator('.li-field').evaluateAll(fields => fields.map(field => field.getBoundingClientRect().height))
    assert.ok(heights.every(height => height === 24), 'Fields retain their height in row and column compositions')
    await h.enter('Font size', 18); await h.settled()
    assert.equal(await h.css('font-size'), '18px')
    assert.equal((await h.journal()).at(-1).requested, '18px')
    await h.host.getByRole('button', { name: 'Before', exact: true }).click(); await h.settled()
    assert.equal(await h.css('font-size'), '12px')
    assert.equal(await h.field('Font size').isDisabled(), true)
    await h.host.getByRole('button', { name: 'After', exact: true }).click(); await h.settled()
    assert.equal(await h.css('font-size'), '18px')
    await h.host.getByRole('button', { name: 'Undo', exact: true }).click(); await h.settled()
    assert.equal(await h.css('font-size'), '12px')
    assert.equal((await h.journal()).at(-1).undone, true)
  } finally { await h.close() }
})

test('invalid and failed saves leave the inspected app unchanged', async () => {
  const h = await createHarness({ failSave: 1 })
  try {
    await h.open(); await h.select()
    await h.enter('Font size', -1); await h.settled()
    assert.equal(await h.css('font-size'), '12px')
    assert.equal((await h.journal()).length, 0)
    await h.enter('Font size', 18); await h.settled()
    assert.equal(await h.css('font-size'), '12px')
    assert.match(await h.host.locator('#status').innerText(), /save failure/)
    assert.equal((await h.journal()).length, 0)
  } finally { await h.close() }
})

test('preset menu supports keyboard selection, Escape and direct numeric editing', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select()
    const trigger = h.host.getByRole('button', { name: 'Font size presets', exact: true })
    await trigger.click()
    assert.equal(await h.host.getByRole('menuitemradio').count(), 16)
    await h.page.keyboard.press('ArrowDown'); await h.page.keyboard.press('Enter'); await h.settled()
    assert.equal(await h.css('font-size'), '13px')
    await trigger.click(); await h.page.keyboard.press('Escape')
    assert.equal(await h.host.getByRole('menu').count(), 0)
    await h.enter('Font size', 19.5); await h.settled()
    assert.equal(await h.css('font-size'), '19.5px')
  } finally { await h.close() }
})

test('padding expansion preserves unequal values and axis edits have reversible side entries', async () => {
  const h = await createHarness()
  try {
    await h.page.locator('body > #target').evaluate(node => { node.style.paddingRight = '24px' })
    await h.open(); await h.select()
    await h.host.getByRole('button', { name: 'Collapse individual padding' }).click()
    assert.equal(await h.field('Horizontal padding').getAttribute('placeholder'), 'Mixed')
    assert.equal((await h.journal()).length, 0)
    await h.enter('Horizontal padding', 30); await h.settled()
    assert.equal(await h.css('padding-left'), '30px')
    assert.equal(await h.css('padding-right'), '30px')
    assert.deepEqual((await h.journal()).map(edit => edit.property), ['padding-left', 'padding-right'])
    await h.host.getByRole('button', { name: 'Undo', exact: true }).click(); await h.settled()
    assert.equal(await h.css('padding-left'), '30px')
    assert.equal(await h.css('padding-right'), '24px')
    await h.host.getByRole('button', { name: 'Expand individual padding' }).click()
    assert.equal(await h.field('Left padding').inputValue(), '30')
    assert.equal(await h.field('Right padding').inputValue(), '24')
  } finally { await h.close() }
})
