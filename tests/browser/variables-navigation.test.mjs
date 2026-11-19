import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

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
    await sidebar.getByRole('button', { name: 'Spacing', exact: true }).click()
    await sidebar.getByRole('button', { name: /16px.*padding/ }).waitFor()
    await sidebar.getByRole('button', { name: 'Typography', exact: true }).click()
    await sidebar.getByRole('button', { name: /quick brown fox.*32px/ }).click()
    await sidebar.getByRole('button', { name: 'Two', exact: true }).click()
    const outline = h.app.locator('#localhost-inspector-outlines #outline')
    assert.deepEqual(await outline.boundingBox(), await h.app.locator('#second-label').boundingBox())
    await h.page.locator('#flow-toggle').click()
    await h.page.locator('#viewport').click({ position: { x: 5, y: 5 } })
    await sidebar.getByRole('button', { name: 'Color', exact: true }).click()
    await sidebar.getByRole('button', { name: /F1F5F9 50 %/ }).waitFor()
    await sidebar.getByRole('button', { name: /Border 0/ }).waitFor()
    const primary = sidebar.getByRole('button', { name: /Primary 1/ })
    await primary.hover()
    await sidebar.getByRole('tooltip').filter({ hasText: 'Primary' }).waitFor()
    assert.equal(await primary.locator('svg').count(), 0)
    await primary.click({ position: { x: 2, y: 12 } })
    await h.showEdits()
    await sidebar.getByRole('button', { name: /Fixture 1/ }).click()
    assert.deepEqual(await outline.boundingBox(), await h.app.locator('#other').boundingBox())
    assert.equal(await h.host.locator('#design-tab').getAttribute('aria-selected'), 'true')

    await sidebar.getByRole('button', { name: 'All colors', exact: true }).click()
    await sidebar.getByRole('button', { name: /DDDDDD 100 % 2/ }).click()
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
    await sidebar.getByRole('button', { name: /quick brown fox.*32px/ }).waitFor()
    await file.click()
    const scanned = await h.page.evaluate(() => window.fixtureScanCount)
    await variables.click()
    await h.page.waitForTimeout(300)
    assert.equal(await h.page.evaluate(() => window.fixtureScanCount), scanned)
    await file.click()
    await h.app.locator('#app-widget span').evaluate(node => { node.style.fontSize = '37px' })
    await variables.click()
    await sidebar.getByRole('button', { name: /quick brown fox.*37px/ }).waitFor()
    assert.equal(await sidebar.getByRole('button', { name: /quick brown fox.*· 33px/ }).count(), 0)
  } finally { await h.close() }
})
