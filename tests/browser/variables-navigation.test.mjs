import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

async function chooseCategory(sidebar, category) {
  await sidebar.locator('.li-var-category').click()
  await sidebar.getByRole('menuitemradio', { name: category, exact: true }).click()
}

test('Variables reveals the exact occurrence in Inspector and keeps the canvas inventory in place', async () => {
  const h = await createHarness({
    canvas: true, dock: true,
    colorCatalog: { names: ['--primary', '--border'] },
    appStyles: `:root { --primary: oklch(0.4 0.1 250); --border: #ddd }
      #other { background-color: var(--primary) }
      #dialog { background-color: oklch(0.968 0.007 247.896 / 0.5) }`,
  })
  try {
    const sidebar = h.page.locator('#workspace-sidebar')
    assert.equal(await sidebar.isVisible(), false)
    await h.open()
    await sidebar.getByRole('button', { name: 'Variables', exact: true }).click()
    await chooseCategory(sidebar, 'Spacing')
    await sidebar.getByRole('button', { name: /16px.*padding/ }).waitFor()
    await chooseCategory(sidebar, 'Typography')
    await sidebar.locator('button.li-type-body').filter({ hasText: /· 32\// }).click()
    await sidebar.getByRole('button', { name: 'Two', exact: true }).click()
    const outline = h.app.locator('#localhost-inspector-outlines #outline')
    assert.deepEqual(await outline.boundingBox(), await h.app.locator('#second-label').boundingBox())
    await h.page.locator('#flow-toggle').click()
    await h.page.locator('#viewport').click({ position: { x: 5, y: 5 } })
    await sidebar.getByRole('button', { name: 'Back', exact: true }).click()
    await chooseCategory(sidebar, 'Color')
    await sidebar.getByRole('button', { name: /Unnamed color #F1F5F9 · 50%/ }).waitFor()
    await sidebar.getByRole('button', { name: /Border #DDDDDD 0/ }).waitFor()
    const white = sidebar.getByRole('button', { name: /Unnamed color #FFFFFF/ })
    const cover = h.app.locator('#second-label')
    const readAlpha = node => window.LocalhostInspector.colorChannels(getComputedStyle(node).backgroundColor)[3]
    // The dismissed category menu can leave the pointer over a color row.
    await sidebar.getByRole('button', { name: 'Sort colors by similarity' }).hover()
    assert.equal(await cover.evaluate(readAlpha), 255)
    await white.hover()
    assert.ok(await cover.evaluate(readAlpha) < 30, 'A covering child reveals the inspected parent fill')
    await sidebar.getByRole('button', { name: 'Sort colors by similarity' }).hover()
    const primary = sidebar.getByRole('button', { name: /Primary #[A-F0-9]{6} 1/ })
    const other = h.app.locator('#other')
    const readFill = node => Array.from(window.LocalhostInspector.colorChannels(getComputedStyle(node).backgroundColor))
    const originalFill = await other.evaluate(readFill)
    const text = h.app.locator('#second-label')
    const originalText = await text.evaluate(node => getComputedStyle(node).color)
    await primary.hover()
    const count = primary.locator('.li-var-count')
    const arrow = primary.locator('..').getByRole('button', { name: /Open occurrences/ })
    assert.equal(await count.evaluate(node => getComputedStyle(node).opacity), '1')
    const pillBounds = await count.boundingBox()
    const arrowBounds = await arrow.boundingBox()
    assert.ok(arrowBounds.x + arrowBounds.width <= pillBounds.x, 'Opening details leaves the use count unobstructed')
    assert.equal(await cover.evaluate(readAlpha), 255)
    await sidebar.getByRole('tooltip').filter({ hasText: 'Primary' }).waitFor()
    assert.deepEqual(await other.evaluate(readFill), originalFill)
    assert.notEqual(await text.evaluate(node => getComputedStyle(node).color), originalText)
    assert.equal(await primary.locator('svg').count(), 0)
    await primary.click({ position: { x: 2, y: 12 } })
    await sidebar.getByRole('button', { name: 'Sort colors by similarity' }).hover()
    assert.equal(await primary.getAttribute('aria-pressed'), 'true')
    assert.notEqual(await text.evaluate(node => getComputedStyle(node).color), originalText)
    await primary.click()
    assert.equal(await primary.getAttribute('aria-pressed'), 'false')
    assert.equal(await text.evaluate(node => getComputedStyle(node).color), originalText)
    await primary.click()
    await primary.locator('..').getByRole('button', { name: /Open occurrences/ }).click()
    assert.equal(await text.evaluate(node => getComputedStyle(node).color), originalText)
    await h.showEdits()
    await sidebar.getByRole('button', { name: /Fixture 1/ }).click()
    assert.deepEqual(await outline.boundingBox(), await h.app.locator('#other').boundingBox())
    assert.equal(await h.host.locator('#design-tab').getAttribute('aria-selected'), 'true')

    await sidebar.getByRole('button', { name: 'Back', exact: true }).click()
    const rawColor = sidebar.getByRole('button', { name: /Unnamed color #DDDDDD 2/ })
    await rawColor.hover()
    await rawColor.locator('..').getByRole('button', { name: /Open occurrences/ }).click()
    const fixture = sidebar.getByRole('button', { name: /Fixture 2/ })
    await fixture.click()
    assert.equal(await fixture.getAttribute('aria-expanded'), 'true')
    assert.deepEqual(await outline.boundingBox(), await h.app.locator('#other').boundingBox())
    const occurrence = sidebar.getByRole('button', { name: 'Two Fill', exact: true })
    await occurrence.click()
    assert.deepEqual(await outline.boundingBox(), await h.app.locator('#second-label').boundingBox())
    assert.equal(await fixture.getAttribute('aria-expanded'), 'true')

    await h.page.evaluate(() => {
      const doc = document.querySelector('#app-preview').contentDocument
      doc.querySelector('#target span').style.backgroundColor = 'red'
      const sidebar = document.querySelector('#workspace-sidebar').shadowRoot
      const stale = [...sidebar.querySelectorAll('button')].find(row => row.textContent === 'OneFill')
      stale.click()
    })
    await sidebar.getByRole('status').filter({ hasText: 'This use changed.' }).waitFor()
    assert.deepEqual(await outline.boundingBox(), await h.app.locator('#second-label').boundingBox())
  } finally { await h.close() }
})

test('opening Variables reuses the inspected page and picks up changes made while File is visible', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.app.evaluate(() => {
      const host = document.body.appendChild(document.createElement('div'))
      host.id = 'app-widget'
      const root = host.attachShadow({ mode: 'open' })
      root.innerHTML = '<span style="font-size:33px">Widget label</span>'
    })
    await h.page.evaluate(() => {
      const ui = window.LocalhostInspector
      const scan = ui.scanVariablesPage
      window.fixtureScanCount = 0
      ui.scanVariablesPage = (...args) => {
        window.fixtureScanCount++
        return scan(...args)
      }
    })
    await h.open()
    const sidebar = h.page.locator('#workspace-sidebar')
    const variables = sidebar.getByRole('button', { name: 'Variables', exact: true })
    const file = sidebar.getByRole('button', { name: 'File', exact: true })
    await variables.click()
    await sidebar.locator('button.li-type-body').filter({ hasText: /· 32\// }).waitFor()
    await file.click()
    const scanned = await h.page.evaluate(() => window.fixtureScanCount)
    await variables.click()
    await h.page.waitForTimeout(300)
    assert.equal(await h.page.evaluate(() => window.fixtureScanCount), scanned)
    await file.click()
    await h.app.locator('#app-widget span').evaluate(node => { node.style.fontSize = '37px' })
    await variables.click()
    await sidebar.locator('button.li-type-body').filter({ hasText: /· 37\// }).waitFor()
    assert.equal(await sidebar.locator('button.li-type-body').filter({ hasText: /· 33\// }).count(), 0)
  } finally { await h.close() }
})

test('oversized typography fits the inventory tile while details retain its actual size', async () => {
  const h = await createHarness({ canvas: true, dock: true, appStyles: '#target #second-label { font: bold 112px/140px Arial }' })
  try {
    await h.open()
    const sidebar = h.page.locator('#workspace-sidebar')
    await sidebar.getByRole('button', { name: 'Variables', exact: true }).click()
    const row = sidebar.locator('.li-type-row').filter({ hasText: '112/140' })
    const marker = row.locator('sup')
    await marker.waitFor({ state: 'visible' })
    const tile = await row.locator('.li-type-tile').boundingBox()
    for (const element of [row.locator('.li-type-tile > span'), marker]) {
      const glyph = await element.boundingBox()
      assert.ok(glyph.x >= tile.x && glyph.y >= tile.y)
      assert.ok(glyph.x + glyph.width <= tile.x + tile.width && glyph.y + glyph.height <= tile.y + tile.height)
    }
    assert.equal(await row.getByRole('button').count(), 1)
    await row.getByRole('button').click()
    await sidebar.locator('.li-type-page > summary').filter({ hasText: 'Fixture' }).waitFor()
    await sidebar.getByRole('button', { name: 'Two', exact: true }).waitFor()
    await sidebar.getByRole('button', { name: /View typography details/ }).click()
    const detail = sidebar.getByRole('dialog').locator('.li-text-style-specimen span:visible')
    await detail.waitFor()
    assert.equal(await detail.textContent(), 'Ag')
    assert.equal(await detail.evaluate(el => getComputedStyle(el).fontSize), '112px')
    assert.equal(await detail.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a), 1)
  } finally { await h.close() }
})

test('screen spacing previews the gap, pins it, and opens occurrences separately', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.open()
    const sidebar = h.page.locator('#workspace-sidebar')
    await sidebar.getByRole('button', { name: 'File', exact: true }).click()
    await chooseCategory(sidebar, 'Spacing')
    const gap = sidebar.getByRole('button', { name: /^8px.*gap/ })
    const away = sidebar.locator('summary').filter({ hasText: 'Unstyled' })
    const bands = h.app.locator('#localhost-inspector-spacing-preview i')
    await gap.hover()
    await bands.first().waitFor()
    const bounds = await bands.first().boundingBox()
    assert.equal(bounds.width, 8)
    await sidebar.getByRole('button', { name: /^16px.*padding/ }).hover()
    assert.equal(await bands.count(), 4)
    await sidebar.getByRole('button', { name: /^24px.*margin/ }).hover()
    assert.ok(await bands.count() >= 2)
    await away.hover()
    await bands.first().waitFor({ state: 'detached' })
    await gap.click()
    await away.hover()
    assert.equal(await gap.getAttribute('aria-pressed'), 'true')
    await bands.first().waitFor()
    await gap.hover()
    await sidebar.getByRole('button', { name: 'Open occurrences for 8px' }).click()
    await bands.first().waitFor({ state: 'detached' })
    await sidebar.locator('.li-var-list-row').first().waitFor()
  } finally { await h.close() }
})

test('arrow keys browse visible variable rows in displayed order', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.open()
    const sidebar = h.page.locator('#workspace-sidebar')
    await sidebar.getByRole('button', { name: 'Variables', exact: true }).click()
    for (const [category, selector] of [['Typography', '.li-type-body'], ['Spacing', '.li-var-value'], ['Color', '.li-var-color-row']]) {
      await chooseCategory(sidebar, category)
      const categoryTrigger = sidebar.locator('.li-var-category')
      const rows = sidebar.locator('button' + selector + ':visible')
      await rows.nth(1).waitFor()
      await categoryTrigger.press('ArrowDown')
      assert.ok(await rows.first().evaluate(el => el.matches(':focus')))
      await h.page.keyboard.press('ArrowDown')
      assert.ok(await rows.nth(1).evaluate(el => el.matches(':focus')))
      await h.page.keyboard.press('ArrowUp')
      assert.ok(await rows.first().evaluate(el => el.matches(':focus')))
    }
  } finally { await h.close() }
})

test('All text selects the live matches together and collapse keeps the style accessible', async () => {
  const h = await createHarness({ canvas: true, dock: true })
  try {
    await h.app.evaluate(() => {
      const sample = document.querySelector('#second-label')
      const copy = sample.cloneNode(true)
      copy.removeAttribute('id')
      copy.style.font = getComputedStyle(sample).font
      copy.textContent = 'Second use'
      sample.after(copy)
    })
    await h.open()
    const sidebar = h.page.locator('#workspace-sidebar')
    await chooseCategory(sidebar, 'Text styles')
    const fold = sidebar.locator('.li-audit-collapse')
    await fold.click()
    assert.equal(await sidebar.locator('.li-type-group[open]').count(), 0)
    await fold.click()
    await sidebar.locator('button.li-type-body').filter({ hasText: /· 32\// }).first().click()
    const all = sidebar.getByRole('button', { name: /All text/ })
    const rows = sidebar.locator('.li-type-use')
    const count = await rows.count()
    assert.ok(count >= 2)
    await rows.first().hover()
    await h.app.locator('#hover-outline').waitFor()
    await all.click()
    assert.equal(await all.getAttribute('aria-pressed'), 'true')
    assert.equal(await h.app.locator('#related-outlines > div').count(), count)
    await fold.click()
    assert.equal(await rows.first().isVisible(), false)
    await fold.click()
    await rows.first().click()
    assert.equal(await h.app.locator('#related-outlines > div').count(), 0)
    assert.equal(await all.getAttribute('aria-pressed'), 'false')
  } finally { await h.close() }
})
