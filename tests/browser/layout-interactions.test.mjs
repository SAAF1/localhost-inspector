import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('padding defaults to compact for matching opposing sides and preserves an explicit toggle', async () => {
  const h = await createHarness()
  try {
    await h.app.locator('#target').evaluate(node => { node.style.padding = '24px 0' })
    await h.open(); await h.select()
    assert.equal(await h.field('Horizontal padding').inputValue(), '0')
    assert.equal(await h.field('Vertical padding').inputValue(), '24')
    assert.equal(await h.field('Left padding').count(), 0)
    await h.host.getByRole('button', { name: 'Expand individual padding' }).click()
    const collapse = h.host.getByRole('button', { name: 'Collapse individual padding' })
    assert.equal(await collapse.evaluate(node => node === node.getRootNode().activeElement), true)
    await h.enter('Gap', 12); await h.settled()
    assert.equal(await h.field('Top padding').inputValue(), '24')
    assert.deepEqual((await h.journal()).map(edit => edit.property), ['gap'])
  } finally { await h.close() }
})

test('flex alignment represents stretch and distribution without releasing the other axis', async () => {
  const h = await createHarness()
  try {
    const target = h.app.locator('body > #target')
    await target.evaluate(node => {
      Object.assign(node.style, { flexDirection: 'column', alignItems: 'normal', justifyContent: 'normal', height: '200px' })
      const header = document.createElement('div')
      header.id = 'contained-header'
      header.style.cssText = 'container-type:inline-size;padding-inline:24px'
      header.textContent = 'Recent Sales'
      const body = document.createElement('div')
      body.textContent = 'Content'
      node.replaceChildren(header, body)
    })
    const header = target.locator('#contained-header')
    const before = await header.boundingBox()
    await h.open(); await h.select()
    const advanced = h.host.getByRole('button', { name: 'More container alignment options' })
    assert.equal(await h.host.getByRole('group', { name: 'Container alignment' }).count(), 0)
    assert.equal(await h.host.getByRole('button', { name: 'Vertical alignment', exact: true }).count(), 0)
    await advanced.click()
    assert.equal(await h.host.getByRole('menuitem', { name: 'Alignment: automatic stretch (current)' }).isVisible(), true)
    assert.deepEqual(await h.host.getByRole('menuitem', { name: /^Vertical alignment/ }).allTextContents(), [
      'Vertical alignment: Top (current)', 'Vertical alignment: Center', 'Vertical alignment: Bottom',
    ])
    await h.host.getByRole('menuitem', { name: 'Vertical alignment: Center', exact: true }).click(); await h.settled()
    assert.equal(await h.css('justify-content'), 'center')
    assert.equal(await h.css('align-items'), 'normal')
    const after = await header.boundingBox()
    assert.equal(after.width, before.width)
    assert.equal(after.height, before.height)
    assert.ok(after.y > before.y, 'The chosen main-axis position moves the content')
    assert.deepEqual((await h.journal()).map(edit => edit.property), ['justify-content'])

    await target.evaluate(node => { node.style.justifyContent = 'space-between'; node.style.alignItems = 'center' })
    await h.select()
    await advanced.click()
    assert.equal(await h.host.getByRole('menuitem', { name: 'Distribution: space between (current)' }).isVisible(), true)
    assert.deepEqual(await h.host.getByRole('menuitem', { name: /^Horizontal alignment/ }).allTextContents(), [
      'Horizontal alignment: Left', 'Horizontal alignment: Center (current)', 'Horizontal alignment: Right',
    ])
    await h.host.getByRole('menuitem', { name: 'Horizontal alignment: Right', exact: true }).click(); await h.settled()
    assert.equal(await h.css('justify-content'), 'space-between')
    assert.equal(await h.css('align-items'), 'end')
    assert.deepEqual((await h.journal()).map(edit => edit.property), ['justify-content', 'align-items'])
  } finally { await h.close() }
})

test('Inspector shortcuts reuse Parent and Undo and leave editing and app controls alone', async () => {
  const h = await createHarness({ dock: true })
  try {
    await h.open()
    const parent = h.host.getByRole('button', { name: 'Select parent element' })
    const undo = h.host.getByRole('button', { name: 'Undo last preview' })
    const shortcut = await undo.getAttribute('aria-keyshortcuts')
    const undoKeys = shortcut === 'Meta+Z' ? 'Meta+z' : 'Control+z'
    await h.select('#target > span:first-child')
    assert.equal(await parent.getAttribute('aria-keyshortcuts'), 'Shift+Enter')
    await h.page.keyboard.press('Shift+Enter')
    const target = h.app.locator('body > #target')
    const selection = h.app.locator('#localhost-inspector-outlines #outline')
    assert.deepEqual(await selection.boundingBox(), await target.boundingBox())
    await h.enter('Corner radius', 18); await h.settled()
    const panel = h.host.getByRole('region', { name: 'Design inspector' })
    assert.equal(await panel.evaluate(el => el === el.getRootNode().activeElement), true)

    await h.field('Corner radius').focus()
    await h.page.keyboard.press(undoKeys)
    assert.equal(await h.css('border-radius'), '18px')
    // Native text Undo may change a draft. Return it to the saved value before leaving the field.
    await h.field('Corner radius').fill('18')
    await h.app.locator('#other').focus()
    await h.page.keyboard.press(undoKeys)
    assert.equal(await h.css('border-radius'), '18px')
    assert.equal((await h.journal())[0].undone, undefined)

    await h.app.evaluate(() => { document.body.tabIndex = -1; document.body.focus() })
    await h.page.keyboard.press(undoKeys); await h.settled()
    assert.equal(await h.css('border-radius'), '0px')
    assert.equal((await h.journal())[0].undone, true)

    await h.enter('Corner radius', 18); await h.settled()
    await h.enter('Corner radius', 19); await h.settled()
    await h.app.evaluate(() => { window.__settings.holdUndo = true })
    await undo.click()
    await h.app.waitForFunction(() => typeof window.__releaseUndo === 'function')
    await h.app.evaluate(() => {
      window.__settings.holdUndo = false
      window.__releaseUndo()
    })
    await h.settled()
    assert.equal(await undo.evaluate(el => el === el.getRootNode().activeElement), true)
    assert.equal(await h.css('border-radius'), '18px')
    await h.page.keyboard.press(undoKeys); await h.settled()
    assert.equal(await h.css('border-radius'), '0px')
  } finally { await h.close() }
})
