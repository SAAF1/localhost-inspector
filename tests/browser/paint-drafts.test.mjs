import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('Escape discards a typed Fill before Tab can commit it', async () => {
  const h = await createHarness()
  try {
    await h.open()
    await h.select()
    const field = h.host.getByRole('textbox', { name: 'Fill color', exact: true })
    await field.fill('1F4A7B')
    await field.press('Enter')
    await h.settled()
    await field.fill('88CC00')
    await field.press('Escape')
    await field.press('Tab')
    await h.settled()
    assert.equal(await field.inputValue(), '1F4A7B')
    assert.equal(await h.css('background-color'), 'rgb(31, 74, 123)')
    assert.equal((await h.journal()).length, 1)
  } finally { await h.close() }
})

test('moving from typed color to plane saves once on release and nothing on capture loss', async () => {
  const h = await createHarness({ dock: true, pendingEdits: true })
  try {
    await h.open()
    await h.select()
    await h.host.getByRole('button', { name: 'Open fill color picker' }).click()
    const field = h.host.getByRole('textbox', { name: 'Custom color value' })
    const plane = h.host.getByRole('button', { name: /Saturation and brightness/ })
    await field.fill('D55BE1')
    await field.press('Enter')
    await h.settled()
    const baseline = await h.css('background-color')
    const bounds = await plane.boundingBox()
    const move = (x, y) => h.page.mouse.move(bounds.x + x * bounds.width, bounds.y + y * bounds.height)
    for (const cancel of [true, false]) {
      await field.focus()
      await move(.2, .3)
      await h.page.mouse.down()
      await move(.4, .5)
      assert.equal((await h.journal()).length, 1)
      assert.equal(await h.css('background-color'), baseline)
      if (cancel) {
        // Release the actual pointer's capture during this drag.
        await plane.evaluate(node => node.addEventListener('pointermove', event => {
          node.releasePointerCapture(event.pointerId)
        }, { once: true }))
        await move(.5, .6)
      }
      await move(.6, .8)
      await h.page.mouse.up()
      await h.settled()
      assert.equal((await h.journal()).length, cancel ? 1 : 2)
      if (cancel) {
        assert.equal(await field.inputValue(), 'D55BE1')
        assert.equal(await h.css('background-color'), baseline)
      } else {
        assert.notEqual(await h.css('background-color'), baseline)
      }
    }
  } finally { await h.close() }
})

test('a first drag uses an uncommitted hex draft and capture loss keeps the typed value', async () => {
  const h = await createHarness({ dock: true, pendingEdits: true })
  try {
    await h.open()
    await h.select()
    await h.host.getByRole('button', { name: 'Open fill color picker' }).click()
    const field = h.host.getByRole('textbox', { name: 'Custom color value' })
    const plane = h.host.getByRole('button', { name: /Saturation and brightness/ })
    const bounds = await plane.boundingBox()
    const move = (x, y) => h.page.mouse.move(bounds.x + bounds.width * x, bounds.y + bounds.height * y)

    await field.fill('0000FF')
    await move(.4, .4)
    await h.page.mouse.down()
    await move(1, 0)
    await move(.5, .5)
    assert.equal((await h.journal()).length, 0)
    await h.page.mouse.up()
    await h.settled()
    const first = (await h.css('background-color')).match(/\d+/g).map(Number)
    assert.ok(first[2] > first[0] && first[0] === first[1] && first[2] < 255)
    assert.equal((await h.journal()).length, 1)

    await field.fill('DD1144')
    await move(.4, .4)
    await h.page.mouse.down()
    await plane.evaluate(node => node.addEventListener('pointermove', event => {
      node.releasePointerCapture(event.pointerId)
    }, { once: true }))
    await move(.6, .6)
    await move(.7, .7)
    await h.page.mouse.up()
    await h.settled()
    assert.equal(await field.inputValue(), 'DD1144')
    assert.equal(await h.css('background-color'), 'rgb(221, 17, 68)')
    assert.equal((await h.journal()).length, 2)
  } finally { await h.close() }
})
