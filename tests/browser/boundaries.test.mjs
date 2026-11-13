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

test('the physical alignment grid moves an icon to the clicked corner even when the page changes direction', async () => {
  const h = await createHarness()
  try {
    const target = h.app.locator('#other')
    await target.evaluate(button => {
      document.documentElement.style.direction = 'rtl'
      document.documentElement.style.writingMode = 'vertical-rl'
      Object.assign(button.style, {
        display: 'inline-flex', direction: 'rtl', writingMode: 'horizontal-tb', width: '48px', height: '48px',
        padding: '0', border: '0', alignItems: 'center', justifyContent: 'center',
      })
      const icon = document.createElement('span')
      icon.style.cssText = 'width:16px;height:16px;background:currentColor'
      button.replaceChildren(icon)
    })
    await h.open()
    await h.select('#other')
    const grid = h.host.getByRole('group', { name: 'Container alignment' })
    const bounds = await grid.boundingBox()
    const button = await target.boundingBox()
    for (const [x, y] of [[0, 0], [1, 1], [0, 1], [1, 0]]) {
      await h.page.mouse.click(bounds.x + bounds.width * (x ? 5 : 1) / 6, bounds.y + bounds.height * (y ? 5 : 1) / 6)
      await h.settled()
      const icon = await target.locator('span').boundingBox()
      assert.deepEqual([icon.x - button.x, icon.y - button.y], [x * 32, y * 32])
    }
  } finally { await h.close() }
})

test('flex alignment with oversized padding withholds only the overflowing axes', async () => {
  const h = await createHarness()
  try {
    const button = h.app.locator('#other')
    await button.evaluate(node => {
      Object.assign(node.style, {
        display: 'inline-flex', flexDirection: 'column', boxSizing: 'border-box',
        width: '28px', height: '28px', minHeight: '50px', border: '1px solid',
        padding: '20px 80px', alignItems: 'center', justifyContent: 'center',
      })
      node.innerHTML = '<svg style="width:16px;height:16px;flex:none"></svg><span style="position:absolute;width:999px;height:999px;pointer-events:none">Label</span>'
    })
    await h.open()
    await h.select('#other')
    const chart = h.host.getByRole('group', { name: 'Container alignment' })
    assert.equal(await chart.count(), 0)
    assert.equal(await h.host.getByText('Content exceeds the available width and height.').isVisible(), true)
    await h.host.getByRole('button', { name: 'Auto layout settings', exact: true }).click()
    assert.equal(await h.host.getByRole('button', { name: 'CSS cross-axis alignment' }).isDisabled(), true)
    await h.page.keyboard.press('Escape')
    await h.enter('Horizontal padding', 0)
    await h.settled()
    assert.equal(await h.host.getByText('Content exceeds the available height.').isVisible(), true)
    const right = chart.getByRole('button', { name: 'Align right' })
    assert.equal(await chart.getByRole('button').count(), 3)
    const icon = button.locator('svg')
    const before = await icon.boundingBox()
    await right.click()
    await h.settled()
    const after = await icon.boundingBox()
    assert.ok(after.x > before.x, 'The remaining horizontal control moves the icon right')
    assert.equal(after.y, before.y)
    await h.enter('Vertical padding', 0)
    await h.settled()
    assert.equal(await h.host.locator('.li-alignment-overflow').count(), 0)
    assert.equal(await chart.getByRole('button').count(), 9)
  } finally { await h.close() }
})

test('a selected outline tracks a layout shift without a target resize', async () => {
  const h = await createHarness()
  try {
    await h.open()
    await h.select('#other')
    const target = h.page.locator('#other')
    const before = await target.boundingBox()
    await target.evaluate(node => {
      const spacer = document.createElement('div')
      spacer.style.height = '100px'
      node.before(spacer)
    })
    const after = await target.boundingBox()
    assert.equal(after.y - before.y, 100)
    assert.equal(after.height, before.height)
    const outline = h.host.locator('#outline')
    await outline.waitFor({ state: 'visible' })
    await h.app.waitForFunction(() => {
      const box = document.querySelector('#other').getBoundingClientRect()
      const outline = document.querySelector('#localhost-inspector').shadowRoot.querySelector('#outline')
      return outline.style.top === box.top + 'px'
    })
    assert.deepEqual(await outline.boundingBox(), after)
  } finally { await h.close() }
})

test('Parent selects the host of an open shadow root', async () => {
  const h = await createHarness()
  try {
    await h.app.evaluate(() => {
      const host = document.createElement('div')
      host.id = 'shadow-host'
      host.style.cssText = 'padding:10px;width:200px'
      host.attachShadow({ mode: 'open' }).innerHTML = '<div style="width:75px">Shadow child</div>'
      document.body.prepend(host)
    })
    await h.open()
    await h.select('#shadow-host div')
    assert.equal(await h.field('Width').inputValue(), '75')
    await h.host.getByRole('button', { name: 'Select parent element' }).click()
    assert.equal(await h.field('Width').inputValue(), '200')
  } finally { await h.close() }
})
