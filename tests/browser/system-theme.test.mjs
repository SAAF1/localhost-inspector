import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

const background = node => node.evaluate(element => getComputedStyle(element).backgroundColor)
const scheme = node => node.evaluate(element => getComputedStyle(element).colorScheme)

test('an open Inspector picker follows system appearance without changing the edit or the app', async () => {
  const h = await createHarness({
    dock: true,
    colorCatalog: { source: 'src/styles/theme.css', names: ['--qa-blue'], canCreate: true },
    appStyles: ':root { --qa-blue: #2979b9; }',
  })
  try {
    await h.page.emulateMedia({ colorScheme: 'light' })
    await h.open()
    await h.select()
    await h.enter('Gap', 20)
    await h.settled()
    const panel = h.host.getByRole('region', { name: 'Design inspector' })
    const trigger = h.host.getByRole('button', { name: 'Fill variables', exact: true })
    await trigger.press('Enter')
    const picker = h.host.getByRole('dialog', { name: 'Variables', exact: true })
    const search = picker.getByRole('combobox', { name: 'Search colors' })
    await search.fill('blue')
    const light = await background(panel)
    assert.equal(await scheme(picker), 'light')
    assert.equal(await background(picker), light)

    await h.page.emulateMedia({ colorScheme: 'dark' })
    const dark = await background(panel)
    assert.notEqual(dark, light)
    assert.equal(await scheme(picker), 'dark')
    assert.equal(await background(picker), dark)
    assert.equal(await search.inputValue(), 'blue')
    assert.equal(await search.evaluate(node => node === node.getRootNode().activeElement), true)
    assert.equal(await h.css('gap'), '20px')
    assert.equal(await h.css('background-color'), 'rgb(255, 255, 255)')
    assert.equal((await h.journal()).length, 1)

    await search.press('Escape')
    await h.host.getByRole('button', { name: 'Gap options' }).press('Enter')
    const gapMenu = h.host.getByRole('menu', { name: 'Gap options' })
    const commandSurface = await background(gapMenu)
    assert.equal(await scheme(gapMenu), 'dark')
    await h.page.emulateMedia({ colorScheme: 'light' })
    assert.equal(await background(panel), light)
    assert.equal(await background(gapMenu), commandSurface)
    assert.equal(await scheme(gapMenu), 'dark')
  } finally { await h.close() }
})
