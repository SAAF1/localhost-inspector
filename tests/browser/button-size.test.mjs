import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('registered Button Size and CSS share history, comparison, and Undo', async () => {
  const h = await createHarness({ buttonSizeKey: 'button:direct' })
  try {
    await h.open()
    await h.select('#other')
    const size = h.host.getByRole('button', { name: 'Button size', exact: true })
    const prop = () => h.app.locator('#other').getAttribute('data-inspector-button-size')
    const undo = h.host.getByRole('button', { name: 'Undo last preview' })
    const chooseLarge = async () => {
      await size.click()
      await h.host.getByRole('menuitemradio', { name: 'Large', exact: true }).click()
      await h.settled()
    }
    await chooseLarge()
    assert.equal(await prop(), 'lg')
    await h.enter('Corner radius', 13)
    await h.settled()
    assert.deepEqual((await h.journal()).map(edit => edit.property), ['button-size', 'border-radius'])

    await h.host.getByRole('button', { name: 'Show original' }).click()
    await h.settled()
    assert.equal(await prop(), 'sm')
    assert.notEqual(await h.css('border-radius', '#other'), '13px')
    await h.host.getByRole('button', { name: 'Show previews' }).click()
    await h.settled()
    assert.equal(await prop(), 'lg')
    assert.equal(await h.css('border-radius', '#other'), '13px')

    await undo.click()
    await h.settled()
    assert.equal(await prop(), 'lg')
    await undo.click()
    await h.settled()
    assert.equal(await prop(), 'sm')
    assert.deepEqual(await h.journal(), [])

    await h.select()
    assert.equal(await size.count(), 0)
  } finally { await h.close() }
})

test('failed Button Size save rolls the prop back and leaves no history', async () => {
  const h = await createHarness({ buttonSizeKey: 'button:direct', failSave: 1 })
  try {
    await h.open()
    await h.select('#other')
    await h.host.getByRole('button', { name: 'Button size', exact: true }).click()
    await h.host.getByRole('menuitemradio', { name: 'Large', exact: true }).click()
    await h.settled()
    assert.equal(await h.app.locator('#other').getAttribute('data-inspector-button-size'), 'sm')
    assert.deepEqual(await h.journal(), [])
    assert.match(await h.host.locator('#status').innerText(), /save failure/)
  } finally { await h.close() }
})

test('same-document navigation never reapplies a saved Button edit to another route', async () => {
  const h = await createHarness({ buttonSizeKey: 'button:direct' })
  try {
    await h.open()
    await h.select('#other')
    const size = h.host.getByRole('button', { name: 'Button size', exact: true })
    await size.click()
    await h.host.getByRole('menuitemradio', { name: 'Large', exact: true }).click()
    await h.settled()
    await h.app.evaluate(() => history.pushState(null, '', '/other'))
    await h.host.getByText('Reload the page to clear the previous Button Size preview.').waitFor()
    await h.select('#other')
    assert.equal(await size.count(), 0)
    assert.deepEqual((await h.journal()).map(edit => [edit.route, edit.requested]), [['/', 'lg']])
    assert.equal(await h.host.getByRole('button', { name: 'Undo last preview' }).isDisabled(), true)
  } finally { await h.close() }
})
