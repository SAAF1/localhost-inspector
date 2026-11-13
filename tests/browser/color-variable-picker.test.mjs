import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

async function installFixture(h) {
  await h.app.evaluate(() => {
    const ui = window.LocalhostInspector
    const root = (window.localhostInspectorDock ?? document).querySelector('#localhost-inspector').shadowRoot
    const fill = root.querySelector('[data-inspector-section="Fill"]')
    const colors = [
      { id: '--card', name: 'Card', value: 'oklch(1 0 0)', group: 'Surface' },
      { id: '--secondary', name: 'Secondary', value: 'oklch(.968 .007 247.896)', group: 'Surface' },
      { id: '--primary', name: 'Primary', value: 'oklch(.208 .042 265.755)', group: 'Action' },
      { id: '--destructive', name: 'Destructive', value: 'oklch(.577 .245 27.325)', group: 'Action' },
    ]
    const state = window.__pickerFixture = { current: '--card', attempts: [] }
    const trigger = ui.action('Fill variables', 'variables', event => {
      ui.openColorVariablePicker(event.currentTarget, {
        colors, current: state.current, sourceLabel: 'src/styles/theme.css',
        async onChoose(id) {
          state.attempts.push(id)
          if (state.hold) await new Promise((resolve, reject) => { state.release = { resolve, reject } })
          state.current = id
        },
      })
    })
    trigger.setAttribute('aria-haspopup', 'dialog')
    trigger.setAttribute('aria-expanded', 'false')
    trigger.style.marginInlineStart = 'auto'
    fill.querySelector('h2').append(trigger)
  })
}

test('the color variable picker separates the search target from the applied color', async () => {
  const h = await createHarness({ dock: true })
  try {
    await h.open()
    await h.select()
    await installFixture(h)
    const trigger = h.host.getByRole('button', { name: 'Fill variables' })
    const dialog = h.host.getByRole('dialog', { name: 'Variables' })
    const search = dialog.getByRole('combobox', { name: 'Search colors' })
    const card = dialog.getByRole('option', { name: 'Card' })
    const secondary = dialog.getByRole('option', { name: 'Secondary' })
    await trigger.click()
    assert.equal(await search.evaluate(node => node === node.getRootNode().activeElement), true)
    assert.equal(await card.getAttribute('aria-selected'), 'true')
    await search.fill('surface')
    assert.equal(await dialog.getByRole('option').count(), 2)
    await search.press('ArrowDown')
    await search.press('ArrowDown')
    assert.equal(await search.getAttribute('aria-activedescendant'), await secondary.getAttribute('id'))
    assert.equal(await secondary.getAttribute('aria-selected'), 'false')
    assert.deepEqual(await h.app.evaluate(() => window.__pickerFixture.attempts), [])
    await search.press('Enter')
    assert.equal(await secondary.getAttribute('aria-selected'), 'true')
    assert.equal(await card.getAttribute('aria-selected'), 'false')
    assert.equal(await search.inputValue(), 'surface')
    await secondary.click()
    assert.deepEqual(await h.app.evaluate(() => window.__pickerFixture.attempts), ['--secondary'])
    await search.fill('purple')
    assert.equal(await dialog.getByRole('status').innerText(), 'No matches found for this search')
    assert.equal(await search.getAttribute('aria-activedescendant'), null)
    await dialog.getByRole('button', { name: 'Clear search' }).click()
    assert.equal(await dialog.getByRole('option').count(), 4)
    await search.press('Escape')
    assert.equal(await dialog.count(), 0)
    assert.equal(await trigger.evaluate(node => node === node.getRootNode().activeElement), true)
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
    assert.equal(await h.css('background-color'), 'rgb(255, 255, 255)')
    assert.deepEqual(await h.journal(), [])
  } finally { await h.close() }
})

test('a failed color selection retains the applied swatch and remains retryable', async () => {
  const h = await createHarness()
  try {
    await h.open()
    await h.select()
    await installFixture(h)
    await h.app.evaluate(() => { window.__pickerFixture.hold = true })
    const trigger = h.host.getByRole('button', { name: 'Fill variables' })
    const dialog = h.host.getByRole('dialog', { name: 'Variables' })
    const search = dialog.getByRole('combobox', { name: 'Search colors' })
    const card = dialog.getByRole('option', { name: 'Card' })
    const secondary = dialog.getByRole('option', { name: 'Secondary' })
    await trigger.click()
    await secondary.click()
    assert.equal(await dialog.getByRole('status').innerText(), 'Applying color…')
    await dialog.getByRole('option', { name: 'Primary' }).click()
    assert.deepEqual(await h.app.evaluate(() => window.__pickerFixture.attempts), ['--secondary'])
    await h.app.evaluate(() => {
      window.__pickerFixture.hold = false
      window.__pickerFixture.release.reject(Error('Rejected for fixture'))
    })
    assert.equal(await dialog.getByRole('status').innerText(), 'Could not apply color. Try again.')
    assert.equal(await card.getAttribute('aria-selected'), 'true')
    assert.equal(await secondary.getAttribute('aria-selected'), 'false')
    await secondary.click()
    assert.equal(await secondary.getAttribute('aria-selected'), 'true')
    assert.equal(await search.evaluate(node => node === node.getRootNode().activeElement), true)
    await trigger.click()
    assert.equal(await dialog.count(), 0)
  } finally { await h.close() }
})
