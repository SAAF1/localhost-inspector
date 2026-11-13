import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

const source = 'src/styles/spacing.css'
const spacingCatalog = {
  source,
  names: ['--space-small', '--space-roomy', '--space-none', '--space-alias',
    '--space-bad', '--space-cycle', '--space-negative'],
}
const appStyles = `
  :root { --space-small: 8px; --space-roomy: 1.5rem; --space-none: 0;
    --space-alias: var(--space-small); --space-bad: red;
    --space-cycle: var(--space-cycle); --space-negative: -4px; }
  :root[data-theme="dark"] { font-size: 20px; --space-small: 10px; }
  @media (prefers-color-scheme: dark) { :root[data-theme="dark"] { font-size: 24px; } }
  @media (max-width: 700px) { :root[data-theme="dark"] { font-size: 22px; } }
`
const target = h => h.app.locator('#target')
const declaration = h => target(h).evaluate(node => node.style.getPropertyValue('gap'))
const picker = h => h.host.getByRole('dialog', { name: 'Spacing variables', exact: true })
const choose = (h, name) => picker(h).getByRole('option', { name: new RegExp(name) }).click()
const gap = h => h.host.getByRole('spinbutton', { name: 'Gap', exact: true })

test('a fixed Gap applies a registered variable, shows the resolved pill, detaches, and undoes', async () => {
  const h = await createHarness({ appStyles, spacingCatalog, dock: true })
  try {
    await h.open()
    await h.select()
    await h.host.getByRole('button', { name: 'Gap options' }).click()
    const menu = h.host.getByRole('menu', { name: 'Gap options' })
    assert.equal(await menu.getByRole('menuitemradio', { name: '8', exact: true }).getAttribute('aria-checked'), 'true')
    await menu.getByRole('menuitem', { name: 'Apply variable…' }).click()
    assert.equal(await picker(h).getByRole('option').count(), 4)
    await choose(h, 'space-small')
    await h.settled()
    assert.equal(await declaration(h), 'var(--space-small)')
    assert.equal(await h.css('gap'), '8px')
    assert.equal(await picker(h).count(), 0)
    assert.deepEqual((await h.journal())[0].spacingToken, { name: '--space-small', source })
    const pill = h.host.getByRole('button', { name: '8, Gap variable space-small' })
    await pill.click()
    assert.equal(await picker(h).getByRole('option', { name: /space-small/ }).getAttribute('aria-selected'), 'true')
    const search = picker(h).getByRole('combobox')
    await search.fill('space-roomy')
    await search.press('ArrowDown')
    await search.press('Enter')
    await h.settled()
    assert.equal(await h.css('gap'), '24px')
    await h.app.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    assert.equal(await h.css('gap'), '30px')
    await h.host.getByRole('button', { name: '30, Gap variable space-roomy' }).waitFor()
    await h.page.emulateMedia({ colorScheme: 'dark' })
    await h.host.getByRole('button', { name: '36, Gap variable space-roomy' }).waitFor()
    await h.page.setViewportSize({ width: 890, height: 1400 })
    const changed = h.host.getByRole('button', { name: '33, Gap variable space-roomy' })
    await changed.press('Backspace')
    await h.settled()
    assert.equal(await declaration(h), '33px')
    assert.equal(await gap(h).inputValue(), '33')
    const undo = h.host.getByRole('button', { name: 'Undo last preview' })
    await undo.click()
    await h.settled()
    assert.equal(await declaration(h), 'var(--space-roomy)')
    await undo.click()
    await h.settled()
    assert.equal(await declaration(h), 'var(--space-small)')
    await undo.click()
    await h.settled()
    assert.equal(await declaration(h), '')
    assert.equal(await h.css('gap'), '8px')
  } finally { await h.close() }
})

test('a spacing preview never overwrites mixed, Auto, or a failed write', async () => {
  const h = await createHarness({ appStyles, spacingCatalog, failSave: 1 })
  try {
    await h.open()
    await target(h).evaluate(node => { node.style.gap = '8px 16px' })
    await h.select()
    const openOptions = () => h.host.getByRole('button', { name: 'Gap options' }).click()
    const apply = h.host.getByRole('menuitem', { name: 'Apply variable…' })
    await openOptions()
    assert.equal(await apply.count(), 0)
    await h.page.keyboard.press('Escape')
    await target(h).evaluate(node => { node.style.gap = '8px'; node.style.justifyContent = 'space-between' })
    await h.select()
    await openOptions()
    assert.equal(await apply.count(), 0)
    await h.page.keyboard.press('Escape')
    await target(h).evaluate(node => { node.style.justifyContent = 'start' })
    await h.select()
    await gap(h).press('=')
    await choose(h, 'space-roomy')
    await h.settled()
    assert.equal(await declaration(h), '8px')
    assert.equal((await h.journal()).length, 0)
    assert.equal(await picker(h).getByText('Could not apply spacing. Try again.').isVisible(), true)
  } finally { await h.close() }
})

test('the individual Padding variable button binds only that side and restores it through comparison and Undo', async () => {
  const h = await createHarness({ appStyles, spacingCatalog })
  try {
    await h.open()
    await target(h).evaluate(node => { node.style.padding = '4px 12px 8px' })
    await h.select()
    const top = h.field('Top padding')
    const trigger = h.host.getByRole('button', { name: 'Apply variable to top padding' })
    await top.hover()
    assert.equal(await trigger.evaluate(button => getComputedStyle(button).opacity), '1')
    await trigger.press('Enter')
    await choose(h, 'space-small')
    await h.settled()
    const pill = h.host.getByRole('button', { name: '8, Top padding variable space-small' })
    await pill.waitFor()
    assert.equal(await h.css('padding'), '8px 12px')
    assert.equal((await h.journal())[0].property, 'padding-top')
    assert.deepEqual((await h.journal())[0].spacingToken, { name: '--space-small', source })

    await h.host.locator('#clear').click()
    assert.equal(await h.css('padding'), '4px 12px 8px')
    await h.host.locator('#clear').click()
    await h.settled()
    assert.equal(await h.css('padding'), '8px 12px')
    await pill.press('Backspace')
    await h.settled()
    assert.equal(await target(h).evaluate(node => node.style.paddingTop), '8px')
    assert.equal(await h.host.locator('#control-padding-toggle').evaluate(button =>
      button.getRootNode().activeElement === button), true)
    await h.host.getByRole('button', { name: 'Undo last preview' }).click()
    await h.settled()
    assert.equal(await target(h).evaluate(node => node.style.paddingTop), 'var(--space-small)')
  } finally { await h.close() }
})

test('Padding does not offer binding when an inline shorthand or logical side cannot be safely restored', async () => {
  const h = await createHarness({ appStyles, spacingCatalog })
  try {
    await h.open()
    await target(h).evaluate(node => { node.style.padding = 'var(--space-small)' })
    await h.select()
    await h.host.getByRole('button', { name: 'Expand individual padding' }).click()
    const trigger = h.host.getByRole('button', { name: 'Apply variable to top padding' })
    assert.equal(await trigger.count(), 0)
    await h.field('Top padding').press('=')
    assert.equal(await picker(h).count(), 0)
    await target(h).evaluate(node => { node.style.cssText = 'padding-top: 4px; padding-block-start: 5px' })
    await h.select()
    assert.equal(await h.css('padding-top'), '5px')
    assert.equal(await trigger.count(), 0)
  } finally { await h.close() }
})

test('compact Padding exposes the picker and applies or detaches only the selected pair', async () => {
  const h = await createHarness({ appStyles, spacingCatalog })
  try {
    await h.open()
    await target(h).evaluate(node => { node.style.padding = '4px 12px' })
    await h.select()
    await h.field('Vertical padding').focus()
    const trigger = h.host.getByRole('button', { name: 'Apply variable to vertical padding' })
    assert.equal(await trigger.evaluate(button => getComputedStyle(button).opacity), '1')
    await trigger.click()
    await choose(h, 'space-small')
    const pill = h.host.getByRole('button', { name: '8, Vertical padding variable space-small' })
    await pill.waitFor()
    assert.equal(await h.css('padding'), '8px 12px')
    assert.deepEqual((await h.journal()).map(entry => entry.property), ['padding-top', 'padding-bottom'])
    await pill.press('Backspace')
    await h.settled()
    assert.equal(await h.css('padding'), '8px 12px')
    assert.equal(await h.field('Vertical padding').inputValue(), '8')
    assert.equal(await target(h).evaluate(node => node.style.padding), '8px 12px')
    await h.field('Horizontal padding').press('=')
    await choose(h, 'space-roomy')
    await h.host.getByRole('button', { name: '24, Horizontal padding variable space-roomy' }).waitFor()
    assert.equal(await h.css('padding'), '8px 24px')
  } finally { await h.close() }
})

test('retrying a partial compact Padding save only writes the remaining side', async () => {
  const h = await createHarness({ appStyles, spacingCatalog, failSave: 2 })
  try {
    await h.open()
    await target(h).evaluate(node => { node.style.padding = '4px 12px' })
    await h.select()
    await h.field('Vertical padding').press('=')
    await choose(h, 'space-small')
    await picker(h).getByText('Could not apply spacing. Try again.').waitFor()
    assert.equal(await h.css('padding'), '8px 12px 4px')
    assert.equal((await h.journal()).length, 1)
    await choose(h, 'space-small')
    await h.settled()
    assert.equal(await h.css('padding'), '8px 12px')
    assert.deepEqual((await h.journal()).map(entry => entry.property), ['padding-top', 'padding-bottom'])
  } finally { await h.close() }
})
