import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('numeric edits, journal, Undo and Before/After preserve the original style', async () => {
  const h = await createHarness()
  try {
    assert.equal(await h.host.getAttribute('data-font-state'), 'loaded')
    await h.open(); await h.select('#target > span:first-child')
    const heights = await h.host.locator('.li-field').evaluateAll(fields => fields.map(field => field.getBoundingClientRect().height))
    assert.ok(heights.every(height => height === 24), 'Fields retain their height in row and column compositions')
    await h.enter('Font size', 18); await h.settled()
    assert.equal(await h.css('font-size', '#target > span:first-child'), '18px')
    assert.equal((await h.journal()).at(-1).requested, '18px')
    await h.host.getByRole('button', { name: 'Show original', exact: true }).click(); await h.settled()
    assert.equal(await h.css('font-size', '#target > span:first-child'), '12px')
    assert.equal(await h.field('Font size').isDisabled(), true)
    await h.host.getByRole('button', { name: 'Show previews', exact: true }).click(); await h.settled()
    assert.equal(await h.css('font-size', '#target > span:first-child'), '18px')
    await h.host.getByRole('button', { name: 'Undo last preview', exact: true }).click(); await h.settled()
    assert.equal(await h.css('font-size', '#target > span:first-child'), '12px')
    assert.equal((await h.journal()).at(-1).undone, true)
  } finally { await h.close() }
})

test('invalid and failed saves leave the inspected app unchanged', async () => {
  const h = await createHarness({ failSave: 1 })
  try {
    await h.open(); await h.select('#target > span:first-child')
    for (const [field, value] of [['Font size', -1], ['Font size', 2001], ['Letter spacing', -21]]) {
      await h.enter(field, value); await h.settled()
      assert.equal(await h.css('font-size', '#target > span:first-child'), '12px')
      assert.notEqual(await h.css('letter-spacing', '#target > span:first-child'), '-21px')
      const input = h.field(field)
      assert.equal(await input.getAttribute('aria-invalid'), 'true')
      const errorId = await input.getAttribute('aria-describedby')
      assert.match(await h.host.locator('#' + errorId).innerText(), /Enter a valid value/)
    }
    assert.equal((await h.journal()).length, 0)
    await h.enter('Font size', 18); await h.settled()
    assert.equal(await h.css('font-size', '#target > span:first-child'), '12px')
    assert.match(await h.host.locator('#status').innerText(), /save failure/)
    assert.equal((await h.journal()).length, 0)
    await h.page.evaluate(() => { window.LocalhostInspector.resizingControls = undefined })
    await h.select('#target > span:first-child')
    assert.match(await h.host.locator('#status').innerText(), /controls could not load/)
    assert.match(await h.host.locator('#fields').innerText(), /Reload the extension/)
  } finally { await h.close() }
})

test('preset menu supports keyboard selection, Escape and direct numeric editing', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select('#target > span:first-child')
    const trigger = h.host.getByRole('button', { name: 'Font size presets', exact: true })
    await trigger.click()
    assert.equal(await h.host.getByRole('menuitemradio').count(), 16)
    await h.page.keyboard.press('ArrowDown'); await h.page.keyboard.press('Enter'); await h.settled()
    assert.equal(await h.css('font-size', '#target > span:first-child'), '13px')
    await trigger.click(); await h.page.keyboard.press('Escape')
    assert.equal(await h.host.getByRole('menu').count(), 0)
    assert.equal(await trigger.evaluate(node => node.getRootNode().activeElement === node), true)
    await trigger.click(); await h.page.keyboard.press('Tab')
    assert.equal(await h.host.getByRole('menu').count(), 0)
    assert.equal(await h.field('Line height').evaluate(node => node.getRootNode().activeElement === node), true)
    await trigger.click(); await h.page.keyboard.press('Shift+Tab')
    assert.equal(await h.field('Font size').evaluate(node => node.getRootNode().activeElement === node), true)
    await h.enter('Font size', 19.5); await h.settled()
    assert.equal(await h.css('font-size', '#target > span:first-child'), '19.5px')
    await h.enter('Font size', 128); await h.settled()
    await h.page.setViewportSize({ width: 1100, height: 400 })
    await trigger.click()
    const visible = await h.host.getByRole('menuitemradio', { checked: true }).evaluate(item => {
      const row = item.getBoundingClientRect()
      const list = item.parentElement.getBoundingClientRect()
      return row.top >= list.top && row.bottom <= list.bottom
    })
    assert.equal(visible, true, 'The current choice is visible when the menu opens in a short viewport')
    const list = h.host.locator('.li-menu-list')
    const beforeScroll = await list.evaluate(node => node.scrollTop)
    await h.page.keyboard.press('ArrowDown')
    const scrollUp = h.host.getByRole('button', { name: 'Scroll font sizes up', exact: true })
    assert.equal(await scrollUp.evaluate(node => node.getRootNode().activeElement === node), true)
    await h.page.keyboard.press('Enter')
    assert.ok(await list.evaluate(node => node.scrollTop) < beforeScroll, 'The footer can scroll the list from the keyboard')
    await h.page.keyboard.press('ArrowDown')
    assert.equal(await h.host.getByRole('button', { name: 'Scroll font sizes down', exact: true }).evaluate(node => node.getRootNode().activeElement === node), true)
    await h.page.keyboard.press('Home')
    assert.equal(await h.host.getByRole('menuitemradio').first().evaluate(node => node.getRootNode().activeElement === node), true)
    await h.page.keyboard.press('End')
    assert.equal(await h.host.getByRole('menuitemradio').last().evaluate(node => node.getRootNode().activeElement === node), true)
    await h.host.locator('.li-header').click({ position: { x: 8, y: 8 } })
    assert.equal(await h.host.getByRole('menu').count(), 0, 'Clicking outside the menu dismisses it')
    await trigger.click()
    await h.page.setViewportSize({ width: 1100, height: 440 })
    await h.host.getByRole('menu').waitFor({ state: 'detached' })
    assert.equal(await h.host.getByRole('menu').count(), 0, 'Resizing dismisses the menu')
    assert.equal(await h.css('font-size', '#target > span:first-child'), '128px', 'Navigation and dismissal do not commit edits')
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
    await h.host.getByRole('button', { name: 'Undo last preview', exact: true }).click(); await h.settled()
    assert.equal(await h.css('padding-left'), '30px')
    assert.equal(await h.css('padding-right'), '24px')
    await h.host.getByRole('button', { name: 'Expand individual padding' }).click()
    assert.equal(await h.field('Left padding').inputValue(), '30')
    assert.equal(await h.field('Right padding').inputValue(), '24')
  } finally { await h.close() }
})

test('optional bounds add without edits, remove through the journal, and survive failed removal and Undo', async () => {
  for (const [axis, bound, reset] of [['width', 'min', 'auto'], ['height', 'max', 'none']]) {
    const h = await createHarness({ failSave: 3 })
    try {
      await h.open(); await h.select()
      const label = bound[0].toUpperCase() + bound.slice(1) + ' ' + axis
      const property = bound + '-' + axis
      const field = h.field(label)
      assert.equal(await field.count(), 0, 'Default bounds are hidden')
      await h.host.getByRole('button', { name: (axis === 'width' ? 'Width' : 'Height') + ' resizing', exact: true }).click()
      assert.equal(await h.host.getByRole('menuitem', { name: /Fill container|Hug contents/ }).count(), axis === 'width' ? 2 : 0)
      await h.host.getByRole('menuitem', { name: 'Add ' + bound + ' ' + axis + '…', exact: true }).click()
      assert.equal(await field.inputValue(), '')
      assert.equal(await field.evaluate(input => input.getRootNode().activeElement === input), true, 'The revealed field is ready to type into')
      assert.equal(await field.getAttribute('placeholder'), bound[0].toUpperCase() + bound.slice(1) + ' ' + (axis === 'width' ? 'W' : 'H'))
      assert.equal((await h.journal()).length, 0, 'Revealing a field does not change the app')
      await h.enter(label, 40); await h.settled()
      assert.equal(await h.css(property), '40px')
      const remove = async () => {
        await h.host.getByRole('button', { name: label + ' options', exact: true }).click()
        await h.host.getByRole('menuitem', { name: 'Remove ' + bound + ' ' + axis, exact: true }).click()
        await h.settled()
      }
      await remove()
      assert.equal(await field.count(), 0)
      assert.equal((await h.journal()).at(-1).requested, reset)
      await h.host.getByRole('button', { name: 'Undo last preview', exact: true }).click(); await h.settled()
      assert.equal(await field.inputValue(), '40')
      assert.equal(await h.css(property), '40px')
      await remove()
      assert.equal(await field.inputValue(), '40', 'Failed removal keeps the constraint visible')
      assert.equal(await h.css(property), '40px')
      assert.equal((await h.journal()).length, 2)
      assert.match(await h.host.locator('#status').innerText(), /save failure/)
      await h.page.locator('body > #other').evaluate(node => { node.style.minHeight = '20px'; node.parentElement.style.display = 'flex' })
      await h.select('body > #other')
      assert.equal(await h.field('Min height').inputValue(), '20', 'Existing constraints are visible without an Add command')
      await h.host.getByRole('button', { name: 'Width resizing', exact: true }).click()
      assert.equal(await h.host.getByRole('menuitem', { name: /Fill container|Hug contents/ }).count(), 0, 'Bounds menus remain available where width modes are ineligible')
      if (axis === 'width') {
        await h.page.keyboard.press('Escape')
        await h.page.evaluate(() => {
          const wrapper = document.createElement('div')
          const inline = document.createElement('span')
          inline.id = 'inline-target'
          inline.textContent = 'Inline target'
          wrapper.append(inline)
          document.body.append(wrapper)
        })
        await h.select('#inline-target')
        for (const bound of ['min', 'max']) {
          await h.host.getByRole('button', { name: 'Width resizing', exact: true }).click()
          await h.host.getByRole('menuitem', { name: 'Add ' + bound + ' width…', exact: true }).click()
        }
        assert.equal(await h.host.getByRole('button', { name: 'Width resizing', exact: true }).count(), 0, 'No empty menu trigger remains when every available bound is revealed')
      }
    } finally { await h.close() }
  }
})
