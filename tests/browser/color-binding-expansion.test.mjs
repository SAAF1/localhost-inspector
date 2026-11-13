import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

const source = 'src/styles/theme.css'
const options = {
  colorCatalog: { source, names: ['--accent', '--another'], canCreate: true },
  appStyles: ':root { --accent: oklch(.7 .1 240 / .6); --another: var(--accent); }',
}
const action = (h, name) => h.host.getByRole('button', { name, exact: true })
const picker = h => h.host.getByRole('dialog', { name: 'Variables', exact: true })
const choose = (h, name) => picker(h).getByRole('option', { name, exact: true }).click()
const undo = h => action(h, 'Undo last preview').click()
const declared = (h, selector, property) =>
  h.app.locator(selector).evaluate((node, name) => node.style.getPropertyValue(name), property)

test('Text color identifies different bindings at equal paint, updates actual text, and keeps Undo per target', async () => {
  const h = await createHarness(options)
  try {
    await h.app.evaluate(() => {
      const group = document.createElement('div')
      group.id = 'text-group'
      group.style.padding = '12px'
      group.innerHTML = '<p id="first" style="color: var(--accent)">First</p><p id="second" style="color: var(--another)">Second</p>'
      document.body.append(group)
    })
    await h.open()
    await h.select('#text-group')
    assert.equal(await h.host.getByRole('textbox', { name: 'Text color', exact: true }).getAttribute('placeholder'), 'Mixed')
    await action(h, 'Text color variables').click()
    await choose(h, 'accent')
    await h.settled()
    assert.equal(await declared(h, '#second', 'color'), 'var(--accent)')
    assert.equal(await declared(h, '#text-group', 'color'), '')
    assert.equal((await h.journal()).length, 1)
    assert.equal(await action(h, 'Text color variable accent').count(), 1)
    await picker(h).getByRole('combobox').press('Escape')
    await action(h, 'Detach text color variable').click()
    await h.settled()
    assert.equal(await declared(h, '#first', 'color'), 'oklch(0.7 0.1 240 / 0.6)')
    assert.equal(await declared(h, '#second', 'color'), 'oklch(0.7 0.1 240 / 0.6)')
    await undo(h)
    await h.settled()
    assert.equal(await declared(h, '#second', 'color'), 'var(--accent)')
    assert.equal(await h.host.getByRole('textbox', { name: 'Text color', exact: true }).getAttribute('placeholder'), 'Mixed')
  } finally { await h.close() }
})

test('Stroke preserves an existing inline solid border and keeps split inline declarations outside the variable control', async () => {
  const h = await createHarness(options)
  try {
    await h.app.evaluate(() => {
      document.querySelector('#target').style.setProperty('border', '3px solid #333', 'important')
    })
    await h.open()
    await h.select()
    assert.equal(await h.host.getByRole('textbox', { name: 'Stroke color', exact: true }).count(), 1)
    await action(h, 'Open stroke color picker').click()
    const custom = h.host.getByRole('dialog', { name: 'Color picker', exact: true })
    assert.equal(await custom.getByRole('tab', { name: 'Custom' }).getAttribute('aria-selected'), 'true')
    await custom.getByRole('tab', { name: 'Libraries' }).click()
    await choose(h, 'accent')
    await h.settled()
    for (const side of ['top', 'right', 'bottom', 'left']) {
      assert.equal(await h.css('border-' + side + '-color'), 'oklch(0.7 0.1 240 / 0.6)')
      assert.equal(await h.css('border-' + side + '-width'), '3px')
      assert.equal(await h.css('border-' + side + '-style'), 'solid')
    }
    await picker(h).getByRole('combobox').press('Escape')
    await undo(h)
    await h.settled()
    assert.equal(await declared(h, '#target', 'border'), '3px solid rgb(51, 51, 51)')
    assert.equal(await h.app.locator('#target').evaluate(node => node.style.getPropertyPriority('border')), 'important')
    await h.app.evaluate(() => {
      document.querySelector('#target').style.setProperty('border', '0 solid #333')
    })
    await h.select()
    await action(h, 'Stroke variables').click()
    await choose(h, 'accent')
    await h.settled()
    assert.equal(await declared(h, '#target', 'border-color'), 'var(--accent)')
    assert.equal(await h.css('border-top-width'), '0px')
    await picker(h).getByRole('combobox').press('Escape')
    await undo(h)
    await h.settled()
    await h.app.evaluate(() => { document.querySelector('#target').style.borderRightColor = 'red' })
    await h.select()
    assert.equal(await action(h, 'Stroke variables').count(), 0)
  } finally { await h.close() }
})

test('Create saves one pending Fill, keeps source variables out of the page, and supports comparison and Undo', async () => {
  const h = await createHarness({ ...options, dock: true })
  try {
    await h.open()
    await h.select()
    await action(h, 'Open fill color picker').click()
    const add = action(h, 'Create color variable')
    await add.click()
    const form = h.host.getByRole('dialog', { name: 'Variable', exact: true })
    const name = form.getByRole('textbox', { name: 'Name' })
    await name.press('Escape')
    await add.press('Enter')
    await name.fill('  Revenue surface  ')
    const value = form.getByRole('textbox', { name: 'Value', exact: true })
    await value.fill('color-mix(in srgb, red, blue)')
    await action(h, 'Create variable').click()
    assert.equal(await form.getByRole('alert').textContent(), 'Enter a solid color.')
    assert.deepEqual(await h.journal(), [])
    await action(h, 'Open variable color picker').click()
    const custom = form.getByRole('dialog', { name: 'Color picker', exact: true })
    const customValue = custom.getByRole('textbox', { name: 'Custom color value' })
    await customValue.fill('33669980')
    await customValue.press('Enter')
    assert.equal(await value.inputValue(), 'rgba(51, 102, 153, 0.5)')
    assert.deepEqual(await h.journal(), [])
    await customValue.press('Escape')
    await action(h, 'Create variable').click()
    await h.settled()
    assert.equal(await form.count(), 0)
    await h.host.getByRole('tab', { name: 'Libraries' }).click()
    assert.equal(await picker(h).getByRole('option', { name: 'Revenue surface' }).getAttribute('aria-selected'), 'true')
    assert.equal(await h.host.getByText('Preview · Source change pending').count(), 1)
    assert.equal(await declared(h, '#target', '--revenue-surface'), '')
    const edits = await h.journal()
    assert.equal(edits.length, 1)
    assert.deepEqual(edits[0].pendingColor, {
      source, label: 'Revenue surface', name: '--revenue-surface', value: 'rgba(51, 102, 153, 0.5)',
    })
    await picker(h).getByRole('combobox').press('Escape')
    const compare = h.host.locator('#clear')
    await compare.click()
    assert.equal(await h.host.getByText('Preview · Source change pending').count(), 0)
    await compare.click()
    await h.settled()
    assert.equal(await h.host.getByText('Preview · Source change pending').count(), 1)
    await undo(h)
    await h.settled()
    assert.equal(await h.host.getByText('Preview · Source change pending').count(), 0)
    assert.equal(await h.css('background-color'), 'rgb(255, 255, 255)')
  } finally { await h.close() }
})

test('a literal Fill opens one visual editor even when no color catalog is connected', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select()
    assert.equal(await h.host.getByRole('textbox', { name: 'Fill color', exact: true }).count(), 1)
    await action(h, 'Open fill color picker').click()
    const popup = h.host.getByRole('dialog', { name: 'Color picker', exact: true })
    assert.equal(await popup.getByRole('tab', { name: 'Libraries' }).count(), 0)
    assert.deepEqual(await h.journal(), [])
    await popup.getByRole('button', { name: /Saturation and brightness/ }).click()
    await h.settled()
    assert.equal((await h.journal()).length, 1)
    assert.notEqual(await h.css('background-color'), 'rgb(255, 255, 255)')
    await popup.getByRole('textbox', { name: 'Custom color value' }).press('Escape')
    assert.equal(await popup.count(), 0)
    await undo(h); await h.settled()
    assert.equal(await h.css('background-color'), 'rgb(255, 255, 255)')
  } finally { await h.close() }
})

test('a long Libraries list scrolls and Create stays available after choosing a Fill variable', async () => {
  const names = Array.from({ length: 32 }, (_, index) => '--palette-' + index)
  const h = await createHarness({
    dock: true,
    colorCatalog: { source, names, canCreate: true },
    appStyles: ':root {' + names.map(name => name + ':#336699;').join('') + '}',
  })
  try {
    await h.page.setViewportSize({ width: 1000, height: 430 })
    await h.open()
    await h.select()
    await action(h, 'Open fill color picker').press('Enter')
    const add = action(h, 'Create color variable')
    assert.equal(await add.isVisible(), true)
    await h.host.getByRole('tab', { name: 'Libraries' }).click()
    const list = picker(h).getByRole('listbox')
    await list.hover()
    await h.page.mouse.wheel(0, 2400)
    await h.page.waitForFunction(() => document.querySelector('#localhost-inspector').shadowRoot
      .querySelector('.li-color-picker-list')?.scrollTop > 0, null, { timeout: 4000 })
    const last = picker(h).getByRole('option', { name: 'palette-31', exact: true })
    await last.click()
    await h.settled()
    assert.equal(await declared(h, '#target', 'background-color'), 'var(--palette-31)')
    assert.equal(await add.isVisible(), true)
    await picker(h).getByRole('combobox').press('Escape')
    await action(h, 'Fill variable palette-31').press('Enter')
    await add.click()
    const form = h.host.getByRole('dialog', { name: 'Variable', exact: true })
    assert.equal(await form.getByRole('textbox', { name: 'Value', exact: true }).inputValue(), '336699')
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill('New blue')
    await action(h, 'Create variable').click()
    await h.settled()
    assert.equal(await h.host.getByText('Preview · Source change pending').isVisible(), true)
    assert.equal(await add.isVisible(), true)
  } finally { await h.close() }
})
