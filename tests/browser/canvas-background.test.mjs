import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('the blank Canvas uses shared color controls and keeps its background out of app edits', async () => {
  const h = await createHarness({
    canvas: true, dock: true, pendingEdits: true,
    colorCatalog: { source: 'theme.css', names: ['--ocean'] },
    appStyles: ':root { --ocean: #173f7a; }',
  })
  try {
    const flow = h.page.locator('#flow-toggle')
    const viewport = h.page.locator('#viewport')
    const color = h.host.getByRole('textbox', { name: 'Canvas background color' })
    const panel = h.host.locator('#inspector-panel')
    const opacity = h.field('Canvas background opacity')
    const visibility = h.host.getByRole('button', { name: 'Show canvas background' })
    const backgroundImage = () => viewport.evaluate(element => getComputedStyle(element).backgroundImage)
    const displayedColor = () => viewport.evaluate(element => {
      const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
      canvas.fillStyle = getComputedStyle(element).backgroundColor
      canvas.fillRect(0, 0, 1, 1)
      return [...canvas.getImageData(0, 0, 1, 1).data]
    })

    await h.open()
    assert.equal(await color.isVisible(), false)
    await flow.click()
    assert.equal(await color.isVisible(), false)
    await panel.focus()
    await h.page.keyboard.press('Escape')
    await color.waitFor()
    assert.deepEqual(await displayedColor(), [242, 241, 238, 255])
    assert.equal(await backgroundImage(), 'none')
    assert.equal(await visibility.getAttribute('aria-pressed'), 'true')
    assert.equal(await visibility.evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)')
    assert.equal(await h.host.getByText('Background', { exact: true }).count(), 0)

    await color.fill('B04461')
    await color.press('Enter')
    assert.deepEqual(await displayedColor(), [176, 68, 97, 255])
    await h.host.getByRole('button', { name: 'Open canvas color picker' }).click()
    await h.host.getByRole('tab', { name: 'Custom' }).waitFor()
    await h.host.getByRole('tab', { name: 'Libraries' }).click()
    const ocean = h.host.getByRole('option', { name: /ocean/i })
    await ocean.click()
    assert.equal(await ocean.getAttribute('aria-selected'), 'true')
    assert.equal(await h.host.getByText(/^Style ·/).count(), 0)
    assert.deepEqual(await displayedColor(), [23, 63, 122, 255])
    await h.host.getByRole('button', { name: 'Close Variables' }).click()
    await h.app.evaluate(() => document.documentElement.style.setProperty('--ocean', '#2464a0'))
    await color.evaluate(input => { if (input.value !== '2464A0') throw Error('Applied style did not refresh') })
    assert.deepEqual(await displayedColor(), [36, 100, 160, 255])
    await opacity.fill('50')
    await opacity.press('Enter')
    const translucent = await displayedColor()
    assert.ok(translucent[0] > 36 && translucent[0] < 242)
    await visibility.focus()
    await visibility.press('Space')
    assert.equal(await visibility.getAttribute('aria-pressed'), 'false')
    assert.equal(await visibility.evaluate(button => button === button.getRootNode().activeElement), true)
    assert.equal(await visibility.evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)')
    assert.equal(await opacity.isDisabled(), true)
    assert.match(await backgroundImage(), /conic-gradient/)
    const checkerSize = await viewport.evaluate(element => getComputedStyle(element).backgroundSize)
    await h.page.locator('#zoom-preset').selectOption('0.25')
    assert.equal(await viewport.evaluate(element => getComputedStyle(element).backgroundSize), checkerSize)
    await visibility.press('Space')
    assert.equal(await opacity.isEnabled(), true)
    assert.equal(await opacity.inputValue(), '50')
    assert.equal(await backgroundImage(), 'none')
    assert.deepEqual(await displayedColor(), translucent)

    await h.select()
    assert.equal(await color.isVisible(), false)
    assert.deepEqual(await h.journal(), [])
    await panel.focus()
    await h.page.keyboard.press('Escape')
    await visibility.click()
    assert.match(await backgroundImage(), /conic-gradient/)
    await flow.click()
    assert.deepEqual(await displayedColor(), [0, 0, 0, 0])
    assert.equal(await backgroundImage(), 'none')
    assert.equal(new URLSearchParams(new URL(h.page.url()).hash.slice(1)).get('view'), null)
    await h.page.reload()
    await flow.click()
    assert.match(await backgroundImage(), /conic-gradient/)
  } finally { await h.close() }
})
